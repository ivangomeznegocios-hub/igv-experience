import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import { project, type GameState } from '../engine/project';
import { TRAINING_SETTINGS_ID } from '../engine/modules/training';
import {
  FOOD_IDEAS,
  JOINT_STRESS,
  PATTERNS,
  coachPlan,
  coachProfile,
  coachSettingsOf,
  nutritionDay,
  nutritionTargets,
  patternOptions,
  stepsTarget,
  weekReview,
  type CoachPlan,
  type PrescribedExercise,
  type PrescribedSession,
} from '../engine/coach';
import { matchExercise, type ExerciseDef } from '../training/library';
import {
  BODY_AREAS,
  BODY_AREA_NAMES,
  COACH_GOALS,
  COACH_GOAL_NAMES,
  COACH_LEVELS,
  COACH_LEVEL_NAMES,
  MEAL_KINDS,
  MEAL_KIND_NAMES,
  MEAL_TAGS,
  MEAL_TAG_NAMES,
  WORKOUT_PLACES,
  type BodyArea,
  type CoachSettings,
  type Entity,
  type GameEvent,
  type TrainingSettingsData,
} from '../types';
import { addDays, isDateString, weekStart, weekday } from '../util/dates';
import { fmtDay, fmtNum } from './format';
import type { AssistantSnapshot } from './snapshot';
import { ToolError, makeEvent, ok, pastDate, tool, upsert, zDate, zFecha, type AssistantStore } from './toolkit';

/**
 * Herramientas de IA del entrenador personal: ver el plan (fase, semana, sesión de hoy con pesos objetivo, cardio,
 * pasos, sueño, nutrición), ajustarlo (objetivo, días, molestias…), y registrar comidas, agua, pasos, cómo te
 * sientes y el check-in semanal. Nada de esto da XP (la XP del entreno sale de registrar_entrenamiento).
 */

const DAY_IDS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const;
const DAY_LABEL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Eventos que lee el entrenador (para recalcular su plan en el servidor). */
export const COACH_EVENT_TYPES = ['workout.logged', 'body.logged', 'checkin.morning', 'meal.logged', 'water.logged', 'steps.logged', 'coach.readiness', 'coach.checkin'];

/**
 * Historial del plan: fases y descargas (semanas entrenadas desde el inicio), progresión de cada ejercicio (la última vez
 * que lo hiciste, aunque sea de antes del plan o de hace años: "retoma con X kg"), récords, dónde entrenas, check-ins que
 * frenan una semana y el peso. Se lee completo, como en la app y en la foto: son pocos registros al año.
 */
export const COACH_HISTORY_TYPES = ['workout.logged', 'body.logged', 'coach.checkin'];
/** Registro diario (comidas, agua, pasos, sueño, cómo te sientes): el plan solo mira las últimas semanas. */
export const COACH_DAILY_TYPES = COACH_EVENT_TYPES.filter((t) => !COACH_HISTORY_TYPES.includes(t));
/**
 * Días de registro diario que carga el plan completo: esta semana, la pasada, los días del promedio de pasos de la
 * semana pasada y los 14 días de ver_nutricion, con margen.
 */
const DAILY_DAYS = 35;

const trainingSettingsOf = (catalog: Entity[]) => catalog.find((e) => e.id === TRAINING_SETTINGS_ID && !e.deletedAt)?.data as TrainingSettingsData | undefined;

export interface CoachStateOptions {
  catalog?: Entity[];
  /** Tipos de registro diario que hacen falta (por defecto, todos). */
  daily?: string[];
  /** Desde cuándo leer el registro diario (por defecto, `DAILY_DAYS` atrás). */
  dailyFrom?: string;
  /** Registros que aún no se guardan: las herramientas calculan su respuesta ANTES de escribir. */
  extra?: GameEvent[];
  /**
   * Los entrenos anteriores a esta fecha se proyectan sin sus series (proyectar series es lo más caro). La fase solo
   * cuenta sesiones por semana y el lugar habitual sale de dónde fueron, así que alcanza para respuestas que dicen la
   * fase, la sesión de hoy y sus ajustes; NO para pesos objetivo, récords ni la lista de ejercicios (eso lo da
   * ver_plan_entrenador).
   */
  detailFrom?: string;
}

/**
 * Estado para el plan del entrenador (sin XP: solo lo que el coach necesita). El historial del plan va completo (como en
 * la app y en la foto); el registro diario, solo de las últimas semanas, porque es lo más numeroso (un evento por vaso de
 * agua) y el plan no mira más atrás.
 */
