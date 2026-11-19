import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import { project } from '../engine/project';
import { exerciseDefFromEntity, resolveExercise, TRAINING_SETTINGS_ID, type TrainingSummary } from '../engine/modules/training';
import { RECORD_LABELS, progressSeries, trainingAnalysis, trainingMission, type TrainingAnalysis } from '../engine/training';
import { customExerciseId, matchExercise, MUSCLES, searchExercises, type ExerciseDef } from '../training/library';
import {
  MUSCLE_IDS,
  WORKOUT_KIND_NAMES,
  WORKOUT_KINDS,
  WORKOUT_PLACE_NAMES,
  WORKOUT_PLACES,
  type Entity,
  type ExerciseData,
  type MuscleId,
  type RoutineData,
  type TrainingSettingsData,
  type WorkoutExercise,
  type WorkoutSet,
} from '../types';
import { addDays } from '../util/dates';
import { fmtDay } from './format';
import type { AssistantSnapshot } from './snapshot';
import { ToolError, list, makeEvent, ok, pastDate, tool, upsert, zFecha, zId, zText, type ActivityRefs, type AssistantStore } from './toolkit';

/**
 * Herramientas de IA del sistema de Entrenamiento: registrar un entrenamiento (con la misión de entrenar, igual
 * que la app) y ver el estado de cada músculo, lo que falta y la siguiente sesión sugerida.
 */

const fmt = (n: number) => String(Math.round(n * 10) / 10);
const muscleName = (m: MuscleId) => MUSCLES[m].name.toLowerCase();

const zSet = z.object({
  reps: z.number().int().min(0).max(1000).optional(),
  kg: z.number().min(0).max(1000).optional(),
  segundos: z.number().int().min(0).max(36000).optional(),
  minutos: z.number().min(0).max(1440).optional(),
  km: z.number().min(0).max(1000).optional(),
});

const zExercise = z.object({
  nombre: zText(120).describe('Nombre del ejercicio en español ("press de banca", "sentadilla", "correr"). Se busca en la biblioteca aunque no sea exacto.'),
  series: z.array(zSet).max(30).optional().describe('Cada serie: reps y kg (fuerza), segundos (plancha) o minutos y km (cardio).'),
  n_series: z.number().int().min(1).max(30).optional().describe('Atajo: número de series iguales ("4x10 con 60 kg" → n_series 4, reps 10, kg 60).'),
  reps: z.number().int().min(1).max(1000).optional(),
  kg: z.number().min(0).max(1000).optional(),
  segundos: z.number().int().min(1).max(36000).optional(),
  minutos: z.number().min(0).max(1440).optional(),
  km: z.number().min(0).max(1000).optional(),
  musculos: z.array(z.enum(MUSCLE_IDS)).max(4).optional().describe('Solo si es un ejercicio que no está en la biblioteca: sus músculos principales (se crea como ejercicio propio).'),
});

function setsOf(x: z.infer<typeof zExercise>): WorkoutSet[] {
  const clean = (s: WorkoutSet) => Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'number' && v > 0)) as WorkoutSet;
  if (x.series?.length) return x.series.map((s) => clean({ reps: s.reps, kg: s.kg, sec: s.segundos, min: s.minutos, km: s.km })).filter((s) => Object.keys(s).length);
  const one = clean({ reps: x.reps, kg: x.kg, sec: x.segundos, min: x.minutos, km: x.km });
  if (!Object.keys(one).length) return [];
  const n = x.minutos || x.km ? 1 : (x.n_series ?? 1);
  return Array.from({ length: n }, () => ({ ...one }));
}

const customDefs = (catalog: Entity[]): ExerciseDef[] => list<ExerciseData>(catalog, 'training', 'exercise').map(exerciseDefFromEntity);

