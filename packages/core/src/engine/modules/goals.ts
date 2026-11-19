import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { GoalData } from '../../types';

export interface GoalState {
  current: number;
  target: number;
  /** 0..1 */
  progress: number;
  completedOn: string | null;
  entries: { eventId: string; date: string; amount: number; note?: string }[];
}

/** Metas con contador: al llegar al objetivo dan la XP de una misión de su tamaño (una sola vez). */
export function reduceGoals(ctx: Ctx): Record<string, GoalState> {
  const out: Record<string, GoalState> = {};
  const goals = entitiesOf<GoalData>(ctx, 'goals', 'goal');
  const byGoal = new Map<string, GoalState['entries']>();
  for (const ev of ofType<{ goalId: string; amount: number; note?: string }>(ctx, 'goal.progress')) {
    if (!byGoal.has(ev.payload.goalId)) byGoal.set(ev.payload.goalId, []);
    byGoal.get(ev.payload.goalId)!.push({ eventId: ev.id, date: ev.localDate, amount: ev.payload.amount, note: ev.payload.note });
  }
  for (const g of goals) {
    const entries = byGoal.get(g.id) ?? [];
    const target = Math.max(0, g.data.target || 0);
    let current = 0;
    let completedOn: string | null = null;
    for (const e of entries) {
      current += e.amount;
      if (!completedOn && target > 0 && current >= target) completedOn = e.date;
    }
    if (completedOn) {
      ctx.addXp({
        date: completedOn,
        amount: ctx.cfg.missionXp[g.data.size] ?? 0,
        source: 'goal',
        label: `Meta cumplida: ${g.data.title}`,
        attribute: g.data.attribute,
        refId: g.id,
      });
    }
    out[g.id] = { current, target, progress: target > 0 ? Math.min(1, current / target) : 0, completedOn, entries };
  }
  return out;
}