export async function coachStateFor(store: AssistantStore, opts: CoachStateOptions | Entity[] = {}): Promise<GameState> {
  const o: CoachStateOptions = Array.isArray(opts) ? { catalog: opts } : opts;
  const today = store.today;
  const daily = o.daily ?? COACH_DAILY_TYPES;
  const [cat, history, recent] = await Promise.all([
    o.catalog ?? store.catalog(),
    store.events({ types: COACH_HISTORY_TYPES, to: today, order: 'asc' }),
    daily.length ? store.events({ types: daily, from: o.dailyFrom ?? addDays(today, -DAILY_DAYS), to: today, order: 'asc' }) : Promise.resolve([]),
  ]);
  const from = o.detailFrom;
  const plan = from ? history.map((e) => (e.type === 'workout.logged' && e.localDate < from ? { ...e, payload: { ...(e.payload as object), exercises: [] } } : e)) : history;
  // project() ordena los eventos, así que basta con juntarlos.
  return project({ events: [...plan, ...recent, ...(o.extra ?? [])], entities: cat, today });
}

/** Lo de hoy que cambia la sesión (sueño y cómo te sientes): basta para la respuesta de las herramientas que ajustan. */
const SESSION_DAILY_TYPES = ['checkin.morning', 'coach.readiness'];
/** Desde cuándo hacen falta las series de los entrenos para la sesión de hoy: esta semana y la pasada (recuperación). */
const sessionDetailFrom = (today: string) => addDays(weekStart(today), -7);
/** Lo que usa el resumen de una semana (check-in): pasos, sueño, comidas y agua. */
const CHECKIN_DAILY_TYPES = ['checkin.morning', 'meal.logged', 'water.logged', 'steps.logged'];

/** Días de fuerza a la semana según tus ajustes (solo mueven las calorías, que las respuestas cortas no muestran). */
function strengthDayCount(state: GameState): number {
  const cs = coachSettingsOf(state);
  return cs.days?.length || GAME_CONFIG.coach.defaultDays[cs.level ?? 'sedentario'].length;
}

// ---------------------------------------------------------------------------------------------
// Texto del plan (lo usan la herramienta, la foto para la IA y el panorama del Coach)
// ---------------------------------------------------------------------------------------------

/** Nombre de una zona del cuerpo; una que esta versión no conoce (de una versión más nueva) se muestra tal cual. */
const areaName = (a: string) => (BODY_AREA_NAMES[a as BodyArea] ?? a).toLowerCase();

const range = (r: [number, number] | null, unit = '') => (r ? `${r[0]}–${r[1]}${unit}` : '');

export function fmtPrescribed(e: PrescribedExercise): string {
  const target = e.targetKg ? ` @ ${e.targetKg} kg` : '';
  const reps = e.seconds ? `${range(e.seconds, ' s')}` : range(e.reps);
  const aim = e.targetReps && e.reps ? ` (busca ${e.targetReps})` : e.targetSec ? ` (busca ${e.targetSec} s)` : '';
  return `${e.name}: ${e.sets}×${reps}${target}${aim} · reserva ${e.rir[0]}–${e.rir[1]} · descanso ${Math.round(e.restSec / 15) * 15} s [patrón ${e.slot}]`;
}

export function fmtSession(s: PrescribedSession, detailed: boolean): string[] {
  const L: string[] = [`${s.title}${s.estMinutes ? ` (~${s.estMinutes} min)` : ''}: ${s.focus}`];
  for (const a of s.adjustments) L.push(`  Ajuste: ${a}`);
  if (s.exercises.length) {
    if (detailed && s.warmup.length) L.push(`  Calentamiento: ${s.warmup.join(' ')}`);
    for (const e of s.exercises) {
      L.push(`  - ${fmtPrescribed(e)}`);
      if (detailed && e.note) L.push(`    ${e.note}`);
    }
  }
  if (s.cardio) L.push(`  - ${s.cardio.name} ${s.cardio.minutes} min. ${s.cardio.intensity}`);
  return L;
}

