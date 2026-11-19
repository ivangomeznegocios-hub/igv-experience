import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { GameConfigInput } from '../../config/game';
import {
  MUSCLE_IDS,
  WORKOUT_KINDS,
  WORKOUT_PLACES,
  type AttributeId,
  type Entity,
  type ExerciseData,
  type ExerciseMeasure,
  type GameEvent,
  type MissionSize,
  type MuscleId,
  type TrainingSettingsData,
  type WorkoutKind,
  type WorkoutPayload,
  type WorkoutPlace,
  type WorkoutSet,
} from '../../types';
import { EXERCISE_BY_ID, MUSCLES, isMuscleId, type ExerciseDef } from '../../training/library';
import { addDays, weekStart } from '../../util/dates';

/**
 * Entrenamiento: junta los registros `workout.logged` (y los entrenamientos de texto libre de `body.logged`),
 * resuelve los músculos de cada ejercicio, calcula series por músculo, récords y los agregados de la semana.
 *
 * XP: un entrenamiento NO da XP por sí solo; la app registra junto una `mission.completed` (misión "Entrenar" o
 * la diaria que elijas) y de ahí salen XP, racha, oro y atributos. Lo único que da XP aquí es un RÉCORD PERSONAL
 * nuevo: mejor marca que todo lo registrado ANTES (por orden de registro) con fecha igual o anterior. Así agregar
 * un registro nunca le quita un récord (ni XP) a otro, y una foto de una fecha pasada no depende de lo posterior.
 */

export const TRAINING_SETTINGS_ID = 'training-settings';

/** Mejor marca de un ejercicio en una sesión. */
export interface ExerciseTop {
  /** Peso más alto levantado (con ≥ 1 rep). */
  kg?: number;
  /** Más repeticiones en una serie. */
  reps?: number;
  /** 1RM estimado (Epley) de la mejor serie (hasta 20 reps). */
  e1rm?: number;
  /** Volumen de la sesión: Σ reps × kg. */
  volume?: number;
  /** Más segundos en una serie (isométricos). */
  sec?: number;
  /** Más km en una entrada (cardio). */
  km?: number;
  /** Minutos totales (cardio). */
  min?: number;
  /** Ritmo de la entrada con más km (min/km, menor es mejor). */
  pace?: number;
}

export interface ResolvedExercise {
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  primary: MuscleId[];
  secondary: MuscleId[];
  /** Se conocen sus músculos (biblioteca, ejercicio propio o guardados en el registro). */
  known: boolean;
  sets: WorkoutSet[];
  /** Series duras (fuerza e isométricos; el cardio no cuenta series). */
  hardSets: number;
  volumeKg: number;
  cardioMinutes: number;
  top: ExerciseTop;
}

export interface Workout {
  eventId: string;
  date: string;
  /** Momento estimado (ISO): la hora de registro si fue ese mismo día; si no, las 18:00 de ese día. */
  at: string;
  /** `cuerpo` = entrenamiento de texto libre registrado en Cuerpo (sin músculos). */
  source: 'entreno' | 'cuerpo';
  kind: WorkoutKind;
  title: string;
  where: WorkoutPlace | null;
  placeId: string | null;
  minutes: number | null;
  rpe: number | null;
  note: string;
  routineId: string | null;
  missionEventId: string | null;
  exercises: ResolvedExercise[];
  hardSets: number;
  volumeKg: number;
  cardioMinutes: number;
  /** Series efectivas por músculo (principal = 1, secundario = config.training.secondaryFactor). */
  muscleSets: Partial<Record<MuscleId, number>>;
  /** Ejercicios en los que este registro marcó récord personal con XP. */
  records: string[];
}

export interface RecordMark {
  value: number;
  date: string;
  eventId: string;
}

export interface ExerciseRecord {
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  sessions: number;
  firstDate: string;
  lastDate: string;
  best: Partial<Record<keyof ExerciseTop, RecordMark>>;
  /** Una entrada por sesión, en orden cronológico (para la gráfica de progreso). */
  history: { date: string; eventId: string; top: ExerciseTop; sets: number }[];
  /** Series de la última vez (para precargar "repetir"). */
  lastSets: WorkoutSet[];
}

