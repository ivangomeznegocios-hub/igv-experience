import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import {
  HEALTH_DOCTOR_ID,
  HEALTH_PROFILE_ID,
  MISSION_SIZES,
  type AttributeId,
  type CheckupCategory,
  type CheckupData,
  type DoctorAction,
  type HealthConsultData,
  type HealthDoctorData,
  type HealthMetricKind,
  type HealthProfileData,
  type HealthRecordData,
  type MissionSize,
} from '../../types';
import { isDateString } from '../../util/dates';
import {
  HEALTH_METRIC_INFO,
  checkupTiming,
  classifyAgainstRange,
  classifyHealthMetric,
  fmtRange,
  healthMetricKey,
  nextDoctorReview,
  resolveMetricKind,
  type CheckupStatus,
  type HealthMetricLevel,
} from '../health';

export interface CheckupState {
  id: string;
  name: string;
  category: CheckupCategory;
  everyMonths: number;
  active: boolean;
  size: MissionSize;
  /** XP que da hacerlo hoy. */
  xp: number;
  /** Última vez: el registro más reciente o la fecha anotada a mano, la que sea más nueva. */
  lastDone: string | null;
  lastResult: string | null;
  nextDue: string | null;
  /** Días que faltan (negativo = atrasado). */
  daysLeft: number | null;
  status: CheckupStatus;
  /** Fracción del intervalo ya transcurrida (para la barra de "falta poco"). */
  elapsed: number | null;
  /** Veces registrado (una por día). */
  timesDone: number;
  doneToday: boolean;
}

/** Un chequeo que ya toca o está por tocar (para Hoy y la revisión del día). */
export interface HealthDueItem {
  checkupId: string;
  name: string;
  category: CheckupCategory;
  status: 'atrasado' | 'pronto';
  nextDue: string;
  daysLeft: number;
  xp: number;
}

/** Un chequeo hecho (el que cuenta de cada chequeo y día). */
export interface CheckupDone {
  eventId: string;
  checkupId: string;
  date: string;
  name: string;
  xp: number;
  note?: string;
  result?: string;
}

export interface HealthMetricEntry {
  eventId: string;
  date: string;
  kind: HealthMetricKind;
  /** Serie a la que pertenece ("presion", "otro:trigliceridos"…). */
  key: string;
  label: string;
  value: number;
  value2?: number;
  unit: string;
  note?: string;
  level: HealthMetricLevel | null;
  levelText: string | null;
  /** Rango de referencia del propio estudio ("70–99"), si lo trae. */
  ref?: string;
  /** Estudio del que salió. */
  recordId?: string;
}

/** Un estudio o documento médico (`health/record`) con su id. */
export type HealthRecordEntry = HealthRecordData & { id: string; /** Valores fuera de rango que leyó la IA. */ flagged: number };
/** Una revisión de tu médico IA con su id. */
export type HealthConsultEntry = HealthConsultData & { id: string };
/** Una acción pendiente de la última revisión. */
export type DoctorPendingAction = DoctorAction & { consultId: string };

export interface HealthState {
  checkups: Record<string, CheckupState>;
  /** Activos atrasados o que tocan en ≤ `health.soonDays` días (atrasados primero). */
  due: HealthDueItem[];
  /** Activos sin ningún registro ni fecha anotada. */
  unknown: string[];
  /** % de chequeos activos al día (al día + te toca pronto); null si no hay activos. */
  score: number | null;
  counts: { active: number; alDia: number; pronto: number; atrasado: number; sinRegistro: number };
  /** Chequeos hechos, del más reciente al más antiguo. */
  history: CheckupDone[];
  doneThisYear: number;
  xpThisYear: number;
  /** Mediciones por serie, en orden cronológico. */
  metrics: Record<string, HealthMetricEntry[]>;
  /** Ficha médica (null si no se ha llenado). */
  card: HealthProfileData | null;
  /** Estudios y documentos, del más reciente al más antiguo. */
  records: HealthRecordEntry[];
  /** Lo gastado en salud (costo de los estudios) este año y en total. */
  spendThisYear: number;
  spendTotal: number;
  /** Revisiones de tu médico IA, de la más reciente a la más antigua. */
  consults: HealthConsultEntry[];
  /** La revisión más reciente que aún no abres (null si ya las viste). */
  unseenConsultId: string | null;
  /** Acciones de la última revisión que no has hecho ni descartado. */
  pendingActions: DoctorPendingAction[];
  /** Lo que tu médico IA debe saber de ti y cada cuándo te revisa. */
  doctor: HealthDoctorData;
  /** Siguiente revisión automática (null = manual o aún sin primera revisión). */
  nextReview: string | null;
}

interface CheckupDonePayload {
  checkupId: string;
  name?: string;
  size?: MissionSize;
  note?: string;
  result?: string;
}

