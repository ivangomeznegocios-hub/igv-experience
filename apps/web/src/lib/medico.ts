import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HEALTH_FILE_MAX_BYTES,
  HEALTH_FILE_MIMES,
  HEALTH_SUGGESTIONS,
  ageOn,
  buildHealthDossier,
  doctorReviewDue,
  isDateString,
  recordValueToMetric,
  suggestionCheckupId,
  type CheckupData,
  type DoctorAction,
  type Entity,
  type GameState,
  type HealthConsultData,
  type HealthDoctorData,
  type HealthFileRef,
  type HealthRecordData,
  type HealthRecordValue,
} from '@igv/core';
import { addEvent, deleteEntity, getEntity, restoreEvent, saveEntity, useGame, voidEvent } from '../data/store';
import { medicoApi, type ConsultResult, type ReadResult } from '../data/medicoApi';
import { toast, undoToast } from '../ui/kit';
import { saveCheckup } from './health';
import { newId } from './time';

/** Tu médico IA y Estudios: archivos, lectura con IA, revisiones y acciones (las usan /salud, Hoy y la revisión automática). */

// ---------------------------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------------------------

export interface PreparedFile {
  name: string;
  mime: string;
  b64: string;
  size: number;
  /** Vista previa local (fotos). */
  preview?: string;
}

const MAX_SIDE = 2200;

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('No pude leer el archivo'));
    r.readAsDataURL(blob);
  });
}

/** Fotos: se reducen a ~2200 px y JPEG (un resultado fotografiado pesa ~300–700 KB). PDF: tal cual. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  const type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  if (type === 'application/pdf') {
    if (file.size > HEALTH_FILE_MAX_BYTES) throw new Error(`"${file.name}" pesa más de ${Math.round(HEALTH_FILE_MAX_BYTES / 1024 / 1024)} MB.`);
    return { name: file.name, mime: type, b64: await blobToB64(file), size: file.size };
  }
  if (!type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) throw new Error(`"${file.name}": sube un PDF o una foto.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`No pude abrir "${file.name}". Toma la foto de nuevo o súbela como JPG o PDF.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const keep = scale === 1 && (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') && file.size <= 1_500_000;
  if (keep) {
    bitmap.close?.();
    return { name: file.name, mime: type, b64: await blobToB64(file), size: file.size, preview: URL.createObjectURL(file) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Tu navegador no pudo procesar la foto.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('No pude comprimir la foto.');
  const name = file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
  return { name, mime: 'image/jpeg', b64: await blobToB64(blob), size: blob.size, preview: URL.createObjectURL(blob) };
}

export const isAllowedMime = (m: string) => (HEALTH_FILE_MIMES as readonly string[]).includes(m);

/** Sube varios archivos en orden (avisa el avance). Si uno falla, borra los que ya subió y lanza el error. */
export async function uploadFiles(files: PreparedFile[], onProgress?: (done: number) => void): Promise<HealthFileRef[]> {
  const out: HealthFileRef[] = [];
  try {
    for (const f of files) {
      out.push(await medicoApi.upload(f.name, f.mime, f.b64));
      onProgress?.(out.length);
    }
  } catch (err) {
    await Promise.all(out.map((f) => medicoApi.deleteFile(f.id).catch(() => undefined)));
    throw err;
  }
  return out;
}

const urlCache = new Map<string, string>();