/** Lo que se sabe de un músculo (sin depender de la hora actual; ver engine/training.ts). */
export interface MuscleAggregate {
  /** Último día con ≥ 1 serie efectiva. */
  lastDate: string | null;
  lastAt: string | null;
  /** Última sesión que pide recuperación (≥ recoveryMinSets) y cuándo queda listo. */
  hardAt: string | null;
  readyAt: string | null;
  /** Series efectivas de la semana (lunes a hoy) y en cuántos días distintos. */
  weekSets: number;
  weekDays: number;
  last7Sets: number;
  last14Sets: number;
}

/** Resumen compacto (JSON) que usan el análisis, la foto para la IA y el personaje 3D. */
export interface TrainingSummary {
  today: string;
  weekStart: string;
  sessionsThisWeek: number;
  hardSetsThisWeek: number;
  cardioMinutesThisWeek: number;
  /** Semanas seguidas con al menos `streakMinSessions` sesiones (la semana en curso no rompe). */
  weekStreak: number;
  lastWorkout: { date: string; title: string; kind: WorkoutKind } | null;
  muscles: Record<MuscleId, MuscleAggregate>;
  /** Ejercicios más usados en 90 días (ids, del más frecuente al menos). */
  favorites: string[];
  usualWhere: WorkoutPlace | null;
}

export interface TrainingState {
  /** Todos los entrenamientos, en orden cronológico. */
  workouts: Workout[];
  records: Record<string, ExerciseRecord>;
  /** Ejercicios propios del catálogo, ya como definiciones. */
  custom: Record<string, ExerciseDef>;
  settings: TrainingSettingsData;
  summary: TrainingSummary;
}

// ---------------------------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------------------------

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** 1RM estimado con la fórmula de Epley: kg × (1 + reps / 30). Con 1 rep, el peso. */
export function epley1rm(kg: number, reps: number): number {
  if (!(kg > 0) || !(reps >= 1)) return 0;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

/** Métrica de récord de cada forma de medir: 1RM estimado, repeticiones, segundos o kilómetros. */
export const RECORD_METRIC: Record<ExerciseMeasure, keyof ExerciseTop> = { peso: 'e1rm', corporal: 'reps', tiempo: 'sec', distancia: 'km' };

/** Forma de medir deducida de las series (para ejercicios desconocidos). */
export function measureFromSets(sets: WorkoutSet[]): ExerciseMeasure {
  if (sets.some((s) => (s.km ?? 0) > 0 || (s.min ?? 0) > 0)) return 'distancia';
  if (sets.some((s) => (s.sec ?? 0) > 0) && !sets.some((s) => (s.reps ?? 0) > 0)) return 'tiempo';
  if (sets.some((s) => (s.kg ?? 0) > 0)) return 'peso';
  return 'corporal';
}

export function exerciseDefFromEntity(e: Entity<ExerciseData>): ExerciseDef {
  const primary = (e.data.primary ?? []).filter(isMuscleId);
  return {
    id: e.id,
    name: e.data.name,
    equipment: e.data.equipment ?? 'corporal',
    measure: e.data.measure ?? 'peso',
    primary,
    secondary: (e.data.secondary ?? []).filter((m) => isMuscleId(m) && !primary.includes(m)),
    compound: primary.length > 1,
  };
}

/** Ejercicio de un registro → músculos y números (biblioteca > ejercicio propio > músculos guardados en el registro). */
export function resolveExercise(ex: WorkoutPayload['exercises'][number], custom: Record<string, ExerciseDef>): ResolvedExercise {
  const def = EXERCISE_BY_ID.get(ex.exerciseId) ?? custom[ex.exerciseId];
  const sets = ex.sets ?? [];
  let measure: ExerciseMeasure;
  let primary: MuscleId[];
  let secondary: MuscleId[];
  if (def) {
    measure = def.measure;
    primary = def.primary;
    secondary = def.secondary;
  } else {
    measure = measureFromSets(sets);
    primary = (ex.primary ?? []).filter(isMuscleId);
    secondary = (ex.secondary ?? []).filter((m) => isMuscleId(m) && !primary.includes(m));
  }
  const top: ExerciseTop = {};
  let hardSets = 0;
  let volumeKg = 0;
  let cardioMinutes = 0;
  for (const s of sets) {
    const reps = s.reps ?? 0;
    const kg = s.kg ?? 0;
    if (measure === 'distancia') {
      cardioMinutes += s.min ?? 0;
      if ((s.km ?? 0) > (top.km ?? 0)) {
        top.km = s.km;
        if ((s.min ?? 0) > 0) top.pace = round(s.min! / s.km!, 2);
      }
      continue;
    }
    if (reps > 0 || (s.sec ?? 0) > 0) hardSets++;
    if (reps > 0) {
      top.reps = Math.max(top.reps ?? 0, reps);
      if (kg > 0) {
        top.kg = Math.max(top.kg ?? 0, kg);
        volumeKg += reps * kg;
        if (reps <= 20) top.e1rm = Math.max(top.e1rm ?? 0, round(epley1rm(kg, reps), 2));
      }
    }
    if ((s.sec ?? 0) > 0) top.sec = Math.max(top.sec ?? 0, s.sec!);
  }
  if (volumeKg > 0) top.volume = round(volumeKg, 1);
  if (cardioMinutes > 0) top.min = round(cardioMinutes, 1);
  return {
    exerciseId: ex.exerciseId,
    name: ex.name,
    measure,
    primary,
    secondary,
    known: primary.length > 0,
    sets,
    hardSets,
    volumeKg: round(volumeKg, 1),
    cardioMinutes: round(cardioMinutes, 1),
    top,
  };
}

/** Series efectivas por músculo de una lista de ejercicios. */
export function muscleSetsOf(exercises: ResolvedExercise[], secondaryFactor: number): Partial<Record<MuscleId, number>> {
  const out: Partial<Record<MuscleId, number>> = {};
  for (const ex of exercises) {
    if (!ex.hardSets) continue;
    for (const m of ex.primary) out[m] = (out[m] ?? 0) + ex.hardSets;
    for (const m of ex.secondary) out[m] = (out[m] ?? 0) + ex.hardSets * secondaryFactor;
  }
  return out;
}

const AEROBIC_KINDS = new Set<WorkoutKind>(['cardio', 'deporte', 'clase', 'caminata']);

/** Tipo de un entrenamiento de texto libre ("Correr 5 km", "Pierna 45 min"). */
export function guessWorkoutKind(text: string): WorkoutKind {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/(corr|trot|bici|spinning|cardio|eliptic|nad|natac|remo ergo|cuerda|hiit)/.test(t)) return 'cardio';
  if (/camin/.test(t)) return 'caminata';
  if (/(yoga|estir|movilidad|pilates|flexibil)/.test(t)) return 'movilidad';
  if (/(futbol|fut |basket|basquet|tenis|padel|box|voley|beis|squash|escalada|frontenis)/.test(t)) return 'deporte';
  if (/(clase|crossfit|zumba|funcional)/.test(t)) return 'clase';
  return 'fuerza';
}

