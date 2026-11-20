import { GAME_CONFIG, type GameConfigInput } from '../config/game';
import type { MuscleId } from '../types';
import { MUSCLES } from '../training/library';
import type { MuscleStatus } from './training';

/**
 * Músculos sobre el cuerpo 3D: en qué zona del cuerpo vive cada grupo muscular y de qué color se pinta según
 * su estado (`muscleStatus` y los números de `config.training`). Funciones puras: el personaje 3D solo las
 * pregunta vértice por vértice.
 *
 * Coordenadas de cada parte (las mismas que usa la figura, que mira hacia +Z):
 *  - `torso` y `pierna`: `v` = altura como fracción de la estatura (0 = piso, 1 = coronilla).
 *  - `brazo`: `v` = 0 en lo alto del hombro, 0.5 en el codo y 1 en la muñeca.
 *  - `angle`: ángulo alrededor de la parte, en radianes: 0 = hacia afuera (lado), π/2 = al frente,
 *    −π/2 = atrás, π = hacia adentro (hacia la línea media, en brazos y piernas).
 *  - `xn` (solo torso): distancia a la línea media como fracción del medio ancho del torso a esa altura (0–1).
 */

export type BodyPart = 'torso' | 'brazo' | 'pierna';

/** Alturas de referencia (fracción de la estatura) de la figura. */
export const BODY_LANDMARKS = {
  /** Entrepierna. */
  crotch: 0.47,
  /** Pliegue del glúteo. */
  gluteFold: 0.5,
  /** Cintura (ombligo). */
  waist: 0.606,
  /** Línea de los hombros. */
  shoulder: 0.784,
  /** Base del cuello. */
  neck: 0.846,
  /** Rodilla. */
  knee: 0.287,
} as const;

/**
 * Forma de un músculo: superelipse (girada) en coordenadas de la parte. `d` = 1 en el centro, 0 en el borde
 * (negativo afuera). Entre músculos queda piel sin pintar, como en una lámina de anatomía.
 */
interface Shape {
  id: MuscleId;
  /** Centro y semiejes en coordenadas de la parte (ver `coords`). */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Giro en radianes (positivo = el eje x sube). */
  rot?: number;
  /** Exponente (2 = elipse, más = más cuadrado). */
  p?: number;
  /** Semieje de abajo distinto (forma de gota o rombo). */
  ryLow?: number;
  /** Afinar hacia abajo: el ancho baja este tanto en la punta inferior (0–1). */
  taper?: number;
}

const TAU = Math.PI * 2;
/** Diferencia de ángulos en (−π, π]. */
const angDiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
};

function shapeD(sh: Shape, x: number, y: number): number {
  let dx = x - sh.cx;
  let dy = y - sh.cy;
  if (sh.rot) {
    const c = Math.cos(sh.rot);
    const s = Math.sin(sh.rot);
    [dx, dy] = [dx * c + dy * s, -dx * s + dy * c];
  }
  const ry = dy < 0 && sh.ryLow ? sh.ryLow : sh.ry;
  const t = dy < 0 ? Math.min(1, -dy / ry) : 0;
  const rx = sh.rx * (1 - (sh.taper ?? 0) * t);
  const p = sh.p ?? 2;
  const r = (Math.abs(dx / rx) ** p + Math.abs(dy / ry) ** p) ** (1 / p);
  return 1 - r;
}

