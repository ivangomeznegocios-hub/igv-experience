import type { Ctx } from '../context';
import { ofType } from '../context';
import type { AttributeId, CompletionKind, MissionSize } from '../../types';
import type { MissionsState } from './missions';

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
    const items = (e.payload.items ?? []).map((it) => ({ ...it, done: !!missions.completions[it.missionId]?.dates.includes(forDate) }));
    out[forDate] = { eventId: e.id, forDate, items, completed: items.length > 0 && items.every((i) => i.done) };
  }
  return out;
}
