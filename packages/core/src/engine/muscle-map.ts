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

const sinA = Math.sin;
const cosA = Math.cos;

/** Grupo muscular en un punto de la superficie (o null: hueso, articulación, cuello, manos, pies). */
export function muscleRegionAt(part: BodyPart, v: number, angle: number, xn = 0): MuscleId | null {
  const s = sinA(angle);
  const c = cosA(angle);
  if (part === 'brazo') {
    if (v < 0) return null;
    if (v < 0.27) return s > 0.42 ? 'hombro_frontal' : s < -0.42 ? 'hombro_posterior' : 'hombro_lateral';
    if (v < 0.47) {
      // Bíceps al frente, tríceps atrás; el borde va un poco hacia afuera (el tríceps se ve de lado).
      if (s > 0.15 - 0.25 * Math.max(0, -c)) return 'biceps';
      if (s < -0.05) return 'triceps';
      return c > 0 ? 'triceps' : 'biceps';
    }
    if (v < 0.53) return null; // codo
    if (v < 0.93) return 'antebrazo';
    return null; // muñeca y mano
  }
  if (part === 'pierna') {
    const back = s < -0.12;
    const medial = c < -0.5;
    if (v > 0.545) return null;
    if (v > BODY_LANDMARKS.gluteFold) return back || (c > 0.55 && s < 0.2) ? 'gluteos' : medial ? 'aductores' : v > 0.525 ? null : 'cuadriceps';
    if (v > 0.315) {
      if (medial && v > 0.355) return 'aductores';
      if (back) return 'isquios';
      return 'cuadriceps';
    }
    if (v > 0.255) return null; // rodilla
    if (v > 0.105) return s < 0.25 || (medial && s < 0.6) ? 'pantorrillas' : null; // espinilla: hueso
    return null; // tobillo y pie
  }
  // Torso
  const L = BODY_LANDMARKS;
  const front = s > 0.2;
  const backSide = s < -0.2;
  if (v > L.neck - 0.004) return null; // cuello
  if (v < L.crotch) return null;
  if (v < 0.578) {
    // Pelvis: glúteos atrás; al frente, abdomen bajo y la cadera.
    if (backSide && xn > 0.06) return 'gluteos';
    if (front && xn < 0.32 && v > 0.555) return 'abdomen';
    return null;
  }
  if (front) {
    // Trapecio superior: la pendiente del cuello al hombro.
    if (v > 0.805 && xn > 0.24 && xn < 0.9) return 'trapecio';
    if (v > 0.802) return null; // clavículas
    // Borde inferior del pectoral: sube hacia la axila.
    if (v > 0.697 + 0.04 * xn * xn) return xn < 0.95 ? 'pecho' : 'espalda';
    // Recto abdominal: más ancho arriba (costillas) que abajo (pubis).
    if (xn < 0.25 + 0.12 * Math.min(1, (v - 0.575) / 0.12)) return 'abdomen';
    return v < 0.69 ? 'oblicuos' : 'espalda';
  }
  if (backSide) {
    // Trapecio: rombo de la nuca al centro de la espalda.
    const trapW = v > 0.79 ? 1 : v < 0.66 ? 0 : 0.12 + 0.75 * ((v - 0.66) / 0.13);
    if (v > 0.66 && xn < trapW) return 'trapecio';
    if (v > 0.645) return 'espalda';
    // Espalda baja: las dos columnas de los erectores; a los lados, el final del dorsal y los oblicuos.
    if (xn < 0.34) return 'lumbar';
    return xn > 0.8 ? 'oblicuos' : 'espalda';
  }
  // Costados
  if (v > 0.80) return 'trapecio';
  if (v > 0.69) return 'espalda';
  return 'oblicuos';
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
  return { tone: 'falta', strength: m.weekSets > 0 ? 1 : 0.8 };
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
