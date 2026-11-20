import { addDays, compareDates } from '../util/dates';
import { BODY_MEASURE_LABELS, GIRTH_KEYS, physiqueAsOf, type BodyMeasureKey, type BodyMeasures, type Girths, type GirthKey, type Physique } from './physique';

/**
 * "Antes / ahora": comparar tu cuerpo entre dos fechas. Funciones puras; nada se guarda.
 *
 * Regla: la forma sale de tus medidas reales. Una diferencia es EXACTA solo si la medida está medida en las
 * dos fechas (no proyectada con el peso ni estimada por fórmula). Si en alguna de las dos está estimada, la
 * diferencia se marca como estimada (≈). Una medida que nunca has tomado no se compara (sería la fórmula
 * comparándose consigo misma).
 */

export type CompareKey = BodyMeasureKey | 'leanKg';

export interface MeasureDelta {
  key: CompareKey;
  label: string;
  unit: string;
  from: number;
  to: number;
  /** `to − from`, redondeado a una décima. */
  delta: number;
  /** true si en alguna de las dos fechas el valor es estimado (se muestra con ≈). */
  estimated: boolean;
}

const GIRTH_OF: Record<GirthKey, keyof Girths> = {
  neckCm: 'neck',
  shouldersCm: 'shoulders',
  chestCm: 'chest',
  waistCm: 'waist',
  hipsCm: 'hips',
  armCm: 'arm',
  forearmCm: 'forearm',
  thighCm: 'thigh',
  calfCm: 'calf',
};

/** Etiquetas cortas para las diferencias ("Brazo +1.5 cm"). */
const SHORT_LABEL: Record<CompareKey, string> = {
  ...BODY_MEASURE_LABELS,
  shouldersCm: 'Hombros',
  bodyFatPct: 'Grasa',
  leanKg: 'Magra',
};

const UNIT: Record<CompareKey, string> = {
  weightKg: 'kg',
  bodyFatPct: '%',
  leanKg: 'kg',
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

/** Orden en que se muestran: peso y composición, luego de arriba hacia abajo. */
export const COMPARE_ORDER: CompareKey[] = ['weightKg', 'bodyFatPct', 'leanKg', 'neckCm', 'shouldersCm', 'chestCm', 'armCm', 'forearmCm', 'waistCm', 'hipsCm', 'thighCm', 'calfCm'];

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Valor de una medida en una complexión. */
export function physiqueValue(p: Physique, key: CompareKey): number {
  if (key === 'weightKg') return p.weightKg;
  if (key === 'bodyFatPct') return p.bodyFatPct;
  if (key === 'leanKg') return p.leanKg;
  return p.girths[GIRTH_OF[key]];
}

/** ¿Ese valor salió de una medida real (no proyectada ni estimada)? */
export function isMeasured(p: Physique, key: CompareKey): boolean {
  if (key === 'weightKg') return !p.estimated.weight;
  if (key === 'bodyFatPct') return !p.estimated.bodyFat;
  if (key === 'leanKg') return !p.estimated.weight && !p.estimated.bodyFat;
  return !p.estimated.girths.includes(GIRTH_OF[key]);
}

/** Medidas que tienen al menos un registro hasta `date` (inclusive). */
export function everMeasured(entries: readonly (BodyMeasures & { date: string })[], date: string): Set<CompareKey> {
  const out = new Set<CompareKey>();
  for (const e of entries) {
    if (compareDates(e.date, date) > 0) continue;
    for (const k of ['weightKg', 'bodyFatPct', ...GIRTH_KEYS] as const) {
      const v = e[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out.add(k);
    }
  }
  if (out.has('weightKg') && out.has('bodyFatPct')) out.add('leanKg');
  return out;
}

/**
 * Diferencias entre dos complexiones. Solo entran las medidas que alguna vez registraste (`measured`) y que
 * cambiaron al menos una décima. Marca como estimada la que no esté medida en las dos.
 */
export function physiqueDeltas(before: Physique, after: Physique, measured: ReadonlySet<CompareKey>): MeasureDelta[] {
  const out: MeasureDelta[] = [];
  for (const key of COMPARE_ORDER) {
    if (!measured.has(key)) continue;
    const from = round1(physiqueValue(before, key));
    const to = round1(physiqueValue(after, key));
    const delta = round1(to - from);
    if (Math.abs(delta) < 0.1) continue;
    out.push({ key, label: SHORT_LABEL[key], unit: UNIT[key], from, to, delta, estimated: !(isMeasured(before, key) && isMeasured(after, key)) });
  }
  return out;
}

/** "Brazo +1.5 cm", "≈ Cintura −3 cm", "Grasa −2.1 %". */
export function formatDelta(d: Pick<MeasureDelta, 'label' | 'unit' | 'delta' | 'estimated'>): string {
  const sign = d.delta > 0 ? '+' : d.delta < 0 ? '−' : '±';
  return `${d.estimated ? '≈ ' : ''}${d.label} ${sign}${round1(Math.abs(d.delta))} ${d.unit}`;
}

export interface BodyComparison {
  from: string;
  to: string;
  before: Physique;
  after: Physique;
  deltas: MeasureDelta[];
}

/** Compara tu cuerpo entre dos fechas con la misma regla que la línea de tiempo (`physiqueAsOf`). */
export function compareBodies(
  entries: readonly (BodyMeasures & { date: string })[],
  from: string,
  to: string,
  opts: { heightCm?: number | null; age?: number | null } = {},
): BodyComparison {
  const [a, b] = compareDates(from, to) <= 0 ? [from, to] : [to, from];
  const before = physiqueAsOf(entries, a, opts);
  const after = physiqueAsOf(entries, b, opts);
  return { from: a, to: b, before, after, deltas: physiqueDeltas(before, after, everMeasured(entries, b)) };
}

export type CompareChoiceId = 'inicio' | 'anio' | 'seis' | 'tres' | 'mes';

export interface CompareChoice {
  id: CompareChoiceId;
  label: string;
  /** Fecha de registro que se usa como "antes". */
  date: string;
}

const BACK: { id: Exclude<CompareChoiceId, 'inicio'>; label: string; days: number }[] = [
  { id: 'anio', label: 'Hace 1 año', days: 365 },
  { id: 'seis', label: 'Hace 6 meses', days: 182 },
  { id: 'tres', label: 'Hace 3 meses', days: 91 },
  { id: 'mes', label: 'Hace 1 mes', days: 30 },
];

/**
 * Opciones de "antes" para comparar contra hoy, a partir de las fechas en que cambió alguna medida
 * (`measureDates`, en orden). Cada opción usa el último registro que había en esa fecha; se quitan las que
 * caen en el mismo registro y las que caen en el último (sería compararte contra ti mismo). Van de la más
 * antigua a la más reciente; la primera ("Primer registro") es la opción por omisión.
 */
export function compareChoices(dates: readonly string[], today: string): CompareChoice[] {
  const sorted = [...dates].filter((d) => compareDates(d, today) <= 0).sort(compareDates);
  if (sorted.length < 2) return [];
  const latest = sorted[sorted.length - 1]!;
  const out: CompareChoice[] = [{ id: 'inicio', label: 'Primer registro', date: sorted[0]! }];
  for (const b of BACK) {
    const target = addDays(today, -b.days);
    let pick: string | undefined;
    for (const d of sorted) if (compareDates(d, target) <= 0) pick = d;
    if (!pick || pick === latest || out.some((c) => c.date === pick)) continue;
    out.push({ id: b.id, label: b.label, date: pick });
  }
  return out;
}