// Torso: x = distancia a la línea media (xn, 0–1), y = altura × 10 (≈ la misma escala que x).
const TORSO_FRONT: Shape[] = [
  // Pectoral: abanico redondo del esternón a la axila, el borde de afuera más alto.
  { id: 'pecho', cx: 0.5, cy: 7.46, rx: 0.46, ry: 0.46, rot: 0.32, p: 2.3 },
  // Recto abdominal: columna redondeada, más ancha arriba.
  { id: 'abdomen', cx: 0, cy: 6.36, rx: 0.28, ry: 0.7, p: 2.8, ryLow: 0.7, taper: 0.25 },
  // Oblicuos: a los lados del abdomen, inclinados hacia la cadera.
  { id: 'oblicuos', cx: 0.72, cy: 6.32, rx: 0.25, ry: 0.56, rot: -0.35, p: 2.2 },
  // Trapecio superior: la pendiente del cuello al hombro.
  { id: 'trapecio', cx: 0.45, cy: 8.24, rx: 0.36, ry: 0.15, rot: -0.3 },
];
const TORSO_BACK: Shape[] = [
  // Trapecio: rombo de la nuca a media espalda.
  { id: 'trapecio', cx: 0, cy: 7.92, rx: 0.6, ry: 0.5, ryLow: 1.18, p: 1.35, taper: 0.1 },
  // Dorsales: alas en V de la axila a la cintura.
  { id: 'espalda', cx: 0.64, cy: 7.05, rx: 0.72, ry: 0.27, rot: 1.0, p: 2.2 },
  // Espalda baja: las dos columnas de los erectores.
  { id: 'lumbar', cx: 0.17, cy: 6.12, rx: 0.15, ry: 0.52, p: 2.4 },
  { id: 'oblicuos', cx: 0.86, cy: 6.2, rx: 0.14, ry: 0.36, p: 2.2 },
  // Glúteos.
  { id: 'gluteos', cx: 0.47, cy: 5.25, rx: 0.42, ry: 0.4, p: 2.2 },
];

// Pierna: x = ángulo × 0.33 (desde el centro de la forma), y = altura × 10.
const LEG: (Shape & { a: number })[] = [
  // Cuádriceps: gota al frente del muslo, más ancha arriba, y el vasto interno abultado sobre la rodilla.
  { id: 'cuadriceps', a: Math.PI / 2 - 0.1, cx: 0, cy: 4.15, rx: 0.42, ry: 1.05, ryLow: 1.0, taper: 0.45, p: 2.2 },
  { id: 'cuadriceps', a: Math.PI / 2 + 0.6, cx: 0, cy: 3.4, rx: 0.15, ry: 0.28 },
  // Aductores: cara interna del muslo, arriba.
  { id: 'aductores', a: Math.PI, cx: 0, cy: 4.55, rx: 0.24, ry: 0.68, ryLow: 0.8, taper: 0.5 },
  // Isquiotibiales: atrás del muslo.
  { id: 'isquios', a: -Math.PI / 2, cx: 0, cy: 4.0, rx: 0.38, ry: 0.9, ryLow: 0.95, taper: 0.4, p: 2.2 },
  // Glúteo (la parte que baja a la pierna).
  { id: 'gluteos', a: -Math.PI / 2 + 0.3, cx: 0, cy: 5.25, rx: 0.42, ry: 0.4 },
  // Pantorrilla: los dos gemelos atrás de la espinilla.
  { id: 'pantorrillas', a: -Math.PI / 2 - 0.6, cx: 0, cy: 2.12, rx: 0.38, ry: 0.5, ryLow: 0.62, taper: 0.4 },
  { id: 'pantorrillas', a: -Math.PI / 2 + 0.4, cx: 0, cy: 2.18, rx: 0.22, ry: 0.45, ryLow: 0.55, taper: 0.4 },
];

// Brazo: x = ángulo (desde el centro de la forma), y = largo × 13 hacia abajo (aquí "abajo" = hacia la muñeca).
const ARM: (Shape & { a: number })[] = [
  // Deltoides: tres cabezas que bajan en punta hacia la mitad del brazo.
  { id: 'hombro_frontal', a: Math.PI / 2 - 0.15, cx: 0, cy: 1.55, rx: 0.8, ry: 1.2, ryLow: 1.8, taper: 0.7 },
  { id: 'hombro_lateral', a: 0, cx: 0, cy: 1.45, rx: 0.85, ry: 1.2, ryLow: 1.9, taper: 0.7 },
  { id: 'hombro_posterior', a: -Math.PI / 2 + 0.15, cx: 0, cy: 1.55, rx: 0.8, ry: 1.2, ryLow: 1.8, taper: 0.7 },
  // Bíceps solo al frente; tríceps solo atrás.
  { id: 'biceps', a: Math.PI / 2 + 0.15, cx: 0, cy: 4.6, rx: 0.85, ry: 1.5, taper: 0.35 },
  { id: 'triceps', a: -Math.PI / 2 - 0.1, cx: 0, cy: 4.35, rx: 1.0, ry: 1.75, taper: 0.4 },
  // Antebrazo: flexores (cara interna) y extensores (cara externa), gruesos arriba y finos hacia la muñeca.
  { id: 'antebrazo', a: Math.PI / 2 + 0.55, cx: 0, cy: 8.2, rx: 0.95, ry: 1.05, ryLow: 2.3, taper: 0.6 },
  { id: 'antebrazo', a: -0.35, cx: 0, cy: 8.2, rx: 0.95, ry: 1.05, ryLow: 2.3, taper: 0.6 },
];