const registrarEntrenamiento = tool({
  name: 'registrar_entrenamiento',
  title: 'Registrar entrenamiento',
  group: 'registrar',
  writes: true,
  description: `Registra un entrenamiento que Iván HIZO: tipo, dónde, minutos, esfuerzo (RPE 1–10) y ejercicios con sus series. Los nombres se buscan en la biblioteca (~80 ejercicios) aunque no sean exactos. Igual que la app, también completa la misión de entrenar del día ("Entrenar", media · ${GAME_CONFIG.missionXp.media} XP, o la diaria que él eligió) si no estaba hecha: de ahí salen XP, racha y oro. Un récord personal nuevo da +${GAME_CONFIG.missionXp[GAME_CONFIG.training.record.size]} XP. Para algo sin ejercicios (fútbol, yoga) manda solo tipo y minutos.`,
  input: z.object({
    tipo: z.enum(WORKOUT_KINDS).optional().describe('fuerza, cardio, movilidad, deporte, clase, caminata u otro. Por defecto: fuerza si hay ejercicios de fuerza, si no cardio.'),
    titulo: z.string().trim().max(120).optional().describe('Nombre corto ("Pecho y tríceps", "Fútbol con amigos").'),
    donde: z.enum(WORKOUT_PLACES).optional(),
    minutos: z.number().int().min(1).max(1440).optional().describe('Duración total.'),
    esfuerzo: z.number().int().min(1).max(10).optional().describe('RPE: 6 ligero, 7 moderado, 8 duro, 9 muy duro, 10 al límite.'),
    nota: z.string().trim().max(2000).optional(),
    ejercicios: z.array(zExercise).max(30).optional(),
    rutina_id: zId.optional().describe('Rutina guardada (sus ejercicios se usan si no mandas "ejercicios").'),
    fecha: zFecha,
  }),
  async run(i, store) {
    const date = pastDate(store, i.fecha);
    const catalog = await store.catalog();
    const custom = customDefs(catalog);
    const entityRefs: ActivityRefs['entities'] = [];
    const matched: string[] = [];
    const exercises: WorkoutExercise[] = [];
    let routine: Entity<RoutineData> | undefined;
    if (i.rutina_id) {
      routine = list<RoutineData>(catalog, 'training', 'routine').find((r) => r.id === i.rutina_id);
      if (!routine) throw new ToolError(`No encontré la rutina "${i.rutina_id}". Usa ver_entrenamiento para ver las rutinas.`);
    }
    for (const x of i.ejercicios ?? []) {
      const sets = setsOf(x);
      if (!sets.length) throw new ToolError(`Faltan las series de "${x.nombre}" (reps y kg, segundos, o minutos y km).`);
      const m = matchExercise(x.nombre, custom);
      if (m) {
        if (m.exercise.name.toLowerCase() !== x.nombre.toLowerCase()) matched.push(`"${x.nombre}" → ${m.exercise.name}`);
        exercises.push({ exerciseId: m.exercise.id, name: m.exercise.name, sets });
        continue;
      }
      if (!x.musculos?.length) {
        const near = searchExercises(x.nombre, custom, 3).map((s) => s.exercise.name);
        throw new ToolError(
          `No reconocí el ejercicio "${x.nombre}".${near.length ? ` ¿Quisiste decir: ${near.join(', ')}?` : ''} Si es nuevo, mándalo otra vez con "musculos" (${MUSCLE_IDS.join(', ')}) y lo creo como ejercicio propio.`,
        );
      }
      const id = customExerciseId(x.nombre);
      const prev = catalog.find((e) => e.id === id) ?? null;
      const primary = [...new Set(x.musculos)];
      const measure = sets.some((s) => s.km || s.min) ? 'distancia' : sets.every((s) => !s.reps && s.sec) ? 'tiempo' : sets.some((s) => s.kg) ? 'peso' : 'corporal';
      if (!prev) {
        const { ref } = await upsert<ExerciseData>(store, null, { id, module: 'training', kind: 'exercise', data: { name: x.nombre.trim(), primary, measure } });
        entityRefs.push(ref);
        custom.push({ id, name: x.nombre.trim(), equipment: 'corporal', measure, primary, secondary: [] });
      }
      exercises.push({ exerciseId: id, name: x.nombre.trim(), primary, sets });
    }
    if (!exercises.length && routine) {
      for (const r of routine.data.exercises) exercises.push({ exerciseId: r.exerciseId, name: r.name, sets: Array.from({ length: Math.max(1, r.sets) }, () => ({ reps: r.reps ?? 10 })) });
    }
    if (!exercises.length && !i.minutos) throw new ToolError('Manda al menos un ejercicio con sus series, o el tipo y los minutos.');

    const customMap = Object.fromEntries(custom.map((c) => [c.id, c]));
    const resolved = exercises.map((x) => resolveExercise(x, customMap));
    const kind = i.tipo ?? (resolved.some((x) => x.measure !== 'distancia') ? 'fuerza' : resolved.length ? 'cardio' : 'otro');

    const settings = (catalog.find((e) => e.id === TRAINING_SETTINGS_ID)?.data ?? {}) as TrainingSettingsData;
    const mission = trainingMission(settings, catalog);
    const doneThatDay = (await store.events({ types: ['mission.completed'], match: { missionId: mission.missionId }, from: date, to: date, limit: 1 })).length > 0;
    const missionEv = doneThatDay ? null : makeEvent(store, 'mission.completed', { missionId: mission.missionId, title: mission.title, size: mission.size, attribute: mission.attribute, kind: mission.kind, mainQuestId: mission.mainQuestId, npcId: null }, date);
    const workoutEv = makeEvent(
      store,
      'workout.logged',
      {
        kind,
        title: i.titulo || routine?.data.name || undefined,
        where: i.donde ?? settings.where ?? undefined,
        minutes: i.minutos,
        rpe: i.esfuerzo,
        note: i.nota || undefined,
        routineId: routine?.id ?? null,
        missionEventId: missionEv?.id ?? null,
        exercises,
      },
      date,
    );
    await store.addEvents(missionEv ? [missionEv, workoutEv] : [workoutEv]);

    // ¿Récord? Se calcula igual que en la app (con los registros de entrenamiento y el catálogo).
    const history = await store.events({ types: ['workout.logged'], to: store.today });
    const state = project({ events: history, entities: entityRefs.length ? await store.catalog() : catalog, today: store.today });
    const w = state.training.workouts.find((x) => x.eventId === workoutEv.id);
    const recXp = GAME_CONFIG.missionXp[GAME_CONFIG.training.record.size];
    const recNames = (w?.records ?? []).map((id) => exercises.find((x) => x.exerciseId === id)?.name ?? id);

    const hard = resolved.reduce((t, x) => t + x.hardSets, 0);
    const parts = [
      `${WORKOUT_KIND_NAMES[kind]}${i.donde ? ` en ${WORKOUT_PLACE_NAMES[i.donde].toLowerCase()}` : ''}`,
      i.minutos ? `${i.minutos} min` : '',
      exercises.length ? `${exercises.length} ${exercises.length === 1 ? 'ejercicio' : 'ejercicios'}` : '',
      hard ? `${hard} series duras` : '',
    ].filter(Boolean);
    const xpText = missionEv
      ? `+${GAME_CONFIG.missionXp[mission.size]} XP por "${mission.title}"`
      : `"${mission.title}" ya estaba registrada ese día (sin XP extra)`;
    const recText = recNames.length ? ` Récord personal en ${recNames.join(', ')} (+${recXp * recNames.length} XP).` : '';
    const label = i.titulo || routine?.data.name || WORKOUT_KIND_NAMES[kind];
    return ok(
      `Listo: ${label} ${date === store.today ? 'hoy' : `el ${fmtDay(date)}`} · ${parts.join(' · ')} · ${xpText}.${recText}${matched.length ? ` Reconocí: ${matched.join('; ')}.` : ''} Registro [${workoutEv.id}]${missionEv ? ` y misión [${missionEv.id}]` : ''}.`,
      `Entrenamiento: ${label}${missionEv ? ` (+${GAME_CONFIG.missionXp[mission.size]} XP)` : ''}${recNames.length ? ` · récord en ${recNames.join(', ')}` : ''}${date !== store.today ? ` · ${date}` : ''}`,
      { events: [...(missionEv ? [missionEv.id] : []), workoutEv.id], entities: entityRefs },
    );
  },
});

