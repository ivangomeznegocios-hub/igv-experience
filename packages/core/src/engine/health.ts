import type { CheckupCategory, DoctorCadence, HealthMetricKind, HealthRecordValue, MissionSize } from '../types';
import { addDays, ageOn, diffDays, isDateString } from '../util/dates';

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
  // En intervalos cortos (p. ej. cada mes) la ventana es a lo más un tercio del intervalo: recién hecho no "toca pronto".
  const soon = Math.min(soonDays, Math.floor(span / 3));
  const status: CheckupStatus = daysLeft < 0 ? 'atrasado' : daysLeft <= soon ? 'pronto' : 'al_dia';
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
  /** Sale de un análisis de laboratorio (no se mide en casa). */
  lab?: boolean;
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
  trigliceridos: {
    name: 'Triglicéridos',
    unit: 'mg/dL',
    lab: true,
    reference: 'Referencia: menos de 150 mg/dL. De 150 a 199 es limítrofe; 200 o más, alto (NCEP ATP III).',
    guides: [150],
  },
  hdl: {
    name: 'Colesterol HDL',
    unit: 'mg/dL',
    lab: true,
    reference: 'El "bueno": en hombres conviene 40 mg/dL o más; 60 o más protege el corazón.',
    guides: [40, 60],
  },
  ldl: {
    name: 'Colesterol LDL',
    unit: 'mg/dL',
    lab: true,
    reference: 'El "malo": óptimo menos de 100 mg/dL; 130–159 limítrofe; 160 o más, alto. Tu meta depende de tu riesgo: platícalo con tu médico.',
    guides: [100, 130],
  },
  hba1c: {
    name: 'Hemoglobina glucosilada (HbA1c)',
    unit: '%',
    lab: true,
    reference: 'Promedio de azúcar de ~3 meses: menos de 5.7 %. De 5.7 a 6.4 es rango de prediabetes; 6.5 o más, de diabetes (ADA).',
    guides: [5.7, 6.5],
  },
  acido_urico: {
    name: 'Ácido úrico',
    unit: 'mg/dL',
    lab: true,
    reference: 'Referencia en hombres: hasta ~7 mg/dL. Alto se relaciona con gota y cálculos.',
    guides: [7],
  },
  creatinina: {
    name: 'Creatinina',
    unit: 'mg/dL',
    lab: true,
    reference: 'Función del riñón. Referencia en hombres: ~0.7–1.3 mg/dL (si entrenas fuerza o tomas creatina puede salir un poco alta).',
    guides: [0.7, 1.3],
  },
  tsh: {
    name: 'TSH (tiroides)',
    unit: 'mUI/L',
    lab: true,
    reference: 'Referencia general: ~0.4–4.0 mUI/L.',
    guides: [0.4, 4],
  },
  vitamina_d: {
    name: 'Vitamina D (25-OH)',
    unit: 'ng/mL',
    lab: true,
    reference: 'Suficiente: 30–100 ng/mL. De 20 a 29, insuficiente; menos de 20, deficiencia.',
    guides: [20, 30],
  },
  hemoglobina: {
    name: 'Hemoglobina',
    unit: 'g/dL',
    lab: true,
    reference: 'Referencia en hombres: ~13.5–17.5 g/dL. Baja puede ser anemia.',
    guides: [13.5, 17.5],
  },
  saturacion: {
    name: 'Saturación de oxígeno',
    unit: '%',
    reference: 'En reposo: 95 % o más. Menos de 92 %, sobre todo con falta de aire, amerita atención médica.',
    guides: [95],
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
    case 'trigliceridos':
      if (value < 150) return { level: 'ok', text: 'En rango de referencia' };
      if (value < 200) return { level: 'atencion', text: 'Limítrofe' };
      if (value < 500) return { level: 'alto', text: 'Alto: platícalo con tu médico' };
      return { level: 'alto', text: 'Muy alto: platícalo con tu médico pronto' };
    case 'hdl':
      if (value < 40) return { level: 'bajo', text: 'Bajo: en hombres conviene 40 o más' };
      if (value < 60) return { level: 'ok', text: 'En rango de referencia' };
      return { level: 'ok', text: 'Alto (protege tu corazón)' };
    case 'ldl':
      if (value < 100) return { level: 'ok', text: 'Óptimo' };
      if (value < 130) return { level: 'ok', text: 'Casi óptimo' };
      if (value < 160) return { level: 'atencion', text: 'Limítrofe' };
      if (value < 190) return { level: 'alto', text: 'Alto: platícalo con tu médico' };
      return { level: 'alto', text: 'Muy alto: platícalo con tu médico pronto' };
    case 'hba1c':
      if (value < 5.7) return { level: 'ok', text: 'En rango de referencia' };
      if (value < 6.5) return { level: 'atencion', text: 'Rango de prediabetes: platícalo con tu médico' };
      return { level: 'alto', text: 'Rango de diabetes: confírmalo con tu médico' };
    case 'acido_urico':
      if (value < 2.5) return { level: 'bajo', text: 'Por debajo de la referencia' };
      if (value <= 7) return { level: 'ok', text: 'En rango de referencia' };
      return { level: 'alto', text: 'Alto: platícalo con tu médico' };
    case 'creatinina':
      if (value < 0.6) return { level: 'bajo', text: 'Baja (suele depender de tu masa muscular)' };
      if (value <= 1.3) return { level: 'ok', text: 'En rango de referencia' };
      if (value <= 1.5) return { level: 'atencion', text: 'Un poco alta: platícalo con tu médico' };
      return { level: 'alto', text: 'Alta: platícalo con tu médico (función del riñón)' };
    case 'tsh':
      if (value < 0.4) return { level: 'bajo', text: 'Baja: platícalo con tu médico (tiroides)' };
      if (value <= 4) return { level: 'ok', text: 'En rango de referencia' };
      if (value < 10) return { level: 'atencion', text: 'Un poco alta: platícalo con tu médico (tiroides)' };
      return { level: 'alto', text: 'Alta: platícalo con tu médico (tiroides)' };
    case 'vitamina_d':
      if (value < 20) return { level: 'bajo', text: 'Deficiencia: platícalo con tu médico' };
      if (value < 30) return { level: 'atencion', text: 'Insuficiente' };
      if (value <= 100) return { level: 'ok', text: 'Suficiente' };
      return { level: 'alto', text: 'Alta: revisa tus suplementos con tu médico' };
    case 'hemoglobina':
      if (value < 13.5) return { level: 'bajo', text: 'Baja (posible anemia): platícalo con tu médico' };
      if (value <= 17.5) return { level: 'ok', text: 'En rango de referencia' };
      return { level: 'alto', text: 'Alta: platícalo con tu médico' };
    case 'saturacion':
      if (value < 90) return { level: 'bajo', text: 'Muy baja: busca atención médica hoy' };
      if (value < 92) return { level: 'bajo', text: 'Baja: si te falta el aire, busca atención médica' };
      if (value < 95) return { level: 'atencion', text: 'Un poco baja: vuelve a medirla en reposo' };
      return { level: 'ok', text: 'En rango de referencia' };
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


/** Contra el rango de referencia del propio estudio (para mediciones sin rango en la app). */
export function classifyAgainstRange(value: number, low?: number | null, high?: number | null): HealthMetricReading | null {
  const lo = typeof low === 'number' && Number.isFinite(low) ? low : null;
  const hi = typeof high === 'number' && Number.isFinite(high) ? high : null;
  if (lo === null && hi === null) return null;
  if (lo !== null && value < lo) return { level: 'bajo', text: 'Por debajo del rango de tu estudio' };
  if (hi !== null && value > hi) return { level: 'alto', text: 'Por encima del rango de tu estudio' };
  return { level: 'ok', text: 'Dentro del rango de tu estudio' };
}

/** "70–99", "< 150", "> 40" (vacío si no hay). */
export function fmtRange(low?: number | null, high?: number | null): string {
  const n = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100));
  const lo = typeof low === 'number' && Number.isFinite(low) ? low : null;
  const hi = typeof high === 'number' && Number.isFinite(high) ? high : null;
  if (lo !== null && hi !== null) return `${n(lo)}–${n(hi)}`;
  if (hi !== null) return `< ${n(hi)}`;
  if (lo !== null) return `> ${n(lo)}`;
  return '';
}