/** Líneas del plan del entrenador (compactas para el panorama; completas para ver_plan_entrenador). */
export function coachPlanLines(p: CoachPlan, detailed: boolean): string[] {
  const L: string[] = [];
  const pr = p.profile;
  if (!pr.configured) {
    L.push(`Entrenador (${pr.coachName}): Iván aún no arma su plan. Si habla de entrenar, ofrécele armarlo con ajustar_entrenador: se arma al mandar objetivo, nivel, días o minutos (o activar: true para empezar con los valores por defecto); las molestias van en la misma llamada, solas no lo arman. Mientras, el plan usa valores por defecto (sedentario, salud, 3 días).`);
  } else {
    L.push(
      `Entrenador "${pr.coachName}": objetivo ${COACH_GOAL_NAMES[pr.goal].toLowerCase()} · nivel ${pr.level} · fase ${p.phase.name.toLowerCase()} (semana ${p.phase.weekNumber} del plan, ${p.phase.trainedWeeks} semanas entrenadas${p.phase.nextPhaseIn !== null ? `, faltan ${p.phase.nextPhaseIn} para la siguiente fase` : ''})${p.phase.light ? ' · SEMANA LIGERA' : ''}.`,
    );
  }
  const body = [
    pr.weightKg ? `peso ${pr.weightKg} kg (${pr.weightDate})` : 'sin peso registrado',
    pr.heightCm ? `estatura ${pr.heightCm} cm` : '',
    pr.bmi ? `IMC ${pr.bmi} (${pr.bmiLabel})` : '',
    pr.waistCm ? `cintura ${pr.waistCm} cm${pr.waistToHeight ? ` (cintura/estatura ${pr.waistToHeight}${pr.waistToHeight >= 0.5 ? ', riesgo' : ''})` : ''}` : '',
    pr.bodyFatPct ? `grasa ${pr.bodyFatPct}%` : '',
    pr.ageYears ? `${pr.ageYears} años` : '',
    pr.targetWeightKg ? `meta ${pr.targetWeightKg} kg` : '',
  ].filter(Boolean);
  L.push(`Cuerpo: ${body.join(' · ')}.${pr.missing.length ? ` Falta: ${pr.missing.join(', ')}.` : ''}`);
  if (pr.limitations.length) L.push(`Molestias o lesiones: ${pr.limitations.map(areaName).join(', ')} (el plan evita lo que las carga).`);
  L.push(`Días de fuerza: ${p.strengthDays.map((d) => DAY_LABEL[d]).join(', ')} · ${p.sessionMinutes} min por sesión · entrena en ${pr.where ?? 'gym'}.`);
  const t = p.targets;
  L.push(
    `Esta semana: fuerza ${t.strength.done}/${t.strength.target} · cardio ${t.cardio.done}/${t.cardio.target} min · pasos ${t.steps.avg !== null ? `promedio ${fmtNum(t.steps.avg)}` : 'sin registro'} (meta ${fmtNum(t.steps.target)}/día) · sueño ${t.sleep.avg !== null ? `promedio ${t.sleep.avg} h` : 'sin registro'}${t.sleep.lastNight !== null ? `, anoche ${t.sleep.lastNight} h` : ''} · comida ${t.nutrition.avg !== null ? `${t.nutrition.avg}/100` : 'sin registro'}.`,
  );
  L.push('Hoy:', ...fmtSession(p.today.session, detailed));
  if (p.today.readiness) L.push(`Cómo se siente hoy: energía ${p.today.readiness.energy}/5, adolorido ${p.today.readiness.soreness}/3${p.today.readiness.pain.length ? `, molestia en ${p.today.readiness.pain.map(areaName).join(', ')}` : ''}.`);
  if (p.today.next) L.push(`Siguiente sesión de fuerza: ${p.today.next.title} el ${fmtDay(p.today.next.date)}.`);
  if (detailed) {
    L.push('', 'Semana:');
    for (const d of p.week) L.push(`- ${d.label} ${d.date}${d.isToday ? ' (HOY)' : ''}: ${d.title}${d.didStrength || d.didCardio ? ` · hecho: ${d.doneTitles.join(', ')}` : d.past && d.kind === 'fuerza' ? ' · no se hizo' : ''}`);
  }
  const n = p.nutrition;
  L.push(
    `Nutrición: ${n.targets.kcal ? `${fmtNum(n.targets.kcal)} kcal/día · ` : ''}${n.targets.proteinG ? `proteína ${n.targets.proteinG} g (~${n.targets.proteinPerMeal} g por comida) · ` : ''}agua ${n.targets.waterGlasses} vasos · hoy ${n.today.score !== null ? `${n.today.score}/100 (${n.today.checks.map((c) => `${c.label} ${c.done ? '✓' : c.detail}`).join(', ')})` : 'sin registro'}.${n.today.tip ? ` Consejo: ${n.today.tip}` : ''}`,
  );
  if (p.weight.verdict) L.push(`Peso: ${p.weight.verdict}`);
  if (p.weight.measureDue) L.push(`Toca medirse (peso y cintura${p.weight.daysSinceMeasure !== null ? `; última vez hace ${p.weight.daysSinceMeasure} días` : ''}): pídeselo con registrar_cuerpo.`);
  if (p.checkinWeek) L.push(`Toca el check-in semanal de la semana del ${fmtDay(p.checkinWeek)}: pregúntale cómo le fue (qué tan pesado, energía, ánimo, molestias) y guárdalo con registrar_checkin_semanal.`);
  const lw = p.lastWeek;
  L.push(`Semana pasada: fuerza ${lw.strength.done}/${lw.strength.target}, cardio ${lw.cardio.done}/${lw.cardio.target} min, cumplimiento ${lw.compliance}% → ${lw.verdictText}`);
  if (detailed) L.push('', 'Por qué el plan es así:', ...p.why.map((w) => `- ${w}`));
  L.push(`Lo que diría el coach ahora: ${p.brief.message}`);
  return L;
}

/** Sección "## Entrenador" del panorama (usa la foto; las cifras del día pueden tener unas horas). */
export function renderCoachOverview(s: AssistantSnapshot): string[] {
  const c = (s as { coach?: { lines: string[] } }).coach;
  if (!c?.lines?.length) return [];
  return ['', '## Entrenador personal (usa ver_plan_entrenador para el detalle fresco)', ...c.lines];
}

// ---------------------------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------------------------