/** Líneas de entrenamiento para el panorama (ver_resumen y el Coach). */
export function renderTrainingOverview(s: AssistantSnapshot): string[] {
  const t = (s as { training?: TrainingSummary }).training;
  if (!t) return [];
  const a = trainingAnalysis(t, s.computedAt);
  if (!t.lastWorkout && !a.sessions) return ['', '## Entrenamiento', 'Sin entrenamientos registrados todavía.'];
  return ['', '## Entrenamiento', ...analysisLines(a, t, false)];
}

function analysisLines(a: TrainingAnalysis, t: TrainingSummary, detailed: boolean): string[] {
  const L: string[] = [];
  L.push(
    `Esta semana: ${a.sessions} ${a.sessions === 1 ? 'sesión' : 'sesiones'} · ${fmt(a.hardSets)} series duras · cardio ${a.cardio.minutes} de ${a.cardio.min} min · semanas seguidas con ${GAME_CONFIG.training.streakMinSessions}+ sesiones: ${a.weekStreak}. Quedan ${a.daysLeft} ${a.daysLeft === 1 ? 'día' : 'días'} de la semana.`,
  );
  if (t.lastWorkout) L.push(`Último entrenamiento: ${t.lastWorkout.date} · ${t.lastWorkout.title}.`);
  if (a.missing.length)
    L.push(`Le falta esta semana (bajo el mínimo de ${GAME_CONFIG.training.weeklySets.min} series): ${a.missing.map((m) => `${muscleName(m.id)} ${fmt(m.weekSets)}`).join(', ')}.`);
  else L.push('Todos los músculos principales ya pasaron el mínimo efectivo de la semana.');
  if (detailed && a.missingAccessory.length) L.push(`Accesorios bajos: ${a.missingAccessory.map((m) => `${muscleName(m.id)} ${fmt(m.weekSets)}`).join(', ')}.`);
  if (a.recovering.length) L.push(`Recuperando: ${a.recovering.map((m) => `${muscleName(m.id)} (lista en ${m.hoursToReady} h)`).join(', ')}.`);
  for (const n of a.balance.notes) L.push(`Equilibrio: ${n}`);
  const sg = a.suggestion;
  L.push(`Siguiente sesión sugerida: ${sg.title}. ${sg.reason}${sg.exercises.length ? ` Ejercicios: ${sg.exercises.map((e) => `${e.name} ${e.sets}×${e.reps}`).join('; ')}.` : ''}`);
  return L;
}