interface MetricPayload {
  kind: HealthMetricKind;
  value: number;
  value2?: number;
  unit?: string;
  label?: string;
  note?: string;
  refLow?: number;
  refHigh?: number;
  recordId?: string;
}

const validSize = (s: unknown): s is MissionSize => typeof s === 'string' && (MISSION_SIZES as readonly string[]).includes(s);

/**
 * Salud: chequeos preventivos, mediciones y ficha médica.
 * - Hacer un chequeo da la XP de una misión de su tamaño (el guardado en el registro, o `health.checkupSize`), al
 *   atributo `health.attribute`. Cuenta UNA vez por chequeo por día: si hay varios registros del mismo chequeo el
 *   mismo día, cuenta el de más XP (así agregar un registro nunca baja la XP). No depende del catálogo: borrar o
 *   editar el chequeo no cambia la XP ya ganada.
 * - Mediciones y ficha médica: solo registro (sin XP).
 */
export function reduceHealth(ctx: Ctx): HealthState {
  const cfg = ctx.cfg.health;
  const defaultSize: MissionSize = validSize(cfg.checkupSize) ? cfg.checkupSize : 'media';
  const xpOf = (size: MissionSize) => (ctx.cfg.missionXp as Record<string, number>)[size] ?? 0;
  const attribute = cfg.attribute as AttributeId;
  const year = ctx.today.slice(0, 4);
  const checkupEntities = entitiesOf<CheckupData>(ctx, 'health', 'checkup');
  const nameOf = new Map(checkupEntities.map((c) => [c.id, c.data.name]));

  // --- Chequeos hechos: uno por chequeo y día (el de más XP; empate → el primero registrado) ---
  const best = new Map<string, CheckupDone & { createdAt: number }>();
  for (const ev of ofType<CheckupDonePayload>(ctx, 'health.checkup_done')) {
    const p = ev.payload;
    if (!p?.checkupId) continue;
    const size = validSize(p.size) ? p.size : defaultSize;
    const cand = {
      eventId: ev.id,
      checkupId: p.checkupId,
      date: ev.localDate,
      name: p.name?.trim() || nameOf.get(p.checkupId) || 'Chequeo',
      xp: xpOf(size),
      note: p.note || undefined,
      result: p.result || undefined,
      createdAt: ev.createdAt ?? 0,
    };
    const k = `${p.checkupId}|${ev.localDate}`;
    const cur = best.get(k);
    if (!cur || cand.xp > cur.xp || (cand.xp === cur.xp && (cand.createdAt < cur.createdAt || (cand.createdAt === cur.createdAt && cand.eventId < cur.eventId)))) best.set(k, cand);
  }
  const done = [...best.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
  for (const d of done) {
    ctx.addXp({ date: d.date, amount: d.xp, source: 'health', label: `Chequeo: ${d.name}`, attribute, eventId: d.eventId, refId: d.checkupId });
  }
  const history: CheckupDone[] = done.map(({ createdAt: _c, ...d }) => d).reverse();
  const byCheckup = new Map<string, CheckupDone[]>();
  for (const d of done) {
    if (!byCheckup.has(d.checkupId)) byCheckup.set(d.checkupId, []);
    byCheckup.get(d.checkupId)!.push(d);
  }

  // --- Estado de cada chequeo del catálogo ---
  const checkups: Record<string, CheckupState> = {};
  const due: HealthDueItem[] = [];
  const unknown: string[] = [];
  const counts = { active: 0, alDia: 0, pronto: 0, atrasado: 0, sinRegistro: 0 };
  for (const c of checkupEntities) {
    const d = c.data;
    const list = byCheckup.get(c.id) ?? [];
    const lastEvent = list.at(-1) ?? null;
    const manual = d.lastDone && isDateString(d.lastDone) && d.lastDone <= ctx.today ? d.lastDone : null;
    const lastDone = lastEvent && (!manual || lastEvent.date >= manual) ? lastEvent.date : manual;
    const everyMonths = Math.max(0, Math.floor(Number(d.everyMonths) || 0));
    const timing = checkupTiming(lastDone, everyMonths, ctx.today, cfg.soonDays);
    const size = validSize(d.size) ? d.size : defaultSize;
    const active = d.active !== false;
    const st: CheckupState = {
      id: c.id,
      name: d.name,
      category: d.category,
      everyMonths,
      active,
      size,
      xp: xpOf(size),
      lastDone,
      lastResult: lastEvent?.result ?? null,
      ...timing,
      timesDone: list.length,
      doneToday: lastEvent?.date === ctx.today,
    };
    checkups[c.id] = st;
    if (!active) continue;
    counts.active++;
    if (st.status === 'al_dia') counts.alDia++;
    else if (st.status === 'pronto') counts.pronto++;
    else if (st.status === 'atrasado') counts.atrasado++;
    else counts.sinRegistro++;
    if ((st.status === 'atrasado' || st.status === 'pronto') && st.nextDue && st.daysLeft !== null)
      due.push({ checkupId: c.id, name: d.name, category: d.category, status: st.status, nextDue: st.nextDue, daysLeft: st.daysLeft, xp: st.xp });
    if (st.status === 'sin_registro') unknown.push(c.id);
  }
  due.sort((a, b) => a.daysLeft - b.daysLeft || (a.name < b.name ? -1 : 1));

  // --- Mediciones ---
  const metrics: Record<string, HealthMetricEntry[]> = {};
  for (const ev of ofType<MetricPayload>(ctx, 'health.metric')) {
    const p = ev.payload;
    if (!HEALTH_METRIC_INFO[p.kind]) continue;
    // Una "otra" con nombre conocido (p. ej. "Triglicéridos" en mg/dL) se agrupa con la suya.
    const kind = resolveMetricKind(p.kind, p.label, p.unit);
    const info = HEALTH_METRIC_INFO[kind];
    const key = healthMetricKey(kind, p.label);
    const reading = kind === 'otro' ? classifyAgainstRange(p.value, p.refLow, p.refHigh) : classifyHealthMetric(kind, p.value, p.value2);
    const ref = fmtRange(p.refLow, p.refHigh);
    (metrics[key] ??= []).push({
      eventId: ev.id,
      date: ev.localDate,
      kind,
      key,
      label: kind === 'otro' ? p.label?.trim() || info.name : info.name,
      value: p.value,
      value2: kind === 'presion' ? p.value2 : undefined,
      unit: (kind === 'otro' ? p.unit?.trim() : '') || info.unit || p.unit?.trim() || '',
      note: p.note || undefined,
      level: reading?.level ?? null,
      levelText: reading?.text ?? null,
      ...(ref ? { ref } : {}),
      ...(p.recordId ? { recordId: p.recordId } : {}),
    });
  }

  // --- Ficha médica ---
  const cardEntity = ctx.entityById.get(HEALTH_PROFILE_ID);
  const card = cardEntity && cardEntity.module === 'health' ? ((cardEntity.data ?? {}) as HealthProfileData) : null;

  // --- Estudios y documentos ---
  const records: HealthRecordEntry[] = entitiesOf<HealthRecordData>(ctx, 'health', 'record')
    .filter((e) => e.data && typeof e.data.title === 'string')
    .map((e) => ({
      ...e.data,
      id: e.id,
      files: Array.isArray(e.data.files) ? e.data.files : [],
      flagged: (e.data.ai?.values ?? []).filter((v) => v.flag).length,
      _sort: e.createdAt ?? e.sort ?? 0,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b._sort - a._sort))
    .map(({ _sort, ...r }) => r);
  const costOf = (r: HealthRecordEntry) => (typeof r.cost === 'number' && Number.isFinite(r.cost) && r.cost > 0 ? r.cost : 0);
  const spendThisYear = records.filter((r) => r.date?.startsWith(year)).reduce((t, r) => t + costOf(r), 0);
  const spendTotal = records.reduce((t, r) => t + costOf(r), 0);

  // --- Tu médico IA ---
  const consults: HealthConsultEntry[] = entitiesOf<HealthConsultData>(ctx, 'health', 'consult')
    .filter((e) => e.data && isDateString(e.data.date) && typeof e.data.title === 'string')
    .map((e) => ({ ...e.data, id: e.id, actions: Array.isArray(e.data.actions) ? e.data.actions : [], _sort: e.createdAt ?? e.sort ?? 0 }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b._sort - a._sort))
    .map(({ _sort, ...c }) => c);
  const latest = consults[0] ?? null;
  const pendingActions: DoctorPendingAction[] = latest
    ? latest.actions.filter((a) => !a.doneAt && !a.dismissedAt).map((a) => ({ ...a, consultId: latest.id }))
    : [];
  const doctorEntity = ctx.entityById.get(HEALTH_DOCTOR_ID);
  const doctor = (doctorEntity && doctorEntity.module === 'health' ? doctorEntity.data ?? {} : {}) as HealthDoctorData;

  const thisYear = history.filter((h) => h.date.startsWith(year));
  return {
    checkups,
    due,
    unknown,
    score: counts.active ? Math.round(((counts.alDia + counts.pronto) / counts.active) * 100) : null,
    counts,
    history,
    doneThisYear: thisYear.length,
    xpThisYear: thisYear.reduce((s, h) => s + h.xp, 0),
    metrics,
    card,
    records,
    spendThisYear,
    spendTotal,
    consults,
    unseenConsultId: latest && !latest.seenAt ? latest.id : null,
    pendingActions,
    doctor,
    nextReview: nextDoctorReview(latest?.date ?? null, doctor.cadence),
  };
}