const verPlan = tool({
  name: 'ver_plan_entrenador',
  title: 'Ver plan del entrenador',
  group: 'consultar',
  writes: false,
  description:
    'Plan del entrenador personal de Iván: objetivo, nivel, fase (adaptación → base → progreso, con descargas), semana con días de fuerza y cardio, la sesión de HOY con ejercicios, series × repeticiones, peso objetivo (sobrecarga progresiva con su historial), reserva y descanso, ajustes por sueño o molestias, metas de cardio, pasos, sueño y nutrición (calorías, proteína, agua), tendencia de peso, check-in pendiente y la semana pasada. Úsala antes de recomendarle qué entrenar o comer.',
  input: z.object({}),
  async run(_i, store) {
    const state = await coachStateFor(store);
    const p = coachPlan(state, store.now().toISOString());
    return { text: [`# Plan del entrenador · ${fmtDay(store.today)}`, ...coachPlanLines(p, true)].join('\n') };
  },
});

const verNutricion = tool({
  name: 'ver_nutricion',
  title: 'Ver nutrición',
  group: 'consultar',
  writes: false,
  description: 'Comidas, agua y calificación de hábitos de los últimos días (proteína, verduras, fruta, agua, ultraprocesados), metas de calorías y proteína, porciones con la mano e ideas de comida mexicana para lo que falta.',
  input: z.object({ dias: z.number().int().min(1).max(14).optional().describe('Días hacia atrás (por defecto 7).') }),
  async run({ dias }, store) {
    const state = await coachStateFor(store);
    const p = coachPlan(state, store.now().toISOString());
    const t = p.nutrition.targets;
    const L = [`# Nutrición · ${fmtDay(store.today)}`];
    L.push(`Metas: ${t.kcal ? `${fmtNum(t.kcal)} kcal (gasto ${fmtNum(t.tdee!)}, reposo ${fmtNum(t.bmr!)})` : 'calorías sin calcular'} · proteína ${t.proteinG ?? '?'} g · agua ${t.waterGlasses} vasos (${t.waterMl} ml) · fibra ${t.fiberG} g · proteína en ${t.meals.protein} comidas, verdura en ${t.meals.veggies}, fruta ${t.meals.fruit}.`);
    L.push(`Porciones por comida: proteína ${t.portions.proteina}, verduras ${t.portions.verduras}, carbohidratos ${t.portions.carbos}, grasas ${t.portions.grasas}.`);
    for (const n of t.notes) L.push(`Nota: ${n}`);
    for (let i = 0; i < (dias ?? 7); i++) {
      const d = addDays(store.today, -i);
      const day = nutritionDay(state.coach, d, t);
      if (day.score === null) {
        L.push(`- ${fmtDay(d)}: sin registro`);
        continue;
      }
      L.push(`- ${fmtDay(d)}: ${day.score}/100 · ${day.checks.map((c) => `${c.label} ${c.done ? '✓' : c.detail}`).join(', ')}`);
      for (const m of day.meals) L.push(`    ${MEAL_KIND_NAMES[m.meal]}: ${[m.text, m.tags.map((x) => MEAL_TAG_NAMES[x]).join(', '), m.proteinG ? `${m.proteinG} g proteína` : '', m.kcal ? `${m.kcal} kcal` : ''].filter(Boolean).join(' · ')} [${m.eventId}]`);
    }
    if (p.nutrition.today.tip) L.push(`Consejo de hoy: ${p.nutrition.today.tip}`);
    L.push(`Ideas: proteína (${FOOD_IDEAS.proteina.slice(0, 6).join(', ')}); verduras (${FOOD_IDEAS.verduras.slice(0, 6).join(', ')}); fruta (${FOOD_IDEAS.fruta.slice(0, 5).join(', ')}).`);
    return { text: L.join('\n') };
  },
});

// ---------------------------------------------------------------------------------------------
// Organizar: ajustes del plan
// ---------------------------------------------------------------------------------------------