const verEntrenamiento = tool({
  name: 'ver_entrenamiento',
  title: 'Ver entrenamiento',
  group: 'consultar',
  writes: false,
  description:
    'Entrenamiento de Iván: estado de cada músculo (recuperando / listo / olvidado), series duras de la semana contra la meta basada en evidencia (10–20 por músculo, mínimo 6, 2 veces por semana, 48–72 h de recuperación), lo que le falta, equilibrio empuje/jalón y torso/pierna, la siguiente sesión sugerida con ejercicios, entrenamientos recientes y rutinas. Con "ejercicio", sus récords y su progreso.',
  input: z.object({ ejercicio: z.string().trim().min(2).max(120).optional().describe('Nombre de un ejercicio para ver sus récords y progreso.') }),
  async run({ ejercicio }, store) {
    const [catalog, events] = await Promise.all([store.catalog(), store.events({ types: ['workout.logged', 'body.logged'], from: addDays(store.today, -365), to: store.today, order: 'asc' })]);
    const state = project({ events, entities: catalog, today: store.today });
    const tr = state.training;
    const L: string[] = [];
    if (ejercicio) {
      const m = matchExercise(ejercicio, Object.values(tr.custom));
      if (!m) throw new ToolError(`No reconocí "${ejercicio}". Parecidos: ${searchExercises(ejercicio, Object.values(tr.custom), 4).map((x) => x.exercise.name).join(', ') || 'ninguno'}.`);
      const r = tr.records[m.exercise.id];
      L.push(`# ${m.exercise.name}`);
      L.push(`Músculos: ${m.exercise.primary.map(muscleName).join(', ')}${m.exercise.secondary.length ? ` (secundarios: ${m.exercise.secondary.map(muscleName).join(', ')})` : ''}.`);
      if (!r) {
        L.push('Sin registros de este ejercicio en el último año.');
        return { text: L.join('\n') };
      }
      L.push(`${r.sessions} ${r.sessions === 1 ? 'sesión' : 'sesiones'} · primera ${r.firstDate} · última ${r.lastDate}.`);
      L.push('Récords:');
      for (const [k, v] of Object.entries(r.best)) L.push(`- ${RECORD_LABELS[k as keyof typeof RECORD_LABELS]}: ${fmt(v!.value)}${k === 'pace' ? ' min/km' : k === 'sec' ? ' s' : k === 'km' ? ' km' : k === 'min' ? ' min' : k === 'reps' ? ' reps' : ' kg'} (${v!.date})`);
      const series = progressSeries(r).slice(-10);
      if (series.length) L.push(`Progreso (${r.measure === 'peso' ? '1RM estimado' : r.measure === 'corporal' ? 'reps' : r.measure === 'tiempo' ? 'segundos' : 'km'}): ${series.map((p) => `${p.date} ${fmt(p.value)}`).join(' · ')}.`);
      L.push(`Última vez: ${r.lastSets.map((s) => [s.reps ? `${s.reps}` : '', s.kg ? `× ${s.kg} kg` : '', s.sec ? `${s.sec} s` : '', s.min ? `${s.min} min` : '', s.km ? `${s.km} km` : ''].filter(Boolean).join(' ')).join(', ')}.`);
      return { text: L.join('\n') };
    }
    const now = store.now().toISOString();
    const a = trainingAnalysis(tr.summary, now, { custom: Object.values(tr.custom) });
    L.push(`# Entrenamiento · ${fmtDay(store.today)}`);
    L.push(...analysisLines(a, tr.summary, true));
    L.push('', 'Músculos (series duras esta semana / meta · veces · estado):');
    for (const id of MUSCLE_IDS) {
      const m = a.muscles[id];
      const st = m.state === 'recuperando' ? `recuperando, ${Math.round(m.recovery * 100)}% (lista en ${m.hoursToReady} h)` : m.state === 'olvidado' ? (m.lastDate ? `olvidado, hace ${m.daysSince} días` : 'sin registro') : `listo${m.daysSince !== null ? `, último hace ${m.daysSince} ${m.daysSince === 1 ? 'día' : 'días'}` : ''}`;
      L.push(`- ${m.name}: ${fmt(m.weekSets)}/${m.target.target}${m.accessory ? ' (accesorio)' : ''} · ${m.weekDays}× · ${st}`);
    }
    const recent = tr.workouts.slice(-6).reverse();
    if (recent.length) {
      L.push('', 'Entrenamientos recientes:');
      for (const w of recent)
        L.push(
          `- ${w.date} [${w.eventId}] ${w.title} (${WORKOUT_KIND_NAMES[w.kind]}${w.where ? `, ${WORKOUT_PLACE_NAMES[w.where].toLowerCase()}` : ''}${w.minutes ? `, ${w.minutes} min` : ''})${w.exercises.length ? `: ${w.exercises.map((x) => `${x.name} ${x.sets.length}×`).join(', ')}` : ''}${w.records.length ? ' · RÉCORD' : ''}`,
        );
    }
    const routines = list<RoutineData>(catalog, 'training', 'routine');
    if (routines.length) L.push('', `Rutinas guardadas: ${routines.map((r) => `${r.data.name} [${r.id}] (${r.data.exercises.map((x) => x.name).join(', ')})`).join('; ')}.`);
    return { text: L.join('\n') };
  },
});

/** Herramientas de entrenamiento (se agregan a ASSISTANT_TOOLS). */
export const ENTRENO_TOOLS = [registrarEntrenamiento, verEntrenamiento];

/** Línea de guía para APP_GUIDE. */
export const ENTRENO_GUIDE = `Entrenamiento: registra entrenos con ejercicios y series (registrar_entrenamiento; también completa la misión de entrenar del día, de ahí salen XP y racha; un récord personal nuevo da +${GAME_CONFIG.missionXp[GAME_CONFIG.training.record.size]} XP). ver_entrenamiento dice qué músculos faltan esta semana (meta: ${GAME_CONFIG.training.weeklySets.target}–${GAME_CONFIG.training.weeklySets.max} series duras por músculo, mínimo ${GAME_CONFIG.training.weeklySets.min}, ${GAME_CONFIG.training.minFrequency} veces por semana, ${GAME_CONFIG.training.recoveryHours.chico}–${GAME_CONFIG.training.recoveryHours.grande} h de recuperación) y sugiere la siguiente sesión.`;

