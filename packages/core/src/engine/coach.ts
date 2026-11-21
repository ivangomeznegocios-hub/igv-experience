import { GAME_CONFIG, type GameConfigInput } from '../config/game';
import {
  COACH_GOAL_NAMES,
  MEAL_LIMIT_TAGS,
  BODY_AREAS,
  BODY_AREA_NAMES,
  type BodyArea,
  type CoachGoal,
  type CoachLevel,
  type CoachSettings,
  type Equipment,
  type ExerciseMeasure,
  type MealTag,
  type MuscleId,
  type WorkoutPlace,
} from '../types';
import { EXERCISE_BY_ID, MUSCLES, type ExerciseDef } from '../training/library';
import { addDays, ageOn, diffDays, toLocalDate, weekStart, weekday } from '../util/dates';
import type { GameState } from './project';
import type { CoachLogs, MealEntry } from './modules/coach';
import type { ExerciseRecord, Workout } from './modules/training';
import { muscleStatus } from './training';
import { pickForDate } from './reports';

/**
 * Tu entrenador personal (funciones puras, sin red): con tus registros arma un plan progresivo y basado en evidencia,
 * te dice qué hacer hoy (ejercicios, series, repeticiones, descanso y peso objetivo), cuánto cardio y pasos te tocan,
 * cómo vas con el sueño y la comida, y te habla como un coach. NUNCA da ni quita XP: solo planea y aconseja.
 *
 *  - Progresión "poco a poco": el plan avanza por SEMANAS ENTRENADAS (≥ 2 sesiones), no por calendario. Adaptación
 *    (2 series, lejos del fallo) → Base → Progreso, con descargas. Las semanas sin entrenar no avanzan y, si se
 *    acumulan, el plan regresa un poco para retomar sin lastimarte.
 *  - Sobrecarga progresiva (doble progresión): cuando haces el tope del rango en todas las series, sube el peso; si
 *    no, repite el peso y busca una repetición más.
 *  - Cómo te sientes, cuánto dormiste y lo que te duele ajustan la sesión del día.
 *  - Nutrición por hábitos (proteína en cada comida, verdura, fruta, agua, limitar ultraprocesados) más metas de
 *    calorías y proteína calculadas con tu peso, estatura y edad (Mifflin-St Jeor; proteína 1.6–2.2 g/kg).
 */

type Cfg = GameConfigInput;
const DEFAULT_CFG = GAME_CONFIG as Cfg;
/** "Cuerpo completo B" → "cuerpo completo B" (solo la primera letra; las siglas se respetan). */
export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
/** Nombre de una zona del cuerpo (una zona desconocida, de una versión futura, se muestra tal cual). */
const areaName = (a: string) => (BODY_AREA_NAMES[a as BodyArea] ?? a).toLowerCase();
const isBodyArea = (a: unknown): a is BodyArea => (BODY_AREAS as readonly unknown[]).includes(a);

export type PhaseKey = 'adaptacion' | 'base' | 'progreso' | 'descarga';

// ---------------------------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------------------------

export interface CoachProfile {
  coachName: string;
  firstName: string;
  configured: boolean;
  goal: CoachGoal;
  level: CoachLevel;
  sex: 'hombre' | 'mujer';
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  weightDate: string | null;
  bmi: number | null;
  bmiLabel: string | null;
  bodyFatPct: number | null;
  waistCm: number | null;
  /** Cintura / estatura (≥ 0.5 = riesgo cardiometabólico). */
  waistToHeight: number | null;
  targetWeightKg: number | null;
  limitations: BodyArea[];
  where: WorkoutPlace | null;
  /** Datos que faltan para personalizar mejor (estatura, peso, fecha de nacimiento). */
  missing: string[];
}

export function coachSettingsOf(state: GameState): CoachSettings {
  return state.training.settings.coach ?? {};
}

export function bmiLabel(bmi: number): string {
  if (bmi < 18.5) return 'bajo peso';
  if (bmi < 25) return 'peso saludable';
  if (bmi < 30) return 'sobrepeso';
  if (bmi < 35) return 'obesidad grado 1';
  if (bmi < 40) return 'obesidad grado 2';
  return 'obesidad grado 3';
}

export function coachProfile(state: GameState): CoachProfile {
  const cs = coachSettingsOf(state);
  const st = state.settings;
  const lw = state.body.lastWeight;
  const heightCm = st.heightCm && st.heightCm > 50 ? st.heightCm : null;
  const weightKg = lw?.kg ?? null;
  const bmi = heightCm && weightKg ? round(weightKg / (heightCm / 100) ** 2, 1) : null;
  const ageYears = st.birthDate ? ageOn(st.birthDate, state.today).years : null;
  const latest = state.body.latest as { bodyFatPct?: number; waistCm?: number };
  const waistCm = latest.waistCm ?? null;
  const missing: string[] = [];
  if (!heightCm) missing.push('estatura');
  if (!weightKg) missing.push('peso');
  if (!st.birthDate) missing.push('fecha de nacimiento');
  const name = (st.name || '').trim();
  return {
    coachName: cs.name?.trim() || 'Coach',
    firstName: name && name !== 'Jugador' ? name.split(/\s+/)[0] : '',
    configured: !!cs.on,
    goal: cs.goal ?? 'salud',
    level: cs.level ?? 'sedentario',
    sex: cs.sex ?? 'hombre',
    ageYears,
    heightCm,
    weightKg,
    weightDate: lw?.date ?? null,
    bmi,
    bmiLabel: bmi ? bmiLabel(bmi) : null,
    bodyFatPct: latest.bodyFatPct ?? null,
    waistCm,
    waistToHeight: waistCm && heightCm ? round(waistCm / heightCm, 2) : null,
    targetWeightKg: cs.targetWeightKg ?? null,
    limitations: [...new Set((cs.limitations ?? []).filter(isBodyArea))],
    where: state.training.settings.where ?? state.training.summary.usualWhere ?? null,
    missing,
  };
}

// ---------------------------------------------------------------------------------------------
// Fase del plan
// ---------------------------------------------------------------------------------------------

export interface PlanPhase {
  key: PhaseKey;
  name: string;
  /** Semanas entrenadas acumuladas (incluye las que "trae" tu nivel). */
  trainedWeeks: number;
  /** Semana del plan en el calendario (1 = la de inicio). */
  weekNumber: number;
  startDate: string;
  /** Semana ligera por tu check-in o por molestias. */
  light: boolean;
  reason: string;
  /** Semanas entrenadas que faltan para la siguiente fase (null en progreso). */
  nextPhaseIn: number | null;
}

/**
 * Días distintos con entrenamiento (de cualquier tipo) por lunes de la semana. Fuerza y caminata el mismo día
 * cuentan como UN día: así seguir el "extra opcional" de cardio no adelanta el plan.
 */