const normText = (s: string) =>
  ` ${s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()} `;

/**
 * Reconoce el nombre de un valor de laboratorio ("Colesterol HDL", "Hemoglobina glucosilada A1c", "Ácido úrico"…).
 * Devuelve null si no es una medición conocida (o si es ambigua: hemoglobina corpuscular, glucosa en orina…).
 */
export function metricKindFromName(name: string | null | undefined): Exclude<HealthMetricKind, 'otro'> | null {
  if (!name) return null;
  const t = normText(name);
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has(' orina ', ' urinari', ' depuracion ', ' en 24 ')) return null;
  if (has('glucosilada', 'glicosilada', 'glicada', ' hba1c ', ' a1c ', ' hb a1c ', ' hemoglobina a1c ')) return 'hba1c';
  if (has('triglicer')) return 'trigliceridos';
  if (has(' no hdl ', ' vldl ')) return null;
  if (has(' hdl ')) return 'hdl';
  if (has(' ldl ')) return 'ldl';
  if (has(' colesterol total ') || t.trim() === 'colesterol') return 'colesterol';
  if (has('acido urico', ' urico ')) return 'acido_urico';
  if (has(' creatinina ')) return 'creatinina';
  if (has(' tsh ', 'tirotropina', 'estimulante de tiroides', 'estimulante de la tiroides')) return 'tsh';
  if (has('vitamina d', ' 25 oh ', ' 25 hidroxi', 'calcidiol')) return 'vitamina_d';
  if (has(' hemoglobina ') && !has('corpuscular', ' media ', ' hcm ', ' cmhc ')) return 'hemoglobina';
  if (has(' glucosa ', ' glucemia ', ' glicemia ')) return 'glucosa';
  if (has(' saturacion ', ' spo2 ', ' sat o2 ')) return 'saturacion';
  if (has(' pulso ', ' frecuencia cardiaca ')) return 'frecuencia_reposo';
  return null;
}

