import type { Ctx } from '../context';
import { ofType } from '../context';
import type { AttributeId, CompletionKind, MissionSize } from '../../types';
import { REPEATABLE_KINDS, type MissionsState } from './missions';

export interface PlanItem {
  missionId: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  kind: CompletionKind;
}

export interface DayPlan {
  eventId: string;
  forDate: string;
  items: (PlanItem & { done: boolean })[];
  /** Cumpliste todo lo que planeaste (al menos 1 cosa). */
  completed: boolean;
}

/**
 * "Planear mañana": la última versión del plan de cada día gana. Una cosa del plan está hecha si su
 * misión se completó ese mismo día. No da XP (solo un bono de oro en el módulo de oro).
 */
export function reducePlans(ctx: Ctx, missions: MissionsState): Record<string, DayPlan> {
  const out: Record<string, DayPlan> = {};
  for (const e of ofType<{ forDate: string; items: PlanItem[] }>(ctx, 'plan.set')) {
    const forDate = e.payload.forDate;
    const items = (e.payload.items ?? []).map((it) => {
      const dates = missions.completions[it.missionId]?.dates ?? [];
      // Lo que solo cuenta una vez (pendientes, secundarias…) y ya se hizo antes de ese día también está hecho:
      // volver a completarlo no contaría y la cosa quedaría atorada para siempre.
      const done = dates.includes(forDate) || (!REPEATABLE_KINDS.has(it.kind) && dates.some((d) => d <= forDate));
      return { ...it, done };
    });
    out[forDate] = { eventId: e.id, forDate, items, completed: items.length > 0 && items.every((i) => i.done) };
  }
  return out;
}