const ajustar = tool({
  name: 'ajustar_entrenador',
  title: 'Ajustar plan del entrenador',
  group: 'organizar',
  writes: true,
  description:
    'Arma o cambia el plan del entrenador personal: objetivo, nivel de partida, días de fuerza, minutos por sesión, lugar, molestias o lesiones (el plan evita lo que las carga), meta de pasos, peso meta, nombre del coach, cambiar un ejercicio de un patrón por otra opción del mismo patrón que quepa donde entrena y no cargue sus molestias (el "patrón" aparece en ver_plan_entrenador) o reiniciar el plan desde la semana 1. Solo manda lo que cambia. Si el plan aún no está armado, se arma (desde hoy) solo al mandar objetivo, nivel, días o minutos, o activar: true; lo demás (lugar, nombre, molestias…) se guarda sin armarlo. No toca el historial ni la XP.',
  input: z.object({
    objetivo: z.enum(COACH_GOALS).optional().describe(COACH_GOALS.map((g) => `${g} = ${COACH_GOAL_NAMES[g]}`).join('; ')),
    nivel: z.enum(COACH_LEVELS).optional().describe(COACH_LEVELS.map((l) => `${l} = ${COACH_LEVEL_NAMES[l]}`).join('; ')),
    dias: z.array(z.enum(DAY_IDS)).min(1).max(6).optional().describe('Días de fuerza (al menos un día de la semana queda libre).'),
    minutos: z.number().int().min(20).max(120).optional().describe('Minutos por sesión de fuerza.'),
    lugar: z.enum(WORKOUT_PLACES).optional().describe('Dónde entrena (fuera del gym solo usa peso corporal, mancuernas, bandas o kettlebell).'),
    molestias: z.array(z.enum(BODY_AREAS)).max(8).optional().describe('Zonas con dolor o lesión (lista completa; [] = ninguna).'),
    meta_pasos: z.number().int().min(2000).max(30000).nullable().optional().describe('Meta fija de pasos al día (null = automática).'),
    peso_meta: z.number().min(30).max(300).nullable().optional(),
    nombre_coach: z.string().trim().min(1).max(30).optional(),
    cambiar_ejercicio: z.object({ patron: z.string().trim().min(2).max(40), ejercicio: z.string().trim().min(2).max(120) }).optional(),
    reiniciar: z.boolean().optional().describe('Empieza el plan desde la semana 1 hoy (no borra nada).'),
    activar: z.boolean().optional().describe('Arma el plan con lo que ya haya (o con los valores por defecto: salud, sedentario, 3 días). No hace falta si mandas objetivo, nivel, días o minutos.'),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = catalog.find((e) => e.id === TRAINING_SETTINGS_ID) ?? null;
    const data = { ...((prev?.data as TrainingSettingsData | undefined) ?? {}) };
    const coach: CoachSettings = { ...(data.coach ?? {}) };
    const changes: string[] = [];
    if (i.objetivo) {
      coach.goal = i.objetivo;
      changes.push(`objetivo ${COACH_GOAL_NAMES[i.objetivo].toLowerCase()}`);
    }
    if (i.nivel) {
      coach.level = i.nivel;
      changes.push(`nivel ${i.nivel}`);
    }
    if (i.dias) {
      coach.days = [...new Set(i.dias.map((d) => DAY_IDS.indexOf(d)))].sort((a, b) => a - b);
      changes.push(`días ${coach.days.map((d) => DAY_LABEL[d]).join(', ')}`);
    }
    if (i.minutos) {
      coach.sessionMinutes = i.minutos;
      changes.push(`${i.minutos} min por sesión`);
    }
    if (i.lugar) {
      data.where = i.lugar;
      changes.push(`entrena en ${i.lugar}`);
    }
    if (i.molestias) {
      coach.limitations = [...new Set(i.molestias)];
      changes.push(i.molestias.length ? `cuida ${i.molestias.map(areaName).join(', ')}` : 'sin molestias');
    }
    if (i.meta_pasos !== undefined) {
      coach.stepsGoal = i.meta_pasos;
      changes.push(i.meta_pasos ? `meta de ${fmtNum(i.meta_pasos)} pasos` : 'pasos automáticos');
    }
    if (i.peso_meta !== undefined) {
      coach.targetWeightKg = i.peso_meta;
      changes.push(i.peso_meta ? `peso meta ${i.peso_meta} kg` : 'sin peso meta');
    }
    if (i.nombre_coach) {
      coach.name = i.nombre_coach;
      changes.push(`coach "${i.nombre_coach}"`);
    }
    let swap: { key: string; ex: ExerciseDef } | null = null;
    if (i.cambiar_ejercicio) {
      // Por clave ("press_horizontal") o por nombre ("Press horizontal"), sin importar acentos, mayúsculas ni guiones.
      const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s-]+/g, ' ').trim();
      const want = norm(i.cambiar_ejercicio.patron);
      const key = Object.keys(PATTERNS).find((k) => norm(k) === want || norm(PATTERNS[k].label) === want);
      if (!key) throw new ToolError(`No conozco el patrón "${i.cambiar_ejercicio.patron}". Patrones: ${Object.keys(PATTERNS).map((k) => `${k} (${PATTERNS[k].label})`).join(', ')}.`);
      const m = matchExercise(i.cambiar_ejercicio.ejercicio);
      if (!m) throw new ToolError(`No reconocí el ejercicio "${i.cambiar_ejercicio.ejercicio}".`);
      swap = { key, ex: m.exercise };
      changes.push(`${PATTERNS[key].label.toLowerCase()}: ${m.exercise.name}`);
    }
    // El plan se arma solo con datos del plan o si se pide; lo demás (lugar, nombre, molestias…) se guarda sin armarlo.
    const wasOn = !!coach.on;
    const turnOn = !wasOn && !!(i.objetivo || i.nivel || i.dias || i.minutos || i.activar);
    if (i.reiniciar && !wasOn && !turnOn) throw new ToolError('El plan todavía no está armado: no hay nada que reiniciar. Para armarlo manda objetivo, nivel, días o minutos (o activar: true).');
    if (wasOn || turnOn) {
      coach.on = true;
      if (i.reiniciar || !coach.startDate) {
        coach.startDate = store.today;
        if (i.reiniciar) changes.push('plan reiniciado desde hoy');
      }
      if (turnOn) changes.unshift('plan activado');
    }
    if (!changes.length) throw new ToolError(wasOn && i.activar ? 'El plan ya está armado: no mandaste nada que cambiar.' : 'No mandaste nada que cambiar.');
    const entityOf = (c: CoachSettings): Entity<TrainingSettingsData> => ({ id: TRAINING_SETTINGS_ID, module: 'training', kind: 'settings', data: { ...data, ...(Object.keys(c).length ? { coach: c } : {}) }, sort: prev?.sort ?? 0 });
    // Estado con el ajuste nuevo en memoria (sin guardar): da el lugar y las molestias con que el plan arma la sesión y la
    // respuesta. Se calcula ANTES de guardar, sin el registro diario que no cambia la sesión y sin las series de entrenos
    // viejos: barato, y si el Worker se corta no queda nada guardado a medias. El cambio de ejercicio no mueve la fase,
    // la sesión de hoy ni los días, así que el mismo estado sirve para la respuesta.
    const state =
      coach.on || swap
        ? await coachStateFor(store, {
            catalog: [...catalog.filter((e) => e.id !== TRAINING_SETTINGS_ID), entityOf({ ...coach })],
            daily: SESSION_DAILY_TYPES,
            dailyFrom: store.today,
            detailFrom: sessionDetailFrom(store.today),
          })
        : null;
    if (swap && state) {
      // Solo opciones del mismo patrón que quepan donde entrenas y con tus molestias: lo mismo que ofrece la app (el
      // lugar es el del plan: el guardado o, si no hay, el de tus últimos entrenos).
      const pr = coachProfile(state);
      const avoid = pr.limitations.filter((a): a is BodyArea => (BODY_AREAS as readonly string[]).includes(a));
      const valid = patternOptions(swap.key, { where: pr.where, avoid, beginner: false });
      if (!valid.some((o) => o.id === swap!.ex.id)) {
        const label = PATTERNS[swap.key].label.toLowerCase();
        const place = pr.where && pr.where !== 'gym' ? ` entrenando en ${pr.where}` : '';
        const fitsPlace = patternOptions(swap.key, { where: pr.where, avoid: [], beginner: false }).some((o) => o.id === swap!.ex.id);
        const hurts = avoid.filter((a) => JOINT_STRESS[a].includes(swap!.ex.id));
        const why = fitsPlace && hurts.length ? `${swap.ex.name} carga ${hurts.map(areaName).join(', ')} (tienes molestias ahí)` : `${swap.ex.name} no sirve para el patrón "${label}"${place}`;
        throw new ToolError(valid.length ? `${why}. Opciones: ${valid.map((o) => o.name).join(', ')}.` : `El patrón "${label}" no tiene opciones${place}.`);
      }
      coach.swaps = { ...(coach.swaps ?? {}), [swap.key]: swap.ex.id };
    }
    const next = entityOf(coach);
    let text: string;
    if (coach.on && state) {
      const p = coachPlan(state, store.now().toISOString());
      text = `Listo: ${changes.join(' · ')}. Fase ${p.phase.name.toLowerCase()}; hoy: ${p.today.session.title}. Días de fuerza: ${p.strengthDays.map((d) => DAY_LABEL[d]).join(', ')}.`;
    } else text = `Listo: ${changes.join(' · ')}. El plan del entrenador sigue sin armar (se arma con objetivo, nivel, días o minutos, o con activar: true).`;
    const { ref } = await upsert<TrainingSettingsData>(store, prev, next);
    return ok(text, `Entrenador: ${changes.join(', ')}`, { entities: [ref] });
  },
});

