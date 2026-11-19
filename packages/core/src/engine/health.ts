import type { CheckupCategory, HealthMetricKind, MissionSize } from '../types';
import { ageOn, diffDays, isDateString } from '../util/dates';

/**
 * Salud: guía estática y cálculos puros (sin red ni DOM). El reductor está en `modules/health.ts`.
 * Las recomendaciones son orientación general para un hombre adulto, basadas en guías públicas
 * (USPSTF, ADA, AHA/ACC, esquema de vacunación del adulto). No sustituyen a un médico.
 */

export const HEALTH_DISCLAIMER = 'Orientación general; no sustituye a tu médico.';

// ---------------------------------------------------------------------------------------------
// Chequeos recomendados
// ---------------------------------------------------------------------------------------------

export interface HealthSuggestion {
  id: string;
  name: string;
  category: CheckupCategory;
  /** Cada cuántos meses (0 = una sola vez). */
  everyMonths: number;
  size: MissionSize;
  /** Por qué y cada cuánto, en una línea. */
  why: string;
  /** Edad desde la que aplica (si no hay, aplica a cualquier adulto). */
  fromAge?: number;
  /** Edad hasta la que aplica. */
  toAge?: number;
}

export const HEALTH_SUGGESTIONS: readonly HealthSuggestion[] = [
  {
    id: 'dental',
    name: 'Limpieza dental',
    category: 'dental',
    everyMonths: 6,
    size: 'media',
    why: 'Quita el sarro y detecta caries o encías inflamadas a tiempo. Cada 6 meses.',
  },
  {
    id: 'laboratorios',
    name: 'Chequeo general con laboratorios',
    category: 'estudios',
    everyMonths: 12,
    size: 'media',
    why: 'Química sanguínea (glucosa), perfil de lípidos, biometría hemática y examen de orina, y una consulta para revisarlos. Cada año.',
  },
  {
    id: 'presion',
    name: 'Toma de presión arterial',
    category: 'consulta',
    everyMonths: 12,
    size: 'chica',
    why: 'La presión alta no da síntomas. Al menos una vez al año, en consultorio o farmacia.',
  },
  {
    id: 'vista',
    name: 'Examen de la vista',
    category: 'vista',
    everyMonths: 24,
    size: 'media',
    why: 'Graduación y presión del ojo. Cada 1 o 2 años; cada año si usas lentes.',
  },
  {
    id: 'piel',
    name: 'Revisión de lunares y piel',
    category: 'piel',
    everyMonths: 12,
    size: 'media',
    why: 'Con dermatólogo, sobre todo si te da mucho el sol o tienes muchos lunares. Cada año.',
  },
  {
    id: 'influenza',
    name: 'Vacuna contra la influenza',
    category: 'vacuna',
    everyMonths: 12,
    size: 'chica',
    why: 'Cada año, de preferencia en octubre o noviembre.',
  },
  {
    id: 'td',
    name: 'Refuerzo de tétanos y difteria (Td)',
    category: 'vacuna',
    everyMonths: 120,
    size: 'chica',
    why: 'Un refuerzo cada 10 años.',
  },
  {
    id: 'prostata',
    name: 'Consulta de próstata (antígeno prostático)',
    category: 'consulta',
    everyMonths: 24,
    size: 'media',
    fromAge: 45,
    why: 'Desde los 45–50 (antes si hay antecedentes en tu familia): platica con tu médico si te conviene el antígeno y cada cuánto.',
  },
  {
    id: 'colorrectal',
    name: 'Detección de cáncer colorrectal',
    category: 'estudios',
    everyMonths: 12,
    size: 'media',
    fromAge: 45,
    toAge: 75,
    why: 'Desde los 45: sangre oculta en heces cada año o colonoscopía cada 10 años, según te indique tu médico.',
  },
];

export interface HealthSuggestionFit extends HealthSuggestion {
  /** true = aplica a tu edad · false = todavía no (o ya no) · null = sin fecha de nacimiento para saberlo. */
  applies: boolean | null;
  /** Recomendada para activar con un toque ("Activar las recomendadas"). */
  recommended: boolean;
  /** "Desde los 45", "45–75 años"… (vacío si aplica a cualquier adulto). */
  ageText: string;
}

