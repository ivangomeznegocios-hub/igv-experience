import { REPEATABLE_KINDS } from '../engine/modules/missions';
import type { GameState } from '../engine/project';
import type { GameEvent } from '../types';
import type { VoiceProposal } from './parse';
import { norm } from './text';

/**
 * ¿La propuesta ya está registrada? Devuelve por qué (para avisar y no duplicar) o null.
 * - Misiones: las repetibles una vez por día; las demás, una sola vez.
 * - Descanso y contacto con una persona: uno por día.
 * - Dinero y lecciones: si ese día ya hay uno igual (mismo monto y concepto / mismo texto). Así, procesar otra
 *   vez una nota (p. ej. después de que el Coach alcanzó a registrar parte) no duplica gastos ni da XP de más.
 */
export function voiceDuplicate(p: VoiceProposal, state: GameState, events: GameEvent[]): string | null {
  const live = (type: string) => events.filter((e) => !e.voidedAt && e.type === type && e.localDate === p.date);
  switch (p.kind) {
    case 'mission': {
      const c = state.missions.completions[p.missionId];
      if (!c) return null;
      if (REPEATABLE_KINDS.has(p.missionKind)) return c.dates.includes(p.date) ? 'Ya estaba registrada ese día' : null;
      return c.count > 0 ? 'Ya la habías completado' : null;
    }
    case 'rest':
      return live('rest_day.marked').length ? 'Ya estaba marcado' : null;
    case 'person':
      return live('npc.interaction').some((e) => e.payload?.npcId === p.npcId) ? 'Ya estaba registrado ese día' : null;
    case 'income':
    case 'expense': {
      const concept = norm(p.concept);
      return live(p.kind === 'income' ? 'income.recorded' : 'expense.recorded').some((e) => Number(e.payload?.amount) === p.amount && norm(String(e.payload?.concept ?? '')) === concept)
        ? 'Ya estaba registrado ese día'
        : null;
    }
    case 'lesson': {
      const text = norm(p.text);
      return live('lesson.written').some((e) => norm(String(e.payload?.text ?? '')) === text) ? 'Ya estaba registrada ese día' : null;
    }
    default:
      return null;
  }
}
