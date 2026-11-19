import type { Equipment, ExerciseMeasure, MuscleId } from '../types';
import { MUSCLE_IDS } from '../types';

/**
 * Biblioteca de entrenamiento: grupos musculares y ~80 ejercicios comunes en español con sus músculos
 * principales y secundarios. Es código (como la config): si se corrige un ejercicio, el análisis de todo el
 * historial se recalcula. Los ejercicios propios del usuario viven en el catálogo (`training/exercise`).
 */

export type MuscleGroup = 'empuje' | 'jalon' | 'pierna' | 'core';

export interface MuscleInfo {
  id: MuscleId;
  name: string;
  /** Recuperación: grande = 72 h, chico = 48 h (config.training.recoveryHours). */
  size: 'grande' | 'chico';
  /** Para equilibrio empuje/jalón y torso (empuje + jalón) / pierna. */
  group: MuscleGroup;
  /** Recibe mucho trabajo indirecto: pide menos series directas (config.training.accessoryWeeklySets). */
  accessory: boolean;
  /** Vistas del mapa del cuerpo donde se ve. */
  views: ('frente' | 'espalda')[];
  /** Músculos anatómicos que agrupa (guía para pintarlo en el personaje 3D). */
  anatomy: string;
}

export const MUSCLES: Record<MuscleId, MuscleInfo> = {
  pecho: { id: 'pecho', name: 'Pecho', size: 'grande', group: 'empuje', accessory: false, views: ['frente'], anatomy: 'pectoral mayor y menor' },
  espalda: { id: 'espalda', name: 'Espalda', size: 'grande', group: 'jalon', accessory: false, views: ['espalda'], anatomy: 'dorsal ancho, redondo mayor y romboides' },
  trapecio: { id: 'trapecio', name: 'Trapecio', size: 'chico', group: 'jalon', accessory: true, views: ['frente', 'espalda'], anatomy: 'trapecio superior, medio e inferior' },
  hombro_frontal: { id: 'hombro_frontal', name: 'Hombro frontal', size: 'chico', group: 'empuje', accessory: false, views: ['frente'], anatomy: 'deltoides anterior' },
  hombro_lateral: { id: 'hombro_lateral', name: 'Hombro lateral', size: 'chico', group: 'empuje', accessory: false, views: ['frente', 'espalda'], anatomy: 'deltoides medio' },
  hombro_posterior: { id: 'hombro_posterior', name: 'Hombro posterior', size: 'chico', group: 'jalon', accessory: false, views: ['espalda'], anatomy: 'deltoides posterior' },
  biceps: { id: 'biceps', name: 'Bíceps', size: 'chico', group: 'jalon', accessory: false, views: ['frente'], anatomy: 'bíceps braquial y braquial' },
  triceps: { id: 'triceps', name: 'Tríceps', size: 'chico', group: 'empuje', accessory: false, views: ['espalda'], anatomy: 'tríceps braquial' },
  antebrazo: { id: 'antebrazo', name: 'Antebrazo', size: 'chico', group: 'jalon', accessory: true, views: ['frente', 'espalda'], anatomy: 'flexores y extensores del antebrazo, braquiorradial' },
  abdomen: { id: 'abdomen', name: 'Abdomen', size: 'chico', group: 'core', accessory: false, views: ['frente'], anatomy: 'recto abdominal' },
  oblicuos: { id: 'oblicuos', name: 'Oblicuos', size: 'chico', group: 'core', accessory: true, views: ['frente'], anatomy: 'oblicuos externos e internos' },
  lumbar: { id: 'lumbar', name: 'Espalda baja', size: 'grande', group: 'pierna', accessory: true, views: ['espalda'], anatomy: 'erectores de la columna' },
  gluteos: { id: 'gluteos', name: 'Glúteos', size: 'grande', group: 'pierna', accessory: false, views: ['espalda'], anatomy: 'glúteo mayor y medio' },
  cuadriceps: { id: 'cuadriceps', name: 'Cuádriceps', size: 'grande', group: 'pierna', accessory: false, views: ['frente'], anatomy: 'cuádriceps (recto femoral y vastos)' },
  isquios: { id: 'isquios', name: 'Isquiotibiales', size: 'grande', group: 'pierna', accessory: false, views: ['espalda'], anatomy: 'bíceps femoral, semitendinoso y semimembranoso' },
  aductores: { id: 'aductores', name: 'Aductores', size: 'chico', group: 'pierna', accessory: true, views: ['frente', 'espalda'], anatomy: 'aductores de la cadera (cara interna del muslo)' },
  pantorrillas: { id: 'pantorrillas', name: 'Pantorrillas', size: 'chico', group: 'pierna', accessory: false, views: ['frente', 'espalda'], anatomy: 'gemelos y sóleo' },
};

