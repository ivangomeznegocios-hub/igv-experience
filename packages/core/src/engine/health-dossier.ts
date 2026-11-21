import type { Entity, HealthRecordValue, ViceData } from '../types';
import type { GameState } from './project';
import { addDays, ageOn, diffDays, isDateString } from '../util/dates';
import { CHECKUP_STATUS_NAMES, DOCTOR_DEFAULT_CADENCE, HEALTH_METRIC_INFO, checkupEveryText, fmtHealthMetric } from './health';
import { HEALTH_RECORD_TYPE_NAMES } from '../types';

/**
 * Tu médico IA: el expediente que lee (todo lo de salud, cuerpo, sueño, entrenamiento y hábitos, en texto compacto)
 * y los datos que le faltan para orientarte. Funciones puras: las usa la app para armar cada revisión.
 */

export interface HealthGap {
  id: 'nacimiento' | 'estatura' | 'peso' | 'cintura' | 'presion' | 'laboratorios' | 'ficha' | 'familia' | 'sueno' | 'actividad' | 'chequeos';
  label: string;
  why: string;
  done: boolean;
  /** A dónde ir para completarlo. */
  to: string;
}

const hasText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const LAB_KINDS = new Set(['glucosa', 'colesterol', 'trigliceridos', 'hdl', 'ldl', 'hba1c']);

/** Lo que tu médico necesita saber de ti (en orden de importancia) y si ya lo tiene. */
export function healthDataGaps(state: GameState): HealthGap[] {
  const today = state.today;
  const h = state.health;
  const s = state.settings;
  const recent = (date: string | null | undefined, days: number) => !!date && date >= addDays(today, -days) && date <= today;
  const lastOf = (pred: (key: string) => boolean) =>
    Object.entries(h.metrics)
      .filter(([k, series]) => pred(k) && series.length)
      .map(([, series]) => series.at(-1)!.date)
      .sort()
      .at(-1) ?? null;
  const lastWaist = [...state.body.entries].reverse().find((e) => typeof e.waistCm === 'number')?.date ?? null;
  const lastLabRecord = h.records.find((r) => r.type === 'laboratorio')?.date ?? null;
  const lastSleep = state.body.sleep.at(-1)?.date ?? null;
  const lastWorkout = state.training.workouts.at(-1)?.date ?? null;
  const card = h.card ?? {};
  return [
    { id: 'nacimiento', label: 'Tu fecha de nacimiento', why: 'Qué revisarte y desde cuándo cambia con la edad.', done: !!s.birthDate, to: '/ajustes' },
    { id: 'estatura', label: 'Tu estatura', why: 'Para calcular tu IMC y tu complexión.', done: !!s.heightCm, to: '/personaje' },
    { id: 'peso', label: 'Tu peso de este mes', why: 'La tendencia del peso dice más que un solo número.', done: recent(state.body.lastWeight?.date, 31), to: '/cuerpo' },
    { id: 'cintura', label: 'Tu cintura (con cinta, a la altura del ombligo)', why: 'Predice mejor el riesgo del corazón que el peso solo.', done: recent(lastWaist, 183), to: '/cuerpo' },
    { id: 'presion', label: 'Tu presión arterial del último año', why: 'La presión alta no da síntomas: solo se sabe midiéndola.', done: recent(lastOf((k) => k === 'presion'), 366), to: '/salud?tab=mediciones' },
    {
      id: 'laboratorios',
      label: 'Análisis de sangre del último año',
      why: 'Glucosa, colesterol y triglicéridos: lo básico para saber cómo vas por dentro.',
      done: recent(lastOf((k) => LAB_KINDS.has(k)), 366) || recent(lastLabRecord, 366),
      to: '/salud?tab=estudios',
    },
    { id: 'ficha', label: 'Tu ficha médica (tipo de sangre, alergias, medicamentos)', why: 'Para que ninguna recomendación choque con lo que ya tomas.', done: hasText(card.bloodType) || hasText(card.allergies) || hasText(card.medications) || hasText(card.conditions), to: '/salud?tab=resumen&ficha=1' },
    { id: 'familia', label: 'Antecedentes de tu familia', why: 'Diabetes, infartos o cáncer en tu familia cambian qué revisarte y desde cuándo.', done: hasText(h.doctor.familyHistory), to: '/salud?tab=medico&perfil=1' },
    { id: 'sueno', label: 'Tu sueño (check-in de la mañana)', why: 'Dormir poco sube la presión, el azúcar y el hambre.', done: recent(lastSleep, 14), to: '/' },
    { id: 'actividad', label: 'Tu actividad física', why: 'Para ver si llegas a lo recomendado (150 min de cardio y 2 días de fuerza por semana).', done: recent(lastWorkout, 31), to: '/entreno' },
    { id: 'chequeos', label: 'Tus chequeos preventivos', why: 'Para avisarte cuándo te toca cada uno.', done: h.counts.active > 0, to: '/salud?tab=chequeos' },
  ];
}

