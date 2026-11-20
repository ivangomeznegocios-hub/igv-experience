import { GAME_CONFIG, type GameConfigInput } from '../config/game';
import {
  MUSCLE_IDS,
  type AttributeId,
  type CompletionKind,
  type Entity,
  type ExerciseMeasure,
  type MissionData,
  type MissionSize,
  type MuscleId,
  type TrainingSettingsData,
  type WorkoutPlace,
  type WorkoutSet,
} from '../types';
import { EXERCISE_LIBRARY, MUSCLES, type ExerciseDef, type MuscleGroup } from '../training/library';
import { quickMissionId } from './reports';
import { RECORD_METRIC, type ExerciseRecord, type ExerciseTop, type MuscleAggregate, type TrainingSummary } from './modules/training';
import type { XpEntry } from './context';
import { diffDays, weekday } from '../util/dates';

/**
 * Análisis de entrenamiento basado en evidencia (funciones puras). Necesita la hora actual (`nowIso`) para la
 * recuperación; todo lo demás sale del resumen de `project()` (state.training.summary), que también viaja en la
 * foto para la IA.
 *
 *  - Volumen: 10–20 series duras por músculo a la semana; mínimo efectivo ~6 (accesorios: 3–6). Una serie cuenta
 *    completa para los músculos principales del ejercicio y media para los secundarios.
 *  - Frecuencia: cada músculo al menos 2 veces por semana.
 *  - Recuperación: 48 h músculos chicos, 72 h grandes, tras una sesión con ≥ 2 series efectivas.
 *  - Cardio: 150–300 min moderados por semana.
 */

export type MuscleState = 'recuperando' | 'listo' | 'olvidado';

/**
 * Estado de un músculo — LISTO PARA PINTAR EN EL PERSONAJE 3D: `load` (0–1, volumen de la semana contra el
 * objetivo), `fatigue` (0–1, 1 = recién entrenado fuerte) y `volumeLevel` (0–4) dicen de qué color va cada zona;
 * `MUSCLES[id].anatomy` dice qué músculos anatómicos agrupa.
 */
export interface MuscleStatus {
  id: MuscleId;
  name: string;
  group: MuscleGroup;
  accessory: boolean;
  state: MuscleState;
  lastDate: string | null;
  daysSince: number | null;
  hoursSince: number | null;
  readyAt: string | null;
  /** Horas que faltan para estar recuperado (0 si ya). */
  hoursToReady: number;
  /** 0 = recién entrenado fuerte · 1 = recuperado. */
  recovery: number;
  fatigue: number;
  weekSets: number;
  /** Días distintos de esta semana con ≥ 1 serie efectiva. */
  weekDays: number;
  last7Sets: number;
  target: { min: number; target: number; max: number };
  /** 0 nada · 1 bajo el mínimo · 2 efectivo · 3 en el objetivo · 4 más del máximo. */
  volumeLevel: 0 | 1 | 2 | 3 | 4;
  load: number;
  /** Series que faltan esta semana para llegar al objetivo. */
  need: number;
}

export function weeklyTarget(m: MuscleId, cfg: GameConfigInput = GAME_CONFIG as GameConfigInput) {
  const t = MUSCLES[m].accessory ? cfg.training.accessoryWeeklySets : cfg.training.weeklySets;
  return { min: t.min, target: t.target, max: t.max };
}

function volumeLevel(sets: number, t: { min: number; target: number; max: number }): MuscleStatus['volumeLevel'] {
  if (sets <= 0) return 0;
  if (sets < t.min) return 1;
  if (sets < t.target) return 2;
  if (sets <= t.max) return 3;
  return 4;
}

const HOUR = 3_600_000;