/** El brazo se mide hacia abajo: se voltea para que `ryLow`/`taper` apunten a la muñeca. */
const ARM_UP = ARM.map((sh) => ({ ...sh, cy: -sh.cy }));

/** Qué tanto de cada músculo hay en un punto: el principal (`d` 0–1, 1 = centro) y el vecino más cercano. */
export interface MuscleField {
  id: MuscleId | null;
  /** 0 en el borde, 1 en el centro (≤ 0 = piel entre músculos). */
  d: number;
  /** Segundo músculo más cercano (para marcar el surco entre los dos). */
  id2: MuscleId | null;
  d2: number;
}

/** Campo muscular en un punto de la superficie (ver coordenadas arriba). */
export function muscleFieldAt(part: BodyPart, v: number, angle: number, xn = 0): MuscleField {
  const best: MuscleField = { id: null, d: -1, id2: null, d2: -1 };
  const take = (id: MuscleId, d: number) => {
    if (d > best.d) {
      if (best.id !== id) {
        best.id2 = best.id;
        best.d2 = best.d;
      }
      best.id = id;
      best.d = d;
    } else if (id !== best.id && d > best.d2) {
      best.id2 = id;
      best.d2 = d;
    }
  };
  const s = Math.sin(angle);
  if (part === 'torso') {
    if (v > BODY_LANDMARKS.neck || v < BODY_LANDMARKS.crotch) return best;
    const y = v * 10;
    // Al frente y atrás; en los costados se prueban los dos (los dorsales y oblicuos dan la vuelta).
    const fade = (k: number) => Math.min(1, Math.max(0, k));
    if (s > -0.25) for (const sh of TORSO_FRONT) take(sh.id, shapeD(sh, xn, y) - 0.6 * fade(-s * 4));
    if (s < 0.25) for (const sh of TORSO_BACK) take(sh.id, shapeD(sh, xn, y) - 0.6 * fade(s * 4));
    return best;
  }
  if (part === 'pierna') {
    const y = v * 10;
    for (const sh of LEG) take(sh.id, shapeD(sh, angDiff(angle, sh.a) * 0.33, y));
    return best;
  }
  const y = -v * 13;
  for (const sh of ARM_UP) take(sh.id, shapeD(sh, angDiff(angle, sh.a), y));
  return best;
}

/** Grupo muscular en un punto de la superficie (o null: piel entre músculos, cuello, articulaciones, manos). */
export function muscleRegionAt(part: BodyPart, v: number, angle: number, xn = 0): MuscleId | null {
  const f = muscleFieldAt(part, v, angle, xn);
  return f.d > 0 ? f.id : null;
}

// ---------------------------------------------------------------------------------------------
// Estado → color
// ---------------------------------------------------------------------------------------------

/** Qué se pinta: estado combinado (lo que necesitas saber hoy), solo volumen o solo recuperación. */
export type MusclePaintMode = 'estado' | 'volumen' | 'recuperacion';

export type MuscleTone =
  // estado
  | 'falta'
  | 'efectivo'
  | 'meta'
  | 'recuperando'
  // volumen
  | 'v1'
  | 'v2'
  | 'v3'
  | 'v4'
  // recuperación
  | 'listo'
  | 'olvidado';