/** % del expediente completo. */
export function healthFileScore(gaps: HealthGap[]): number {
  return gaps.length ? Math.round((gaps.filter((g) => g.done).length / gaps.length) * 100) : 0;
}

const n1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const oneLine = (s: string | undefined | null, max = 400) => clip((s ?? '').replace(/\s+/g, ' ').trim(), max);

function valueText(v: HealthRecordValue): string {
  const val =
    typeof v.value === 'number'
      ? `${n1(v.value)}${typeof v.value2 === 'number' ? `/${n1(v.value2)}` : ''}${v.unit ? ` ${v.unit}` : ''}`
      : v.text?.trim() || '—';
  const ref = v.ref?.trim() ? ` (ref. ${v.ref.trim()})` : '';
  const flag = v.flag ? ` [${v.flag.toUpperCase()}]` : '';
  return `${v.name}: ${val}${ref}${flag}`;
}

/**
 * El expediente completo en texto para tu médico IA. Incluye lo nuevo desde su última revisión para que se enfoque
 * en eso. Se recorta para no pasar de `maxChars` (lo más viejo y lo menos importante se va primero).
 */
export function buildHealthDossier(state: GameState, entities: readonly Entity[], opts: { maxChars?: number } = {}): string {
  const max = opts.maxChars ?? 40000;
  const today = state.today;
  const h = state.health;
  const s = state.settings;
  const L: string[] = [];
  const last = h.consults[0] ?? null;
  const since = last?.date ?? null;
  const isNew = (d: string) => !!since && d > since;

  // --- Datos generales ---
  const age = s.birthDate && isDateString(s.birthDate) ? ageOn(s.birthDate, today).years : null;
  L.push(`# Expediente de salud de ${s.name?.trim() || 'el usuario'} · hoy ${today}`);
  L.push('', '## Datos generales');
  L.push(`- Hombre${age !== null ? `, ${age} años (nació el ${s.birthDate})` : ', edad desconocida (sin fecha de nacimiento)'}${s.heightCm ? ` · estatura ${s.heightCm} cm` : ' · estatura sin registrar'}.`);
  const weights = state.body.entries.filter((e) => typeof e.weightKg === 'number');
  if (weights.length) {
    const lw = weights.at(-1)!;
    const at = (days: number) => [...weights].reverse().find((e) => e.date <= addDays(today, -days));
    const w30 = at(30);
    const w90 = at(90);
    const w365 = at(365);
    const bmi = s.heightCm ? lw.weightKg! / (s.heightCm / 100) ** 2 : null;
    L.push(
      `- Peso: ${n1(lw.weightKg!)} kg (${lw.date})${bmi ? ` · IMC ${bmi.toFixed(1)}` : ''}${w30 ? ` · hace ~1 mes ${n1(w30.weightKg!)} kg` : ''}${w90 ? ` · hace ~3 meses ${n1(w90.weightKg!)} kg` : ''}${w365 ? ` · hace ~1 año ${n1(w365.weightKg!)} kg` : ''}.`,
    );
  } else L.push('- Peso: sin registros.');
  const lastMeasure = (key: 'bodyFatPct' | 'waistCm' | 'hipsCm' | 'neckCm') => [...state.body.entries].reverse().find((e) => typeof e[key] === 'number');
  const fat = lastMeasure('bodyFatPct');
  const waist = lastMeasure('waistCm');
  const hips = lastMeasure('hipsCm');
  const comp = [
    fat && `grasa corporal ${n1(fat.bodyFatPct!)} % (${fat.date})`,
    waist && `cintura ${n1(waist.waistCm!)} cm (${waist.date})${s.heightCm ? `, cintura/estatura ${(waist.waistCm! / s.heightCm).toFixed(2)}` : ''}`,
    hips && `cadera ${n1(hips.hipsCm!)} cm (${hips.date})`,
  ].filter(Boolean);
  if (comp.length) L.push(`- Composición: ${comp.join(' · ')}.`);

  // --- Lo que debes saber ---
  const d = h.doctor;
  const about = [
    hasText(d.goals) && `- Lo que quiere lograr: ${oneLine(d.goals, 600)}`,
    hasText(d.familyHistory) && `- Antecedentes familiares: ${oneLine(d.familyHistory, 600)}`,
    hasText(d.pastHistory) && `- Antecedentes personales (cirugías, lesiones, enfermedades): ${oneLine(d.pastHistory, 600)}`,
    hasText(d.lifestyle) && `- Estilo de vida (alimentación, alcohol, tabaco, estrés): ${oneLine(d.lifestyle, 600)}`,
  ].filter(Boolean) as string[];
  if (about.length) L.push('', '## Lo que te contó de él', ...about);

  const c = h.card ?? {};
  const card = [
    hasText(c.bloodType) && `tipo de sangre ${c.bloodType}`,
    `alergias: ${hasText(c.allergies) ? oneLine(c.allergies, 300) : 'ninguna anotada'}`,
    hasText(c.conditions) && `padecimientos: ${oneLine(c.conditions, 300)}`,
    `medicamentos: ${hasText(c.medications) ? oneLine(c.medications, 300) : 'ninguno anotado'}`,
    hasText(c.doctorName) && `su médico: ${oneLine(c.doctorName, 100)}`,
    hasText(c.notes) && `notas: ${oneLine(c.notes, 300)}`,
  ].filter(Boolean);
  L.push('', '## Ficha médica', `- ${h.card ? card.join(' · ') : 'Vacía.'}`);

  // --- Chequeos ---
  const ck = Object.values(h.checkups);
  L.push('', '## Chequeos preventivos');
  if (!ck.length) L.push('- No tiene chequeos activos.');
  for (const x of ck.sort((a, b) => Number(b.active) - Number(a.active) || (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999))) {
    const when = x.status === 'atrasado' ? `atrasado ${-(x.daysLeft ?? 0)} días` : x.status === 'pronto' ? `le toca en ${x.daysLeft} días` : CHECKUP_STATUS_NAMES[x.status].toLowerCase();
    L.push(`- ${x.name} (${checkupEveryText(x.everyMonths)})${x.active ? '' : ' [pausado]'}: ${when}${x.lastDone ? ` · última vez ${x.lastDone}` : ''}${x.lastResult ? ` · resultado: ${oneLine(x.lastResult, 160)}` : ''}.`);
  }

  // --- Mediciones ---
  const series = Object.values(h.metrics)
    .filter((x) => x.length)
    .sort((a, b) => (a.at(-1)!.date < b.at(-1)!.date ? 1 : -1));
  L.push('', '## Mediciones (de la más reciente a la más antigua)');
  if (!series.length) L.push('- Sin mediciones registradas.');
  for (const x of series) {
    const lastN = x.slice(-6).reverse();
    const info = HEALTH_METRIC_INFO[x[0].kind];
    L.push(
      `- ${x.at(-1)!.label}${info.lab ? ' (laboratorio)' : ''}: ${lastN
        .map((m) => `${fmtHealthMetric(m)} el ${m.date}${m.levelText ? ` (${m.levelText.toLowerCase()})` : ''}${m.ref ? ` [ref. ${m.ref}]` : ''}${isNew(m.date) ? ' NUEVO' : ''}`)
        .join('; ')}${x.length > 6 ? ` · ${x.length} registros en total desde ${x[0].date}` : ''}.`,
    );
  }

  // --- Estudios ---
  L.push('', '## Estudios y consultas');
  if (!h.records.length) L.push('- No ha subido estudios.');
  const yearAgo = addDays(today, -400);
  for (const r of h.records.slice(0, 40)) {
    const head = `- ${r.date} · ${r.title} (${HEALTH_RECORD_TYPE_NAMES[r.type] ?? r.type})${r.place ? ` · ${oneLine(r.place, 80)}` : ''}${r.doctor ? ` · ${oneLine(r.doctor, 80)}` : ''}${isNew(r.date) ? ' NUEVO' : ''}`;
    if (r.date < yearAgo) {
      L.push(`${head}${r.ai?.summary ? `: ${oneLine(r.ai.summary, 200)}` : ''}`);
      continue;
    }
    L.push(head);
    if (r.notes) L.push(`  Notas: ${oneLine(r.notes, 400)}`);
    if (r.ai) {
      L.push(`  Resumen: ${oneLine(r.ai.summary, 700)}`);
      const flagged = r.ai.values.filter((v) => v.flag);
      const rest = r.ai.values.filter((v) => !v.flag);
      if (flagged.length) L.push(`  Fuera de rango: ${flagged.map(valueText).join('; ')}`);
      if (rest.length) L.push(`  Otros valores: ${clip(rest.map(valueText).join('; '), 1500)}`);
      if (r.ai.findings.length) L.push(`  Hallazgos: ${clip(r.ai.findings.map((f) => oneLine(f, 200)).join('; '), 800)}`);
    } else if (r.files.length) L.push('  (Archivo sin leer todavía.)');
  }

  // --- Estilo de vida ---
  L.push('', '## Estilo de vida');
  const sleep = state.body.sleep;
  const avg = (days: number) => {
    const xs = sleep.filter((x) => x.date > addDays(today, -days) && x.date <= today);
    return xs.length ? { h: xs.reduce((t, x) => t + x.hours, 0) / xs.length, n: xs.length } : null;
  };
  const s7 = avg(7);
  const s30 = avg(30);
  L.push(`- Sueño: ${s7 ? `${s7.h.toFixed(1)} h promedio en 7 días (${s7.n} noches)` : 'sin check-in esta semana'}${s30 ? ` · ${s30.h.toFixed(1)} h en 30 días (${s30.n} noches)` : ''}.`);
  const wk = state.training.workouts.filter((w) => w.date > addDays(today, -28) && w.date <= today);
  const tsum = state.training.summary;
  if (wk.length) {
    const minutes = wk.reduce((t, w) => t + (w.minutes ?? 0), 0);
    const cardio = wk.reduce((t, w) => t + w.cardioMinutes, 0);
    const hard = wk.reduce((t, w) => t + w.hardSets, 0);
    const kinds = new Map<string, number>();
    for (const w of wk) kinds.set(w.kind, (kinds.get(w.kind) ?? 0) + 1);
    L.push(
      `- Entrenamiento (últimas 4 semanas): ${wk.length} sesiones (${n1(wk.length / 4)} por semana)${minutes ? ` · ${minutes} min en total` : ''} · cardio ${Math.round(cardio / 4)} min por semana (recomendado 150) · ${Math.round(hard / 4)} series duras por semana · tipos: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}${tsum.weekStreak ? ` · ${tsum.weekStreak} semanas seguidas entrenando` : ''}.`,
    );
  } else L.push(`- Entrenamiento: sin sesiones en las últimas 4 semanas${tsum.lastWorkout ? ` (la última fue el ${tsum.lastWorkout.date})` : ''}.`);
  const viceNames = new Map(entities.filter((e) => e.module === 'habits' && e.kind === 'vice' && !e.deletedAt).map((e) => [e.id, (e.data as ViceData).name]));
  const vices = Object.entries(state.vices).filter(([id]) => viceNames.has(id));
  if (vices.length)
    L.push(`- Hábitos que quiere dejar: ${vices.map(([id, v]) => `${viceNames.get(id)}: ${v.current} días sin caer, ${v.relapses30} días con recaída en 30 días${v.trend ? ` (${v.trend})` : ''}`).join('; ')}.`);
  if (state.streak.current) L.push(`- Constancia general en la app: racha de ${state.streak.current} días.`);

  // --- Revisiones anteriores ---
  if (h.consults.length) {
    L.push('', '## Tus revisiones anteriores (de la más reciente)');
    for (const x of h.consults.slice(0, 3)) {
      L.push(`- ${x.date}: ${oneLine(x.title, 160)} [${x.status}]`);
      for (const a of x.actions.slice(0, 8)) L.push(`  · ${a.doneAt ? 'HECHO' : a.dismissedAt ? 'descartado' : 'pendiente'}: ${oneLine(a.text, 200)}`);
    }
    L.push(`Días desde la última revisión: ${diffDays(h.consults[0].date, today)}.`);
  }

  // --- Datos que faltan ---
  const gaps = healthDataGaps(state).filter((g) => !g.done);
  if (gaps.length) L.push('', '## Datos que todavía no tiene la app', ...gaps.map((g) => `- ${g.label}`));
  L.push('', `Frecuencia de revisión elegida: ${h.doctor.cadence ?? DOCTOR_DEFAULT_CADENCE}.`);

  let out = L.join('\n');
  if (out.length > max) out = `${out.slice(0, max - 60)}\n\n(El expediente se recortó por tamaño.)`;
  return out;
}