function sessionsByWeek(workouts: Workout[], today: string): Map<string, number> {
  const out = new Map<string, number>();
  const days = new Set<string>();
  for (const w of workouts) {
    if (w.date > today || days.has(w.date)) continue;
    days.add(w.date);
    const k = weekStart(w.date);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** Inicio del plan: el que guardaste o, si no hay, el lunes de esta semana. */
export function planStartDate(state: GameState): string {
  const s = coachSettingsOf(state).startDate;
  return s && s <= state.today ? s : weekStart(state.today);
}

export function planPhase(state: GameState, cfg: Cfg = DEFAULT_CFG): PlanPhase {
  const cc = cfg.coach;
  const cs = coachSettingsOf(state);
  const level = cs.level ?? 'sedentario';
  const start = planStartDate(state);
  const ws0 = weekStart(start);
  const cur = weekStart(state.today);
  const perWeek = sessionsByWeek(state.training.workouts, state.today);
  let tw = cc.levelStartWeeks[level] ?? 0;
  let emptyRun = 0;
  for (let wk = ws0; wk < cur; wk = addDays(wk, 7)) {
    const n = perWeek.get(wk) ?? 0;
    const ci = state.coach.checkins[wk];
    const hold = !!ci && (ci.effort >= 5 || ci.energy <= 1 || ci.pain.length > 0);
    if (n >= cc.advanceMinSessions) {
      emptyRun = 0;
      if (!hold) tw++;
    } else if (n === 0) {
      emptyRun++;
      if (emptyRun > cc.detrainAfterWeeks) tw = Math.max(0, tw - 1);
    } else emptyRun = 0;
  }
  const P = cc.phases;
  let key: PhaseKey = tw >= P.progreso.from ? 'progreso' : tw >= P.base.from ? 'base' : 'adaptacion';
  let reason: string;
  const weekNumber = Math.floor(diffDays(ws0, cur) / 7) + 1;
  const inPhase = (k: 'adaptacion' | 'base' | 'progreso') => tw - P[k].from + 1;
  if (key === 'progreso' && inPhase('progreso') % cc.deloadEvery === 0) {
    key = 'descarga';
    reason = `Llevas ${cc.deloadEvery - 1} semanas de progreso seguidas: esta semana menos series, más reserva y un poco menos de peso para que el cuerpo asimile y vuelvas más fuerte.`;
  } else if (key === 'adaptacion') reason = `Semana ${inPhase('adaptacion')} de adaptación: pocas series y lejos del fallo para que tendones, articulaciones y técnica se acostumbren.`;
  else if (key === 'base') reason = `Semana ${inPhase('base')} de base: 3 series en lo principal, construyendo técnica y hábito.`;
  else reason = `Progreso: subes peso o repeticiones cada semana que puedas, con ${P.progreso.rir[0]}–${P.progreso.rir[1]} repeticiones en reserva.`;

  // Semana ligera: el check-in de la semana pasada dijo que fue demasiado, sin energía o con molestias. Es la misma
  // fase con una serie menos y una rep más de reserva, sin subir peso (ver phaseParams y progressionFor).
  const last = state.coach.checkins[addDays(cur, -7)];
  let light = false;
  if (last && key !== 'descarga' && (last.effort >= 5 || last.energy <= 2 || last.pain.length > 0)) {
    light = true;
    const what = 'una serie menos, una rep más de reserva y sin subir peso';
    reason = last.pain.length
      ? `Semana ligera: en tu check-in dijiste que te molesta ${last.pain.map(areaName).join(' y ')}. Va ${what}, y evito lo que carga esa zona.`
      : last.effort >= 5
        ? `Semana ligera: tu check-in dijo que el plan se sintió demasiado. Va ${what}.`
        : `Semana ligera: llegaste sin energía la semana pasada. Va ${what} para que recuperes.`;
  }
  const nextPhaseIn = key === 'adaptacion' ? P.base.from - tw : key === 'base' ? P.progreso.from - tw : null;
  return { key, name: P[key].name, trainedWeeks: tw, weekNumber, startDate: start, light, reason, nextPhaseIn };
}

// ---------------------------------------------------------------------------------------------
// Patrones de movimiento, plantillas y seguridad
// ---------------------------------------------------------------------------------------------

interface PatternDef {
  label: string;
  region: 'torso' | 'pierna' | 'core';
  compound: boolean;
  /** Para principiantes (más estables y fáciles de aprender) y estándar. */
  beginner: string[];
  standard: string[];
  cue: string;
}

/** Patrones de movimiento del plan. Los ids son de la biblioteca (training/library.ts). */
export const PATTERNS: Record<string, PatternDef> = {
  sentadilla: {
    label: 'Sentadilla',
    region: 'pierna',
    compound: true,
    beginner: ['sentadilla-goblet', 'prensa', 'sentadilla-corporal'],
    standard: ['sentadilla', 'prensa', 'sentadilla-goblet', 'sentadilla-hack', 'sentadilla-corporal'],
    cue: 'Pies al ancho de hombros, rodillas hacia donde apuntan los pies y espalda neutra. Baja hasta donde controles y sube empujando el piso.',
  },
  sentadilla2: {
    label: 'Prensa o variante de sentadilla',
    region: 'pierna',
    compound: true,
    beginner: ['prensa', 'sentadilla-goblet', 'step-up', 'sentadilla-corporal'],
    standard: ['prensa', 'sentadilla-hack', 'sentadilla-frontal', 'sentadilla-goblet', 'sentadilla-bulgara'],
    cue: 'Recorrido completo sin despegar la espalda baja del respaldo; no bloquees las rodillas arriba.',
  },
  bisagra: {
    label: 'Bisagra de cadera',
    region: 'pierna',
    compound: true,
    beginner: ['peso-muerto-rumano', 'hip-thrust', 'puente-gluteo', 'swing-kettlebell'],
    standard: ['peso-muerto-rumano', 'peso-muerto', 'hip-thrust', 'puente-gluteo', 'swing-kettlebell'],
    cue: 'Lleva la cadera hacia atrás con rodillas suaves y espalda recta; debes sentir estirar la parte de atrás del muslo, no la espalda baja.',
  },
  gluteo: {
    label: 'Glúteo',
    region: 'pierna',
    compound: true,
    beginner: ['hip-thrust', 'puente-gluteo', 'abduccion-maquina'],
    standard: ['hip-thrust', 'puente-gluteo', 'patada-gluteo', 'abduccion-maquina'],
    cue: 'Mentón al pecho y costillas abajo; sube con el glúteo y aprieta 1 segundo arriba sin arquear la espalda.',
  },
  zancada: {
    label: 'Zancada (una pierna)',
    region: 'pierna',
    compound: true,
    beginner: ['step-up', 'zancadas', 'sentadilla-bulgara', 'puente-gluteo'],
    standard: ['sentadilla-bulgara', 'zancadas', 'step-up'],
    cue: 'Torso alto, el peso en la pierna de adelante y la rodilla siguiendo la punta del pie. Primero equilibrio, luego peso.',
  },
  femoral: {
    label: 'Femoral',
    region: 'pierna',
    compound: false,
    beginner: ['curl-femoral', 'puente-gluteo'],
    standard: ['curl-femoral', 'peso-muerto-rumano'],
    cue: 'Controla la bajada en 2–3 segundos; sin levantar la cadera del asiento.',
  },
  cuadriceps: {
    label: 'Cuádriceps',
    region: 'pierna',
    compound: false,
    beginner: ['extension-cuadriceps', 'sentadilla-corporal'],
    standard: ['extension-cuadriceps', 'sentadilla-goblet'],
    cue: 'Extiende completo y aprieta arriba 1 segundo; baja lento.',
  },
  pantorrilla: {
    label: 'Pantorrilla',
    region: 'pierna',
    compound: false,
    beginner: ['elevacion-talones', 'talones-sentado'],
    standard: ['elevacion-talones', 'talones-sentado'],
    cue: 'Pausa de 1 segundo abajo (estirando) y sube hasta la punta; sin rebotar.',
  },
  press_horizontal: {
    label: 'Press de pecho',
    region: 'torso',
    compound: true,
    beginner: ['press-pecho-maquina', 'press-mancuernas', 'lagartijas'],
    standard: ['press-banca', 'press-mancuernas', 'press-pecho-maquina', 'lagartijas'],
    cue: 'Escápulas juntas y hacia abajo, pies firmes. Baja controlado en 2–3 segundos hasta el pecho y empuja sin rebotar.',
  },
  press_inclinado: {
    label: 'Press inclinado',
    region: 'torso',
    compound: true,
    beginner: ['press-inclinado-mancuernas', 'press-pecho-maquina', 'lagartijas'],
    standard: ['press-inclinado-mancuernas', 'press-inclinado', 'fondos', 'lagartijas'],
    cue: 'Banco a 30°, codos a unos 45° del cuerpo; la barra o mancuernas bajan a la parte alta del pecho.',
  },
  press_vertical: {
    label: 'Press de hombro',
    region: 'torso',
    compound: true,
    beginner: ['press-hombro-mancuernas', 'press-arnold'],
    standard: ['press-militar', 'press-hombro-mancuernas', 'press-arnold'],
    cue: 'Abdomen y glúteo firmes para no arquear la espalda baja; sube en línea recta sobre la cabeza.',
  },
  apertura: {
    label: 'Apertura de pecho',
    region: 'torso',
    compound: false,
    beginner: ['pec-deck', 'cruce-poleas', 'aperturas'],
    standard: ['cruce-poleas', 'pec-deck', 'aperturas'],
    cue: 'Codos ligeramente flexionados y fijos; abre hasta sentir el estiramiento sin dolor en el hombro.',
  },
  jalon_vertical: {
    label: 'Jalón',
    region: 'torso',
    compound: true,
    beginner: ['jalon-pecho', 'remo-invertido', 'dominadas-supinas'],
    standard: ['dominadas', 'jalon-pecho', 'dominadas-supinas', 'remo-invertido'],
    cue: 'Pecho arriba y lleva los codos hacia las costillas; sin balancearte ni jalar con el cuello.',
  },
  remo: {
    label: 'Remo',
    region: 'torso',
    compound: true,
    beginner: ['remo-maquina', 'remo-polea', 'remo-mancuerna', 'remo-invertido'],
    standard: ['remo-barra', 'remo-polea', 'remo-mancuerna', 'remo-maquina', 'remo-invertido'],
    cue: 'Espalda neutra; jala con el codo y junta los omóplatos 1 segundo atrás.',
  },
  lateral: {
    label: 'Hombro lateral',
    region: 'torso',
    compound: false,
    beginner: ['elevaciones-laterales'],
    standard: ['elevaciones-laterales'],
    cue: 'Sube hasta la altura del hombro con codos un poco flexionados; sin impulso, baja lento.',
  },
  posterior: {
    label: 'Hombro posterior',
    region: 'torso',
    compound: false,
    beginner: ['face-pull', 'pajaros'],
    standard: ['face-pull', 'pajaros'],
    cue: 'Jala hacia la cara abriendo los codos y aprieta atrás; es tu seguro para hombros sanos.',
  },
  biceps: {
    label: 'Bíceps',
    region: 'torso',
    compound: false,
    beginner: ['curl-mancuernas', 'curl-martillo', 'curl-polea'],
    standard: ['curl-barra', 'curl-mancuernas', 'curl-martillo', 'curl-polea'],
    cue: 'Codos pegados al cuerpo, sin balancear la espalda; baja lento.',
  },
  triceps: {
    label: 'Tríceps',
    region: 'torso',
    compound: false,
    beginner: ['extension-polea', 'patada-triceps', 'fondos-banco'],
    standard: ['extension-polea', 'press-frances', 'extension-sobre-cabeza', 'fondos-banco'],
    cue: 'Codos fijos; extiende completo y controla la vuelta.',
  },
  trapecio: {
    label: 'Trapecio y agarre',
    region: 'torso',
    compound: false,
    beginner: ['paseo-granjero', 'encogimientos'],
    standard: ['encogimientos', 'paseo-granjero'],
    cue: 'Hombros hacia arriba y atrás sin girar el cuello; en el paseo, camina erguido.',
  },
  core: {
    label: 'Abdomen',
    region: 'core',
    compound: false,
    beginner: ['plancha', 'bicho-muerto', 'crunch'],
    standard: ['plancha', 'rueda-abdominal', 'elevacion-piernas', 'bicho-muerto'],
    cue: 'Cuerpo en línea, aprieta glúteo y abdomen y sigue respirando; calidad antes que tiempo.',
  },
  core_rotacion: {
    label: 'Abdomen (anti-rotación)',
    region: 'core',
    compound: false,
    beginner: ['plancha-lateral', 'press-pallof', 'bicho-muerto'],
    standard: ['press-pallof', 'lenador', 'plancha-lateral', 'giros-rusos'],
    cue: 'No dejes que el cuerpo gire ni se caiga la cadera; lento y controlado.',
  },
};

export type SessionKey = 'full_a' | 'full_b' | 'torso_a' | 'torso_b' | 'pierna_a' | 'pierna_b' | 'empuje' | 'jalon';

export const SESSION_TEMPLATES: Record<SessionKey, { title: string; short: string; focus: string; key: MuscleId[]; slots: string[] }> = {
  full_a: { title: 'Cuerpo completo A', short: 'Compl. A', focus: 'Pierna, pecho y espalda', key: ['cuadriceps', 'pecho', 'espalda'], slots: ['sentadilla', 'press_horizontal', 'remo', 'bisagra', 'lateral', 'core', 'biceps'] },
  full_b: { title: 'Cuerpo completo B', short: 'Compl. B', focus: 'Glúteo, espalda y hombro', key: ['gluteos', 'espalda', 'pecho'], slots: ['gluteo', 'jalon_vertical', 'press_inclinado', 'zancada', 'posterior', 'core_rotacion', 'triceps'] },
  torso_a: { title: 'Torso A', short: 'Torso A', focus: 'Pecho, espalda y hombro', key: ['pecho', 'espalda'], slots: ['press_horizontal', 'remo', 'press_vertical', 'jalon_vertical', 'lateral', 'biceps', 'triceps'] },
  torso_b: { title: 'Torso B', short: 'Torso B', focus: 'Espalda, pecho alto y brazos', key: ['pecho', 'espalda'], slots: ['jalon_vertical', 'press_inclinado', 'remo', 'lateral', 'posterior', 'triceps', 'biceps'] },
  pierna_a: { title: 'Pierna A', short: 'Pierna A', focus: 'Cuádriceps y glúteo', key: ['cuadriceps', 'gluteos'], slots: ['sentadilla', 'bisagra', 'zancada', 'femoral', 'pantorrilla', 'core'] },
  pierna_b: { title: 'Pierna B', short: 'Pierna B', focus: 'Glúteo e isquios', key: ['gluteos', 'isquios'], slots: ['gluteo', 'sentadilla2', 'femoral', 'cuadriceps', 'pantorrilla', 'core_rotacion'] },
  empuje: { title: 'Empuje', short: 'Empuje', focus: 'Pecho, hombro y tríceps', key: ['pecho'], slots: ['press_horizontal', 'press_vertical', 'press_inclinado', 'lateral', 'triceps', 'apertura'] },
  jalon: { title: 'Jalón', short: 'Jalón', focus: 'Espalda, hombro posterior y bíceps', key: ['espalda'], slots: ['jalon_vertical', 'remo', 'posterior', 'biceps', 'trapecio', 'core'] },
};

/** Orden de sesiones por número de días de fuerza (con 1–3 días se alternan A y B entre semanas). */
function sessionOrder(n: number): SessionKey[] {
  if (n <= 3) return ['full_a', 'full_b'];
  if (n === 4) return ['torso_a', 'pierna_a', 'torso_b', 'pierna_b'];
  if (n === 5) return ['torso_a', 'pierna_a', 'empuje', 'jalon', 'pierna_b'];
  return ['empuje', 'jalon', 'pierna_a', 'empuje', 'jalon', 'pierna_b'];
}

/** Ejercicios que cargan cada zona: con molestias ahí, el plan los evita. */
export const JOINT_STRESS: Record<BodyArea, string[]> = {
  rodilla: ['sentadilla', 'sentadilla-frontal', 'sentadilla-bulgara', 'zancadas', 'sentadilla-hack', 'extension-cuadriceps', 'step-up', 'burpees', 'thruster', 'correr', 'saltar-cuerda', 'escaladora'],
  espalda_baja: ['peso-muerto', 'peso-muerto-rumano', 'remo-barra', 'remo-t', 'sentadilla', 'sentadilla-frontal', 'cargada', 'thruster', 'hiperextensiones', 'swing-kettlebell', 'press-militar', 'elevacion-piernas'],
  hombro: ['press-militar', 'press-hombro-mancuernas', 'press-arnold', 'fondos', 'remo-al-menton', 'press-banca', 'press-inclinado', 'press-declinado', 'pullover', 'elevaciones-frontales', 'dominadas', 'elevacion-piernas'],
  cuello: ['encogimientos', 'press-militar', 'sentadilla', 'remo-al-menton'],
  codo: ['press-frances', 'extension-sobre-cabeza', 'curl-barra', 'curl-predicador', 'fondos', 'fondos-banco', 'press-cerrado'],
  muneca: ['curl-barra', 'lagartijas', 'press-frances', 'curl-muneca', 'fondos-banco', 'burpees', 'sentadilla-frontal', 'cargada'],
  cadera: ['sentadilla', 'sentadilla-bulgara', 'zancadas', 'peso-muerto', 'sentadilla-frontal', 'aduccion-maquina'],
  tobillo: ['correr', 'saltar-cuerda', 'burpees', 'zancadas', 'step-up', 'escaladora'],
};

const HOME_EQUIPMENT = new Set<Equipment>(['corporal', 'mancuerna', 'banda', 'kettlebell']);

function stresses(exerciseId: string, areas: readonly BodyArea[]): BodyArea[] {
  // `?.`: una zona que esta versión no conoce (de una versión futura) no carga nada.
  return areas.filter((a) => JOINT_STRESS[a]?.includes(exerciseId));
}

/** El ejercicio se puede hacer donde entrenas: fuera del gym solo peso corporal, mancuernas, banda o kettlebell. */
const fitsPlace = (e: ExerciseDef, where: WorkoutPlace | null) => !where || where === 'gym' || HOME_EQUIPMENT.has(e.equipment);

/** Cabe con tu lugar y tus molestias (la misma regla para las opciones del plan y para el ejercicio que cambiaste). */
const fitsYou = (e: ExerciseDef | undefined, where: WorkoutPlace | null, avoid: readonly BodyArea[]): e is ExerciseDef => !!e && fitsPlace(e, where) && stresses(e.id, avoid).length === 0;

/** Opciones de un patrón que caben con tu equipo y tus molestias (en orden de preferencia). */
export function patternOptions(slot: string, opts: { where: WorkoutPlace | null; avoid: readonly BodyArea[]; beginner: boolean; favorites?: string[] }): ExerciseDef[] {
  const p = PATTERNS[slot];
  if (!p) return [];
  const base = opts.beginner ? [...p.beginner, ...p.standard] : [...p.standard, ...p.beginner];
  const all = [...new Set(base)];
  const ok = (id: string) => fitsYou(EXERCISE_BY_ID.get(id), opts.where, opts.avoid);
  // Lo que ya usas (favoritos) va primero: así el plan sigue tus marcas y la progresión tiene historial.
  const fav = (opts.favorites ?? []).filter((id) => all.includes(id) && ok(id));
  return [...new Set([...fav, ...all.filter(ok)])].map((id) => EXERCISE_BY_ID.get(id)!);
}

// ---------------------------------------------------------------------------------------------
// Prescripción de una sesión
// ---------------------------------------------------------------------------------------------

export type Progression = 'nuevo' | 'subir' | 'repetir' | 'retomar' | 'mantener';

export interface PrescribedExercise {
  slot: string;
  slotLabel: string;
  exerciseId: string;
  name: string;
  measure: ExerciseMeasure;
  equipment: Equipment;
  compound: boolean;
  sets: number;
  /** Rango de repeticiones (fuerza) o de segundos (isométricos). */
  reps: [number, number] | null;
  seconds: [number, number] | null;
  rir: [number, number];
  restSec: number;
  /** Lo que el coach te pide hoy en cada serie. */
  targetKg: number | null;
  targetReps: number | null;
  targetSec: number | null;
  progression: Progression;
  note: string;
  cue: string;
  muscles: MuscleId[];
  /** Otros ejercicios para el mismo patrón (para cambiarlo). */
  alternatives: { id: string; name: string }[];
}

export interface CardioPrescription {
  exerciseId: string;
  name: string;
  minutes: number;
  intensity: string;
}

export interface PrescribedSession {
  kind: 'fuerza' | 'cardio' | 'recuperacion' | 'descanso';
  key: SessionKey | 'cardio' | 'recuperacion' | 'descanso';
  title: string;
  focus: string;
  warmup: string[];
  exercises: PrescribedExercise[];
  cardio: CardioPrescription | null;
  cooldown: string[];
  estMinutes: number;
  /** Ajustes del día (sueño, cómo te sientes, molestias). */
  adjustments: string[];
}

/**
 * Números de la fase. La semana ligera es la MISMA fase con una serie menos (mín. 1) y una rep más de reserva: conserva
 * rangos, cardio, días de fuerza y ejercicios (la descarga, en cambio, usa sus propios números).
 */
function phaseParams(phase: PlanPhase, cfg: Cfg) {
  const p = cfg.coach.phases[phase.key];
  if (!phase.light) return p;
  return { ...p, sets: Math.max(1, p.sets - 1), accessorySets: Math.max(1, p.accessorySets - 1), rir: [p.rir[0] + 1, p.rir[1] + 1] };
}

/** Semana o día en que NO se sube: descarga, semana ligera o día ligero (sueño, energía o molestias). */
export type EaseMode = 'descarga' | 'semana' | 'dia';
const EASE_LABEL: Record<EaseMode, string> = { descarga: 'Semana de descarga', semana: 'Semana ligera', dia: 'Hoy vas ligero' };

function increment(e: ExerciseDef, compound: boolean, cfg: Cfg): number {
  const inc = cfg.coach.increments;
  if (!compound) return e.equipment === 'mancuerna' ? inc.aislado : inc.aisladoMaquina;
  if (e.equipment === 'mancuerna' || e.equipment === 'kettlebell') return inc.mancuerna;
  const leg = e.primary.some((m) => MUSCLES[m].group === 'pierna');
  return leg ? inc.pierna : inc.torso;
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/**
 * Doble progresión con tu historial: qué peso, reps o segundos toca hoy. Con `ease` (descarga, semana ligera o día
 * ligero) NUNCA sube: pide como máximo lo de la vez pasada (dentro del tope del rango) con el mismo peso, o un poco
 * menos en la descarga; el veredicto no se calcula contra el rango de esa semana.
 */
export function progressionFor(
  e: ExerciseDef,
  rec: ExerciseRecord | undefined,
  rx: { reps: [number, number] | null; seconds: [number, number] | null; rir: [number, number]; compound: boolean; ease?: EaseMode },
  today: string,
  cfg: Cfg = DEFAULT_CFG,
): { targetKg: number | null; targetReps: number | null; targetSec: number | null; progression: Progression; note: string } {
  const rirText = `${rx.rir[0]}–${rx.rir[1]}`;
  if (!rec || !rec.lastSets.length) {
    const note =
      e.measure === 'peso'
        ? `Primera vez: un peso que te deje ${rirText} reps de sobra. Anótalo y la próxima te digo cuánto subir.`
        : e.measure === 'tiempo'
          ? `Primera vez: aguanta con buena forma; para antes de que se rompa la postura.`
          : `Primera vez: las repeticiones que salgan con buena técnica, dejando ${rirText} en reserva.`;
    return { targetKg: null, targetReps: rx.reps ? rx.reps[1] : null, targetSec: rx.seconds ? rx.seconds[0] : null, progression: 'nuevo', note };
  }
  const days = diffDays(rec.lastDate, today);
  const last = rec.lastSets;
  const ease = rx.ease ? EASE_LABEL[rx.ease] : null;
  if (e.measure === 'tiempo' && rx.seconds) {
    const best = Math.max(...last.map((s) => s.sec ?? 0));
    if (ease) {
      const target = best > 0 ? Math.min(best, rx.seconds[1]) : rx.seconds[0];
      return { targetKg: null, targetReps: null, targetSec: target, progression: 'mantener', note: best ? `${ease}: la vez pasada aguantaste ${best} s; hoy ${target} s, sin buscar más.` : '' };
    }
    const target = clamp(best >= rx.seconds[1] ? rx.seconds[1] : best + 5, rx.seconds[0], rx.seconds[1]);
    return { targetKg: null, targetReps: null, targetSec: target, progression: best >= rx.seconds[1] ? 'mantener' : 'subir', note: best ? `La vez pasada aguantaste ${best} s: hoy busca ${target} s.` : '' };
  }
  if (e.measure === 'corporal' || !last.some((s) => (s.kg ?? 0) > 0)) {
    const reps = last.map((s) => s.reps ?? 0).filter((r) => r > 0);
    if (!reps.length || !rx.reps) return { targetKg: null, targetReps: rx.reps?.[1] ?? null, targetSec: null, progression: 'repetir', note: '' };
    const min = Math.min(...reps);
    const max = Math.max(...reps);
    if (ease) {
      const target = Math.min(min, rx.reps[1]);
      return { targetKg: null, targetReps: target, targetSec: null, progression: 'mantener', note: `${ease}: la vez pasada ${reps.join(', ')} reps. Hoy ${target} en cada serie, sin buscar más.` };
    }
    if (min >= rx.reps[1])
      return {
        targetKg: null,
        targetReps: rx.reps[1],
        targetSec: null,
        progression: 'subir',
        note: `Ya haces ${min}+ en todas las series: hazlo más difícil (baja en 3 segundos, pausa abajo o agrega peso) y vuelve a ${rx.reps[0]}–${rx.reps[1]}.`,
      };
    const target = clamp(min + 1, rx.reps[0], rx.reps[1]);
    return { targetKg: null, targetReps: target, targetSec: null, progression: 'repetir', note: `La vez pasada ${reps.join(', ')} reps: hoy busca ${target} en cada serie (máximo ${max + 1}).` };
  }
  // Peso: las series con el peso más alto son las de trabajo.
  const topKg = Math.max(...last.map((s) => s.kg ?? 0));
  const work = last.filter((s) => (s.kg ?? 0) === topKg);
  const repsAtTop = work.map((s) => s.reps ?? 0);
  const minReps = Math.min(...repsAtTop);
  const step = increment(e, rx.compound, cfg);
  const lastText = `${work.length}×${repsAtTop.join('/')} con ${topKg} kg`;
  // Un poco menos de peso (~stalePct), nunca más que la vez pasada.
  const lighter = Math.min(topKg, Math.max(step, roundTo(topKg * cfg.coach.stalePct, step === 1 ? 0.5 : step / 2)));
  // Sin subir: como máximo las reps de la vez pasada (y el tope del rango).
  const easeReps = rx.reps ? Math.min(minReps, rx.reps[1]) : null;
  if (days > cfg.coach.staleDays) {
    return { targetKg: lighter, targetReps: ease ? easeReps : rx.reps?.[0] ?? null, targetSec: null, progression: 'retomar', note: `Hace ${days} días que no lo haces (${lastText}): retoma con ${lighter} kg${ease ? ', sin buscar más esta semana' : ' y sube desde ahí'}.` };
  }
  if (ease) {
    const descarga = rx.ease === 'descarga';
    const kg = descarga ? lighter : topKg;
    return {
      targetKg: kg,
      targetReps: easeReps,
      targetSec: null,
      progression: 'mantener',
      note: descarga
        ? `${ease}: la vez pasada ${lastText}. Hoy ${kg} kg${easeReps ? ` × ${easeReps}` : ''}, sin buscar más.`
        : `${ease}: la vez pasada ${lastText}. Hoy el mismo peso${easeReps ? ` y ${easeReps} reps` : ''}, sin buscar más: así te dejas una rep más en reserva.`,
    };
  }
  if (!rx.reps) return { targetKg: topKg, targetReps: null, targetSec: null, progression: 'repetir', note: '' };
  if (minReps >= rx.reps[1]) {
    const kg = round(topKg + step, 1);
    return { targetKg: kg, targetReps: rx.reps[0], targetSec: null, progression: 'subir', note: `La vez pasada ${lastText} (tope del rango): sube a ${kg} kg y busca ${rx.reps[0]}+ reps.` };
  }
  if (minReps < rx.reps[0] - 2 && topKg > step) {
    const kg = round(topKg - step, 1);
    return { targetKg: kg, targetReps: rx.reps[0], targetSec: null, progression: 'repetir', note: `La vez pasada ${lastText}: quedaste abajo del rango. Baja a ${kg} kg y busca ${rx.reps[0]}–${rx.reps[1]} con buena forma.` };
  }
  const target = clamp(minReps + 1, rx.reps[0], rx.reps[1]);
  return { targetKg: topKg, targetReps: target, targetSec: null, progression: 'repetir', note: `La vez pasada ${lastText}: mismo peso, busca ${target} reps en cada serie.` };
}

export interface SessionContext {
  phase: PlanPhase;
  goal: CoachGoal;
  level: CoachLevel;
  where: WorkoutPlace | null;
  avoid: BodyArea[];
  sessionMinutes: number;
  favorites: string[];
  swaps: Record<string, string>;
  records: Record<string, ExerciseRecord>;
  today: string;
  /** Ajuste del día: `light` quita una serie y suma reserva. */
  light?: boolean;
}

export function prescribeSession(key: SessionKey, sc: SessionContext, cfg: Cfg = DEFAULT_CFG): PrescribedSession {
  const t = SESSION_TEMPLATES[key];
  const pp = phaseParams(sc.phase, cfg);
  const cc = cfg.coach;
  const beginner = (sc.level === 'sedentario' || sc.level === 'principiante') && sc.phase.key !== 'progreso';
  // La semana ligera conserva los rangos de su fase (también los de fuerza); la descarga usa los suyos.
  const strengthFocus = sc.goal === 'fuerza' && sc.phase.key === 'progreso';
  const hold = cc.holdSeconds[sc.phase.key] as readonly number[];
  // Semana de descarga, semana ligera o día ligero: la progresión no sube.
  const ease: EaseMode | undefined = sc.phase.key === 'descarga' ? 'descarga' : sc.phase.light ? 'semana' : sc.light ? 'dia' : undefined;
  const exercises: PrescribedExercise[] = [];
  const used = new Set<string>();
  let minutes = cc.warmupMinutes;
  for (const slot of t.slots) {
    if (exercises.length >= pp.maxExercises) break;
    const pat = PATTERNS[slot];
    const options = patternOptions(slot, { where: sc.where, avoid: sc.avoid, beginner, favorites: sc.favorites }).filter((e) => !used.has(e.id));
    const swap = sc.swaps[slot];
    const swapped = swap ? EXERCISE_BY_ID.get(swap) : undefined;
    // El cambio se respeta si cabe con tu lugar y tus molestias y no lo usa ya otro patrón; si no, la primera opción
    // (el cambio queda guardado: vuelve cuando entrenes donde sí cabe).
    const ex = fitsYou(swapped, sc.where, sc.avoid) && !used.has(swapped.id) ? swapped : options[0];
    if (!ex) continue;
    const compound = pat.compound && ex.measure !== 'tiempo';
    let sets = compound ? pp.sets : pp.accessorySets;
    let rir: [number, number] = [pp.rir[0], pp.rir[1]];
    if (sc.light) {
      sets = Math.max(1, sets - 1);
      rir = [rir[0] + 1, rir[1] + 1];
    }
    const restSec = compound ? (strengthFocus ? cc.strengthRestSec : pp.restSec) : pp.accessoryRestSec;
    const time = minutes + (sets * (cc.setSeconds + restSec)) / 60;
    // La sesión cabe en tu tiempo: lo principal siempre entra (al menos 3 ejercicios).
    if (exercises.length >= 3 && time > sc.sessionMinutes) break;
    minutes = time;
    const repsRange: [number, number] | null =
      ex.measure === 'tiempo' || ex.measure === 'distancia'
        ? null
        : compound
          ? strengthFocus
            ? [cc.strengthCompoundReps[0], cc.strengthCompoundReps[1]]
            : [pp.compoundReps[0], pp.compoundReps[1]]
          : [pp.reps[0], pp.reps[1]];
    const seconds: [number, number] | null = ex.measure === 'tiempo' ? [hold[0], hold[1]] : null;
    const prog = progressionFor(ex, sc.records[ex.id], { reps: repsRange, seconds, rir, compound, ease }, sc.today, cfg);
    used.add(ex.id);
    // Sin subir puede tocar menos que el mínimo del rango (lo de la vez pasada): el rango que se muestra lo incluye.
    const shownReps: [number, number] | null = repsRange && prog.targetReps !== null && prog.targetReps < repsRange[0] ? [prog.targetReps, repsRange[1]] : repsRange;
    const shownSec: [number, number] | null = seconds && prog.targetSec !== null && prog.targetSec < seconds[0] ? [prog.targetSec, seconds[1]] : seconds;
    exercises.push({
      slot,
      slotLabel: pat.label,
      exerciseId: ex.id,
      name: ex.name,
      measure: ex.measure,
      equipment: ex.equipment,
      compound,
      sets,
      reps: shownReps,
      seconds: shownSec,
      rir,
      restSec,
      ...prog,
      cue: pat.cue,
      muscles: ex.primary,
      alternatives: [],
    });
  }
  // Alternativas: solo lo que de verdad se puede elegir (cabe con tu lugar y molestias) y que no está ya en esta sesión
  // en ningún patrón. Así elegir una siempre se respeta y no repite un ejercicio de la sesión.
  for (const e of exercises)
    e.alternatives = patternOptions(e.slot, { where: sc.where, avoid: sc.avoid, beginner, favorites: [] })
      .filter((o) => !used.has(o.id))
      .slice(0, 5)
      .map((o) => ({ id: o.id, name: o.name }));
  const warmup = [
    '5 min de caminata, bici o elíptica suave.',
    'Movilidad: 10 círculos de cadera, 10 de hombro y 10 sentadillas sin peso.',
    exercises[0]?.measure === 'peso' ? `1–2 series ligeras de ${exercises[0].name.toLowerCase()} (50% y 75% del peso) antes de las de trabajo.` : 'Una serie suave del primer ejercicio antes de empezar.',
  ];
  const cooldown = ['5 min de estiramiento suave de lo que trabajaste.', 'Anota cada serie: con eso el coach ajusta la próxima.'];
  return { kind: 'fuerza', key, title: t.title, focus: t.focus, warmup, exercises, cardio: null, cooldown, estMinutes: Math.round(minutes + 3), adjustments: [] };
}

/** Cardio del día: caminar o algo de bajo impacto si te molestan rodilla o tobillo. */
export function cardioFor(minutes: number, sc: Pick<SessionContext, 'where' | 'avoid' | 'phase' | 'goal'>): CardioPrescription {
  const lowImpact = sc.avoid.includes('rodilla') || sc.avoid.includes('tobillo');
  const gym = sc.where === 'gym';
  const id = lowImpact ? (gym ? 'bici' : 'caminar') : sc.phase.key === 'progreso' && sc.goal === 'condicion' ? 'correr' : gym ? 'eliptica' : 'caminar';
  const def = EXERCISE_BY_ID.get(id)!;
  const intensity =
    sc.phase.key === 'adaptacion'
      ? 'Paso ligero: respiras más rápido pero puedes platicar.'
      : 'Zona 2: puedes hablar en frases completas pero no cantar.';
  return { exerciseId: id, name: id === 'caminar' ? 'Caminata' : def.name, minutes, intensity };
}

// ---------------------------------------------------------------------------------------------
// Semana
// ---------------------------------------------------------------------------------------------

export interface PlanDay {
  date: string;
  weekday: number;
  label: string;
  short: string;
  kind: 'fuerza' | 'cardio' | 'descanso';
  /** Sesión de fuerza que toca (en orden de la semana). */
  sessionKey: SessionKey | null;
  title: string;
  minutes: number | null;
  isToday: boolean;
  past: boolean;
  /** Lo que hiciste ese día. */
  didStrength: boolean;
  didCardio: boolean;
  doneTitles: string[];
}

export interface WeekTargets {
  strength: { done: number; target: number };
  cardio: { done: number; target: number };
  steps: { avg: number | null; target: number; days: number; today: number | null };
  sleep: { avg: number | null; target: number; days: number; lastNight: number | null };
  nutrition: { avg: number | null; days: number };
}

const isStrength = (w: Workout) => w.kind === 'fuerza' || w.hardSets > 0;
const isCardio = (w: Workout) => w.cardioMinutes > 0 || w.kind === 'caminata' || w.kind === 'cardio';

function strengthDaysOf(cs: CoachSettings, level: CoachLevel, phaseMax: number, cfg: Cfg): number[] {
  const def = (cfg.coach.defaultDays[level] ?? [0, 2, 4]) as readonly number[];
  const days = [...new Set((cs.days?.length ? cs.days : def).filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (days.length <= phaseMax) return days;
  // Más días de los que pide la fase: de todas las combinaciones (máx. 35), la que deja más descanso entre días de
  // fuerza, contando el cruce domingo → lunes. Se comparan los huecos de menor a mayor (el más corto primero); en
  // empate, la que tiene menos días seguidos de fuerza, y luego la primera (los días más temprano).
  let best = days.slice(0, phaseMax);
  let bestKey: number[] | null = null;
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  const pick = (from: number, acc: number[]) => {
    if (acc.length === phaseMax) {
      const gaps = acc.map((d, i) => (i + 1 < acc.length ? acc[i + 1] : acc[0] + 7) - d);
      let run = 0;
      let longest = 0;
      for (const g of [...gaps, ...gaps]) longest = Math.max(longest, (run = g === 1 ? run + 1 : 0));
      // Más grande es mejor: huecos de menor a mayor y, al final, la racha de días seguidos (en negativo).
      const key = [...[...gaps].sort((a, b) => a - b), -Math.min(longest, gaps.length)];
      if (!bestKey || better(key, bestKey)) {
        bestKey = key;
        best = acc;
      }
      return;
    }
    for (let i = from; i <= days.length - (phaseMax - acc.length); i++) pick(i + 1, [...acc, days[i]]);
  };
  if (phaseMax > 0) pick(0, []);
  return best;
}

export function stepsTarget(logs: CoachLogs, today: string, cs: CoachSettings, goal: CoachGoal, cfg: Cfg = DEFAULT_CFG): number {
  const sc = cfg.coach.steps;
  if (cs.stepsGoal && cs.stepsGoal > 0) return cs.stepsGoal;
  const vals: number[] = [];
  for (let i = 1; i <= sc.averageDays; i++) {
    const v = logs.steps[addDays(today, -i)];
    if (typeof v === 'number' && v > 0) vals.push(v);
  }
  const bonus = cfg.coach.goalStepsBonus[goal] ?? 0;
  if (vals.length < 3) return clamp(sc.default + bonus, sc.min, sc.max);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return clamp(Math.round((avg + sc.step + bonus) / 500) * 500, sc.min, sc.max);
}

// ---------------------------------------------------------------------------------------------
// Nutrición
// ---------------------------------------------------------------------------------------------

export interface NutritionTargets {
  /** Calorías del día (null si faltan peso, estatura o edad). */
  kcal: number | null;
  bmr: number | null;
  tdee: number | null;
  proteinG: number | null;
  proteinPerMeal: number | null;
  waterGlasses: number;
  waterMl: number;
  fiberG: number;
  meals: { protein: number; veggies: number; fruit: number };
  /** Porciones con la mano por comida (sin báscula). */
  portions: { proteina: string; verduras: string; carbos: string; grasas: string };
  notes: string[];
}

export function nutritionTargets(profile: CoachProfile, strengthDays: number, cfg: Cfg = DEFAULT_CFG): NutritionTargets {
  const n = cfg.coach.nutrition;
  const notes: string[] = [];
  const w = profile.weightKg;
  const h = profile.heightCm;
  const age = profile.ageYears;
  let bmr: number | null = null;
  let tdee: number | null = null;
  let kcal: number | null = null;
  if (w && h && age) {
    bmr = Math.round(10 * w + 6.25 * h - 5 * age + (profile.sex === 'mujer' ? -161 : 5));
    const act = n.activity[strengthDays <= 1 ? 0 : strengthDays <= 3 ? 1 : strengthDays <= 5 ? 2 : 3];
    tdee = Math.round(bmr * act);
    if (profile.goal === 'perder_grasa') {
      kcal = tdee - Math.min(n.maxDeficit, Math.round(tdee * n.deficitPct));
      notes.push(`Déficit moderado (unas ${tdee - kcal} kcal menos que tu gasto) para bajar grasa sin perder músculo.`);
    } else if (profile.goal === 'ganar_musculo') {
      kcal = tdee + Math.min(n.maxSurplus, Math.round(tdee * n.surplusPct));
      notes.push(`Superávit pequeño (+${kcal - tdee} kcal) para ganar músculo con poca grasa.`);
    } else kcal = tdee;
    kcal = Math.round(kcal / 50) * 50;
  } else notes.push(`Para calcular tus calorías me falta: ${profile.missing.join(', ') || 'tu edad'}.`);
  let proteinG: number | null = null;
  if (w) {
    const perKg = (n.proteinPerKg as Record<string, number>)[profile.goal] ?? n.proteinPerKg.base;
    // Con sobrepeso, la proteína se calcula con tu peso meta (o el de IMC 25): con el peso total sale una cantidad
    // difícil de comer y que no hace falta (la grasa no necesita proteína).
    const over = !!profile.bmi && profile.bmi >= 25 && !!h;
    const refW = over ? Math.min(w, profile.targetWeightKg ?? 25 * (h! / 100) ** 2) : w;
    proteinG = Math.round((refW * perKg) / 5) * 5;
    if (refW !== w) notes.push(`La proteína se calcula con ${profile.targetWeightKg ? 'tu peso meta' : 'un peso de referencia'} de ${Math.round(refW)} kg${profile.targetWeightKg ? '' : ' (IMC 25)'}: así es suficiente y realista.`);
  }
  const waterMl = w ? Math.round((w * n.waterMlPerKg) / 50) * 50 : 2000;
  const waterGlasses = clamp(Math.round(waterMl / n.glassMl), 6, 12);
  const carbs = profile.goal === 'perder_grasa' ? '1 puño' : profile.goal === 'ganar_musculo' ? '2–3 puños' : '1–2 puños';
  return {
    kcal,
    bmr,
    tdee,
    proteinG,
    proteinPerMeal: proteinG ? Math.round(proteinG / n.proteinMeals / 5) * 5 : null,
    waterGlasses,
    waterMl,
    fiberG: n.fiberG,
    meals: { protein: n.proteinMeals, veggies: n.veggieMeals, fruit: n.fruitMeals },
    portions: { proteina: '2 palmas', verduras: '2 puños', carbos: carbs, grasas: '1–2 pulgares' },
    notes,
  };
}

/** Ideas de comida mexicana por grupo (para las recomendaciones del coach). */
export const FOOD_IDEAS: Record<'proteina' | 'verduras' | 'fruta' | 'integrales' | 'grasas', string[]> = {
  proteina: ['huevo (2–3)', 'pechuga de pollo asada', 'atún en agua', 'queso panela', 'yogur griego natural', 'bistec de res magro', 'pescado a la plancha', 'frijoles con queso fresco', 'requesón', 'tofu o soya texturizada'],
  verduras: ['nopales asados', 'calabacitas', 'brócoli', 'ensalada verde', 'jitomate y pepino', 'chayote', 'espinacas', 'ejotes', 'champiñones', 'pico de gallo'],
  fruta: ['manzana', 'plátano', 'papaya', 'naranja', 'guayaba', 'fresas', 'mango (porción chica)', 'sandía', 'pera'],
  integrales: ['tortillas de maíz', 'avena', 'arroz', 'camote', 'papa cocida', 'pan integral', 'frijoles de la olla'],
  grasas: ['aguacate', 'cacahuates o nueces', 'aceite de oliva', 'semillas de calabaza'],
};

export interface NutritionDay {
  date: string;
  meals: MealEntry[];
  proteinMeals: number;
  veggieMeals: number;
  fruitMeals: number;
  limitTags: MealTag[];
  proteinG: number | null;
  kcal: number | null;
  water: number;
  /** 0–100 (null si no registraste nada ese día). */
  score: number | null;
  checks: { key: string; label: string; done: boolean; detail: string }[];
  /** Consejo del coach para lo que falta. */
  tip: string | null;
}

export function nutritionDay(logs: CoachLogs, date: string, t: NutritionTargets): NutritionDay {
  const meals = logs.meals.filter((m) => m.date === date);
  const has = (tag: MealTag) => meals.filter((m) => m.tags.includes(tag)).length;
  const proteinMeals = meals.filter((m) => m.tags.includes('proteina') || (m.proteinG ?? 0) >= 20).length;
  const veggieMeals = has('verduras');
  const fruitMeals = has('fruta');
  const limitTags = [...new Set(meals.flatMap((m) => m.tags.filter((x) => MEAL_LIMIT_TAGS.includes(x))))];
  const limitCount = meals.reduce((s, m) => s + m.tags.filter((x) => MEAL_LIMIT_TAGS.includes(x)).length, 0);
  const pg = meals.filter((m) => m.proteinG !== null);
  const kc = meals.filter((m) => m.kcal !== null);
  const proteinG = pg.length ? Math.round(pg.reduce((s, m) => s + m.proteinG!, 0)) : null;
  const kcal = kc.length ? Math.round(kc.reduce((s, m) => s + m.kcal!, 0)) : null;
  const water = logs.water[date] ?? 0;
  const ate = meals.length > 0;
  const any = ate || water > 0;
  // Proteína: cuenta el MEJOR de los dos criterios (comidas con proteína —etiqueta o ≥ 20 g— o los gramos anotados),
  // así anotar los gramos de una comida nunca baja el día ni desmarca la proteína.
  const gramsRatio = proteinG !== null && t.proteinG ? proteinG / t.proteinG : 0;
  const mealsRatio = proteinMeals / t.meals.protein;
  const byGrams = gramsRatio > 0 && gramsRatio >= mealsRatio;
  const proteinOk = gramsRatio >= 0.9 || mealsRatio >= 1;
  const score = any
    ? Math.round(
        Math.min(1, Math.max(gramsRatio, mealsRatio)) * 30 +
          Math.min(1, veggieMeals / t.meals.veggies) * 25 +
          Math.min(1, fruitMeals / t.meals.fruit) * 10 +
          Math.min(1, water / t.waterGlasses) * 20 +
          // Sin comidas registradas no se sabe si hubo ultraprocesados: esos puntos no se dan.
          (!ate ? 0 : limitCount === 0 ? 15 : limitCount === 1 ? 7 : 0),
      )
    : null;
  const checks = [
    {
      key: 'proteina',
      label: 'Proteína',
      done: proteinOk,
      detail: byGrams ? `${proteinG} de ${t.proteinG} g` : `en ${proteinMeals} de ${t.meals.protein} comidas${proteinG ? ` (${proteinG} g anotados)` : ''}`,
    },
    { key: 'verduras', label: 'Verduras', done: veggieMeals >= t.meals.veggies, detail: `en ${veggieMeals} de ${t.meals.veggies} comidas` },
    { key: 'fruta', label: 'Fruta', done: fruitMeals >= t.meals.fruit, detail: fruitMeals ? `${fruitMeals} ${fruitMeals === 1 ? 'vez' : 'veces'}` : 'aún no' },
    { key: 'agua', label: 'Agua', done: water >= t.waterGlasses, detail: `${water} de ${t.waterGlasses} vasos` },
    { key: 'limitar', label: 'Sin ultraprocesados ni refresco', done: ate && limitCount === 0, detail: limitCount ? `${limitCount} ${limitCount === 1 ? 'vez' : 'veces'}` : ate ? 'bien' : 'sin comidas' },
  ];
  let tip: string | null = null;
  const pick = (k: keyof typeof FOOD_IDEAS, n = 3) => {
    const list = FOOD_IDEAS[k];
    const first = pickForDate(list.map((_, i) => i), date, k) ?? 0;
    return Array.from({ length: n }, (_, i) => list[(first + i) % list.length]).join(', ');
  };
  if (!proteinOk) tip = `Te falta proteína: en tu siguiente comida agrega ${t.portions.proteina} (${pick('proteina')}).`;
  else if (veggieMeals < t.meals.veggies) tip = `Suma verdura: ${t.portions.verduras} en tu siguiente comida (${pick('verduras')}).`;
  else if (water < t.waterGlasses) tip = `Vas en ${water} vasos de agua: te faltan ${t.waterGlasses - water}. Ten una botella a la mano.`;
  else if (!fruitMeals) tip = `Una fruta hoy (${pick('fruta', 2)}) y cierras el día redondo.`;
  else if (limitCount > 1) tip = 'Hoy hubo varios ultraprocesados o bebidas con azúcar: mañana cambia uno por agua natural o fruta.';
  return { date, meals, proteinMeals, veggieMeals, fruitMeals, limitTags, proteinG, kcal, water, score, checks, tip };
}

// ---------------------------------------------------------------------------------------------
// Medidas, sueño y la semana pasada
// ---------------------------------------------------------------------------------------------

export interface WeightTrend {
  last: { date: string; kg: number } | null;
  /** Cambio contra el registro más cercano a hace 7 días (o el anterior). */
  change: { kg: number; pct: number; days: number } | null;
  /** Ritmo semanal (% del peso). */
  weeklyPct: number | null;
  verdict: string | null;
  measureDue: boolean;
  daysSinceMeasure: number | null;
}

export function weightTrend(state: GameState, goal: CoachGoal, cfg: Cfg = DEFAULT_CFG): WeightTrend {
  const entries = state.body.entries.filter((e) => typeof e.weightKg === 'number');
  const last = entries.at(-1);
  const daysSince = last ? diffDays(last.date, state.today) : null;
  const measureDue = daysSince === null || daysSince >= cfg.coach.measureEveryDays;
  if (!last) return { last: null, change: null, weeklyPct: null, verdict: null, measureDue, daysSinceMeasure: null };
  const before = entries.filter((e) => e.date <= addDays(last.date, -5));
  const ref = before.at(-1);
  if (!ref) return { last: { date: last.date, kg: last.weightKg! }, change: null, weeklyPct: null, verdict: null, measureDue, daysSinceMeasure: daysSince };
  const days = diffDays(ref.date, last.date);
  const kg = round(last.weightKg! - ref.weightKg!, 1);
  const pct = round((kg / ref.weightKg!) * 100, 2);
  const weeklyPct = round((pct / days) * 7, 2);
  const r = cfg.coach.weightRatePct;
  let verdict: string;
  if (goal === 'perder_grasa') {
    if (weeklyPct <= -r.perder[1]) verdict = `Bajas ${Math.abs(weeklyPct)}% por semana: más rápido de lo recomendado (${r.perder[0]}–${r.perder[1]}%). Come un poco más de proteína y no recortes tanto.`;
    else if (weeklyPct <= -r.perder[0]) verdict = `Bajas ${Math.abs(weeklyPct)}% por semana: ritmo ideal.`;
    else if (weeklyPct < 0) verdict = `Bajas ${Math.abs(weeklyPct)}% por semana: va, pero lento. Revisa porciones y pasos.`;
    else verdict = `Tu peso no está bajando (${weeklyPct > 0 ? '+' : ''}${weeklyPct}% por semana). Ajusta porciones de carbohidratos y sube pasos.`;
  } else if (goal === 'ganar_musculo') {
    if (weeklyPct > r.ganar[1]) verdict = `Subes ${weeklyPct}% por semana: más rápido de lo ideal (${r.ganar[0]}–${r.ganar[1]}%), probablemente con grasa.`;
    else if (weeklyPct >= r.ganar[0]) verdict = `Subes ${weeklyPct}% por semana: ritmo ideal para ganar músculo.`;
    else verdict = `Tu peso casi no sube (${weeklyPct}% por semana): suma una colación con proteína.`;
  } else verdict = Math.abs(weeklyPct) < 0.5 ? 'Tu peso está estable.' : `Tu peso cambia ${weeklyPct > 0 ? '+' : ''}${weeklyPct}% por semana.`;
  return { last: { date: last.date, kg: last.weightKg! }, change: { kg, pct, days }, weeklyPct, verdict, measureDue, daysSinceMeasure: daysSince };
}

export interface WeekReview {
  weekStart: string;
  strength: { done: number; target: number };
  cardio: { done: number; target: number };
  steps: { avg: number | null; target: number };
  sleep: { avg: number | null; target: number };
  nutrition: { avg: number | null; days: number };
  /** 0–100: qué tanto cumpliste el plan (fuerza pesa más). */
  compliance: number;
  verdict: 'subir' | 'mantener' | 'bajar';
  verdictText: string;
}

function avgOf(vals: number[]): number | null {
  return vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 1) : null;
}

/** Resumen de una semana para el check-in (lo que hiciste contra lo que pedía el plan). */
export function weekReview(state: GameState, ws: string, cfg: Cfg = DEFAULT_CFG): WeekReview {
  const cs = coachSettingsOf(state);
  const profile = coachProfile(state);
  const phase = planPhase({ ...state, today: addDays(ws, 6) > state.today ? state.today : addDays(ws, 6) } as GameState, cfg);
  const pp = phaseParams(phase, cfg);
  const sdays = strengthDaysOf(cs, profile.level, pp.maxStrengthDays, cfg);
  const end = addDays(ws, 6);
  const ws_ = state.training.workouts.filter((w) => w.date >= ws && w.date <= end);
  const strengthDone = new Set(ws_.filter(isStrength).map((w) => w.date)).size;
  const cardioDone = Math.round(ws_.reduce((s, w) => s + w.cardioMinutes, 0));
  const cardioTarget = Math.min(300, pp.cardioMinutes + (cfg.coach.goalCardioBonus[profile.goal] ?? 0));
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((d) => d <= state.today);
  const stepsVals = days.map((d) => state.coach.steps[d]).filter((v): v is number => typeof v === 'number' && v > 0);
  const stepsT = stepsTarget(state.coach, ws, cs, profile.goal, cfg);
  const sleepVals = state.body.sleep.filter((s) => s.date >= ws && s.date <= end).map((s) => s.hours);
  const nt = nutritionTargets(profile, sdays.length, cfg);
  const nutriVals = days.map((d) => nutritionDay(state.coach, d, nt).score).filter((v): v is number => v !== null);
  const parts: [number, number][] = [[Math.min(1, strengthDone / Math.max(1, sdays.length)), 40]];
  parts.push([Math.min(1, cardioDone / Math.max(1, cardioTarget)), 20]);
  const sAvg = avgOf(stepsVals);
  if (sAvg !== null) parts.push([Math.min(1, sAvg / stepsT), 15]);
  const nAvg = avgOf(nutriVals);
  if (nAvg !== null) parts.push([nAvg / 100, 15]);
  const slAvg = avgOf(sleepVals);
  if (slAvg !== null) parts.push([Math.min(1, slAvg / cfg.coach.sleep.target), 10]);
  const totalW = parts.reduce((s, p) => s + p[1], 0);
  const compliance = Math.round((parts.reduce((s, p) => s + p[0] * p[1], 0) / totalW) * 100);
  const ci = state.coach.checkins[ws];
  let verdict: WeekReview['verdict'];
  let verdictText: string;
  if (ci && (ci.effort >= 5 || ci.energy <= 2 || ci.pain.length)) {
    verdict = 'bajar';
    verdictText = 'La próxima semana va más ligera: una serie menos, una rep más de reserva y sin subir peso. Primero recuperarte.';
  } else if (strengthDone >= Math.min(cfg.coach.advanceMinSessions, sdays.length) && compliance >= 70 && (!ci || ci.effort <= 4)) {
    verdict = 'subir';
    verdictText = 'Cumpliste: la próxima semana subes peso o repeticiones donde llegaste al tope.';
  } else {
    verdict = 'mantener';
    verdictText = strengthDone === 0 ? 'Esta semana no hubo fuerza: repetimos la misma semana, sin subir nada.' : 'Repetimos la semana con los mismos pesos y buscas completar todas las sesiones.';
  }
  return {
    weekStart: ws,
    strength: { done: strengthDone, target: sdays.length },
    cardio: { done: cardioDone, target: cardioTarget },
    steps: { avg: sAvg === null ? null : Math.round(sAvg), target: stepsT },
    sleep: { avg: slAvg, target: cfg.coach.sleep.target },
    nutrition: { avg: nAvg === null ? null : Math.round(nAvg), days: nutriVals.length },
    compliance,
    verdict,
    verdictText,
  };
}

// ---------------------------------------------------------------------------------------------
// El plan completo y lo que dice el coach
// ---------------------------------------------------------------------------------------------

export type CoachMood = 'feliz' | 'animo' | 'calma' | 'atento' | 'serio';

export type CoachActionKind = 'arrancar' | 'sesion' | 'cardio' | 'sentir' | 'sueno' | 'medidas' | 'checkin' | 'comida' | 'agua' | 'pasos' | 'perfil';

export interface CoachAction {
  kind: CoachActionKind;
  label: string;
  detail?: string;
}

export interface CoachPlan {
  profile: CoachProfile;
  phase: PlanPhase;
  /** Por qué el plan es así (explicaciones basadas en evidencia). */
  why: string[];
  strengthDays: number[];
  sessionMinutes: number;
  week: PlanDay[];
  targets: WeekTargets;
  today: {
    session: PrescribedSession;
    /** Ya entrenaste fuerza hoy. */
    strengthDone: boolean;
    cardioDone: boolean;
    workoutsToday: Workout[];
    /** Siguiente sesión de fuerza (si hoy ya quedó o no toca). */
    next: { date: string; title: string; key: SessionKey } | null;
    readiness: { energy: number; soreness: number; pain: BodyArea[] } | null;
    sleepHours: number | null;
  };
  nutrition: { targets: NutritionTargets; today: NutritionDay };
  weight: WeightTrend;
  /** Semana a revisar en el check-in (null si no toca). */
  checkinWeek: string | null;
  lastWeek: WeekReview;
  /** Lo que dice el coach ahora. */
  brief: { mood: CoachMood; greeting: string; message: string; extra: string[]; actions: CoachAction[] };
}

const TZ_HOUR = new Map<string, Intl.DateTimeFormat>();
/** Hora y minuto locales (h23). */
function localTime(nowIso: string, tz: string): { h: number; m: number } {
  let f = TZ_HOUR.get(tz);
  if (!f) TZ_HOUR.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })));
  const parts = f.formatToParts(new Date(nowIso));
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return { h: Number.isFinite(h) ? h : 12, m: Number.isFinite(m) ? m : 0 };
}
const localHour = (nowIso: string, tz: string): number => localTime(nowIso, tz).h;