function minutesFromText(text: string): number | null {
  const h = /(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hora|horas)\b/i.exec(text);
  const m = /(\d+)\s*(?:min|mins|minutos|m)\b/i.exec(text);
  const total = (h ? Number(h[1].replace(',', '.')) * 60 : 0) + (m ? Number(m[1]) : 0);
  return total > 0 && total <= 1440 ? Math.round(total) : null;
}

type RegKey = [number, string, string];
const regKey = (e: GameEvent): RegKey => [e.createdAt ?? 0, e.occurredAt, e.id];
const regCmp = (a: RegKey, b: RegKey) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);

// Inicio del día local (ms UTC). Se guarda entre proyecciones y reutiliza un solo formateador: crear
// Intl.DateTimeFormat por registro haría lento project() (corre en cada render y en el plan gratis de Workers).
const TZ_FORMAT = new Map<string, Intl.DateTimeFormat>();
const DAY_START = new Map<string, number>();
function tzOffsetMs(t: number, tz: string): number {
  let f = TZ_FORMAT.get(tz);
  if (!f) TZ_FORMAT.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })));
  const parts = f.formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(t / 1000) * 1000;
}
export function localDayStart(date: string, tz: string): number {
  const key = `${tz}|${date}`;
  let t = DAY_START.get(key);
  if (t === undefined) {
    const [y, m, d] = date.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d);
    t = guess - tzOffsetMs(guess, tz);
    const t2 = guess - tzOffsetMs(t, tz);
    if (t2 !== t) t = t2;
    if (DAY_START.size > 20_000) DAY_START.clear();
    DAY_START.set(key, t);
  }
  return t;
}

const emptyAggregate = (): MuscleAggregate => ({ lastDate: null, lastAt: null, hardAt: null, readyAt: null, weekSets: 0, weekDays: 0, last7Sets: 0, last14Sets: 0 });

// ---------------------------------------------------------------------------------------------
// Reductor
// ---------------------------------------------------------------------------------------------

