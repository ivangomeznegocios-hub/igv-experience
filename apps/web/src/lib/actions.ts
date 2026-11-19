import type { AttributeId, Entity, GeneratedMission, MissionData, MissionKind, SettingsData } from '@igv/core';
import { addEvent, saveEntity } from '../data/store';

export function completeMission(m: Entity<MissionData>) {
  return addEvent('mission.completed', {
    missionId: m.id,
    title: m.data.title,
    size: m.data.size,
    attribute: m.data.attribute,
    kind: m.kind as MissionKind,
    mainQuestId: m.data.mainQuestId ?? null,
  });
}

export function completeGenerated(m: GeneratedMission) {
  return addEvent('mission.completed', {
    missionId: m.id,
    title: m.title,
    size: m.size,
    attribute: m.attribute,
    kind: 'npc',
    npcId: m.npcId,
  });
}

export function writeLesson(text: string, mission: Entity<MissionData> | null) {
  const attribute: AttributeId = mission?.data.attribute ?? 'inteligencia';
  return addEvent('lesson.written', { text, missionId: mission?.id ?? null, attribute });
}

export function updateSettings(current: SettingsData, patch: Partial<SettingsData>) {
  return saveEntity({ id: 'settings', module: 'profile', kind: 'settings', data: { ...current, ...patch }, sort: 0 });
}

/** Una misión no repetible ya completada. */
export function isDone(completions: Record<string, { count: number }>, id: string) {
  return (completions[id]?.count ?? 0) > 0;
}
