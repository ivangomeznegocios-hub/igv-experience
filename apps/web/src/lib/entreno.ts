import {
  EXERCISE_BY_ID,
  GAME_CONFIG,
  TRAINING_SETTINGS_ID,
  customExerciseId,
  trainingMission,
  wouldBeRecords,
  type Entity,
  type ExerciseData,
  type ExerciseDef,
  type ExerciseMeasure,
  type ExerciseRecord,
  type GameState,
  type MuscleId,
  type RoutineData,
  type SessionSuggestion,
  type TrainingSettingsData,
  type Workout,
  type WorkoutExercise,
  type WorkoutKind,
  type WorkoutPlace,
  type WorkoutSet,
} from '@igv/core';
import { addEvent, getEvents, restoreEvent, saveEntity, voidEvent } from '../data/store';
import { undoToast } from '../ui/kit';
import { sfx } from './sound';
import { newId } from './time';

/** Entrenamiento en edición (formulario de registro). */
export interface DraftExercise {
  key: string;
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  /** Solo ejercicios propios: músculos del momento (se guardan en el registro). */
  primary?: MuscleId[];
  secondary?: MuscleId[];
  sets: WorkoutSet[];
}

export interface WorkoutDraft {
  kind: WorkoutKind;
  title: string;
  where: WorkoutPlace | null;
  minutes: number | null;
  rpe: number | null;
  note: string;
  routineId: string | null;
  exercises: DraftExercise[];
}

export const RPE_OPTIONS = [
  { value: 6, label: 'Ligero' },
  { value: 7, label: 'Moderado' },
  { value: 8, label: 'Duro' },
  { value: 9, label: 'Muy duro' },
  { value: 10, label: 'Al límite' },
];

const key = () => newId().slice(0, 8);

export function emptyDraft(settings?: TrainingSettingsData | null, usualWhere?: WorkoutPlace | null): WorkoutDraft {
  return { kind: 'fuerza', title: '', where: settings?.where ?? usualWhere ?? null, minutes: null, rpe: null, note: '', routineId: null, exercises: [] };
}

/** Definición de un ejercicio (biblioteca o propio). */
export function exerciseDef(id: string, custom: Record<string, ExerciseDef>): ExerciseDef | undefined {
  return EXERCISE_BY_ID.get(id) ?? custom[id];
}

/** Serie inicial: la primera de la última vez, o una vacía según cómo se mide. */
export function defaultSet(measure: ExerciseMeasure, last?: WorkoutSet[]): WorkoutSet {
  const l = last?.[0];
  if (l) return { ...l };
  if (measure === 'tiempo') return { sec: 30 };
  if (measure === 'distancia') return { min: 30 };
  return { reps: 10 };
}

/** Agrega un ejercicio con las series de la última vez (o 3 series vacías). */
export function draftExercise(def: ExerciseDef, records: Record<string, ExerciseRecord>, nSets?: number, reps?: number): DraftExercise {
  const last = records[def.id]?.lastSets;
  const isCustom = !EXERCISE_BY_ID.has(def.id);
  let sets: WorkoutSet[];
  if (last?.length && !nSets) sets = last.map((s) => ({ ...s }));
  else {
    const base = defaultSet(def.measure, last);
    if (reps && def.measure !== 'distancia' && def.measure !== 'tiempo') base.reps = reps;
    sets = Array.from({ length: nSets ?? (def.measure === 'distancia' ? 1 : 3) }, () => ({ ...base }));
  }
  return { key: key(), exerciseId: def.id, name: def.name, measure: def.measure, ...(isCustom ? { primary: def.primary, secondary: def.secondary } : {}), sets };
}

/** "Repetir": mismo tipo, lugar, ejercicios y series. */
export function draftFromWorkout(w: Workout): WorkoutDraft {
  return {
    kind: w.kind,
    title: w.source === 'entreno' ? w.title : '',
    where: w.where,
    minutes: w.minutes,
    rpe: null,
    note: '',
    routineId: w.routineId,
    exercises: w.exercises.map((x) => ({
      key: key(),
      exerciseId: x.exerciseId,
      name: x.name,
      measure: x.measure,
      ...(EXERCISE_BY_ID.has(x.exerciseId) ? {} : { primary: x.primary, secondary: x.secondary }),
      sets: x.sets.map((s) => ({ ...s })),
    })),
  };
}

export function draftFromRoutine(r: Entity<RoutineData>, state: GameState): WorkoutDraft {
  const tr = state.training;
  return {
    ...emptyDraft(tr.settings, tr.summary.usualWhere),
    kind: r.data.kind ?? 'fuerza',
    title: r.data.name,
    routineId: r.id,
    exercises: r.data.exercises
      .map((x) => {
        const def = exerciseDef(x.exerciseId, tr.custom) ?? { id: x.exerciseId, name: x.name, equipment: 'corporal', measure: 'peso', primary: [], secondary: [] };
        const d = draftExercise(def, tr.records, x.sets, x.reps);
        // Con historial, usa el peso de la última vez en cada serie.
        const last = tr.records[x.exerciseId]?.lastSets?.[0];
        if (last) d.sets = d.sets.map((s) => ({ ...s, kg: last.kg, reps: x.reps ?? last.reps ?? s.reps }));
        return d;
      })
      .filter(Boolean),
  };
}