// ---------------------------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------------------------

const registrarComida = tool({
  name: 'registrar_comida',
  title: 'Registrar comida',
  group: 'registrar',
  writes: true,
  description: `Registra una comida que Iván YA comió: tipo (${MEAL_KINDS.join(', ')}; si no lo dice, deduce por la hora), qué fue (descripción corta) y etiquetas de hábito (${MEAL_TAGS.map((t) => `${t} = ${MEAL_TAG_NAMES[t]}`).join('; ')}). Si puedes, estima gramos de proteína y calorías de forma conservadora (p. ej. 3 huevos ≈ 18 g de proteína; 150 g de pollo ≈ 45 g). Una comida por llamada. No da XP.`,
  input: z.object({
    tipo: z.enum(MEAL_KINDS),
    descripcion: z.string().trim().min(1).max(500),
    etiquetas: z.array(z.enum(MEAL_TAGS)).max(12).default([]),
    proteina_g: z.number().min(0).max(400).optional(),
    kcal: z.number().min(0).max(6000).optional(),
    fecha: zFecha,
  }),
  async run(i, store) {
    const date = pastDate(store, i.fecha);
    const e = makeEvent(store, 'meal.logged', { meal: i.tipo, text: i.descripcion, tags: [...new Set(i.etiquetas)], proteinG: i.proteina_g, kcal: i.kcal }, date);
    // Respuesta barata y ANTES de guardar (con la comida nueva en memoria): solo el cuerpo (el último peso y medidas, para
    // las metas, como en la app) y lo de ese día. El dictado registra varias comidas en una sola petición y el plan
    // completo no hace falta para esto.
    const [catalog, body, sameDay] = await Promise.all([
      store.catalog(),
      store.events({ types: ['body.logged'], to: store.today, order: 'asc' }),
      store.events({ types: ['meal.logged', 'water.logged'], from: date, to: date, order: 'asc' }),
    ]);
    const state = project({ events: [...body, ...sameDay, e], entities: catalog, today: store.today });
    const day = nutritionDay(state.coach, date, nutritionTargets(coachProfile(state), strengthDayCount(state)));
    await store.addEvents([e]);
    return ok(
      `Comida registrada (${MEAL_KIND_NAMES[i.tipo].toLowerCase()}${date !== store.today ? ` del ${fmtDay(date)}` : ''}): ${i.descripcion}. Día de comida: ${day.score ?? 0}/100 (${day.checks.map((c) => `${c.label} ${c.done ? '✓' : c.detail}`).join(', ')}).${day.tip ? ` ${day.tip}` : ''} [${e.id}]`,
      `Comida: ${MEAL_KIND_NAMES[i.tipo].toLowerCase()} · ${i.descripcion.slice(0, 60)}`,
      { events: [e.id] },
    );
  },
});