export const MUSCLE_GROUP_NAMES: Record<MuscleGroup, string> = { empuje: 'Empuje', jalon: 'Jalón', pierna: 'Pierna', core: 'Core' };

export function isMuscleId(x: unknown): x is MuscleId {
  return typeof x === 'string' && (MUSCLE_IDS as readonly string[]).includes(x);
}

export interface ExerciseDef {
  id: string;
  name: string;
  equipment: Equipment;
  measure: ExerciseMeasure;
  primary: MuscleId[];
  secondary: MuscleId[];
  /** Multiarticular (va primero en una sesión sugerida). */
  compound?: boolean;
  /** Otros nombres para buscarlo ("bench press", "flexiones"…). */
  aliases?: string[];
}

type Def = [id: string, name: string, equipment: Equipment, measure: ExerciseMeasure, primary: MuscleId[], secondary: MuscleId[], compound: boolean, aliases?: string[]];

const DEFS: Def[] = [
  // ---- Pecho ----
  ['press-banca', 'Press de banca', 'barra', 'peso', ['pecho'], ['triceps', 'hombro_frontal'], true, ['press banca', 'bench press', 'press plano', 'banca']],
  ['press-inclinado', 'Press inclinado con barra', 'barra', 'peso', ['pecho', 'hombro_frontal'], ['triceps'], true, ['press inclinado', 'incline bench']],
  ['press-mancuernas', 'Press con mancuernas', 'mancuerna', 'peso', ['pecho'], ['triceps', 'hombro_frontal'], true, ['press plano con mancuernas', 'dumbbell press']],
  ['press-inclinado-mancuernas', 'Press inclinado con mancuernas', 'mancuerna', 'peso', ['pecho', 'hombro_frontal'], ['triceps'], true, ['inclinado mancuernas']],
  ['press-declinado', 'Press declinado', 'barra', 'peso', ['pecho'], ['triceps'], true, ['decline bench']],
  ['press-pecho-maquina', 'Press de pecho en máquina', 'maquina', 'peso', ['pecho'], ['triceps', 'hombro_frontal'], true, ['chest press', 'press maquina']],
  ['aperturas', 'Aperturas con mancuernas', 'mancuerna', 'peso', ['pecho'], ['hombro_frontal'], false, ['flyes', 'aperturas', 'fly']],
  ['cruce-poleas', 'Cruce de poleas', 'polea', 'peso', ['pecho'], ['hombro_frontal'], false, ['crossover', 'cruces']],
  ['pec-deck', 'Pec deck', 'maquina', 'peso', ['pecho'], [], false, ['peck deck', 'contractora', 'mariposa']],
  ['lagartijas', 'Lagartijas', 'corporal', 'corporal', ['pecho'], ['triceps', 'hombro_frontal', 'abdomen'], true, ['flexiones', 'push ups', 'pushups', 'planchas']],
  ['fondos', 'Fondos en paralelas', 'corporal', 'corporal', ['pecho', 'triceps'], ['hombro_frontal'], true, ['dips', 'fondos']],

  // ---- Espalda ----
  ['dominadas', 'Dominadas', 'corporal', 'corporal', ['espalda'], ['biceps', 'antebrazo', 'hombro_posterior'], true, ['pull ups', 'pullups', 'barra fija']],
  ['dominadas-supinas', 'Dominadas supinas', 'corporal', 'corporal', ['espalda', 'biceps'], ['antebrazo'], true, ['chin ups', 'chinups']],
  ['jalon-pecho', 'Jalón al pecho', 'polea', 'peso', ['espalda'], ['biceps', 'hombro_posterior'], true, ['jalon', 'lat pulldown', 'polea al pecho', 'jalones']],
  ['remo-barra', 'Remo con barra', 'barra', 'peso', ['espalda'], ['biceps', 'hombro_posterior', 'trapecio', 'lumbar'], true, ['barbell row', 'remo inclinado']],
  ['remo-mancuerna', 'Remo con mancuerna', 'mancuerna', 'peso', ['espalda'], ['biceps', 'hombro_posterior', 'trapecio'], true, ['remo a una mano', 'dumbbell row', 'serrucho']],
  ['remo-polea', 'Remo en polea baja', 'polea', 'peso', ['espalda'], ['biceps', 'hombro_posterior', 'trapecio'], true, ['remo sentado', 'seated row', 'remo gironda']],
  ['remo-maquina', 'Remo en máquina', 'maquina', 'peso', ['espalda'], ['biceps', 'hombro_posterior'], true, ['remo hammer']],
  ['remo-t', 'Remo en T', 'barra', 'peso', ['espalda'], ['biceps', 'trapecio', 'lumbar'], true, ['t bar row', 'remo t']],
  ['remo-invertido', 'Remo invertido', 'corporal', 'corporal', ['espalda'], ['biceps', 'hombro_posterior'], true, ['inverted row', 'remo australiano']],
  ['pullover', 'Pullover', 'mancuerna', 'peso', ['espalda'], ['pecho', 'triceps'], false, ['pull over']],
  ['peso-muerto', 'Peso muerto', 'barra', 'peso', ['isquios', 'gluteos', 'lumbar'], ['espalda', 'trapecio', 'antebrazo', 'cuadriceps'], true, ['deadlift', 'muerto', 'peso muerto convencional']],
  ['encogimientos', 'Encogimientos', 'mancuerna', 'peso', ['trapecio'], ['antebrazo'], false, ['shrugs', 'encogimiento de hombros']],
  ['hiperextensiones', 'Hiperextensiones', 'corporal', 'corporal', ['lumbar'], ['gluteos', 'isquios'], false, ['extensiones lumbares', 'back extension']],

  // ---- Hombro ----
  ['press-militar', 'Press militar', 'barra', 'peso', ['hombro_frontal'], ['hombro_lateral', 'triceps', 'trapecio'], true, ['overhead press', 'press de hombro', 'press militar con barra', 'ohp']],
  ['press-hombro-mancuernas', 'Press de hombro con mancuernas', 'mancuerna', 'peso', ['hombro_frontal'], ['hombro_lateral', 'triceps'], true, ['press de hombros', 'shoulder press']],
  ['press-arnold', 'Press Arnold', 'mancuerna', 'peso', ['hombro_frontal'], ['hombro_lateral', 'triceps'], true, ['arnold']],
  ['elevaciones-laterales', 'Elevaciones laterales', 'mancuerna', 'peso', ['hombro_lateral'], ['trapecio'], false, ['laterales', 'lateral raise', 'vuelos laterales']],
  ['elevaciones-frontales', 'Elevaciones frontales', 'mancuerna', 'peso', ['hombro_frontal'], [], false, ['frontales', 'front raise']],
  ['pajaros', 'Pájaros', 'mancuerna', 'peso', ['hombro_posterior'], ['trapecio'], false, ['elevaciones posteriores', 'reverse fly', 'vuelos posteriores', 'deltoides posterior']],
  ['face-pull', 'Face pull', 'polea', 'peso', ['hombro_posterior'], ['trapecio'], false, ['facepull', 'jalon a la cara']],
  ['remo-al-menton', 'Remo al mentón', 'barra', 'peso', ['hombro_lateral', 'trapecio'], ['biceps'], false, ['upright row', 'remo al menton']],

  // ---- Brazos ----
  ['curl-barra', 'Curl con barra', 'barra', 'peso', ['biceps'], ['antebrazo'], false, ['curl de biceps', 'barbell curl', 'curl biceps']],
  ['curl-mancuernas', 'Curl con mancuernas', 'mancuerna', 'peso', ['biceps'], ['antebrazo'], false, ['curl alterno', 'dumbbell curl']],
  ['curl-martillo', 'Curl martillo', 'mancuerna', 'peso', ['biceps', 'antebrazo'], [], false, ['hammer curl', 'martillo']],
  ['curl-predicador', 'Curl predicador', 'barra', 'peso', ['biceps'], [], false, ['curl scott', 'preacher curl', 'banco scott']],
  ['curl-polea', 'Curl en polea', 'polea', 'peso', ['biceps'], ['antebrazo'], false, ['cable curl']],
  ['curl-concentrado', 'Curl concentrado', 'mancuerna', 'peso', ['biceps'], [], false, ['concentration curl']],
  ['extension-polea', 'Extensión de tríceps en polea', 'polea', 'peso', ['triceps'], [], false, ['pushdown', 'jalon de triceps', 'triceps en polea', 'extension triceps']],
  ['press-frances', 'Press francés', 'barra', 'peso', ['triceps'], [], false, ['skull crusher', 'rompecraneos', 'frances']],
  ['extension-sobre-cabeza', 'Extensión de tríceps sobre la cabeza', 'mancuerna', 'peso', ['triceps'], [], false, ['overhead extension', 'copa', 'triceps tras nuca']],
  ['patada-triceps', 'Patada de tríceps', 'mancuerna', 'peso', ['triceps'], [], false, ['kickback', 'patada de burro']],
  ['press-cerrado', 'Press cerrado', 'barra', 'peso', ['triceps', 'pecho'], ['hombro_frontal'], true, ['close grip bench', 'press agarre cerrado']],
  ['fondos-banco', 'Fondos en banco', 'corporal', 'corporal', ['triceps'], ['pecho', 'hombro_frontal'], false, ['bench dips', 'fondos de triceps']],
  ['curl-muneca', 'Curl de muñeca', 'mancuerna', 'peso', ['antebrazo'], [], false, ['wrist curl', 'curl de muneca', 'antebrazo']],
  ['paseo-granjero', 'Paseo del granjero', 'mancuerna', 'peso', ['antebrazo', 'trapecio'], ['abdomen', 'oblicuos', 'gluteos'], true, ['farmer walk', 'caminata del granjero']],

  // ---- Pierna ----
  ['sentadilla', 'Sentadilla', 'barra', 'peso', ['cuadriceps', 'gluteos'], ['aductores', 'lumbar', 'abdomen'], true, ['squat', 'sentadillas', 'sentadilla con barra', 'back squat']],
  ['sentadilla-frontal', 'Sentadilla frontal', 'barra', 'peso', ['cuadriceps'], ['gluteos', 'abdomen', 'aductores'], true, ['front squat']],
  ['sentadilla-goblet', 'Sentadilla goblet', 'mancuerna', 'peso', ['cuadriceps', 'gluteos'], ['aductores', 'abdomen'], true, ['goblet squat', 'sentadilla copa']],
  ['sentadilla-bulgara', 'Sentadilla búlgara', 'mancuerna', 'peso', ['cuadriceps', 'gluteos'], ['aductores', 'isquios'], true, ['bulgara', 'split squat', 'bulgarian']],
  ['sentadilla-corporal', 'Sentadilla sin peso', 'corporal', 'corporal', ['cuadriceps', 'gluteos'], ['aductores'], true, ['air squat', 'sentadilla libre']],
  ['prensa', 'Prensa de pierna', 'maquina', 'peso', ['cuadriceps', 'gluteos'], ['aductores'], true, ['leg press', 'prensa']],
  ['sentadilla-hack', 'Sentadilla hack', 'maquina', 'peso', ['cuadriceps'], ['gluteos'], true, ['hack squat', 'hack']],
  ['zancadas', 'Zancadas', 'mancuerna', 'peso', ['cuadriceps', 'gluteos'], ['aductores', 'isquios'], true, ['desplantes', 'lunges', 'estocadas']],
  ['step-up', 'Subidas al cajón', 'mancuerna', 'peso', ['cuadriceps', 'gluteos'], ['isquios'], true, ['step up', 'subidas al banco']],
  ['extension-cuadriceps', 'Extensión de cuádriceps', 'maquina', 'peso', ['cuadriceps'], [], false, ['leg extension', 'extensiones', 'extension de pierna']],
  ['curl-femoral', 'Curl femoral', 'maquina', 'peso', ['isquios'], ['pantorrillas'], false, ['leg curl', 'femoral', 'curl de pierna']],
  ['peso-muerto-rumano', 'Peso muerto rumano', 'barra', 'peso', ['isquios', 'gluteos'], ['lumbar', 'antebrazo'], true, ['rumano', 'rdl', 'romanian deadlift']],
  ['hip-thrust', 'Hip thrust', 'barra', 'peso', ['gluteos'], ['isquios'], true, ['empuje de cadera', 'hip thrusts']],
  ['puente-gluteo', 'Puente de glúteo', 'corporal', 'corporal', ['gluteos'], ['isquios'], false, ['glute bridge', 'puente']],
  ['patada-gluteo', 'Patada de glúteo', 'polea', 'peso', ['gluteos'], ['isquios'], false, ['glute kickback', 'patada de gluteo']],
  ['abduccion-maquina', 'Abducción de cadera', 'maquina', 'peso', ['gluteos'], [], false, ['abductores', 'abductor', 'abduccion']],
  ['aduccion-maquina', 'Aducción de cadera', 'maquina', 'peso', ['aductores'], [], false, ['aductores', 'aductor', 'aduccion']],
  ['elevacion-talones', 'Elevación de talones de pie', 'maquina', 'peso', ['pantorrillas'], [], false, ['pantorrilla', 'calf raise', 'gemelos', 'pantorrillas de pie']],
  ['talones-sentado', 'Elevación de talones sentado', 'maquina', 'peso', ['pantorrillas'], [], false, ['seated calf', 'pantorrilla sentado', 'soleo']],
  ['swing-kettlebell', 'Swing con kettlebell', 'kettlebell', 'peso', ['gluteos', 'isquios'], ['lumbar', 'abdomen', 'antebrazo'], true, ['kettlebell swing', 'swing', 'columpio']],

  // ---- Core ----
  ['plancha', 'Plancha', 'corporal', 'tiempo', ['abdomen'], ['oblicuos', 'hombro_frontal'], false, ['plank', 'plancha frontal']],
  ['plancha-lateral', 'Plancha lateral', 'corporal', 'tiempo', ['oblicuos'], ['abdomen'], false, ['side plank']],
  ['crunch', 'Abdominales (crunch)', 'corporal', 'corporal', ['abdomen'], [], false, ['abdominales', 'crunches', 'encogimientos abdominales']],
  ['elevacion-piernas', 'Elevación de piernas colgado', 'corporal', 'corporal', ['abdomen'], ['oblicuos', 'antebrazo'], false, ['leg raise', 'elevaciones de piernas', 'hanging leg raise']],
  ['rueda-abdominal', 'Rueda abdominal', 'corporal', 'corporal', ['abdomen'], ['espalda', 'oblicuos'], false, ['ab wheel', 'rueda']],
  ['giros-rusos', 'Giros rusos', 'corporal', 'corporal', ['oblicuos'], ['abdomen'], false, ['russian twist', 'giro ruso']],
  ['press-pallof', 'Press Pallof', 'polea', 'peso', ['oblicuos'], ['abdomen'], false, ['pallof']],
  ['lenador', 'Leñador en polea', 'polea', 'peso', ['oblicuos'], ['abdomen', 'hombro_frontal'], false, ['woodchopper', 'lenador']],
  ['bicho-muerto', 'Bicho muerto', 'corporal', 'corporal', ['abdomen'], ['oblicuos'], false, ['dead bug']],

  // ---- Cuerpo completo ----
  ['burpees', 'Burpees', 'corporal', 'corporal', ['cuadriceps', 'pecho'], ['hombro_frontal', 'triceps', 'abdomen', 'gluteos'], true, ['burpee']],
  ['cargada', 'Cargada', 'barra', 'peso', ['gluteos', 'isquios', 'trapecio'], ['cuadriceps', 'lumbar', 'hombro_lateral', 'antebrazo'], true, ['power clean', 'clean']],
  ['thruster', 'Thruster', 'barra', 'peso', ['cuadriceps', 'hombro_frontal'], ['gluteos', 'triceps', 'abdomen'], true, ['thrusters']],

  // ---- Cardio (minutos y km; cuentan para el cardio de la semana, no para las series) ----
  ['correr', 'Correr', 'cardio', 'distancia', ['cuadriceps', 'pantorrillas'], ['isquios', 'gluteos'], false, ['trotar', 'running', 'carrera', 'trote', 'caminadora']],
  ['caminar', 'Caminar', 'cardio', 'distancia', ['pantorrillas'], ['cuadriceps', 'gluteos'], false, ['caminata', 'walking']],
  ['bici', 'Bicicleta', 'cardio', 'distancia', ['cuadriceps'], ['gluteos', 'pantorrillas', 'isquios'], false, ['ciclismo', 'spinning', 'bici fija', 'bicicleta fija', 'bike']],
  ['natacion', 'Natación', 'cardio', 'distancia', ['espalda', 'hombro_frontal'], ['triceps', 'pecho', 'abdomen'], false, ['nadar', 'swim']],
  ['eliptica', 'Elíptica', 'cardio', 'distancia', ['cuadriceps'], ['gluteos', 'pantorrillas'], false, ['eliptica']],
  ['remo-ergometro', 'Remo (máquina de cardio)', 'cardio', 'distancia', ['espalda', 'cuadriceps'], ['biceps', 'gluteos', 'isquios'], false, ['ergometro', 'rower', 'remadora']],
  ['escaladora', 'Escaladora', 'cardio', 'distancia', ['gluteos', 'cuadriceps'], ['pantorrillas'], false, ['stairmaster', 'escaleras']],
  ['saltar-cuerda', 'Saltar la cuerda', 'cardio', 'distancia', ['pantorrillas'], ['hombro_frontal', 'cuadriceps'], false, ['cuerda', 'jump rope', 'comba']],
];