const MOTIVATION = [
  'La constancia le gana a la intensidad.',
  'No tiene que ser perfecto, tiene que ser hoy.',
  'Cada sesión es un depósito: no se ve hoy, se ve en ocho semanas.',
  'El cuerpo se adapta a lo que haces seguido, no a lo que haces a veces.',
  'Lo más difícil son los primeros cinco minutos. Empieza.',
  'Poco a poco, pero sin parar.',
  'Hoy entrenas para el que vas a ser en un año.',
  'Termina la sesión y la cabeza te lo agradece en una hora.',
  'Una buena semana se arma con días normales bien hechos.',
];

export function coachPlan(state: GameState, nowIso: string, cfg: Cfg = DEFAULT_CFG): CoachPlan {
  const cc = cfg.coach;
  const cs = coachSettingsOf(state);
  const today = state.today;
  const profile = coachProfile(state);
  const phase = planPhase(state, cfg);
  const pp = phaseParams(phase, cfg);
  const sdays = strengthDaysOf(cs, profile.level, pp.maxStrengthDays, cfg);
  const sessionMinutes = clamp(cs.sessionMinutes ?? cc.defaultSessionMinutes, 20, 120);
  const ws = weekStart(today);
  const wd = weekday(today);
  const hour = localHour(nowIso, cfg.timezone);
  const tr = state.training;

  // ---- Lo de hoy: sueño, cómo te sientes y molestias ----
  const rd = state.coach.readiness[today];
  // Solo zonas que esta versión conoce: una de una versión futura no se puede evitar ni nombrar en el plan.
  const readiness = rd ? { energy: rd.energy, soreness: rd.soreness, pain: [...new Set(rd.pain.filter(isBodyArea))] } : null;
  const sleepHours = state.energy.sleepHours;
  const painToday = readiness?.pain ?? [];
  const avoid = [...new Set([...profile.limitations, ...painToday, ...(state.coach.checkins[addDays(ws, -7)]?.pain ?? []).filter(isBodyArea)])];
  const veryLow = (sleepHours !== null && sleepHours < cc.sleep.veryLow) || (readiness !== null && readiness.energy <= cc.readiness.restEnergy);
  const low = !veryLow && ((sleepHours !== null && sleepHours < cc.sleep.low) || (readiness !== null && (readiness.energy <= cc.readiness.lightEnergy || readiness.soreness >= 3)));

  // ---- Semana ----
  const order = sessionOrder(sdays.length);
  const weekIndex = Math.floor(diffDays(weekStart(phase.startDate), ws) / 7);
  const sessionAt = (i: number): SessionKey => (order.length === 2 ? order[(weekIndex * sdays.length + i) % 2] : order[i % order.length]);
  const weekWorkouts = tr.workouts.filter((w) => w.date >= ws && w.date <= addDays(ws, 6) && w.date <= today);
  const strengthDates = [...new Set(weekWorkouts.filter(isStrength).map((w) => w.date))].sort();
  const strengthDoneToday = strengthDates.includes(today);
  const strengthDoneCount = strengthDates.length;
  const cardioTarget = Math.min(300, pp.cardioMinutes + (cc.goalCardioBonus[profile.goal] ?? 0));
  const cardioDone = Math.round(weekWorkouts.reduce((s, w) => s + w.cardioMinutes, 0));
  const restDay = sdays.includes(6) ? [0, 1, 2, 3, 4, 5, 6].filter((d) => !sdays.includes(d)).at(-1) ?? -1 : 6;
  const cardioDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !sdays.includes(d) && d !== restDay);
  const perCardioDay = cardioDays.length ? clamp(Math.ceil(cardioTarget / cardioDays.length / 5) * 5, 20, 60) : 0;
  // ---- Sesión de hoy ----
  const statusNow = muscleStatus(tr.summary, nowIso, cfg);
  const sctx: SessionContext = {
    phase,
    goal: profile.goal,
    level: profile.level,
    where: profile.where,
    avoid,
    sessionMinutes,
    favorites: tr.summary.favorites,
    swaps: cs.swaps ?? {},
    records: tr.records,
    today,
  };
  // Siguiente sesión de fuerza en orden (aunque cambies el día).
  const nextIndex = Math.min(strengthDoneCount, Math.max(0, sdays.length - 1));
  const nextKey = sessionAt(strengthDoneCount < sdays.length ? strengthDoneCount : nextIndex);
  const plannedUpToToday = sdays.filter((d) => d <= wd).length;
  const behind = strengthDoneCount < plannedUpToToday;
  const todayIsStrength = sdays.includes(wd);
  const remainingSessions = Math.max(0, sdays.length - strengthDoneCount);
  /**
   * Días de esta semana en que el motor receta fuerza con lo que llevas hecho: día del plan o, si no, solo cuando ya vas
   * atrasado (la misma regla que decide la sesión de hoy). Sirve para saber a qué día cae una sesión recorrida.
   */
  const trainsOn = (d: number) => sdays.includes(d) || strengthDoneCount < sdays.filter((x) => x <= d).length;
  const adjustments: string[] = [];
  let session: PrescribedSession;
  /** La sesión de hoy se recorre porque los músculos clave no se han recuperado: desde qué día y hora ya se puede. */
  let movedTo: { date: string; time: string; why: string } | null = null;
  const cardioLeft = Math.max(0, cardioTarget - cardioDone);
  const cardioToday = (min: number, title = 'Cardio'): PrescribedSession => {
    const c = cardioFor(min, sctx);
    return {
      kind: 'cardio',
      key: 'cardio',
      title: `${title}: ${c.name.toLowerCase()} ${min} min`,
      focus: c.intensity,
      warmup: ['5 min a ritmo suave para entrar en calor.'],
      exercises: [],
      cardio: c,
      cooldown: ['Termina con 3–5 min suaves y estira pantorrillas y cadera.'],
      estMinutes: min,
      adjustments: [],
    };
  };
  const okH = cc.readyWithinHours;
  /**
   * Si los músculos clave de una sesión siguen recuperándose (les faltan más de `readyWithinHours`), desde qué día y
   * hora ya se puede hacer: el momento exacto (redondeado al minuto hacia arriba, nunca antes); si eso ya es de noche,
   * desde el día siguiente. Null si ya se puede.
   */
  const notReadyFor = (keys: MuscleId[]) => {
    const notReady = keys.filter((m) => statusNow[m].state === 'recuperando' && statusNow[m].hoursToReady > okH);
    if (!notReady.length) return null;
    const maxH = Math.max(...notReady.map((m) => statusNow[m].hoursToReady));
    const readyMs = Math.max(...notReady.map((m) => Date.parse(statusNow[m].readyAt ?? nowIso)));
    const okMs = Math.max(Date.parse(nowIso), Math.ceil((readyMs - okH * 3_600_000) / 60_000) * 60_000);
    const at = localTime(new Date(okMs).toISOString(), cfg.timezone);
    const okDate = toLocalDate(okMs, cfg.timezone);
    const many = notReady.length > 1;
    return {
      date: at.h >= cc.lateHour ? addDays(okDate, 1) : okDate,
      time: `${at.h}:${String(at.m).padStart(2, '0')}`,
      why: `${notReady.map((m) => MUSCLES[m].name).join(' y ')} ${many ? 'siguen' : 'sigue'} recuperándose (lista${many ? 's' : ''} en ${maxH} h)`,
    };
  };
  if (strengthDoneToday) {
    session = cardioLeft > 0 && !weekWorkouts.some((w) => w.date === today && isCardio(w)) ? cardioToday(Math.min(30, Math.max(15, Math.round(cardioLeft / 5) * 5)), 'Extra opcional') : { ...cardioToday(0), kind: 'descanso', key: 'descanso', title: 'Listo por hoy', focus: 'Ya entrenaste: ahora come bien y duerme 7+ horas.', cardio: null, estMinutes: 0, warmup: [], cooldown: [] };
  } else if (veryLow) {
    session = {
      kind: 'recuperacion',
      key: 'recuperacion',
      title: 'Recuperación: caminata 20–30 min',
      focus: 'Hoy tu cuerpo pide recuperar: muévete suave y estira.',
      warmup: [],
      exercises: [],
      cardio: { ...cardioFor(25, sctx), minutes: 25, intensity: 'Muy suave: paso cómodo, sin agitarte.' },
      cooldown: ['10 min de movilidad: cadera, espalda y hombros.', 'Acuéstate temprano: dormir es parte del entrenamiento.'],
      estMinutes: 30,
      adjustments: [sleepHours !== null && sleepHours < cc.sleep.veryLow ? `Dormiste ${sleepHours} h: entrenar pesado así sube el riesgo de lesión y rinde poco.` : 'Dijiste que estás sin energía: hoy recuperar es lo que más suma.'],
    };
  } else if (remainingSessions > 0 && trainsOn(wd)) {
    const pending = notReadyFor(SESSION_TEMPLATES[nextKey].key);
    if (pending) {
      session = cardioToday(perCardioDay || 30);
      // La sesión cae el día en que ya se puede o en el siguiente en que toque fuerza (el texto se arma abajo).
      movedTo = pending;
      session.adjustments = adjustments;
    } else {
      session = prescribeSession(nextKey, { ...sctx, light: low }, cfg);
      if (low) adjustments.push(sleepHours !== null && sleepHours < cc.sleep.low ? `Dormiste ${sleepHours} h: hoy una serie menos, una repetición más en reserva y sin subir peso.` : 'Llegas cansado o adolorido: hoy una serie menos, una repetición más en reserva y sin subir peso. Lo importante es no faltar.');
      if (painToday.length)
        adjustments.push(
          `Te molesta ${painToday.map(areaName).join(' y ')}: quité lo que la carga. Si el dolor es punzante, te despierta o dura más de 1–2 semanas, ve con un médico o fisioterapeuta.`,
        );
      if (!todayIsStrength && behind) adjustments.push(`Hoy no estaba planeada, pero vas ${strengthDoneCount} de ${sdays.length}: si puedes, hazla hoy.`);
      if (hour >= cc.lateHour) adjustments.push('Ya es tarde: si no te da, haz solo los 3 primeros ejercicios. Algo es mejor que nada.');
      session.adjustments = adjustments;
    }
  } else if (wd !== restDay && (cardioDays.includes(wd) || cardioLeft > 0)) {
    // El día libre sigue libre aunque falte cardio (ahí la caminata es opcional, en el texto del descanso).
    session = cardioLeft > 0 ? cardioToday(Math.max(20, Math.min(perCardioDay || 30, Math.ceil(cardioLeft / 5) * 5))) : cardioToday(20, 'Caminata ligera');
  } else {
    session = {
      kind: 'descanso',
      key: 'descanso',
      title: 'Descanso',
      focus: 'Descansar también es entrenar: aquí se reparan los músculos.',
      warmup: [],
      exercises: [],
      cardio: null,
      cooldown: ['Si te late, 10–20 min de caminata suave o estiramientos.'],
      estMinutes: 0,
      adjustments: [],
    };
  }

  // ---- Lo que sigue esta semana, en el orden real (si faltas o se recorre una sesión, lo pendiente se recorre) ----
  const lastDay = addDays(ws, 6);
  const moved = movedTo;
  // Día en que cae la sesión recorrida: el primero desde que los músculos están listos en que el motor sí receta fuerza
  // (día del plan, o uno fuera del plan solo si ese día ya irías atrasado). Null si se pasa a la semana que entra.
  let movedDay: string | null = null;
  if (moved)
    for (let d = moved.date; d <= lastDay; d = addDays(d, 1))
      if (trainsOn(weekday(d))) {
        movedDay = d;
        break;
      }
  // Días que toman las sesiones pendientes: hoy (si hoy toca fuerza o se recorrió a más tarde hoy), el día al que se
  // recorrió y los días de fuerza desde ahí (los de antes no: los músculos aún no estarían listos).
  const slots: string[] = [];
  if (remainingSessions > 0) {
    if (session.kind === 'fuerza' || movedDay === today) slots.push(today);
    const from = moved && moved.date > today ? (movedDay ?? addDays(lastDay, 1)) : addDays(today, 1);
    if (movedDay && movedDay > today) slots.push(movedDay);
    for (const d of sdays) {
      const date = addDays(ws, d);
      if (date >= from && !slots.includes(date)) slots.push(date);
    }
    slots.sort();
  }
  const slotKey = new Map<string, SessionKey>();
  slots.slice(0, remainingSessions).forEach((date, i) => slotKey.set(date, sessionAt(Math.min(strengthDoneCount + i, sdays.length - 1))));

  // Siguiente sesión de fuerza (para "mañana te toca…"): la primera pendiente que no es la de hoy.
  let next: CoachPlan['today']['next'] = null;
  const nextSlot = [...slotKey.entries()].find(([date]) => !(date === today && session.kind === 'fuerza'));
  if (nextSlot) next = { date: nextSlot[0], title: SESSION_TEMPLATES[nextSlot[1]].title, key: nextSlot[1] };
  if (!next && sdays.length) {
    // La semana que entra con lo que llevas registrado: su fase puede ser otra (p. ej. de cuerpo completo a torso/pierna).
    const nws = addDays(ws, 7);
    const nPhase = planPhase({ ...state, today: nws }, cfg);
    const nDays = strengthDaysOf(cs, profile.level, phaseParams(nPhase, cfg).maxStrengthDays, cfg);
    const nOrder = sessionOrder(nDays.length);
    const nIndex = Math.floor(diffDays(weekStart(nPhase.startDate), nws) / 7);
    const k = nOrder.length === 2 ? nOrder[(nIndex * nDays.length) % 2] : nOrder[0];
    const first = addDays(nws, nDays[0] ?? sdays[0]);
    // Solo se retrasa si los músculos de ESA sesión (no los de la que quedó pendiente esta semana) siguen
    // recuperándose: entonces va el primer día de fuerza de esa semana desde que ya se pueda.
    const wait = notReadyFor(SESSION_TEMPLATES[k].key);
    const from = wait && wait.date > first ? wait.date : first;
    const date = nDays.map((d) => addDays(nws, d)).find((d) => d >= from) ?? from;
    next = { date, title: SESSION_TEMPLATES[k].title, key: k };
  }
  if (moved && next) {
    const what = lowerFirst(next.title);
    adjustments.push(
      next.date === today
        ? `${moved.why}: por ahora cardio; ${what} a partir de las ${moved.time}.`
        : `${moved.why}: hoy cardio y ${what} ${next.date === addDays(today, 1) ? 'mañana' : `el ${DAY_NAMES[weekday(next.date)].toLowerCase()}`}.`,
    );
  }

  const week: PlanDay[] = Array.from({ length: 7 }, (_, d) => {
    const date = addDays(ws, d);
    const dayW = weekWorkouts.filter((w) => w.date === date);
    const planned = sdays.includes(d);
    let kind: PlanDay['kind'] = planned ? 'fuerza' : cardioDays.includes(d) ? 'cardio' : 'descanso';
    // Días pasados: su lugar fijo en la semana. Hoy y lo que sigue: lo que de verdad toca.
    let key: SessionKey | null = planned ? sessionAt(sdays.indexOf(d)) : null;
    let title: string | null = null;
    let minutes: number | null = null;
    if (date === today && strengthDoneToday) {
      if (planned) key = sessionAt(Math.max(0, strengthDoneCount - 1));
    } else if (date >= today) {
      const k = slotKey.get(date);
      if (k) {
        kind = 'fuerza';
        key = k;
      } else if (planned && date === today) {
        // Hoy tocaba fuerza pero no va (se recorrió, recuperación o ya completaste la semana): lo que sí toca.
        kind = session.kind === 'descanso' ? 'descanso' : 'cardio';
        key = null;
        title = session.title;
        minutes = session.estMinutes || null;
      } else if (planned) {
        // Día de fuerza que ya no lleva sesión (los músculos aún no estarían listos o ya completaste la semana).
        kind = (moved && date < moved.date) || cardioLeft > 0 ? 'cardio' : 'descanso';
        key = null;
      }
    }
    const cardioMin = perCardioDay || 30;
    return {
      date,
      weekday: d,
      label: DAY_NAMES[d],
      short: DAY_SHORT[d],
      kind,
      sessionKey: key,
      title: title ?? (key ? SESSION_TEMPLATES[key].title : kind === 'cardio' ? `Cardio ${cardioMin} min` : 'Descanso'),
      minutes: title ? minutes : key ? sessionMinutes : kind === 'cardio' ? cardioMin : null,
      isToday: date === today,
      past: date < today,
      didStrength: dayW.some(isStrength),
      didCardio: dayW.some(isCardio),
      doneTitles: dayW.map((w) => w.title),
    };
  });

  // ---- Metas de la semana ----
  const stepsT = stepsTarget(state.coach, today, cs, profile.goal, cfg);
  const daysSoFar = Array.from({ length: wd + 1 }, (_, i) => addDays(ws, i));
  const stepVals = daysSoFar.map((d) => state.coach.steps[d]).filter((v): v is number => typeof v === 'number' && v > 0);
  const sleepWeek = state.body.sleep.filter((s) => s.date >= addDays(today, -6) && s.date <= today);
  const nt = nutritionTargets(profile, sdays.length, cfg);
  const nToday = nutritionDay(state.coach, today, nt);
  const nWeek = daysSoFar.map((d) => nutritionDay(state.coach, d, nt).score).filter((v): v is number => v !== null);
  const targets: WeekTargets = {
    strength: { done: strengthDoneCount, target: sdays.length },
    cardio: { done: cardioDone, target: cardioTarget },
    steps: { avg: stepVals.length ? Math.round(stepVals.reduce((a, b) => a + b, 0) / stepVals.length) : null, target: stepsT, days: stepVals.length, today: state.coach.steps[today] ?? null },
    sleep: { avg: avgOf(sleepWeek.map((s) => s.hours)), target: cc.sleep.target, days: sleepWeek.length, lastNight: sleepHours },
    nutrition: { avg: nWeek.length ? Math.round(nWeek.reduce((a, b) => a + b, 0) / nWeek.length) : null, days: nWeek.length },
  };

  const weight = weightTrend(state, profile.goal, cfg);
  const prevWs = addDays(ws, -7);
  const planWs = weekStart(phase.startDate);
  let checkinWeek: string | null = null;
  if (profile.configured) {
    if (wd >= 5 && !state.coach.checkins[ws]) checkinWeek = ws;
    else if (wd <= 1 && prevWs >= planWs && !state.coach.checkins[prevWs]) checkinWeek = prevWs;
  }
  const lastWeek = weekReview(state, prevWs, cfg);

  // ---- Por qué el plan es así ----
  const mainReps = profile.goal === 'fuerza' && phase.key === 'progreso' ? cc.strengthCompoundReps : pp.compoundReps;
  const why = [
    phase.reason,
    `${sdays.length} ${sdays.length === 1 ? 'día' : 'días'} de fuerza (${sdays.map((d) => DAY_SHORT[d]).join(', ')}) con ${sdays.length <= 3 ? 'cuerpo completo: cada músculo 2–3 veces por semana, lo que mejor funciona al empezar' : 'torso y pierna: cada músculo 2 veces por semana'}.`,
    `${pp.sets} ${pp.sets === 1 ? 'serie' : 'series'} en los ejercicios principales, ${mainReps[0]}–${mainReps[1]} repeticiones, dejando ${pp.rir[0]}–${pp.rir[1]} en reserva: suficiente estímulo sin acabar molido.`,
    phase.key === 'descarga'
      ? 'Esta semana no subes: repites las reps de la vez pasada con un poco menos de peso. La que sigue vuelves a progresar.'
      : phase.light
        ? 'Esta semana no subes peso ni reps: repites lo de la vez pasada. La que sigue vuelves a progresar.'
        : 'Sobrecarga progresiva: cuando haces el tope del rango en todas las series, subes peso; si no, repites el peso y buscas una repetición más.',
    `Cardio: ${cardioTarget} min a la semana (la OMS pide 150–300) y ${stepsT.toLocaleString('es-MX')} pasos al día.`,
    profile.limitations.length ? `Evito ejercicios que cargan ${profile.limitations.map(areaName).join(', ')}.` : '',
    `Objetivo: ${COACH_GOAL_NAMES[profile.goal].toLowerCase()}.`,
  ].filter(Boolean);

  // ---- Lo que dice el coach ----
  const name = profile.firstName;
  const greeting = `${hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'}${name ? `, ${name}` : ''}.`;
  const actions: CoachAction[] = [];
  const extra: string[] = [];
  let mood: CoachMood = 'animo';
  let message: string;
  const lastWorkout = tr.workouts.filter((w) => w.date <= today).at(-1);
  const daysOff = lastWorkout ? diffDays(lastWorkout.date, today) : null;
  const motivation = pickForDate(MOTIVATION, today, 'coach') ?? MOTIVATION[0];
  const todayW = tr.workouts.filter((w) => w.date === today);
  const recordsToday = todayW.flatMap((w) => w.records);

  if (!profile.configured) {
    mood = 'animo';
    message = 'Soy tu coach. Armemos tu plan en dos minutos: tu objetivo, qué días puedes y si algo te molesta. A partir de ahí te digo qué hacer cada día.';
    actions.push({ kind: 'arrancar', label: 'Armar mi plan' });
  } else if (strengthDoneToday) {
    mood = 'feliz';
    message = `Bien hecho: ${todayW.filter(isStrength).map((w) => w.title).join(' y ') || 'tu sesión'} quedó.${recordsToday.length ? ` Y con récord personal (${recordsToday.length}).` : ''} Vas ${strengthDoneCount} de ${sdays.length} esta semana.`;
    if (next) extra.push(`Siguiente: ${next.title} el ${DAY_NAMES[weekday(next.date)].toLowerCase()}.`);
    extra.push(nt.proteinG ? `Hoy cuida la proteína: ${nt.proteinG} g repartidos en ${nt.meals.protein} comidas.` : 'Hoy come proteína en cada comida y duerme 7+ horas: ahí se construye el músculo.');
  } else if (veryLow) {
    mood = 'atento';
    message = sleepHours !== null && sleepHours < cc.sleep.veryLow ? `Dormiste ${sleepHours} h. Hoy no fuerces: camina 20–30 minutos, estira y acuéstate temprano.` : 'Dices que hoy no tienes energía. Hoy toca recuperar: caminata suave y a dormir temprano. Mañana retomamos.';
  } else if (daysOff !== null && daysOff >= 10 && session.kind === 'fuerza') {
    mood = 'serio';
    message = `Llevas ${daysOff} días sin entrenar. Sin culpa: hoy ${lowerFirst(session.title)} en versión corta y volvemos al ritmo.`;
    actions.push({ kind: 'sesion', label: `Empezar ${lowerFirst(session.title)}`, detail: `~${Math.min(session.estMinutes, 30)} min` });
  } else if (session.kind === 'fuerza') {
    mood = behind && strengthDoneCount + 1 < plannedUpToToday ? 'serio' : 'animo';
    const daysLeft = 6 - wd;
    message =
      mood === 'serio'
        ? `Vas ${strengthDoneCount} de ${sdays.length} sesiones y ${daysLeft === 0 ? 'hoy es el último día' : `quedan ${daysLeft + 1} días`}. Hoy toca ${session.title} (~${session.estMinutes} min): ponte las pilas.`
        : `Hoy toca ${session.title} (~${session.estMinutes} min): ${SESSION_TEMPLATES[session.key as SessionKey].focus.toLowerCase()}. ${motivation}`;
    actions.push({ kind: 'sesion', label: `Empezar ${lowerFirst(session.title)}`, detail: `${session.exercises.length} ejercicios · ~${session.estMinutes} min` });
    if (session.adjustments.length) extra.push(...session.adjustments.slice(0, 2));
  } else if (session.kind === 'cardio') {
    mood = 'calma';
    message = session.adjustments.length ? session.adjustments[0] : `Hoy toca moverte sin pesas: ${session.cardio!.name.toLowerCase()} ${session.cardio!.minutes} min. ${session.cardio!.intensity}`;
    actions.push({ kind: 'cardio', label: `Registrar ${session.cardio!.name.toLowerCase()}`, detail: `${session.cardio!.minutes} min` });
  } else {
    mood = targets.strength.done >= targets.strength.target ? 'feliz' : 'calma';
    message = targets.strength.done >= targets.strength.target && targets.strength.target > 0 ? `Semana de fuerza completa (${targets.strength.done} de ${targets.strength.target}). Hoy descansa: camina un rato y llega a tus pasos.` : 'Hoy es de descanso. Camina un rato, estira y prepárate para la siguiente sesión.';
  }

  if (profile.configured) {
    if (profile.missing.length && (profile.missing.includes('estatura') || profile.missing.includes('fecha de nacimiento'))) actions.push({ kind: 'perfil', label: 'Completa tu perfil', detail: `Me falta: ${profile.missing.join(', ')}` });
    if (sleepHours === null && hour >= 5) actions.push({ kind: 'sueno', label: '¿Cuántas horas dormiste?' });
    if (!readiness && !strengthDoneToday && session.kind === 'fuerza') actions.push({ kind: 'sentir', label: '¿Cómo te sientes hoy?', detail: 'Ajusto la sesión' });
    if (checkinWeek) actions.push({ kind: 'checkin', label: '¿Cómo estuvo tu semana?', detail: checkinWeek === ws ? 'Check-in de esta semana' : 'Check-in de la semana pasada' });
    if (weight.measureDue) actions.push({ kind: 'medidas', label: weight.last ? 'Toca medirte' : 'Pésate y mide tu cintura', detail: 'En ayunas, después del baño' });
    if (hour >= 15 && !nToday.meals.length) actions.push({ kind: 'comida', label: '¿Qué comiste hoy?', detail: 'Te digo qué te falta' });
    else if (nToday.tip && nToday.meals.length) extra.push(nToday.tip);
    if (hour >= 12 && nToday.water < Math.round(nt.waterGlasses / 2)) actions.push({ kind: 'agua', label: `Agua: ${nToday.water} de ${nt.waterGlasses} vasos` });
    if (hour >= 18 && targets.steps.today === null) actions.push({ kind: 'pasos', label: '¿Cuántos pasos llevas?', detail: `Meta ${stepsT.toLocaleString('es-MX')}` });
    if (sleepHours !== null && sleepHours < cc.sleep.low && !veryLow) extra.push(`Dormiste ${sleepHours} h: esta noche busca 7–8 horas. El sueño es donde se recupera el músculo.`);
  }
  return {
    profile,
    phase,
    why,
    strengthDays: sdays,
    sessionMinutes,
    week,
    targets,
    today: { session, strengthDone: strengthDoneToday, cardioDone: todayW.some(isCardio), workoutsToday: todayW, next, readiness, sleepHours },
    nutrition: { targets: nt, today: nToday },
    weight,
    checkinWeek,
    lastWeek,
    brief: { mood, greeting, message, extra: extra.slice(0, 3), actions },
  };
}