const normUnit = (u: string | null | undefined) => (u ?? '').toLowerCase().replace(/\s+/g, '').replace(/[µμ]/g, 'u');
/** Unidades equivalentes a la de la app (mismo número). */
const SAME_UNITS: Partial<Record<HealthMetricKind, string[]>> = {
  tsh: ['mui/l', 'miu/l', 'uui/ml', 'uiu/ml', 'mu/l'],
  frecuencia_reposo: ['lpm', 'bpm', 'latidos/min', 'x\'', 'xmin', 'x/min'],
};
const unitMatches = (k: HealthMetricKind, unit: string | null | undefined) => {
  const got = normUnit(unit);
  return !got || got === normUnit(HEALTH_METRIC_INFO[k].unit) || !!SAME_UNITS[k]?.includes(got);
};

/**
 * La medición conocida que corresponde a un registro: las de `otro` con un nombre conocido ("Triglicéridos") se
 * agrupan con la suya, salvo que la unidad no coincida (p. ej. glucosa en mmol/L se queda como "otra").
 */
export function resolveMetricKind(kind: HealthMetricKind, label?: string | null, unit?: string | null): HealthMetricKind {
  if (kind !== 'otro') return kind;
  const k = metricKindFromName(label);
  if (!k || k === 'presion') return 'otro';
  return unitMatches(k, unit) ? k : 'otro';
}

/** ¿El valor viene en la unidad que usa la app para esa medición? (si no, se guarda como "otra" con su unidad). */
export function metricUnitMatches(kind: HealthMetricKind, unit: string | null | undefined): boolean {
  return kind === 'otro' || unitMatches(kind, unit);
}

/**
 * Un valor de un estudio como medición (`health.metric`): con su tipo conocido si el nombre y la unidad coinciden, si
 * no como "otra" con su nombre y unidad. null si no es un número guardable.
 */
export function recordValueToMetric(v: HealthRecordValue): { kind: HealthMetricKind; value: number; value2?: number; unit?: string; label?: string; refLow?: number; refHigh?: number } | null {
  if (typeof v.value !== 'number' || !(v.value > 0) || v.value > 100000) return null;
  const named = v.kind && v.kind !== 'otro' ? v.kind : metricKindFromName(v.name);
  if (named === 'presion') {
    if (typeof v.value2 !== 'number' || !(v.value2 > 0) || v.value2 >= v.value) return null;
    return { kind: 'presion', value: v.value, value2: v.value2 };
  }
  const known = named && metricUnitMatches(named, v.unit) ? named : null;
  const lo = typeof v.low === 'number' && v.low >= 0 ? v.low : undefined;
  const hi = typeof v.high === 'number' && v.high > 0 ? v.high : undefined;
  const range = lo !== undefined && hi !== undefined && lo >= hi ? {} : { refLow: lo, refHigh: hi };
  if (known) return { kind: known, value: v.value, ...range };
  const label = v.name.trim().slice(0, 80);
  if (!label) return null;
  return { kind: 'otro', value: v.value, unit: v.unit?.trim().slice(0, 20) || undefined, label, ...range };
}

// ---------------------------------------------------------------------------------------------
// Tu médico IA: cada cuándo te revisa
// ---------------------------------------------------------------------------------------------

export const DOCTOR_CADENCE_DAYS: Record<DoctorCadence, number | null> = { semanal: 7, quincenal: 14, mensual: 30, manual: null };
export const DOCTOR_CADENCE_NAMES: Record<DoctorCadence, string> = { semanal: 'Cada semana', quincenal: 'Cada 2 semanas', mensual: 'Cada mes', manual: 'Solo cuando la pida' };
export const DOCTOR_DEFAULT_CADENCE: DoctorCadence = 'semanal';
export const DOCTOR_DISCLAIMER = 'Tu médico IA te orienta con tus datos; no sustituye a tu médico ni da diagnósticos. Ante síntomas graves, ve a urgencias.';

/** Fecha de la siguiente revisión automática (null = solo cuando la pidas o aún no hay ninguna). */
export function nextDoctorReview(lastDate: string | null, cadence: DoctorCadence | undefined): string | null {
  const days = DOCTOR_CADENCE_DAYS[cadence ?? DOCTOR_DEFAULT_CADENCE];
  if (!lastDate || days === null) return null;
  return addDays(lastDate, days);
}

/** ¿Ya toca la revisión automática? (solo si ya hubo una primera revisión y la frecuencia no es manual). */
export function doctorReviewDue(lastDate: string | null, cadence: DoctorCadence | undefined, today: string): boolean {
  const next = nextDoctorReview(lastDate, cadence);
  return !!next && next <= today;
}

/** Tipos de archivo que se pueden subir y leer con IA. */
export const HEALTH_FILE_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
/** Tamaño máximo por archivo (bytes). Las fotos se comprimen en el teléfono antes de subirse. */
export const HEALTH_FILE_MAX_BYTES = 10 * 1024 * 1024;