const registrarAgua = tool({
  name: 'registrar_agua',
  title: 'Registrar agua',
  group: 'registrar',
  writes: true,
  description: `Suma vasos de agua al día (un vaso = ${GAME_CONFIG.coach.nutrition.glassMl} ml; 1 litro ≈ 4 vasos). No da XP.`,
  input: z.object({ vasos: z.number().int().min(1).max(20), fecha: zFecha }),
  async run(i, store) {
    const date = pastDate(store, i.fecha);
    const e = makeEvent(store, 'water.logged', { glasses: i.vasos }, date);
    await store.addEvents([e]);
    const total = (await store.events({ types: ['water.logged'], from: date, to: date })).reduce((s, x) => s + ((x.payload as { glasses: number }).glasses ?? 0), 0);
    return ok(`Agua: +${i.vasos} ${i.vasos === 1 ? 'vaso' : 'vasos'} (llevas ${total} ese día). [${e.id}]`, `Agua: +${i.vasos} vasos`, { events: [e.id] });
  },
});

const registrarPasos = tool({
  name: 'registrar_pasos',
  title: 'Registrar pasos',
  group: 'registrar',
  writes: true,
  description: 'Guarda los pasos del día según su teléfono o reloj (el último registro del día gana). No da XP.',
  input: z.object({ pasos: z.number().int().min(0).max(150000), fecha: zFecha }),
  async run(i, store) {
    const date = pastDate(store, i.fecha);
    const e = makeEvent(store, 'steps.logged', { steps: i.pasos }, date);
    // La meta de hoy sale de los pasos de los días anteriores (sin el plan completo); se calcula antes de guardar.
    const catalog = await store.catalog();
    const prior = await store.events({ types: ['steps.logged'], from: addDays(store.today, -GAME_CONFIG.coach.steps.averageDays), to: store.today, order: 'asc' });
    const state = project({ events: [...prior, e], entities: catalog, today: store.today });
    const target = stepsTarget(state.coach, store.today, coachSettingsOf(state), coachProfile(state).goal);
    await store.addEvents([e]);
    return ok(
      `Pasos ${date === store.today ? 'de hoy' : `del ${fmtDay(date)}`}: ${fmtNum(i.pasos)} (meta ${fmtNum(target)}${i.pasos >= target ? ', cumplida' : `, faltan ${fmtNum(target - i.pasos)}`}). [${e.id}]`,
      `Pasos: ${fmtNum(i.pasos)}`,
      { events: [e.id] },
    );
  },
});

const registrarSentir = tool({
  name: 'registrar_como_me_siento',
  title: 'Registrar cómo me siento hoy',
  group: 'registrar',
  writes: true,
  description: 'Cómo llega Iván hoy: energía 1–5, qué tan adolorido 0–3 y zonas con molestia. El entrenador ajusta la sesión de hoy (más ligera, recuperación o sin ejercicios que carguen esa zona). No da XP.',
  input: z.object({
    energia: z.number().int().min(1).max(5).describe('1 sin energía · 3 normal · 5 a tope.'),
    adolorido: z.number().int().min(0).max(3).optional().describe('0 nada · 1 poco · 2 bastante · 3 mucho.'),
    molestias: z.array(z.enum(BODY_AREAS)).max(8).optional(),
    nota: z.string().trim().max(500).optional(),
  }),
  async run(i, store) {
    const e = makeEvent(store, 'coach.readiness', { energy: i.energia, soreness: i.adolorido ?? 0, pain: [...new Set(i.molestias ?? [])], note: i.nota }, store.today);
    // La sesión ajustada se calcula ANTES de guardar (con este registro en memoria), sin comidas, agua ni pasos y sin las
    // series de entrenos viejos, que no la cambian: barato, y si el Worker se corta no queda nada guardado a medias.
    const state = await coachStateFor(store, { daily: SESSION_DAILY_TYPES, dailyFrom: store.today, detailFrom: sessionDetailFrom(store.today), extra: [e] });
    const p = coachPlan(state, store.now().toISOString());
    await store.addEvents([e]);
    return ok(
      `Anotado. Sesión de hoy ajustada: ${p.today.session.title}.${p.today.session.adjustments.length ? ` ${p.today.session.adjustments.join(' ')}` : ''} [${e.id}]`,
      `Cómo me siento: energía ${i.energia}/5`,
      { events: [e.id] },
    );
  },
});