/** Recomendaciones según la edad (si hay fecha de nacimiento); sin ella, las de edad quedan como "desde los N". */
export function healthSuggestionsFor(birthDate: string | null | undefined, today: string): HealthSuggestionFit[] {
  const age = birthDate && isDateString(birthDate) && birthDate <= today ? ageOn(birthDate, today).years : null;
  return HEALTH_SUGGESTIONS.map((s) => {
    const ranged = s.fromAge !== undefined || s.toAge !== undefined;
    const applies = !ranged ? true : age === null ? null : age >= (s.fromAge ?? 0) && age <= (s.toAge ?? 200);
    const ageText = !ranged ? '' : s.toAge !== undefined ? `${s.fromAge ?? 18}–${s.toAge} años` : `Desde los ${s.fromAge}`;
    return { ...s, applies, recommended: applies === true, ageText };
  });
}

/** Id fijo del chequeo que se crea al activar una recomendación (activarla dos veces no duplica). */
export function suggestionCheckupId(suggestionId: string): string {
  return `chk-${suggestionId}`;
}

// ---------------------------------------------------------------------------------------------
// Fechas y estado de un chequeo
// ---------------------------------------------------------------------------------------------

/** Suma meses a una fecha; si el día no existe en el mes destino, usa el último (31 ene + 1 = 28/29 feb). */
export function addMonthsClamped(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + Math.trunc(months);
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export const CHECKUP_STATUSES = ['atrasado', 'pronto', 'sin_registro', 'al_dia'] as const;
export type CheckupStatus = (typeof CHECKUP_STATUSES)[number];
export const CHECKUP_STATUS_NAMES: Record<CheckupStatus, string> = {
  al_dia: 'Al día',
  pronto: 'Te toca pronto',
  atrasado: 'Atrasado',
  sin_registro: 'Sin registro',
};

export interface CheckupTiming {
  /** Fecha en que vuelve a tocar (null = sin registro o de una sola vez y ya hecho). */
  nextDue: string | null;
  /** Días que faltan (negativo = atrasado). */
  daysLeft: number | null;
  status: CheckupStatus;
  /** Fracción del intervalo ya transcurrida (0 = recién hecho, 1 = ya toca). */
  elapsed: number | null;
}

/** Al día / te toca pronto (≤ soonDays, incluye hoy) / atrasado / sin registro. */
export function checkupTiming(lastDone: string | null, everyMonths: number, today: string, soonDays: number): CheckupTiming {
  if (!lastDone) return { nextDue: null, daysLeft: null, status: 'sin_registro', elapsed: null };
  if (!(everyMonths > 0)) return { nextDue: null, daysLeft: null, status: 'al_dia', elapsed: null };
  const nextDue = addMonthsClamped(lastDone, everyMonths);
  const daysLeft = diffDays(today, nextDue);
  const span = Math.max(1, diffDays(lastDone, nextDue));
  const elapsed = Math.max(0, diffDays(lastDone, today) / span);
  const status: CheckupStatus = daysLeft < 0 ? 'atrasado' : daysLeft <= soonDays ? 'pronto' : 'al_dia';
  return { nextDue, daysLeft, status, elapsed };
}

/** "cada 6 meses", "cada año", "cada 10 años", "una sola vez". */
export function checkupEveryText(months: number): string {
  if (!(months > 0)) return 'una sola vez';
  if (months === 1) return 'cada mes';
  if (months % 12 === 0) return months === 12 ? 'cada año' : `cada ${months / 12} años`;
  return `cada ${months} meses`;
}

// ---------------------------------------------------------------------------------------------
// Mediciones y rangos de referencia (contexto, no diagnóstico)
// ---------------------------------------------------------------------------------------------

export type HealthMetricLevel = 'ok' | 'atencion' | 'alto' | 'bajo';

export interface HealthMetricInfo {
  name: string;
  unit: string;
  /** Nombre de cada valor cuando hay dos (presión: sistólica / diastólica). */
  valueNames?: [string, string];
  /** Rango de referencia general, en una línea. */
  reference: string;
  /** Líneas de referencia para la gráfica. */
  guides: number[];
}

export const HEALTH_METRIC_INFO: Record<HealthMetricKind, HealthMetricInfo> = {
  presion: {
    name: 'Presión arterial',
    unit: 'mmHg',
    valueNames: ['Sistólica', 'Diastólica'],
    reference: 'Referencia: menos de 120/80 mmHg. Desde 130/80 se considera alta (AHA/ACC).',
    guides: [120, 80],
  },
  glucosa: {
    name: 'Glucosa en ayunas',
    unit: 'mg/dL',
    reference: 'Referencia en ayunas: 70–99 mg/dL. De 100 a 125 es rango de prediabetes; 126 o más, de diabetes (ADA).',
    guides: [100],
  },
  colesterol: {
    name: 'Colesterol total',
    unit: 'mg/dL',
    reference: 'Referencia: menos de 200 mg/dL. De 200 a 239 es limítrofe; 240 o más, alto.',
    guides: [200],
  },
  frecuencia_reposo: {
    name: 'Pulso en reposo',
    unit: 'lpm',
    reference: 'Referencia en adultos: 60–100 latidos por minuto. Menos de 60 es común si entrenas.',
    guides: [60, 100],
  },
  otro: {
    name: 'Otra medición',
    unit: '',
    reference: 'Sin rango de referencia en la app: revisa el que trae tu estudio.',
    guides: [],
  },
};

export interface HealthMetricReading {
  level: HealthMetricLevel;
  text: string;
}

/** Ubica una medición contra el rango de referencia general (null = sin referencia). */
export function classifyHealthMetric(kind: HealthMetricKind, value: number, value2?: number): HealthMetricReading | null {
  switch (kind) {
    case 'presion': {
      const s = value;
      const d = value2 ?? 0;
      if (s >= 180 || d >= 120) return { level: 'alto', text: 'Muy alta: busca atención médica pronto' };
      if (s >= 140 || d >= 90) return { level: 'alto', text: 'Alta (etapa 2): platícalo con tu médico' };
      if (s >= 130 || d >= 80) return { level: 'atencion', text: 'Alta (etapa 1): vuelve a medirla y platícalo con tu médico' };
      if (s >= 120) return { level: 'atencion', text: 'Elevada' };
      if (s < 90 || (value2 !== undefined && d < 60)) return { level: 'bajo', text: 'Baja: si te mareas, platícalo con tu médico' };
      return { level: 'ok', text: 'En rango de referencia' };
    }
    case 'glucosa':
      if (value < 70) return { level: 'bajo', text: 'Por debajo de la referencia' };
      if (value < 100) return { level: 'ok', text: 'En rango de referencia' };
      if (value < 126) return { level: 'atencion', text: 'Rango de prediabetes: platícalo con tu médico' };
      return { level: 'alto', text: 'Rango de diabetes: confírmalo con tu médico' };
    case 'colesterol':
      if (value < 200) return { level: 'ok', text: 'Deseable' };
      if (value < 240) return { level: 'atencion', text: 'Limítrofe' };
      return { level: 'alto', text: 'Alto: platícalo con tu médico' };
    case 'frecuencia_reposo':
      if (value < 40) return { level: 'bajo', text: 'Muy bajo: platícalo con tu médico si te sientes mal' };
      if (value < 60) return { level: 'ok', text: 'Bajo (común si entrenas)' };
      if (value <= 100) return { level: 'ok', text: 'En rango de referencia' };
      return { level: 'alto', text: 'Alto en reposo: platícalo con tu médico' };
    default:
      return null;
  }
}

/** Clave de la serie de una medición ("presion", "otro:trigliceridos"…). */
export function healthMetricKey(kind: HealthMetricKind, label?: string | null): string {
  if (kind !== 'otro') return kind;
  const norm = (label ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `otro:${norm || 'medicion'}`;
}

/** "128/82 mmHg", "94 mg/dL". */
export function fmtHealthMetric(m: { kind: HealthMetricKind; value: number; value2?: number; unit?: string | null }): string {
  const unit = m.unit || HEALTH_METRIC_INFO[m.kind].unit;
  const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const v = m.kind === 'presion' && m.value2 !== undefined ? `${n(m.value)}/${n(m.value2)}` : n(m.value);
  return unit ? `${v} ${unit}` : v;
}