export function reduceTraining(ctx: Ctx): TrainingState {
  const tc = ctx.cfg.training;
  const tz = ctx.cfg.timezone;
  const custom: Record<string, ExerciseDef> = {};
  for (const e of entitiesOf<ExerciseData>(ctx, 'training', 'exercise')) custom[e.id] = exerciseDefFromEntity(e);
  const settings: TrainingSettingsData = { ...((ctx.entityById.get(TRAINING_SETTINGS_ID)?.data as TrainingSettingsData | undefined) ?? {}) };

  const estimateAt = (e: GameEvent) => {
    const t = Date.parse(e.occurredAt);
    const s = localDayStart(e.localDate, tz);
    if (t >= s && t < s + 86_400_000) return e.occurredAt.length === 24 && e.occurredAt.endsWith('Z') ? e.occurredAt : new Date(t).toISOString();
    return new Date(s + 18 * 3_600_000).toISOString();
  };

  // ---- Entrenamientos ----
  const regs = new Map<string, RegKey>();
  const workouts: Workout[] = [];
  for (const e of ofType<WorkoutPayload>(ctx, 'workout.logged')) {
    const p = e.payload;
    const exercises = (p.exercises ?? []).map((x) => resolveExercise(x, custom));
    const hardSets = exercises.reduce((s, x) => s + x.hardSets, 0);
    const exCardio = exercises.reduce((s, x) => s + x.cardioMinutes, 0);
    const kind = (WORKOUT_KINDS as readonly string[]).includes(p.kind) ? p.kind : 'otro';
    regs.set(e.id, regKey(e));
    workouts.push({
      eventId: e.id,
      date: e.localDate,
      at: estimateAt(e),
      source: 'entreno',
      kind,
      title: p.title?.trim() || defaultTitle(kind, exercises),
      where: p.where && (WORKOUT_PLACES as readonly string[]).includes(p.where) ? p.where : null,
      placeId: p.placeId ?? null,
      minutes: p.minutes ?? null,
      rpe: p.rpe ?? null,
      note: p.note ?? '',
      routineId: p.routineId ?? null,
      missionEventId: p.missionEventId ?? null,
      exercises,
      hardSets,
      volumeKg: round(exercises.reduce((s, x) => s + x.volumeKg, 0), 1),
      // Cardio: los minutos de ejercicios de distancia; si no hay, la duración de un entrenamiento aeróbico.
      cardioMinutes: exCardio > 0 ? round(exCardio, 1) : AEROBIC_KINDS.has(kind) && p.minutes ? p.minutes : 0,
      muscleSets: muscleSetsOf(exercises, tc.secondaryFactor),
      records: [],
    });
  }
  // Entrenamientos de texto libre de Cuerpo (antes de este sistema): cuentan como sesión, sin músculos.
  for (const e of ofType<{ workout?: string }>(ctx, 'body.logged')) {
    const text = e.payload.workout?.trim();
    if (!text) continue;
    const kind = guessWorkoutKind(text);
    const minutes = minutesFromText(text);
    workouts.push({
      eventId: e.id,
      date: e.localDate,
      at: estimateAt(e),
      source: 'cuerpo',
      kind,
      title: text,
      where: null,
      placeId: null,
      minutes,
      rpe: null,
      note: '',
      routineId: null,
      missionEventId: null,
      exercises: [],
      hardSets: 0,
      volumeKg: 0,
      cardioMinutes: AEROBIC_KINDS.has(kind) && minutes ? minutes : 0,
      muscleSets: {},
      records: [],
    });
  }
  workouts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : a.eventId < b.eventId ? -1 : 1));

  const records = buildRecords(workouts);
  awardRecordXp(ctx, workouts, regs);

  return { workouts, records, custom, settings, summary: summarize(workouts, ctx.today, ctx.cfg) };
}

function defaultTitle(kind: WorkoutKind, exercises: ResolvedExercise[]): string {
  if (exercises.length === 1) return exercises[0].name;
  if (kind === 'fuerza' && exercises.length) return 'Fuerza';
  return { fuerza: 'Fuerza', cardio: 'Cardio', movilidad: 'Movilidad', deporte: 'Deporte', clase: 'Clase', caminata: 'Caminata', otro: 'Entrenamiento' }[kind];
}