const registrarCheckin = tool({
  name: 'registrar_checkin_semanal',
  title: 'Registrar check-in semanal',
  group: 'registrar',
  writes: true,
  description:
    '"¿Cómo estuvo tu semana?": qué tan pesado se sintió el plan (1 muy ligero · 3 bien · 5 demasiado), energía y ánimo 1–5, molestias, lo que salió bien y lo que costó. El plan de la semana siguiente se ajusta solo (con 5 o molestias, semana ligera). Pregunta esas cosas antes de registrarlo. No da XP.',
  input: z.object({
    semana: zDate.optional().describe('Lunes de la semana que revisa. Por defecto la que toca (fin de semana: esta; lunes o martes: la pasada).'),
    pesado: z.number().int().min(1).max(5),
    energia: z.number().int().min(1).max(5),
    animo: z.number().int().min(1).max(5),
    molestias: z.array(z.enum(BODY_AREAS)).max(8).optional(),
    logros: z.string().trim().max(1000).optional(),
    dificultades: z.string().trim().max(1000).optional(),
  }),
  async run(i, store) {
    const today = store.today;
    const wd = weekday(today);
    const ws = i.semana ? weekStart(i.semana) : wd <= 1 ? addDays(weekStart(today), -7) : weekStart(today);
    if (ws > today) throw new ToolError('No se puede hacer el check-in de una semana futura.');
    pastDate(store, ws); // máximo un año atrás, como todo lo que registra la IA
    const catalog = await store.catalog();
    const start = trainingSettingsOf(catalog)?.coach?.startDate;
    if (start && isDateString(start) && start <= today && ws < weekStart(start)) {
      throw new ToolError(`La semana del ${fmtDay(ws)} es anterior a tu plan (empezó la semana del ${fmtDay(weekStart(start))}): no hay check-in que hacer ahí.`);
    }
    const e = makeEvent(store, 'coach.checkin', { weekStart: ws, effort: i.pesado, energy: i.energia, mood: i.animo, pain: [...new Set(i.molestias ?? [])], wins: i.logros, struggles: i.dificultades }, today);
    // El resumen de esa semana se calcula ANTES de guardar (con el check-in en memoria) y solo con el registro diario
    // de esa semana y los días del promedio de pasos.
    const detailFrom = ws < sessionDetailFrom(today) ? ws : sessionDetailFrom(today);
    const state = await coachStateFor(store, { catalog, daily: CHECKIN_DAILY_TYPES, dailyFrom: addDays(ws, -GAME_CONFIG.coach.steps.averageDays), detailFrom, extra: [e] });
    const r = weekReview(state, ws);
    await store.addEvents([e]);
    return ok(
      `Check-in de la semana del ${fmtDay(ws)} guardado. Fuerza ${r.strength.done}/${r.strength.target}, cardio ${r.cardio.done}/${r.cardio.target} min, cumplimiento ${r.compliance}%. ${r.verdictText} [${e.id}]`,
      `Check-in semanal (${fmtDay(ws)})`,
      { events: [e.id] },
    );
  },
});

/** Herramientas del entrenador (se agregan a ASSISTANT_TOOLS). */
export const COACH_TOOLS = [verPlan, verNutricion, ajustar, registrarComida, registrarAgua, registrarPasos, registrarSentir, registrarCheckin];

/** Línea de guía para APP_GUIDE. */
export const COACH_GUIDE = `Entrenador personal: un plan progresivo basado en evidencia (adaptación → base → progreso, con descargas; avanza solo con semanas entrenadas) que dice qué hacer cada día: ejercicios con series, repeticiones, peso objetivo (sobrecarga progresiva), reserva y descanso; cardio (${GAME_CONFIG.coach.phases.base.cardioMinutes}+ min a la semana), pasos, sueño (7+ h) y nutrición por hábitos (proteína en cada comida, verdura, fruta, agua; calorías con Mifflin-St Jeor y proteína 1.6–2.2 g/kg). Consulta con ver_plan_entrenador y ver_nutricion; ajusta con ajustar_entrenador; registra comidas (registrar_comida), agua, pasos, cómo se siente hoy y el check-in semanal. Nada de esto da XP; el entreno sí, con registrar_entrenamiento.`;