/** Estado de cada músculo a una hora dada. */
export function muscleStatus(summary: Pick<TrainingSummary, 'today' | 'muscles'>, nowIso: string, cfg: GameConfigInput = GAME_CONFIG as GameConfigInput): Record<MuscleId, MuscleStatus> {
  const now = Date.parse(nowIso);
  const out = {} as Record<MuscleId, MuscleStatus>;
  for (const id of MUSCLE_IDS) {
    const a: MuscleAggregate = summary.muscles[id];
    const info = MUSCLES[id];
    const target = weeklyTarget(id, cfg);
    const ready = a.readyAt ? Date.parse(a.readyAt) : null;
    const hard = a.hardAt ? Date.parse(a.hardAt) : null;
    const recovering = ready !== null && hard !== null && now < ready;
    const recovery = recovering ? Math.max(0, Math.min(1, (now - hard!) / (ready! - hard!))) : 1;
    const daysSince = a.lastDate ? Math.max(0, diffDays(a.lastDate, summary.today)) : null;
    const state: MuscleState = recovering ? 'recuperando' : daysSince === null || daysSince >= cfg.training.forgottenDays ? 'olvidado' : 'listo';
    out[id] = {
      id,
      name: info.name,
      group: info.group,
      accessory: info.accessory,
      state,
      lastDate: a.lastDate,
      daysSince,
      hoursSince: a.lastAt ? Math.max(0, Math.round((now - Date.parse(a.lastAt)) / HOUR)) : null,
      readyAt: a.readyAt,
      hoursToReady: recovering ? Math.ceil((ready! - now) / HOUR) : 0,
      recovery: Math.round(recovery * 100) / 100,
      fatigue: Math.round((1 - recovery) * 100) / 100,
      weekSets: a.weekSets,
      weekDays: a.weekDays,
      last7Sets: a.last7Sets,
      target,
      volumeLevel: volumeLevel(a.weekSets, target),
      load: Math.round(Math.min(1, a.weekSets / target.target) * 100) / 100,
      need: Math.max(0, Math.round((target.target - a.weekSets) * 10) / 10),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sesión sugerida
// ---------------------------------------------------------------------------------------------

export type SplitId = 'cuerpo_completo' | 'torso' | 'pierna' | 'empuje' | 'jalon';

interface SplitDef {
  title: string;
  /** Deben estar recuperados para elegir esta sesión. */
  key: MuscleId[];
  muscles: MuscleId[];
  /** Series por músculo que caben en una sesión de este tipo. */
  perMuscle: number;
}

export const SPLITS: Record<SplitId, SplitDef> = {
  cuerpo_completo: {
    title: 'Cuerpo completo',
    key: ['pecho', 'espalda', 'cuadriceps', 'gluteos'],
    muscles: MUSCLE_IDS.filter((m) => !MUSCLES[m].accessory),
    perMuscle: 3,
  },
  torso: { title: 'Torso', key: ['pecho', 'espalda'], muscles: ['pecho', 'espalda', 'hombro_frontal', 'hombro_lateral', 'hombro_posterior', 'biceps', 'triceps', 'trapecio'], perMuscle: 5 },
  pierna: { title: 'Pierna', key: ['cuadriceps', 'gluteos'], muscles: ['cuadriceps', 'isquios', 'gluteos', 'pantorrillas', 'aductores', 'lumbar', 'abdomen', 'oblicuos'], perMuscle: 5 },
  empuje: { title: 'Empuje', key: ['pecho'], muscles: ['pecho', 'hombro_frontal', 'hombro_lateral', 'triceps'], perMuscle: 6 },
  jalon: { title: 'Jalón', key: ['espalda'], muscles: ['espalda', 'hombro_posterior', 'biceps', 'trapecio', 'antebrazo'], perMuscle: 6 },
};

export interface SuggestedExercise {
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  sets: number;
  /** Rango sugerido ("6–10", "10–15", "30–60 s", "30–45 min"). */
  reps: string;
  muscles: MuscleId[];
}

export interface SessionSuggestion {
  split: SplitId | 'cardio' | 'descanso';
  title: string;
  reason: string;
  focus: MuscleId[];
  exercises: SuggestedExercise[];
}

/** Equipo disponible fuera del gym (casa, parque, calle…). */
const HOME_EQUIPMENT = new Set(['corporal', 'mancuerna', 'banda', 'kettlebell']);

function repsHint(ex: ExerciseDef): string {
  if (ex.measure === 'tiempo') return '30–60 s';
  if (ex.measure === 'distancia') return '30–45 min';
  if (ex.measure === 'corporal') return '8–15';
  return ex.compound ? '6–10' : '10–15';
}

const listNames = (ids: MuscleId[]) => {
  const n = ids.map((m) => MUSCLES[m].name.toLowerCase());
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} y ${n.at(-1)}`;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface SuggestOptions {
  cfg?: GameConfigInput;
  /** Ejercicios propios (además de la biblioteca). */
  custom?: ExerciseDef[];
  favorites?: string[];
  where?: WorkoutPlace | null;
  cardioMinutesThisWeek?: number;
}

/**
 * Elige la siguiente sesión: entre las plantillas cuyos músculos clave están recuperados, la que más series
 * atrasadas cubre (con tope de una sesión); a igualdad, la de músculos clave más atrasados y luego el orden
 * cuerpo completo → torso → pierna → empuje → jalón. Un músculo trabajado solo 1 vez en la semana pide al
 * menos un bloque más (frecuencia ≥ 2).
 */
export function suggestSession(muscles: Record<MuscleId, MuscleStatus>, opts: SuggestOptions = {}): SessionSuggestion {
  const cfg = opts.cfg ?? (GAME_CONFIG as GameConfigInput);
  const tc = cfg.training;
  const sc = tc.suggestion;
  const ready = (m: MuscleId) => muscles[m].state !== 'recuperando';
  const need = sessionNeed(muscles, cfg);

  let best: { id: SplitId; capped: number; urgency: number } | null = null;
  for (const id of Object.keys(SPLITS) as SplitId[]) {
    const s = SPLITS[id];
    if (!s.key.every(ready)) continue;
    const raw = s.muscles.filter(ready).reduce((t, m) => t + Math.min(need(m), s.perMuscle), 0);
    const capped = Math.min(raw, sc.sessionSets);
    const urgency = s.key.reduce((t, m) => t + need(m), 0) / s.key.length;
    if (!best || capped > best.capped + 1e-9 || (Math.abs(capped - best.capped) < 1e-9 && urgency > best.urgency + 1e-9)) best = { id, capped, urgency };
  }

  const cardioLeft = Math.max(0, tc.cardioMinutes.min - (opts.cardioMinutesThisWeek ?? 0));
  const recovering = MUSCLE_IDS.filter((m) => !ready(m) && !MUSCLES[m].accessory);
  if (!best || best.capped < sc.setsPerExercise) {
    const cardioEx: SuggestedExercise[] = ['correr', 'bici']
      .map((id) => EXERCISE_LIBRARY.find((e) => e.id === id)!)
      .map((e) => ({ exerciseId: e.id, name: e.name, measure: e.measure, sets: 1, reps: '30–45 min', muscles: e.primary }));
    const big = recovering.filter((m) => MUSCLES[m].size === 'grande');
    const why = !best ? `${cap(listNames(big.length ? big : recovering))} ${(big.length ? big : recovering).length > 1 ? 'se están' : 'se está'} recuperando.` : 'Ya cubriste el volumen de fuerza de la semana.';
    if (cardioLeft > 0) return { split: 'cardio', title: 'Cardio', reason: `${why} Te faltan ${Math.round(cardioLeft)} min de cardio esta semana.`, focus: [], exercises: cardioEx };
    return { split: 'descanso', title: 'Descanso o movilidad', reason: `${why} Hoy rinde más descansar, estirar o caminar.`, focus: [], exercises: [] };
  }

  const split = SPLITS[best.id];
  const focus = split.muscles.filter((m) => ready(m) && need(m) > 0).sort((a, b) => need(b) - need(a));
  const exercises = pickExercises(best.id, muscles, focus, need, opts, cfg);
  let reason: string;
  if (best.id === 'cuerpo_completo') {
    const behind = split.muscles.filter((m) => muscles[m].weekSets < muscles[m].target.min).length;
    reason = behind
      ? `Todo está recuperado y ${behind} ${behind === 1 ? 'músculo va' : 'músculos van'} bajo el mínimo esta semana: cuerpo completo los cubre en una sesión.`
      : `Todo está recuperado: cuerpo completo mantiene cada músculo en ${tc.minFrequency} veces por semana.`;
  } else {
    const k = split.key;
    const sets = k.map((m) => fmtSets(muscles[m].weekSets)).join(' y ');
    reason = `${cap(listNames(k))} ${k.length > 1 ? 'están listos y llevan' : 'está listo y lleva'} ${sets} de ${muscles[k[0]].target.target} series esta semana.`;
    if (recovering.length) reason += ` ${cap(listNames(recovering.slice(0, 3)))} ${recovering.length > 1 ? 'siguen' : 'sigue'} en recuperación.`;
  }
  return { split: best.id, title: split.title, reason, focus, exercises };
}

const fmtSets = (n: number) => String(Math.round(n * 10) / 10);

/** Series que pide un músculo para la siguiente sesión: lo que falta para el objetivo y, si solo se trabajó una vez, un bloque más. */
function sessionNeed(muscles: Record<MuscleId, MuscleStatus>, cfg: GameConfigInput) {
  const tc = cfg.training;
  return (m: MuscleId) => {
    const s = muscles[m];
    const freq = s.weekDays < tc.minFrequency && s.weekSets < s.target.max ? tc.suggestion.setsPerExercise : 0;
    return Math.max(s.need, freq) * (s.state === 'olvidado' && s.lastDate ? 1.25 : 1);
  };
}

/** Patrones de movimiento: músculo objetivo y ejercicios en orden de preferencia (los favoritos van primero). */
interface Slot {
  muscle: MuscleId;
  ids: string[];
}
const P: Record<string, Slot> = {
  squat: { muscle: 'cuadriceps', ids: ['sentadilla', 'prensa', 'sentadilla-goblet', 'sentadilla-hack', 'sentadilla-bulgara', 'sentadilla-corporal'] },
  hinge: { muscle: 'isquios', ids: ['peso-muerto-rumano', 'peso-muerto', 'swing-kettlebell', 'hip-thrust', 'puente-gluteo'] },
  lunge: { muscle: 'gluteos', ids: ['zancadas', 'sentadilla-bulgara', 'step-up', 'hip-thrust', 'puente-gluteo'] },
  glute: { muscle: 'gluteos', ids: ['hip-thrust', 'puente-gluteo', 'patada-gluteo', 'abduccion-maquina'] },
  hamcurl: { muscle: 'isquios', ids: ['curl-femoral', 'peso-muerto-rumano', 'puente-gluteo'] },
  calves: { muscle: 'pantorrillas', ids: ['elevacion-talones', 'talones-sentado'] },
  hpush: { muscle: 'pecho', ids: ['press-banca', 'press-mancuernas', 'press-pecho-maquina', 'lagartijas', 'fondos'] },
  incline: { muscle: 'pecho', ids: ['press-inclinado-mancuernas', 'press-inclinado', 'fondos', 'lagartijas'] },
  fly: { muscle: 'pecho', ids: ['aperturas', 'cruce-poleas', 'pec-deck'] },
  vpush: { muscle: 'hombro_frontal', ids: ['press-militar', 'press-hombro-mancuernas', 'press-arnold'] },
  lateral: { muscle: 'hombro_lateral', ids: ['elevaciones-laterales'] },
  rear: { muscle: 'hombro_posterior', ids: ['face-pull', 'pajaros'] },
  vpull: { muscle: 'espalda', ids: ['dominadas', 'jalon-pecho', 'dominadas-supinas', 'remo-invertido'] },
  hpull: { muscle: 'espalda', ids: ['remo-barra', 'remo-polea', 'remo-mancuerna', 'remo-maquina', 'remo-invertido'] },
  biceps: { muscle: 'biceps', ids: ['curl-barra', 'curl-mancuernas', 'curl-martillo', 'curl-polea'] },
  triceps: { muscle: 'triceps', ids: ['extension-polea', 'press-frances', 'extension-sobre-cabeza', 'fondos-banco', 'patada-triceps'] },
  traps: { muscle: 'trapecio', ids: ['encogimientos', 'face-pull'] },
  core: { muscle: 'abdomen', ids: ['plancha', 'elevacion-piernas', 'rueda-abdominal', 'crunch', 'bicho-muerto'] },
};

/** Orden de los patrones en cada tipo de sesión (se saltan los que no hacen falta o no están recuperados). */
export const SPLIT_SLOTS: Record<SplitId, Slot[]> = {
  cuerpo_completo: [P.squat, P.hpush, P.vpull, P.hinge, P.vpush, P.hpull, P.core],
  torso: [P.hpush, P.vpull, P.vpush, P.hpull, P.lateral, P.biceps, P.triceps, P.rear],
  pierna: [P.squat, P.hinge, P.lunge, P.hamcurl, P.calves, P.core, P.glute],
  empuje: [P.hpush, P.vpush, P.incline, P.lateral, P.triceps, P.fly],
  jalon: [P.vpull, P.hpull, P.rear, P.biceps, P.traps],
};

function pickExercises(
  split: SplitId,
  muscles: Record<MuscleId, MuscleStatus>,
  focus: MuscleId[],
  need: (m: MuscleId) => number,
  opts: SuggestOptions,
  cfg: GameConfigInput,
): SuggestedExercise[] {
  const sc = cfg.training.suggestion;
  const S = sc.setsPerExercise;
  const ready = (m: MuscleId) => muscles[m].state !== 'recuperando';
  const rem = new Map<MuscleId, number>(focus.map((m) => [m, need(m)]));
  const favorites = opts.favorites ?? [];
  const homeOnly = !!opts.where && opts.where !== 'gym';
  const byId = new Map([...EXERCISE_LIBRARY, ...(opts.custom ?? [])].map((e) => [e.id, e]));
  const allowed = (e: ExerciseDef | undefined): e is ExerciseDef =>
    !!e && e.measure !== 'distancia' && e.primary.length > 0 && e.primary.every(ready) && (!homeOnly || HOME_EQUIPMENT.has(e.equipment) || favorites.includes(e.id));
  const picked: ExerciseDef[] = [];
  for (const slot of SPLIT_SLOTS[split]) {
    if (picked.length >= sc.maxExercises || picked.length * S >= sc.sessionSets) break;
    if ((rem.get(slot.muscle) ?? 0) <= 0) continue;
    // Tus favoritos que trabajan ese músculo primero; luego la lista del patrón (en casa, peso corporal antes).
    const favs = favorites
      .map((id) => byId.get(id))
      .filter(allowed)
      .filter((e) => e.primary[0] === slot.muscle);
    let list = slot.ids.map((id) => byId.get(id)).filter(allowed);
    if (homeOnly) list = [...list.filter((e) => e.equipment === 'corporal'), ...list.filter((e) => e.equipment !== 'corporal')];
    const ex = [...favs, ...list].find((e) => !picked.includes(e));
    if (!ex) continue;
    picked.push(ex);
    for (const m of ex.primary) if (rem.has(m)) rem.set(m, Math.max(0, rem.get(m)! - S));
    for (const m of ex.secondary) if (rem.has(m)) rem.set(m, Math.max(0, rem.get(m)! - S * cfg.training.secondaryFactor));
  }
  return picked.map((e) => ({ exerciseId: e.id, name: e.name, measure: e.measure, sets: S, reps: repsHint(e), muscles: e.primary }));
}

// ---------------------------------------------------------------------------------------------
// Análisis completo
// ---------------------------------------------------------------------------------------------

export interface TrainingAnalysis {
  weekStart: string;
  /** Días que quedan en la semana contando hoy (lunes = 7, domingo = 1). */
  daysLeft: number;
  sessions: number;
  hardSets: number;
  cardio: { minutes: number; min: number; target: number };
  weekStreak: number;
  muscles: Record<MuscleId, MuscleStatus>;
  /** Músculos principales bajo el mínimo efectivo esta semana (lo que "te falta"), del más atrasado al menos. */
  missing: MuscleStatus[];
  /** Accesorios bajo su mínimo (se muestran aparte). */
  missingAccessory: MuscleStatus[];
  /** Principales en el objetivo esta semana. */
  done: MuscleStatus[];
  recovering: MuscleStatus[];
  balance: { push: number; pull: number; upper: number; lower: number; notes: string[] };
  suggestion: SessionSuggestion;
}

/** Análisis de la semana: estado por músculo, lo que falta, equilibrio y la siguiente sesión sugerida. */
export function trainingAnalysis(
  summary: TrainingSummary,
  nowIso: string,
  opts: { cfg?: GameConfigInput; custom?: ExerciseDef[] } = {},
): TrainingAnalysis {
  const cfg = opts.cfg ?? (GAME_CONFIG as GameConfigInput);
  const tc = cfg.training;
  const muscles = muscleStatus(summary, nowIso, cfg);
  const all = MUSCLE_IDS.map((m) => muscles[m]);
  const behind = (m: MuscleStatus) => m.weekSets < m.target.min;
  const order = (a: MuscleStatus, b: MuscleStatus) => a.weekSets / a.target.min - b.weekSets / b.target.min || (b.daysSince ?? 999) - (a.daysSince ?? 999);
  const missing = all.filter((m) => !m.accessory && behind(m)).sort(order);
  const missingAccessory = all.filter((m) => m.accessory && behind(m)).sort(order);

  // Equilibrio en 14 días: promedio de series por músculo principal de cada grupo.
  const avg = (ids: MuscleId[]) => (ids.length ? ids.reduce((t, m) => t + summary.muscles[m].last14Sets, 0) / ids.length : 0);
  const principal = (g: MuscleGroup[]) => MUSCLE_IDS.filter((m) => !MUSCLES[m].accessory && g.includes(MUSCLES[m].group));
  const sum = (ids: MuscleId[]) => Math.round(ids.reduce((t, m) => t + summary.muscles[m].last14Sets, 0));
  const pushIds = principal(['empuje']);
  const pullIds = principal(['jalon']);
  const lowerIds = principal(['pierna']);
  const push = avg(pushIds);
  const pull = avg(pullIds);
  const upper = avg([...pushIds, ...pullIds]);
  const lower = avg(lowerIds);
  const notes: string[] = [];
  const r = tc.balanceRatio;
  const days = tc.balanceDays;
  const enough = (ids: MuscleId[]) => sum(ids) >= tc.balanceMinSets;
  if (enough(pushIds) && push > pull * r) notes.push(`En ${days} días hiciste más empuje que jalón (${sum(pushIds)} contra ${sum(pullIds)} series): suma remo, jalón o dominadas.`);
  else if (enough(pullIds) && pull > push * r) notes.push(`En ${days} días hiciste más jalón que empuje (${sum(pullIds)} contra ${sum(pushIds)} series): suma press o fondos.`);
  if (enough([...pushIds, ...pullIds]) && upper > lower * r) notes.push(`Torso ${Math.round(upper * 10) / 10} series por músculo y pierna ${Math.round(lower * 10) / 10} en ${days} días: no te saltes pierna.`);
  else if (enough(lowerIds) && lower > upper * r) notes.push(`Pierna ${Math.round(lower * 10) / 10} series por músculo y torso ${Math.round(upper * 10) / 10} en ${days} días: dale más al torso.`);

  return {
    weekStart: summary.weekStart,
    daysLeft: 7 - weekday(summary.today),
    sessions: summary.sessionsThisWeek,
    hardSets: summary.hardSetsThisWeek,
    cardio: { minutes: summary.cardioMinutesThisWeek, min: tc.cardioMinutes.min, target: tc.cardioMinutes.target },
    weekStreak: summary.weekStreak,
    muscles,
    missing,
    missingAccessory,
    done: all.filter((m) => !m.accessory && m.weekSets >= m.target.target),
    recovering: all.filter((m) => m.state === 'recuperando').sort((a, b) => b.hoursToReady - a.hoursToReady),
    balance: { push: sum(pushIds), pull: sum(pullIds), upper: sum([...pushIds, ...pullIds]), lower: sum(lowerIds), notes },
    suggestion: suggestSession(muscles, { cfg, custom: opts.custom, favorites: summary.favorites, where: summary.usualWhere, cardioMinutesThisWeek: summary.cardioMinutesThisWeek }),
  };
}

// ---------------------------------------------------------------------------------------------
// Récords y progreso
// ---------------------------------------------------------------------------------------------

export const RECORD_LABELS: Record<keyof ExerciseTop, string> = {
  e1rm: '1RM estimado',
  kg: 'Peso máximo',
  reps: 'Más repeticiones',
  volume: 'Volumen en una sesión',
  sec: 'Más tiempo',
  km: 'Distancia más larga',
  min: 'Más minutos',
  pace: 'Mejor ritmo',
};

/** Puntos para la gráfica de progreso de un ejercicio (su métrica principal por sesión). */
export function progressSeries(r: ExerciseRecord): { date: string; value: number }[] {
  const k = RECORD_METRIC[r.measure];
  const alt: keyof ExerciseTop = r.measure === 'peso' ? 'kg' : r.measure === 'distancia' ? 'min' : k;
  return r.history
    .map((h) => ({ date: h.date, value: h.top[k] ?? h.top[alt] ?? 0 }))
    .filter((p) => p.value > 0);
}

/** Métrica principal de una lista de series (para avisar de un récord antes de guardar). */
export function topOfSets(measure: ExerciseMeasure, sets: WorkoutSet[]): number {
  let best = 0;
  for (const s of sets) {
    const v =
      measure === 'peso'
        ? (s.reps ?? 0) <= 20 && (s.kg ?? 0) > 0 && (s.reps ?? 0) >= 1
          ? (s.reps === 1 ? s.kg! : s.kg! * (1 + s.reps! / 30))
          : 0
        : measure === 'corporal'
          ? s.reps ?? 0
          : measure === 'tiempo'
            ? s.sec ?? 0
            : s.km ?? 0;
    best = Math.max(best, v);
  }
  return Math.round(best * 100) / 100;
}

/**
 * Ejercicios de un entrenamiento nuevo que superarían tu mejor marca (vista previa; el motor decide la XP).
 * Con `day` (fecha del registro y libro de XP) deja solo los que darían XP ese día, como el motor: uno por
 * ejercicio por día y `record.maxPerDay` por día, contando los récords que ya dieron XP esa fecha.
 */
export function wouldBeRecords(
  records: Record<string, ExerciseRecord>,
  exercises: { exerciseId: string; measure: ExerciseMeasure; sets: WorkoutSet[] }[],
  day?: { date: string; ledger: Pick<XpEntry, 'date' | 'source' | 'refId'>[] },
  cfg: GameConfigInput = GAME_CONFIG as GameConfigInput,
): string[] {
  const out: string[] = [];
  for (const x of exercises) {
    const r = records[x.exerciseId];
    if (!r) continue;
    const prev = r.best[RECORD_METRIC[x.measure]]?.value ?? 0;
    const now = topOfSets(x.measure, x.sets);
    if (prev > 0 && now > prev + 1e-6 && !out.includes(x.exerciseId)) out.push(x.exerciseId);
  }
  if (!day) return out;
  const given = day.ledger.filter((e) => e.source === 'training_record' && e.date === day.date);
  const taken = new Set(given.map((e) => e.refId));
  return out.filter((id) => !taken.has(id)).slice(0, Math.max(0, cfg.training.record.maxPerDay - given.length));
}

// ---------------------------------------------------------------------------------------------
// Ejercicios propios: músculos que caben en un registro
// ---------------------------------------------------------------------------------------------

/** Máximo de músculos por ejercicio en un registro `workout.logged` (lo mismo que acepta el esquema de events.ts). */
export const MAX_EXERCISE_MUSCLES = { primary: 6, secondary: 8 } as const;

/** Músculos de un ejercicio propio recortados a lo que acepta un registro: sin repetidos y con los topes. */
export function capExerciseMuscles(primary: readonly MuscleId[], secondary: readonly MuscleId[] = []): { primary: MuscleId[]; secondary: MuscleId[] } {
  const p = [...new Set(primary)].slice(0, MAX_EXERCISE_MUSCLES.primary);
  const s = [...new Set(secondary)].filter((m) => !p.includes(m)).slice(0, MAX_EXERCISE_MUSCLES.secondary);
  return { primary: p, secondary: s };
}

// ---------------------------------------------------------------------------------------------
// Misión de entrenar (XP, racha, oro y atributos vienen de aquí)
// ---------------------------------------------------------------------------------------------

export interface TrainingMission {
  missionId: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  kind: CompletionKind;
  mainQuestId: string | null;
}

/** Diaria de entrenar del catálogo inicial ("Entrenar 30 min"): la que cuenta El Sedentario y la rutina de Hoy. */
export const DEFAULT_TRAINING_DAILY = 'daily-entrenar';

/**
 * Id de la diaria ligada al entrenamiento: la elegida en Ajustes de entrenamiento; si nunca eligió (`missionId`
 * sin definir), la diaria de entrenar del catálogo inicial. `null` (eligió la misión rápida) o una diaria que ya no
 * existe → sin diaria ligada.
 */
export function linkedTrainingDailyId(settings: TrainingSettingsData | null | undefined, entities: Entity[]): string | null {
  const id = settings?.missionId === undefined ? DEFAULT_TRAINING_DAILY : settings.missionId;
  return id && entities.some((e) => e.id === id && !e.deletedAt && e.module === 'missions' && e.kind === 'daily') ? id : null;
}

/**
 * La misión que se completa al registrar un entrenamiento: la diaria ligada (`linkedTrainingDailyId`: la elegida en
 * Ajustes de entrenamiento o, por defecto, "Entrenar 30 min") o la misión rápida "Entrenar" (media · Fuerza física).
 */
export function trainingMission(settings: TrainingSettingsData | null | undefined, entities: Entity[], cfg: GameConfigInput = GAME_CONFIG as GameConfigInput): TrainingMission {
  const id = linkedTrainingDailyId(settings, entities);
  const ent = id ? entities.find((e) => e.id === id) : undefined;
  if (ent) {
    const d = ent.data as MissionData;
    return { missionId: ent.id, title: d.title, size: d.size, attribute: d.attribute, kind: 'daily', mainQuestId: d.mainQuestId ?? null };
  }
  const m = cfg.training.mission;
  return { missionId: quickMissionId(m.title), title: m.title, size: m.size as MissionSize, attribute: m.attribute as AttributeId, kind: 'quick', mainQuestId: null };
}
