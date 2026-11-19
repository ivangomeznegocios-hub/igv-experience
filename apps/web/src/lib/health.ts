import {
  GAME_CONFIG,
  HEALTH_PROFILE_ID,
  suggestionCheckupId,
  type CheckupCategory,
  type CheckupData,
  type Entity,
  type HealthMetricKind,
  type HealthProfileData,
  type HealthSuggestion,
  type MissionSize,
} from '@igv/core';
import { addEvent, deleteEntity, saveEntity, voidEvent } from '../data/store';
import { undoToast } from '../ui/kit';
import { sfx } from './sound';
import { newId } from './time';

/** Acciones de Salud (las usan la pantalla /salud y el registro rápido). */

export const checkupSizeOf = (d: Pick<CheckupData, 'size'>): MissionSize => d.size ?? (GAME_CONFIG.health.checkupSize as MissionSize);
export const checkupXpOf = (d: Pick<CheckupData, 'size'>) => GAME_CONFIG.missionXp[checkupSizeOf(d)];

export const CATEGORY_ICON: Record<CheckupCategory, string> = {
  estudios: 'salud-flask',
  consulta: 'salud-stethoscope',
  dental: 'salud-tooth',
  vista: 'salud-eye',
  piel: 'salud-skin',
  vacuna: 'salud-syringe',
  otro: 'salud-cross',
};

/** "Ya lo hice": registra el chequeo (XP de misión de su tamaño) con "Deshacer". */
export function markCheckupDone(c: Entity<CheckupData>, date: string, extra: { result?: string; note?: string } = {}) {
  const size = checkupSizeOf(c.data);
  const ev = addEvent('health.checkup_done', { checkupId: c.id, name: c.data.name, size, result: extra.result?.trim() || undefined, note: extra.note?.trim() || undefined }, { localDate: date });
  sfx.coin();
  undoToast(`✓ ${c.data.name} · +${GAME_CONFIG.missionXp[size]} XP`, () => voidEvent(ev.id));
  return ev;
}

export function checkupFromSuggestion(s: HealthSuggestion): CheckupData {
  return { name: s.name, category: s.category, everyMonths: s.everyMonths, size: s.size, active: true, notes: s.why, suggestionId: s.id, lastDone: null };
}

/** Activa una recomendación (id fijo: activarla dos veces no duplica). Si estaba pausada, la reactiva. */
export function activateSuggestion(s: HealthSuggestion, existing?: Entity<CheckupData> | null): Entity<CheckupData> {
  if (existing) return saveEntity<CheckupData>({ ...existing, data: { ...existing.data, active: true } });
  return saveEntity<CheckupData>({ id: suggestionCheckupId(s.id), module: 'health', kind: 'checkup', data: checkupFromSuggestion(s) });
}

/** Activa varias con un toque (con "Deshacer"). */
export function activateMany(list: HealthSuggestion[]) {
  const created = list.map((s) => activateSuggestion(s));
  sfx.questStart();
  undoToast(`${created.length} ${created.length === 1 ? 'chequeo activado' : 'chequeos activados'}`, () => created.forEach((e) => deleteEntity(e.id)));
}

export function saveCheckup(data: CheckupData, id?: string): Entity<CheckupData> {
  return saveEntity<CheckupData>({ id: id ?? `chk-${newId().replace(/-/g, '').slice(0, 8)}`, module: 'health', kind: 'checkup', data });
}

export function saveHealthCard(data: HealthProfileData) {
  const clean: HealthProfileData = {};
  for (const [k, v] of Object.entries(data) as [keyof HealthProfileData, string | undefined][]) if (v?.trim()) clean[k] = v.trim();
  return saveEntity<HealthProfileData>({ id: HEALTH_PROFILE_ID, module: 'health', kind: 'profile', data: clean, sort: 0 });
}

export interface MetricInput {
  kind: HealthMetricKind;
  value: number;
  value2?: number;
  unit?: string;
  label?: string;
  note?: string;
}

export function logMetric(m: MetricInput, date: string) {
  const ev = addEvent(
    'health.metric',
    {
      kind: m.kind,
      value: m.value,
      value2: m.kind === 'presion' ? m.value2 : undefined,
      unit: m.kind === 'otro' ? m.unit?.trim() || undefined : undefined,
      label: m.kind === 'otro' ? m.label?.trim() : undefined,
      note: m.note?.trim() || undefined,
    },
    { localDate: date },
  );
  undoToast('Medición guardada', () => voidEvent(ev.id));
  return ev;
}
