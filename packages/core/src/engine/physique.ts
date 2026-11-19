import { compareDates } from '../util/dates';

/**
 * Complexión: convierte tus medidas reales (peso, % de grasa, contornos) en la forma del cuerpo del
 * personaje 3D. Funciones puras: nada se guarda; cambiar una fórmula recalcula toda la evolución.
 *
 * Lo que mediste siempre gana. Lo que falta se estima con fórmulas antropométricas sencillas
 * (referencia: hombre adulto) para que la figura sea creíble desde el primer registro.
 */

/** Contornos en centímetros que se pueden registrar con una cinta. */
export const GIRTH_KEYS = ['neckCm', 'shouldersCm', 'chestCm', 'waistCm', 'hipsCm', 'armCm', 'forearmCm', 'thighCm', 'calfCm'] as const;
export type GirthKey = (typeof GIRTH_KEYS)[number];

/** Todo lo medible del cuerpo en un registro (`body.logged`). */
export const BODY_MEASURE_KEYS = ['weightKg', 'bodyFatPct', ...GIRTH_KEYS] as const;
export type BodyMeasureKey = (typeof BODY_MEASURE_KEYS)[number];
export type BodyMeasures = Partial<Record<BodyMeasureKey, number>>;

export const BODY_MEASURE_LABELS: Record<BodyMeasureKey, string> = {
  weightKg: 'Peso',
  bodyFatPct: 'Grasa corporal',
  neckCm: 'Cuello',
  shouldersCm: 'Hombros (contorno)',
  chestCm: 'Pecho',
  waistCm: 'Cintura',
  hipsCm: 'Cadera',
  armCm: 'Brazo',
  forearmCm: 'Antebrazo',
  thighCm: 'Muslo',
  calfCm: 'Pantorrilla',
};

export const BODY_MEASURE_UNITS: Record<BodyMeasureKey, string> = {
  weightKg: 'kg',
  bodyFatPct: '%',
  neckCm: 'cm',
  shouldersCm: 'cm',
  chestCm: 'cm',
  waistCm: 'cm',
  hipsCm: 'cm',
  armCm: 'cm',
  forearmCm: 'cm',
  thighCm: 'cm',
  calfCm: 'cm',
};

export const DEFAULT_HEIGHT_CM = 175;

export interface Girths {
  neck: number;
  shoulders: number;
  chest: number;
  waist: number;
  hips: number;
  arm: number;
  forearm: number;
  thigh: number;
  calf: number;
}