export const EXERCISE_LIBRARY: ExerciseDef[] = DEFS.map(([id, name, equipment, measure, primary, secondary, compound, aliases]) => ({
  id,
  name,
  equipment,
  measure,
  primary,
  secondary,
  compound,
  aliases,
}));

export const EXERCISE_BY_ID: Map<string, ExerciseDef> = new Map(EXERCISE_LIBRARY.map((e) => [e.id, e]));

// ---------------------------------------------------------------------------------------------
// Búsqueda y coincidencia aproximada (la usan el buscador de la app y la herramienta de IA)
// ---------------------------------------------------------------------------------------------

/** minúsculas, sin acentos ni signos, espacios simples. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Id estable para un ejercicio propio a partir de su nombre (`ex-remo-con-liga`). */
export function customExerciseId(name: string): string {
  return `ex-${normalizeText(name).replace(/ /g, '-').slice(0, 60) || 'ejercicio'}`;
}

const STOP = new Set(['de', 'con', 'en', 'el', 'la', 'los', 'las', 'al', 'a', 'y', 'del', 'para', 'por']);
const tokens = (s: string) =>
  normalizeText(s)
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Parecido entre dos nombres (0 a 1). */
export function nameSimilarity(query: string, name: string): number {
  const q = normalizeText(query);
  const n = normalizeText(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qt = tokens(q);
  const nt = tokens(n);
  if (!qt.length || !nt.length) return 0;
  // Cada palabra de la búsqueda contra la mejor palabra del nombre (tolera errores de dedo).
  let hit = 0;
  for (const t of qt) {
    let best = 0;
    for (const u of nt) {
      if (t === u) best = 1;
      else if (u.startsWith(t) || t.startsWith(u)) best = Math.max(best, Math.min(t.length, u.length) >= 3 ? 0.85 : 0.4);
      else {
        const d = levenshtein(t, u);
        const tol = Math.max(t.length, u.length) >= 6 ? 2 : 1;
        if (d <= tol) best = Math.max(best, 0.75);
      }
    }
    hit += best;
  }
  const recall = hit / qt.length;
  const precision = hit / nt.length;
  const contains = n.includes(q) ? 0.1 : 0;
  return Math.min(0.99, 0.7 * recall + 0.3 * Math.min(1, precision) + contains);
}

export interface ExerciseMatch {
  exercise: ExerciseDef;
  score: number;
}

/** Busca ejercicios por nombre o alias (biblioteca + propios), del más parecido al menos. */
export function searchExercises(query: string, custom: ExerciseDef[] = [], limit = 8): ExerciseMatch[] {
  const all = [...custom, ...EXERCISE_LIBRARY];
  const out: ExerciseMatch[] = [];
  for (const ex of all) {
    let score = nameSimilarity(query, ex.name);
    for (const a of ex.aliases ?? []) score = Math.max(score, nameSimilarity(query, a) - 0.02);
    if (score > 0) out.push({ exercise: ex, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** El ejercicio que mejor coincide con un nombre, si se parece lo suficiente. */
export function matchExercise(query: string, custom: ExerciseDef[] = [], threshold = 0.72): ExerciseMatch | null {
  const best = searchExercises(query, custom, 1)[0];
  return best && best.score >= threshold ? best : null;
}
