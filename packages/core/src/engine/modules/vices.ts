import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { ViceData } from '../../types';
import { diffDays } from '../../util/dates';

export interface ViceState {
  /** Días seguidos sin caer (hasta hoy). */
  current: number;
  best: number;
  relapses: { eventId: string; date: string; note?: string }[];
  lastRelapse: string | null;
  /** Ya se registró una recaída hoy. */
  relapsedToday: boolean;
}

/** Malos hábitos ("enemigos"): solo cuentan días sin caer. Nunca dan ni quitan XP. */
export function reduceVices(ctx: Ctx): Record<string, ViceState> {
  const out: Record<string, ViceState> = {};
  const all = ofType<{ viceId: string; note?: string }>(ctx, 'vice.relapse');
  for (const v of entitiesOf<ViceData>(ctx, 'habits', 'vice')) {
    const start = v.data.startDate;
    const relapses = all.filter((e) => e.payload.viceId === v.id && e.localDate >= start).map((e) => ({ eventId: e.id, date: e.localDate, note: e.payload.note }));
    let best = 0;
    let from = start;
    for (const r of relapses) {
      best = Math.max(best, diffDays(from, r.date));
      from = r.date;
    }
    const current = Math.max(0, diffDays(from, ctx.today));
    best = Math.max(best, current);
    out[v.id] = {
      current,
      best,
      relapses,
      lastRelapse: relapses.at(-1)?.date ?? null,
      relapsedToday: relapses.some((r) => r.date === ctx.today),
    };
  }
  return out;
}