export interface Physique {
  heightCm: number;
  weightKg: number;
  /** Índice de masa corporal. */
  bmi: number;
  bodyFatPct: number;
  /** Masa magra en kg. */
  leanKg: number;
  /** Índice de masa magra (kg/m²): qué tan musculoso estás para tu estatura. */
  ffmi: number;
  /** 0 (muy definido) … 1 (mucha grasa). */
  fat: number;
  /** 0 (poca masa muscular) … 1 (muy musculoso). */
  muscle: number;
  /** Contornos en cm (medidos o estimados). */
  girths: Girths;
  /** Qué se tuvo que estimar por falta de registro. */
  estimated: { height: boolean; weight: boolean; bodyFat: boolean; girths: (keyof Girths)[] };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

const GIRTH_FIELD: Record<keyof Girths, GirthKey> = {
  neck: 'neckCm',
  shoulders: 'shouldersCm',
  chest: 'chestCm',
  waist: 'waistCm',
  hips: 'hipsCm',
  arm: 'armCm',
  forearm: 'forearmCm',
  thigh: 'thighCm',
  calf: 'calfCm',
};

/**
 * Contornos de referencia a 175 cm, 15 % de grasa e índice de masa magra 20, y cuánto cambia cada uno
 * por punto de grasa (`fat`) y por punto de masa magra (`lean`).
 */
const GIRTH_MODEL: Record<keyof Girths, { base: number; fat: number; lean: number }> = {
  neck: { base: 38, fat: 0.22, lean: 0.7 },
  shoulders: { base: 116, fat: 0.55, lean: 3.4 },
  chest: { base: 98, fat: 0.85, lean: 2.9 },
  waist: { base: 81, fat: 1.75, lean: 1.0 },
  hips: { base: 96, fat: 0.95, lean: 1.3 },
  arm: { base: 32.5, fat: 0.28, lean: 1.5 },
  forearm: { base: 27.5, fat: 0.1, lean: 0.9 },
  thigh: { base: 55, fat: 0.55, lean: 1.7 },
  calf: { base: 37, fat: 0.2, lean: 0.9 },
};

const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Calcula la complexión a partir de las medidas disponibles.
 * - Grasa: la registrada; si no, por cintura y estatura (masa grasa relativa); si no, por IMC y edad.
 * - Peso: el registrado; si no, el de un IMC de 24 para tu estatura.
 * - Contornos: los medidos; los demás se estiman con grasa y masa magra.
 */
export function physiqueFrom(m: BodyMeasures, opts: { heightCm?: number | null; age?: number | null } = {}): Physique {
  const hasHeight = valid(opts.heightCm);
  const heightCm = clamp(hasHeight ? (opts.heightCm as number) : DEFAULT_HEIGHT_CM, 120, 230);
  const h = heightCm / 100;
  const hasWeight = valid(m.weightKg);
  const weightKg = hasWeight ? (m.weightKg as number) : round1(24 * h * h);
  const bmi = weightKg / (h * h);

  let bodyFatPct: number;
  const hasFat = valid(m.bodyFatPct);
  if (hasFat) bodyFatPct = m.bodyFatPct as number;
  else if (valid(m.waistCm)) bodyFatPct = 64 - (20 * heightCm) / m.waistCm;
  else bodyFatPct = 1.2 * bmi + 0.23 * (opts.age ?? 30) - 16.2;
  bodyFatPct = clamp(bodyFatPct, 4, 55);

  const leanKg = weightKg * (1 - bodyFatPct / 100);
  const ffmi = leanKg / (h * h);
  const dFat = bodyFatPct - 15;
  const dLean = ffmi - 20;
  const scale = heightCm / 175;

  const girths = {} as Girths;
  const estimatedGirths: (keyof Girths)[] = [];
  for (const key of Object.keys(GIRTH_MODEL) as (keyof Girths)[]) {
    const measured = m[GIRTH_FIELD[key]];
    if (valid(measured)) girths[key] = measured;
    else {
      const g = GIRTH_MODEL[key];
      girths[key] = round1(Math.max(g.base * 0.6, scale * (g.base + g.fat * dFat + g.lean * dLean)));
      estimatedGirths.push(key);
    }
  }

  return {
    heightCm,
    weightKg,
    bmi: round1(bmi),
    bodyFatPct: round1(bodyFatPct),
    leanKg: round1(leanKg),
    ffmi: round1(ffmi),
    fat: clamp((bodyFatPct - 8) / 30, 0, 1),
    muscle: clamp((ffmi - 17) / 9, 0, 1),
    girths,
    estimated: { height: !hasHeight, weight: !hasWeight, bodyFat: !hasFat, girths: estimatedGirths },
  };
}

/** Mezcla dos complexiones (t = 0 → `a`, t = 1 → `b`). Sirve para animar la evolución. */
export function lerpPhysique(a: Physique, b: Physique, t: number): Physique {
  const k = clamp(t, 0, 1);
  const mix = (x: number, y: number) => x + (y - x) * k;
  const girths = {} as Girths;
  for (const key of Object.keys(a.girths) as (keyof Girths)[]) girths[key] = mix(a.girths[key], b.girths[key]);
  return {
    heightCm: mix(a.heightCm, b.heightCm),
    weightKg: mix(a.weightKg, b.weightKg),
    bmi: mix(a.bmi, b.bmi),
    bodyFatPct: mix(a.bodyFatPct, b.bodyFatPct),
    leanKg: mix(a.leanKg, b.leanKg),
    ffmi: mix(a.ffmi, b.ffmi),
    fat: mix(a.fat, b.fat),
    muscle: mix(a.muscle, b.muscle),
    girths,
    estimated: k < 0.5 ? a.estimated : b.estimated,
  };
}

/** Último valor conocido de cada medida hasta una fecha (inclusive). Las entradas van en orden cronológico. */
export function measuresAsOf(entries: readonly (BodyMeasures & { date: string })[], date: string): BodyMeasures {
  const out: BodyMeasures = {};
  for (const e of entries) {
    if (compareDates(e.date, date) > 0) continue;
    for (const k of BODY_MEASURE_KEYS) if (valid(e[k])) out[k] = e[k];
  }
  return out;
}

/** Fechas (sin repetir, en orden) en las que cambió alguna medida: los puntos de la línea de tiempo. */
export function measureDates(entries: readonly (BodyMeasures & { date: string })[]): string[] {
  const dates = new Set<string>();
  const last: BodyMeasures = {};
  for (const e of [...entries].sort((a, b) => compareDates(a.date, b.date)))
    for (const k of BODY_MEASURE_KEYS) {
      const v = e[k];
      if (valid(v) && v !== last[k]) {
        last[k] = v;
        dates.add(e.date);
      }
    }
  return [...dates].sort(compareDates);
}

/** Primer valor registrado de cada medida (el punto de partida para ver cuánto ha cambiado). */
export function firstMeasures(entries: readonly (BodyMeasures & { date: string })[]): BodyMeasures {
  const out: BodyMeasures = {};
  for (const e of [...entries].sort((a, b) => compareDates(a.date, b.date)))
    for (const k of BODY_MEASURE_KEYS) if (valid(e[k]) && out[k] === undefined) out[k] = e[k];
  return out;
}

const estimateOf = (p: Physique, k: Exclude<BodyMeasureKey, 'weightKg'>): number => {
  if (k === 'bodyFatPct') return p.bodyFatPct;
  const girth = (Object.keys(GIRTH_FIELD) as (keyof Girths)[]).find((g) => GIRTH_FIELD[g] === k)!;
  return p.girths[girth];
};

/**
 * Complexión a una fecha, a partir de los registros. Cada medida usa su último valor conocido, pero si
 * el peso se volvió a registrar DESPUÉS de una medida (lo normal: te pesas seguido y la cinta la usas de
 * vez en cuando), esa medida vieja no se toma como actual: se proyecta con el cambio de peso, conservando
 * tu diferencia personal contra la estimación (medido − estimado de entonces + estimado de hoy), y se
 * marca como estimada. Así un peso nuevo nunca deja la cintura o la grasa de hace meses como si fueran de hoy.
 */
export function physiqueAsOf(entries: readonly (BodyMeasures & { date: string })[], date: string, opts: { heightCm?: number | null; age?: number | null } = {}): Physique {
  const sorted = [...entries].filter((e) => compareDates(e.date, date) <= 0).sort((a, b) => compareDates(a.date, b.date));
  const last: Partial<Record<BodyMeasureKey, { value: number; date: string }>> = {};
  for (const e of sorted) for (const k of BODY_MEASURE_KEYS) if (valid(e[k])) last[k] = { value: e[k] as number, date: e.date };
  const raw: BodyMeasures = {};
  for (const k of BODY_MEASURE_KEYS) if (last[k]) raw[k] = last[k]!.value;
  const weight = last.weightKg;
  if (!weight) return physiqueFrom(raw, opts);

  const weightOn = (d: string): number | undefined => {
    let w: number | undefined;
    for (const e of sorted) if (compareDates(e.date, d) <= 0 && valid(e.weightKg)) w = e.weightKg;
    return w;
  };
  const nowEstimate = physiqueFrom({ weightKg: weight.value }, opts);
  const adjusted: BodyMeasures = { weightKg: weight.value };
  const projected: Exclude<BodyMeasureKey, 'weightKg'>[] = [];
  for (const k of BODY_MEASURE_KEYS) {
    if (k === 'weightKg') continue;
    const m = last[k];
    if (!m) continue;
    const weightThen = weightOn(m.date);
    if (compareDates(m.date, weight.date) >= 0 || weightThen === undefined || weightThen === weight.value) {
      adjusted[k] = m.value;
      continue;
    }
    const thenEstimate = physiqueFrom({ weightKg: weightThen }, opts);
    const value = estimateOf(nowEstimate, k) + (m.value - estimateOf(thenEstimate, k));
    adjusted[k] = k === 'bodyFatPct' ? clamp(value, 4, 55) : Math.max(estimateOf(nowEstimate, k) * 0.6, value);
    projected.push(k);
  }
  const p = physiqueFrom(adjusted, opts);
  if (projected.includes('bodyFatPct')) p.estimated.bodyFat = true;
  for (const g of Object.keys(GIRTH_FIELD) as (keyof Girths)[]) {
    if (projected.includes(GIRTH_FIELD[g]) && !p.estimated.girths.includes(g)) p.estimated.girths.push(g);
    if (projected.includes(GIRTH_FIELD[g])) p.girths[g] = round1(p.girths[g]);
  }
  return p;
}

/** Resumen corto de las medidas de un registro: "78 kg · 17 % grasa · Cintura 88 cm". */
export function describeMeasures(m: BodyMeasures): string {
  const parts: string[] = [];
  if (valid(m.weightKg)) parts.push(`${m.weightKg} kg`);
  if (valid(m.bodyFatPct)) parts.push(`${m.bodyFatPct} % grasa`);
  for (const k of GIRTH_KEYS) if (valid(m[k])) parts.push(`${BODY_MEASURE_LABELS[k]} ${m[k]} cm`);
  return parts.join(' · ');
}