export function draftFromSuggestion(sg: SessionSuggestion, state: GameState): WorkoutDraft {
  const tr = state.training;
  return {
    ...emptyDraft(tr.settings, tr.summary.usualWhere),
    kind: sg.split === 'cardio' ? 'cardio' : 'fuerza',
    title: sg.split === 'cardio' || sg.split === 'descanso' ? '' : sg.title,
    exercises: sg.exercises.slice(0, sg.split === 'cardio' ? 1 : undefined).map((x) => {
      const def = exerciseDef(x.exerciseId, tr.custom)!;
      return draftExercise(def, tr.records, tr.records[x.exerciseId] ? undefined : x.sets);
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------------------------

const num = (v: unknown, max: number, int = false) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const c = Math.min(max, n);
  return int ? Math.round(c) : Math.round(c * 100) / 100;
};

/** Series válidas (sin vacías) según cómo se mide el ejercicio. */
export function cleanSets(measure: ExerciseMeasure, sets: WorkoutSet[]): WorkoutSet[] {
  const out: WorkoutSet[] = [];
  for (const s of sets) {
    const c: WorkoutSet =
      measure === 'distancia'
        ? { min: num(s.min, 1440), km: num(s.km, 1000) }
        : measure === 'tiempo'
          ? { sec: num(s.sec, 36000, true) }
          : { reps: num(s.reps, 1000, true), kg: num(s.kg, 1000) };
    const clean = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as WorkoutSet;
    if ((clean.reps ?? 0) > 0 || (clean.sec ?? 0) > 0 || (clean.min ?? 0) > 0 || (clean.km ?? 0) > 0) out.push(clean);
  }
  return out.slice(0, 60);
}

export function draftExercisesClean(d: WorkoutDraft): WorkoutExercise[] {
  return d.exercises
    .map((x) => ({ exerciseId: x.exerciseId, name: x.name.slice(0, 120), ...(x.primary?.length ? { primary: x.primary, secondary: x.secondary ?? [] } : {}), sets: cleanSets(x.measure, x.sets) }))
    .filter((x) => x.sets.length > 0)
    .slice(0, 40);
}

export function canSave(d: WorkoutDraft): boolean {
  return draftExercisesClean(d).length > 0 || (d.minutes ?? 0) > 0;
}

/** Misión que dará la XP al guardar en esa fecha (null si ya contó ese día). */
export function missionFor(state: GameState, entities: Entity[], date: string) {
  const m = trainingMission(state.training.settings, entities);
  const done = !!state.missions.completions[m.missionId]?.dates.includes(date);
  return { mission: m, done };
}

/**
 * Registra el entrenamiento y, si no estaba, la misión de entrenar del día (de ahí salen XP, racha y oro).
 * "Deshacer" anula ambos.
 */
export function logWorkout(draft: WorkoutDraft, date: string, state: GameState, entities: Entity[]) {
  const exercises = draftExercisesClean(draft);
  const { mission, done } = missionFor(state, entities, date);
  const missionEv = done
    ? null
    : addEvent('mission.completed', { missionId: mission.missionId, title: mission.title, size: mission.size, attribute: mission.attribute, kind: mission.kind, mainQuestId: mission.mainQuestId, npcId: null }, { localDate: date });
  const records = wouldBeRecords(
    state.training.records,
    draft.exercises.map((x) => ({ exerciseId: x.exerciseId, measure: x.measure, sets: cleanSets(x.measure, x.sets) })),
  ).slice(0, GAME_CONFIG.training.record.maxPerDay);
  const ev = addEvent(
    'workout.logged',
    {
      kind: draft.kind,
      title: draft.title.trim().slice(0, 120) || undefined,
      where: draft.where ?? undefined,
      minutes: draft.minutes && draft.minutes > 0 ? Math.min(1440, Math.round(draft.minutes)) : undefined,
      rpe: draft.rpe ?? undefined,
      note: draft.note.trim().slice(0, 2000) || undefined,
      routineId: draft.routineId,
      missionEventId: missionEv?.id ?? null,
      exercises,
    },
    { localDate: date },
  );
  const xp = (missionEv ? GAME_CONFIG.missionXp[mission.size] : 0) + records.length * GAME_CONFIG.missionXp[GAME_CONFIG.training.record.size];
  sfx.coin();
  const names = records.map((id) => draft.exercises.find((x) => x.exerciseId === id)?.name ?? id);
  undoToast(
    `Entrenamiento guardado${xp ? ` · +${xp} XP` : ''}${names.length ? ` · récord en ${names.join(', ')}` : ''}`,
    () => {
      voidEvent(ev.id);
      if (missionEv) voidEvent(missionEv.id);
    },
  );
  return { eventId: ev.id, missionEventId: missionEv?.id ?? null, records };
}

/** Anula un entrenamiento y la misión que se registró con él (si no hay otro entrenamiento ese día). */
export function voidWorkout(w: Workout, state: GameState) {
  if (w.source !== 'entreno') return;
  voidEvent(w.eventId);
  const voided = [w.eventId];
  const others = state.training.workouts.some((o) => o.eventId !== w.eventId && o.date === w.date);
  const mission = w.missionEventId ? getEvents().find((e) => e.id === w.missionEventId && !e.voidedAt) : undefined;
  if (mission && !others) {
    voidEvent(mission.id);
    voided.push(mission.id);
  }
  undoToast(`Anulado: ${w.title}`, () => voided.forEach(restoreEvent));
}

// ---------------------------------------------------------------------------------------------
// Catálogo: rutinas, ejercicios propios y ajustes
// ---------------------------------------------------------------------------------------------

export function saveRoutine(data: RoutineData, id?: string) {
  return saveEntity<RoutineData>({ id: id ?? `routine-${key()}`, module: 'training', kind: 'routine', data });
}

export function routineFromDraft(name: string, d: WorkoutDraft): RoutineData {
  return {
    name: name.trim().slice(0, 120),
    kind: d.kind,
    exercises: d.exercises.map((x) => ({ exerciseId: x.exerciseId, name: x.name, sets: Math.max(1, Math.min(10, x.sets.length)), reps: x.sets[0]?.reps })),
  };
}

export function routineFromWorkout(name: string, w: Workout): RoutineData {
  return routineFromDraft(name, draftFromWorkout(w));
}

/** Crea un ejercicio propio (id estable a partir del nombre; si ya existe uno igual, otro sufijo). */
export function saveCustomExercise(data: ExerciseData, existingIds: Set<string>): Entity<ExerciseData> {
  let id = customExerciseId(data.name);
  if (existingIds.has(id) || EXERCISE_BY_ID.has(id)) id = `${id}-${key().slice(0, 4)}`;
  return saveEntity<ExerciseData>({ id, module: 'training', kind: 'exercise', data });
}

export function saveTrainingSettings(prev: TrainingSettingsData, patch: Partial<TrainingSettingsData>) {
  return saveEntity<TrainingSettingsData>({ id: TRAINING_SETTINGS_ID, module: 'training', kind: 'settings', data: { ...prev, ...patch }, sort: 0 });
}

// ---------------------------------------------------------------------------------------------
// Borrador (solo en este dispositivo: si cierras la hoja a medias, no pierdes las series)
// ---------------------------------------------------------------------------------------------

const DRAFT_KEY = 'igv-entreno-borrador';

export function loadDraft(): { date: string; draft: WorkoutDraft; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d?.draft?.exercises || Date.now() - (d.savedAt ?? 0) > 18 * 3_600_000) return null;
    return d;
  } catch {
    return null;
  }
}

export function storeDraft(date: string, draft: WorkoutDraft) {
  try {
    if (!draft.exercises.length) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ date, draft, savedAt: Date.now() }));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nada */
  }
}

