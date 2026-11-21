import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import { project, type GameState } from '../engine/project';
import { TRAINING_SETTINGS_ID } from '../engine/modules/training';
import {
  FOOD_IDEAS,
  PATTERNS,
  coachPlan,
  nutritionDay,
  weekReview,
  type CoachPlan,
  type PrescribedExercise,
  type PrescribedSession,
} from '../engine/coach';
import { matchExercise } from '../training/library';
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
  type CoachSettings,
  type Entity,
  type TrainingSettingsData,
} from '../types';
import { addDays, weekStart, weekday } from '../util/dates';
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

/** Estado mínimo para el plan del entrenador (sin XP: solo lo que el coach necesita). */
export async function coachStateFor(store: AssistantStore, catalog?: Entity[]): Promise<GameState> {
  const [cat, events] = await Promise.all([catalog ? Promise.resolve(catalog) : store.catalog(), store.events({ types: COACH_EVENT_TYPES, from: addDays(store.today, -400), to: store.today, order: 'asc' })]);
  return project({ events, entities: cat, today: store.today });
}

// ---------------------------------------------------------------------------------------------
// Texto del plan (lo usan la herramienta, la foto para la IA y el panorama del Coach)
// ---------------------------------------------------------------------------------------------

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
    L.push(`Entrenador (${pr.coachName}): Iván aún no arma su plan. Si habla de entrenar, ofrécele hacerlo con ajustar_entrenador (objetivo, nivel, días, minutos, molestias). Mientras, el plan usa valores por defecto (sedentario, salud, 3 días).`);
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
  if (pr.limitations.length) L.push(`Molestias o lesiones: ${pr.limitations.map((a) => BODY_AREA_NAMES[a].toLowerCase()).join(', ')} (el plan evita lo que las carga).`);
  L.push(`Días de fuerza: ${p.strengthDays.map((d) => DAY_LABEL[d]).join(', ')} · ${p.sessionMinutes} min por sesión · entrena en ${pr.where ?? 'gym'}.`);
  const t = p.targets;
  L.push(
    `Esta semana: fuerza ${t.strength.done}/${t.strength.target} · cardio ${t.cardio.done}/${t.cardio.target} min · pasos ${t.steps.avg !== null ? `promedio ${fmtNum(t.steps.avg)}` : 'sin registro'} (meta ${fmtNum(t.steps.target)}/día) · sueño ${t.sleep.avg !== null ? `promedio ${t.sleep.avg} h` : 'sin registro'}${t.sleep.lastNight !== null ? `, anoche ${t.sleep.lastNight} h` : ''} · comida ${t.nutrition.avg !== null ? `${t.nutrition.avg}/100` : 'sin registro'}.`,
  );
  L.push('Hoy:', ...fmtSession(p.today.session, detailed));
  if (p.today.readiness) L.push(`Cómo se siente hoy: energía ${p.today.readiness.energy}/5, adolorido ${p.today.readiness.soreness}/3${p.today.readiness.pain.length ? `, molestia en ${p.today.readiness.pain.map((a) => BODY_AREA_NAMES[a].toLowerCase()).join(', ')}` : ''}.`);
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
    'Arma o cambia el plan del entrenador personal: objetivo, nivel de partida, días de fuerza, minutos por sesión, lugar, molestias o lesiones (el plan evita lo que las carga), meta de pasos, peso meta, nombre del coach, cambiar un ejercicio de un patrón (el "patrón" aparece en ver_plan_entrenador) o reiniciar el plan desde la semana 1. Solo manda lo que cambia. No toca el historial ni la XP.',
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
      changes.push(i.molestias.length ? `cuida ${i.molestias.map((a) => BODY_AREA_NAMES[a].toLowerCase()).join(', ')}` : 'sin molestias');
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
    if (i.cambiar_ejercicio) {
      const key = Object.keys(PATTERNS).find((k) => k === i.cambiar_ejercicio!.patron || PATTERNS[k].label.toLowerCase() === i.cambiar_ejercicio!.patron.toLowerCase());
      if (!key) throw new ToolError(`No conozco el patrón "${i.cambiar_ejercicio.patron}". Patrones: ${Object.keys(PATTERNS).join(', ')}.`);
      const m = matchExercise(i.cambiar_ejercicio.ejercicio);
      if (!m) throw new ToolError(`No reconocí el ejercicio "${i.cambiar_ejercicio.ejercicio}".`);
      coach.swaps = { ...(coach.swaps ?? {}), [key]: m.exercise.id };
      changes.push(`${PATTERNS[key].label.toLowerCase()}: ${m.exercise.name}`);
    }
    if (i.reiniciar || !coach.startDate) {
      coach.startDate = store.today;
      if (i.reiniciar) changes.push('plan reiniciado desde hoy');
    }
    if (!coach.on) changes.unshift('plan activado');
    coach.on = true;
    if (!changes.length) throw new ToolError('No mandaste nada que cambiar.');
    const { ref } = await upsert<TrainingSettingsData>(store, prev, { id: TRAINING_SETTINGS_ID, module: 'training', kind: 'settings', data: { ...data, coach }, sort: 0 });
    const state = await coachStateFor(store);
    const p = coachPlan(state, store.now().toISOString());
    return ok(
      `Listo: ${changes.join(' · ')}. Fase ${p.phase.name.toLowerCase()}; hoy: ${p.today.session.title}. Días de fuerza: ${p.strengthDays.map((d) => DAY_LABEL[d]).join(', ')}.`,
      `Entrenador: ${changes.join(', ')}`,
      { entities: [ref] },
    );
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
    await store.addEvents([e]);
    const state = await coachStateFor(store);
    const p = coachPlan(state, store.now().toISOString());
    const day = date === store.today ? p.nutrition.today : nutritionDay(state.coach, date, p.nutrition.targets);
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
    await store.addEvents([e]);
    const state = await coachStateFor(store);
    const target = coachPlan(state, store.now().toISOString()).targets.steps.target;
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
    await store.addEvents([e]);
    const state = await coachStateFor(store);
    const p = coachPlan(state, store.now().toISOString());
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
    const e = makeEvent(store, 'coach.checkin', { weekStart: ws, effort: i.pesado, energy: i.energia, mood: i.animo, pain: [...new Set(i.molestias ?? [])], wins: i.logros, struggles: i.dificultades }, today);
    await store.addEvents([e]);
    const state = await coachStateFor(store);
    const r = weekReview(state, ws);
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