/** URL local (blob) para ver o descargar un archivo; se baja una vez por sesión. */
export async function fileUrl(ref: HealthFileRef): Promise<string> {
  const hit = urlCache.get(ref.id);
  if (hit) return hit;
  const f = await medicoApi.file(ref.id);
  const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
  urlCache.set(ref.id, url);
  return url;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------------------------
// Estudios
// ---------------------------------------------------------------------------------------------

export const newRecordId = () => `hrec-${newId().replace(/-/g, '').slice(0, 10)}`;

export function saveRecord(id: string, data: HealthRecordData): Entity<HealthRecordData> {
  return saveEntity<HealthRecordData>({ id, module: 'health', kind: 'record', data });
}

/** "Hombre, 34 años" para que la IA lea los rangos por edad. */
export function profileLine(state: GameState): string {
  const b = state.settings.birthDate;
  return b && isDateString(b) ? `Hombre, ${ageOn(b, state.today).years} años` : 'Hombre adulto';
}

export function readingValues(r: ReadResult): HealthRecordValue[] {
  return r.values.map((v) => ({ ...v, kind: v.kind ?? null }));
}

/** Los valores que se pueden guardar como mediciones (índice del valor → medición). */
export function savableValues(values: HealthRecordValue[]) {
  return values.map((v, i) => ({ i, v, metric: recordValueToMetric(v) })).filter((x) => x.metric);
}

/**
 * Guarda lo que leyó la IA en el estudio (rellena título, lugar, médico y costo si estaban vacíos; la fecha del
 * documento gana si `preferReadingDate`) y crea las mediciones elegidas (con la fecha del estudio y enlazadas a él).
 * Volver a leer REEMPLAZA las mediciones que ya había sacado de ese estudio (no se duplican). Con "Deshacer".
 */
export function applyReading(record: Entity<HealthRecordData>, reading: ReadResult, pick: Set<number>, today: string, preferReadingDate = false): Entity<HealthRecordData> {
  const prev = record;
  const d = record.data;
  const values = readingValues(reading);
  const fromDoc = reading.date && isDateString(reading.date) && reading.date <= today ? reading.date : null;
  const date = preferReadingDate && fromDoc ? fromDoc : d.date && isDateString(d.date) ? d.date : (fromDoc ?? today);
  const replaced = pick.size ? [...(d.metricEventIds ?? [])] : [];
  replaced.forEach((id) => voidEvent(id));
  const created: string[] = [];
  for (const { i, metric } of savableValues(values)) {
    if (!pick.has(i) || !metric) continue;
    const ev = addEvent('health.metric', { ...metric, recordId: record.id }, { localDate: date });
    created.push(ev.id);
  }
  const kept = pick.size ? [] : (d.metricEventIds ?? []);
  const data: HealthRecordData = {
    ...d,
    title: d.title?.trim() || reading.title,
    type: d.type ?? reading.type,
    date,
    place: d.place || reading.place || undefined,
    doctor: d.doctor || reading.doctor || undefined,
    cost: d.cost ?? reading.cost ?? null,
    ai: { readAt: new Date().toISOString(), summary: reading.summary, findings: reading.findings, values, recommendations: reading.recommendations },
    metricEventIds: [...kept, ...created],
  };
  const saved = saveRecord(record.id, data);
  undoToast(created.length ? `Guardado · ${created.length} ${created.length === 1 ? 'medición' : 'mediciones'}` : 'Lectura guardada', () => {
    created.forEach((id) => voidEvent(id));
    replaced.forEach((id) => restoreEvent(id));
    saveEntity(prev);
  });
  return saved;
}

/** Guarda en mediciones los valores elegidos de un estudio ya leído (los que no se guardaron antes). */
export function saveRecordMetrics(record: Entity<HealthRecordData>, pick: Set<number>) {
  const values = record.data.ai?.values ?? [];
  const created: string[] = [];
  for (const { i, metric } of savableValues(values)) {
    if (!pick.has(i) || !metric) continue;
    created.push(addEvent('health.metric', { ...metric, recordId: record.id }, { localDate: record.data.date }).id);
  }
  if (!created.length) return;
  const prev = record;
  saveRecord(record.id, { ...record.data, metricEventIds: [...(record.data.metricEventIds ?? []), ...created] });
  undoToast(`${created.length} ${created.length === 1 ? 'medición guardada' : 'mediciones guardadas'}`, () => {
    created.forEach((id) => voidEvent(id));
    saveEntity(prev);
  });
}

/** Registra el costo como gasto (categoría Salud). Dinero real: no da XP. */
export function recordExpense(record: Entity<HealthRecordData>): Entity<HealthRecordData> | null {
  const cost = record.data.cost;
  if (!(typeof cost === 'number' && cost > 0) || record.data.expenseEventId) return null;
  const ev = addEvent('expense.recorded', { amount: cost, concept: `Salud: ${record.data.title}`.slice(0, 300), category: 'Salud' }, { localDate: record.data.date });
  return saveRecord(record.id, { ...record.data, expenseEventId: ev.id });
}

/** Borra el estudio y sus archivos; las mediciones se quitan solo si se pide. El gasto se conserva (dinero aparte). */
export async function deleteRecord(record: Entity<HealthRecordData>, alsoMetrics: boolean) {
  deleteEntity(record.id);
  if (alsoMetrics) (record.data.metricEventIds ?? []).forEach((id) => voidEvent(id));
  await Promise.all(record.data.files.map((f) => medicoApi.deleteFile(f.id).catch(() => undefined)));
  toast('Estudio borrado');
}

// ---------------------------------------------------------------------------------------------
// Tu médico IA
// ---------------------------------------------------------------------------------------------

export function doctorOf(state: GameState): HealthDoctorData {
  return state.health.doctor ?? {};
}

export function saveDoctor(data: HealthDoctorData) {
  const clean: HealthDoctorData = {};
  for (const [k, v] of Object.entries(data) as [keyof HealthDoctorData, string | undefined][]) if (typeof v === 'string' && v.trim()) (clean as Record<string, string>)[k] = v.trim();
  return saveEntity<HealthDoctorData>({ id: 'health-doctor', module: 'health', kind: 'doctor', data: clean, sort: 0 });
}

export function consultFromResult(r: ConsultResult, kind: HealthConsultData['kind'], today: string, focus?: string): HealthConsultData {
  return {
    date: today,
    kind,
    title: r.title,
    message: r.message,
    status: r.status,
    highlights: r.highlights,
    actions: r.actions.map((a, i): DoctorAction => ({ id: `a${i + 1}`, text: a.text, why: a.why || undefined, type: a.type, priority: a.priority, checkup: a.checkup, metric: a.metric })),
    missing: r.missing,
    nextReviewDays: r.nextReviewDays,
    ...(focus ? { focus } : {}),
    seenAt: null,
  };
}

/** Pide una revisión con el expediente completo y la guarda (`health/consult`). */
export async function requestConsult(state: GameState, entities: Entity[], kind: HealthConsultData['kind'], focus?: string): Promise<Entity<HealthConsultData>> {
  const dossier = buildHealthDossier(state, entities);
  const r = await medicoApi.consult({ dossier, today: state.today, kind, focus: focus?.trim() || undefined });
  // La automática tiene id por día: si dos dispositivos la piden el mismo día, queda una sola.
  const id = kind === 'auto' ? `consult-auto-${state.today}` : `consult-${state.today}-${newId().replace(/-/g, '').slice(0, 6)}`;
  return saveEntity<HealthConsultData>({ id, module: 'health', kind: 'consult', data: consultFromResult(r, kind, state.today, focus) });
}

export function markConsultSeen(id: string) {
  const e = getEntity(id) as Entity<HealthConsultData> | undefined;
  if (!e || e.data.seenAt) return;
  saveEntity<HealthConsultData>({ ...e, data: { ...e.data, seenAt: new Date().toISOString() } });
}

/** Marca una acción como hecha o descartada (o la regresa a pendiente). */
export function setActionState(consultId: string, actionId: string, patch: Pick<DoctorAction, 'doneAt' | 'dismissedAt'>) {
  const e = getEntity(consultId) as Entity<HealthConsultData> | undefined;
  if (!e) return;
  const prev = e;
  saveEntity<HealthConsultData>({ ...e, data: { ...e.data, actions: e.data.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) } });
  if (patch.doneAt || patch.dismissedAt) undoToast(patch.doneAt ? 'Hecho ✓' : 'Descartado', () => saveEntity(prev));
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** El chequeo que ya tienes para una acción (por nombre o por recomendación parecida). */
export function checkupForAction(a: DoctorAction, checkups: Entity<CheckupData>[]): Entity<CheckupData> | undefined {
  if (!a.checkup) return undefined;
  const n = norm(a.checkup.name);
  return checkups.find((c) => norm(c.data.name) === n) ?? checkups.find((c) => c.data.suggestionId && norm(HEALTH_SUGGESTIONS.find((s) => s.id === c.data.suggestionId)?.name ?? '') === n);
}

/** Activa como chequeo lo que te recomendó (si coincide con una recomendación de la app, usa esa). */
export function activateActionCheckup(a: DoctorAction, checkups: Entity<CheckupData>[]): Entity<CheckupData> | null {
  if (!a.checkup) return null;
  const existing = checkupForAction(a, checkups);
  if (existing) {
    if (existing.data.active === false) return saveEntity<CheckupData>({ ...existing, data: { ...existing.data, active: true } });
    return existing;
  }
  const sug = HEALTH_SUGGESTIONS.find((s) => norm(s.name) === norm(a.checkup!.name));
  const data: CheckupData = {
    name: a.checkup.name,
    category: a.checkup.category,
    everyMonths: a.checkup.everyMonths,
    active: true,
    notes: a.why || undefined,
    lastDone: null,
    suggestionId: sug?.id ?? null,
  };
  const saved = sug && !checkups.some((c) => c.id === suggestionCheckupId(sug.id)) ? saveEntity<CheckupData>({ id: suggestionCheckupId(sug.id), module: 'health', kind: 'checkup', data }) : saveCheckup(data);
  undoToast(`Activado: ${saved.data.name}`, () => deleteEntity(saved.id));
  return saved;
}

// ---------------------------------------------------------------------------------------------
// Revisión automática (cada semana / quincena / mes)
// ---------------------------------------------------------------------------------------------

const AUTO_KEY = 'igv.medico.autoAttempt';

/**
 * Pide sola la revisión cuando ya toca (solo después de la primera, que se pide a mano en Salud → Tu médico).
 * Una vez por día como máximo, con conexión y después de sincronizar (para no duplicar la de otro dispositivo).
 */
export function DoctorAutoReview() {
  const { state, entities, store } = useGame();
  const navigate = useNavigate();
  const running = useRef(false);
  const last = state.health.consults[0]?.date ?? null;
  const due = doctorReviewDue(last, state.health.doctor.cadence, state.today);
  const synced = store.ready && !!store.lastSync && store.status === 'idle';
  useEffect(() => {
    if (!due || !synced || running.current || typeof navigator !== 'undefined' && !navigator.onLine) return;
    let tried: string | null = null;
    try {
      tried = localStorage.getItem(AUTO_KEY);
    } catch {
      /* sin almacenamiento: se intenta igual */
    }
    if (tried === state.today) return;
    try {
      localStorage.setItem(AUTO_KEY, state.today);
    } catch {
      /* nada */
    }
    running.current = true;
    (async () => {
      try {
        const st = await medicoApi.status();
        if (!st.enabled) return;
        await requestConsult(state, entities, 'auto');
        toast('Tu médico te dejó su revisión', 'info', { label: 'Ver', run: () => navigate('/salud?tab=medico') });
      } catch {
        // Sin conexión o sin clave: se intenta otro día.
      } finally {
        running.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, synced, state.today]);
  return null;
}