// ---------------------------------------------------------------------------------------------
// Abrir el registro desde cualquier pantalla (Hoy, Entrenamiento, Cuerpo…)
// ---------------------------------------------------------------------------------------------

export interface OpenWorkoutOptions {
  draft?: WorkoutDraft;
  date?: string;
}
const bus = new Set<(o: OpenWorkoutOptions) => void>();
let pending: OpenWorkoutOptions | null = null;

/** Abre la hoja de registro de entrenamiento (opcionalmente con un borrador: rutina, repetir, sugerida). */
export function openWorkout(o: OpenWorkoutOptions = {}) {
  if (!bus.size) pending = o;
  bus.forEach((f) => f(o));
}

export function onOpenWorkout(f: (o: OpenWorkoutOptions) => void) {
  bus.add(f);
  if (pending) {
    const p = pending;
    pending = null;
    f(p);
  }
  return () => {
    bus.delete(f);
  };
}

/** Texto corto de una serie ("8 × 60 kg", "45 s", "30 min · 5 km"). */
export function fmtSet(s: WorkoutSet): string {
  if (s.min || s.km) return [s.min ? `${s.min} min` : '', s.km ? `${s.km} km` : ''].filter(Boolean).join(' · ');
  if (s.sec) return `${s.sec} s`;
  return s.kg ? `${s.reps ?? 0} × ${s.kg} kg` : `${s.reps ?? 0} reps`;
}

/** Resumen de series ("3 × 8 · 60 kg" si son iguales). */
export function fmtSets(sets: WorkoutSet[]): string {
  if (!sets.length) return '';
  const all = sets.every((s) => fmtSet(s) === fmtSet(sets[0]));
  if (all && sets.length > 1 && !sets[0].min && !sets[0].km) return `${sets.length} series · ${fmtSet(sets[0])}`;
  return sets.map(fmtSet).join(', ');
}