/** Récords (por orden cronológico; solo lectura, no dan XP). */
function buildRecords(workouts: Workout[]): Record<string, ExerciseRecord> {
  const out: Record<string, ExerciseRecord> = {};
  for (const w of workouts) {
    // Un ejercicio repetido en el mismo registro cuenta como una sesión (se junta su mejor marca).
    const merged = new Map<string, ResolvedExercise[]>();
    for (const x of w.exercises) merged.set(x.exerciseId, [...(merged.get(x.exerciseId) ?? []), x]);
    for (const [id, xs] of merged) {
      const top = mergeTops(xs.map((x) => x.top));
      const r = (out[id] ??= { exerciseId: id, name: xs[0].name, measure: xs[0].measure, sessions: 0, firstDate: w.date, lastDate: w.date, best: {}, history: [], lastSets: [] });
      r.sessions++;
      r.lastDate = w.date;
      r.name = xs[0].name;
      r.lastSets = xs.flatMap((x) => x.sets);
      r.history.push({ date: w.date, eventId: w.eventId, top, sets: xs.reduce((s, x) => s + (x.measure === 'distancia' ? x.sets.length : x.hardSets), 0) });
      for (const k of Object.keys(top) as (keyof ExerciseTop)[]) {
        const v = top[k]!;
        const cur = r.best[k];
        const better = k === 'pace' ? !cur || v < cur.value : !cur || v > cur.value;
        if (better) r.best[k] = { value: v, date: w.date, eventId: w.eventId };
      }
    }
  }
  return out;
}

function mergeTops(tops: ExerciseTop[]): ExerciseTop {
  const out: ExerciseTop = {};
  for (const t of tops) {
    for (const k of Object.keys(t) as (keyof ExerciseTop)[]) {
      const v = t[k]!;
      if (k === 'volume' || k === 'min') out[k] = round((out[k] ?? 0) + v, 1);
      else if (k === 'pace') out[k] = out[k] === undefined ? v : Math.min(out[k]!, v);
      else out[k] = Math.max(out[k] ?? 0, v);
    }
  }
  return out;
}

/**
 * XP por récord personal: un registro gana el récord de un ejercicio si supera la mejor marca de todos los
 * registros ANTERIORES (por orden de registro) con fecha igual o anterior, y ya había al menos uno. Máximo uno
 * por ejercicio por día y `record.maxPerDay` por día.
 */
function awardRecordXp(ctx: Ctx, workouts: Workout[], regs: Map<string, RegKey>) {
  const rc = ctx.cfg.training.record;
  const amount = ctx.cfg.missionXp[rc.size as MissionSize] ?? 0;
  type Entry = { w: Workout; exerciseId: string; name: string; date: string; reg: RegKey; metric: number };
  const entries: Entry[] = [];
  for (const w of workouts) {
    if (w.source !== 'entreno') continue;
    const best = new Map<string, Entry>();
    for (const x of w.exercises) {
      const metric = x.top[RECORD_METRIC[x.measure]];
      if (!(typeof metric === 'number' && metric > 0)) continue;
      const prev = best.get(x.exerciseId);
      if (!prev || metric > prev.metric) best.set(x.exerciseId, { w, exerciseId: x.exerciseId, name: x.name, date: w.date, reg: regs.get(w.eventId)!, metric });
    }
    entries.push(...best.values());
  }
  entries.sort((a, b) => regCmp(a.reg, b.reg));
  type Seen = { list: { date: string; metric: number }[]; maxDate: string; best: number };
  const seen = new Map<string, Seen>();
  const awarded = new Set<string>();
  const perDay = new Map<string, number>();
  for (const e of entries) {
    // Mejor marca de los registros anteriores con fecha igual o anterior. Caso común (se registra en orden):
    // todos los anteriores tienen fecha ≤ esta y basta el máximo acumulado.
    const sn = seen.get(e.exerciseId);
    let priorBest = -1;
    if (sn && sn.maxDate <= e.date) priorBest = sn.best;
    else if (sn) for (const p of sn.list) if (p.date <= e.date && p.metric > priorBest) priorBest = p.metric;
    const key = `${e.exerciseId}|${e.date}`;
    if (priorBest > 0 && !awarded.has(key) && (perDay.get(e.date) ?? 0) < rc.maxPerDay) {
      if (e.metric > priorBest + 1e-6) {
        awarded.add(key);
        perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1);
        e.w.records.push(e.exerciseId);
        ctx.addXp({ date: e.date, amount, source: 'training_record', label: `Récord: ${e.name}`, attribute: rc.attribute as AttributeId, eventId: e.w.eventId, refId: e.exerciseId });
      }
    }
    if (!sn) seen.set(e.exerciseId, { list: [{ date: e.date, metric: e.metric }], maxDate: e.date, best: e.metric });
    else {
      sn.list.push({ date: e.date, metric: e.metric });
      if (e.date > sn.maxDate) sn.maxDate = e.date;
      if (e.metric > sn.best) sn.best = e.metric;
    }
  }
}

