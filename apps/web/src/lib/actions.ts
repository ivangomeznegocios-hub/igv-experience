import { TRAINING_SETTINGS_ID, linkedTrainingDailyId, quickMissionId, type TrainingSettingsData, type AttributeId, type CompletionKind, type Entity, type GameEvent, type GeneratedMission, type MissionData, type MissionSize, type SettingsData, type TodoData } from '@igv/core';
import { addEvent, getEntity, getEvents, restoreEvent, saveEntity, voidEvent } from '../data/store';
import { toast, undoToast } from '../ui/kit';
import { openWorkout } from './entreno';
import { newId } from './time';

type CompletionInput = { missionId: string; title: string; size: MissionSize; attribute: AttributeId; kind: CompletionKind; mainQuestId?: string | null; npcId?: string | null };

/** Registra una misión completada (con aviso de "Deshacer"). `date` permite registrar días pasados. */
export function complete(p: CompletionInput, date?: string, opts: { silent?: boolean } = {}): GameEvent {
  const ev = addEvent('mission.completed', p, date ? { localDate: date } : {});
  if (!opts.silent) undoToast(`✓ ${p.title}`, () => voidEvent(ev.id));
  return ev;
}

/**
 * ¿Esta misión es tu entreno? Solo la diaria ligada en Entrenamiento → Ajustes (por defecto "Entrenar 30 min"): así,
 * al anotar el entreno después, no se crea otra misión "Entrenar" (la XP no se duplica).
 */
function isTrainingMission(m: Entity<MissionData>): boolean {
  return linkedTrainingDailyId(getEntity(TRAINING_SETTINGS_ID)?.data as TrainingSettingsData | undefined, [m]) === m.id;
}

export function completeMission(m: Entity<MissionData>, date?: string) {
  if (isTrainingMission(m)) {
    // Después del "✓", ofrece anotar qué entrenaste (músculos y récords). La misión ya contó: no se duplica la XP.
    setTimeout(() => toast('¿Qué entrenaste?', 'info', { label: 'Anotar', run: () => openWorkout({ date }) }), 400);
  }
  return complete(
    {
      missionId: m.id,
      title: m.data.title,
      size: m.data.size,
      attribute: m.data.attribute,
      kind: m.kind as CompletionKind,
      mainQuestId: m.data.mainQuestId ?? null,
    },
    date,
  );
}

export function completeGenerated(m: GeneratedMission, date?: string) {
  return complete({ missionId: m.id, title: m.title, size: m.size, attribute: m.attribute, kind: 'npc', npcId: m.npcId }, date);
}

/** "Hice algo": misión sin catálogo. Se repite una vez por día por título. */
export function completeQuick(title: string, size: MissionSize, attribute: AttributeId, date?: string) {
  const t = title.trim();
  return complete({ missionId: quickMissionId(t), title: t, size, attribute, kind: 'quick' }, date);
}

export function completeTodo(t: Entity<TodoData>, date?: string) {
  return complete({ missionId: t.id, title: t.data.title, size: t.data.size, attribute: t.data.attribute, kind: 'todo' }, date);
}

/** Eventos vigentes de "misión completada" para una misión (en un día, o en cualquier día). */
export function completionEvents(missionId: string, date?: string): GameEvent[] {
  return getEvents().filter((e) => !e.voidedAt && e.type === 'mission.completed' && e.payload?.missionId === missionId && (!date || e.localDate === date));
}

/** Desmarcar: anula los registros de esa misión en ese día (corrige un error; no es castigo). */
export function uncomplete(missionId: string, date?: string, title?: string) {
  const evs = completionEvents(missionId, date);
  evs.forEach((e) => voidEvent(e.id));
  if (evs.length) undoToast(`Desmarcada${title ? `: ${title}` : ''}`, () => evs.forEach((e) => restoreEvent(e.id)));
}

export function writeLesson(text: string, mission: Entity<MissionData> | null, date?: string) {
  const attribute: AttributeId = mission?.data.attribute ?? 'inteligencia';
  return addEvent('lesson.written', { text, missionId: mission?.id ?? null, attribute }, date ? { localDate: date } : {});
}

export function updateSettings(current: SettingsData, patch: Partial<SettingsData>) {
  return saveEntity({ id: 'settings', module: 'profile', kind: 'settings', data: { ...current, ...patch }, sort: 0 });
}

/** Una misión no repetible ya completada. */
export function isDone(completions: Record<string, { count: number }>, id: string) {
  return (completions[id]?.count ?? 0) > 0;
}

export function saveTodo(data: TodoData, id?: string) {
  return saveEntity<TodoData>({ id: id ?? `todo-${newId().slice(0, 8)}`, module: 'planner', kind: 'todo', data });
}