export interface MusclePaint {
  /** null = sin pintar (color base del cuerpo). */
  tone: MuscleTone | null;
  /** Intensidad del tinte (0–1). En recuperación, más fuerte entre más reciente. */
  strength: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Color de un músculo:
 *  - `estado`: recuperando (dentro de sus 48/72 h) > en la meta (≥ objetivo semanal) > trabajado (≥ mínimo
 *    efectivo) > te falta (bajo el mínimo, como "Te falta esta semana").
 *  - `volumen`: nivel 1–4 de `volumeLevel` (0 = sin pintar).
 *  - `recuperacion`: recuperando (por fatiga) · listo · olvidado (con registro; nunca entrenado = sin pintar).
 */
export function musclePaint(m: MuscleStatus, mode: MusclePaintMode): MusclePaint {
  if (mode === 'volumen') return m.volumeLevel ? { tone: `v${m.volumeLevel}` as MuscleTone, strength: 1 } : { tone: null, strength: 0 };
  if (m.state === 'recuperando') return { tone: 'recuperando', strength: r2(0.45 + 0.55 * m.fatigue) };
  if (mode === 'recuperacion') {
    if (m.state === 'listo') return { tone: 'listo', strength: 1 };
    return m.lastDate ? { tone: 'olvidado', strength: 1 } : { tone: null, strength: 0 };
  }
  if (m.weekSets >= m.target.target) return { tone: 'meta', strength: 1 };
  if (m.weekSets >= m.target.min) return { tone: 'efectivo', strength: 1 };
  // Lo que no has trabajado va más tenue: llama la atención sin gritar.
  return { tone: 'falta', strength: m.weekSets > 0 ? 0.75 : 0.55 };
}

export interface MuscleLegendItem {
  tone: MuscleTone | null;
  label: string;
}

/** Leyenda de cada modo, con los números de la config (músculos principales; los accesorios piden menos). */
export function muscleLegend(mode: MusclePaintMode, cfg: GameConfigInput = GAME_CONFIG as GameConfigInput): MuscleLegendItem[] {
  const t = cfg.training;
  const w = t.weeklySets;
  if (mode === 'volumen')
    return [
      { tone: null, label: '0 series' },
      { tone: 'v1', label: `Menos de ${w.min}` },
      { tone: 'v2', label: `${w.min}–${w.target - 1}` },
      { tone: 'v3', label: `${w.target}–${w.max}` },
      { tone: 'v4', label: `Más de ${w.max}` },
    ];
  if (mode === 'recuperacion')
    return [
      { tone: 'recuperando', label: `Recuperando (${t.recoveryHours.chico} h chicos · ${t.recoveryHours.grande} h grandes)` },
      { tone: 'listo', label: 'Listo' },
      { tone: 'olvidado', label: `Sin trabajar ${t.forgottenDays}+ días` },
    ];
  return [
    { tone: 'falta', label: `Te falta (menos de ${w.min} series)` },
    { tone: 'efectivo', label: `Trabajado (${w.min}–${w.target - 1})` },
    { tone: 'meta', label: `En la meta (${w.target}+)` },
    { tone: 'recuperando', label: `Recuperando (${t.recoveryHours.chico}/${t.recoveryHours.grande} h)` },
  ];
}

const fmt1 = (n: number) => String(Math.round(n * 10) / 10);
const hoursText = (h: number) => (h < 24 ? `${h} h` : `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`);

/** Texto del músculo seleccionado: estado, series de la semana contra la meta y horas desde que lo entrenaste. */
export function muscleDetail(m: MuscleStatus, cfg: GameConfigInput = GAME_CONFIG as GameConfigInput): { title: string; status: string; lines: string[] } {
  const info = MUSCLES[m.id];
  const recovery = cfg.training.recoveryHours[info.size];
  const status =
    m.state === 'recuperando'
      ? `Recuperando · listo en ${hoursText(m.hoursToReady)}`
      : m.weekSets >= m.target.target
        ? 'En la meta de la semana'
        : m.weekSets >= m.target.min
          ? 'Trabajado: ya pasó el mínimo'
          : m.weekSets > 0
            ? 'Te falta: bajo el mínimo'
            : 'Te falta: sin series esta semana';
  const lines = [
    `${fmt1(m.weekSets)} de ${m.target.target} series esta semana (mínimo ${m.target.min}${m.accessory ? ', accesorio' : ''})`,
    m.hoursSince === null ? 'Sin entrenamientos registrados' : m.hoursSince < 48 ? `Entrenado hace ${m.hoursSince} h` : m.hoursSince < 72 ? `Entrenado hace ${hoursText(m.hoursSince)}` : `Entrenado hace ${m.daysSince ?? Math.floor(m.hoursSince / 24)} días`,
    `Recupera en ${recovery} h (${info.size === 'grande' ? 'músculo grande' : 'músculo chico'})`,
  ];
  return { title: info.name, status, lines };
}