/** Agregados por músculo y de la semana (dependen de `today`, no de la hora). */
export function summarize(workouts: Workout[], today: string, cfg: GameConfigInput): TrainingSummary {
  const tc = cfg.training;
  const ws = weekStart(today);
  const d7 = addDays(today, -6);
  const d14 = addDays(today, -13);
  const muscles = Object.fromEntries(MUSCLE_IDS.map((m) => [m, emptyAggregate()])) as Record<MuscleId, MuscleAggregate>;
  const weekDays = new Map<MuscleId, Set<string>>();
  let sessionsThisWeek = 0;
  let hardSetsThisWeek = 0;
  let cardioMinutesThisWeek = 0;
  for (const w of workouts) {
    if (w.date > today) continue;
    const inWeek = w.date >= ws;
    if (inWeek) {
      sessionsThisWeek++;
      hardSetsThisWeek += w.hardSets;
      cardioMinutesThisWeek += w.cardioMinutes;
    }
    for (const [m, sets] of Object.entries(w.muscleSets) as [MuscleId, number][]) {
      const a = muscles[m];
      if (inWeek) a.weekSets += sets;
      if (w.date >= d7) a.last7Sets += sets;
      if (w.date >= d14) a.last14Sets += sets;
      if (sets >= 1) {
        a.lastDate = w.date;
        a.lastAt = w.at;
        if (inWeek) (weekDays.get(m) ?? weekDays.set(m, new Set()).get(m)!).add(w.date);
      }
      if (sets >= tc.recoveryMinSets) a.hardAt = w.at;
    }
  }
  for (const m of MUSCLE_IDS) {
    const a = muscles[m];
    a.weekSets = round(a.weekSets, 1);
    a.last7Sets = round(a.last7Sets, 1);
    a.last14Sets = round(a.last14Sets, 1);
    a.weekDays = weekDays.get(m)?.size ?? 0;
    if (a.hardAt) a.readyAt = new Date(Date.parse(a.hardAt) + (MUSCLES[m].size === 'grande' ? tc.recoveryHours.grande : tc.recoveryHours.chico) * 3_600_000).toISOString();
  }

  // Semanas seguidas con al menos N sesiones (la semana en curso cuenta si ya llegó; si no, no rompe).
  const perWeek = new Map<string, number>();
  const wkOf = new Map<string, string>();
  for (const w of workouts) {
    if (w.date > today) continue;
    let k = wkOf.get(w.date);
    if (!k) wkOf.set(w.date, (k = weekStart(w.date)));
    perWeek.set(k, (perWeek.get(k) ?? 0) + 1);
  }
  let weekStreak = 0;
  let wk = ws;
  if ((perWeek.get(wk) ?? 0) >= tc.streakMinSessions) weekStreak++;
  wk = addDays(wk, -7);
  while ((perWeek.get(wk) ?? 0) >= tc.streakMinSessions) {
    weekStreak++;
    wk = addDays(wk, -7);
  }

  const d90 = addDays(today, -89);
  const counts = new Map<string, { n: number; last: string }>();
  for (const w of workouts) {
    if (w.date < d90 || w.date > today) continue;
    for (const x of new Set(w.exercises.map((e) => e.exerciseId))) counts.set(x, { n: (counts.get(x)?.n ?? 0) + 1, last: w.date });
  }
  const favorites = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || (a[1].last < b[1].last ? 1 : -1)).map(([id]) => id).slice(0, 20);

  const whereCount = new Map<WorkoutPlace, number>();
  for (const w of workouts.filter((w) => w.where && w.date <= today).slice(-10)) whereCount.set(w.where!, (whereCount.get(w.where!) ?? 0) + 1);
  const usualWhere = [...whereCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const last = workouts.filter((w) => w.date <= today).at(-1);
  return {
    today,
    weekStart: ws,
    sessionsThisWeek,
    hardSetsThisWeek: round(hardSetsThisWeek, 1),
    cardioMinutesThisWeek: Math.round(cardioMinutesThisWeek),
    weekStreak,
    lastWorkout: last ? { date: last.date, title: last.title, kind: last.kind } : null,
    muscles,
    favorites,
    usualWhere,
  };
}
