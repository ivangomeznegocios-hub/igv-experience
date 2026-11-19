import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { SavingsData } from '../../types';
import { weekStart } from '../../util/dates';

export interface BodyEntry {
  eventId: string;
  date: string;
  weightKg?: number;
  workout?: string;
  note?: string;
}

export interface BodyState {
  entries: BodyEntry[];
  lastWeight: { date: string; kg: number } | null;
  firstWeight: { date: string; kg: number } | null;
  workoutsThisWeek: number;
  /** Horas de sueño por día (del check-in de la mañana). */
  sleep: { date: string; hours: number }[];
}

/** Cuerpo: peso, entrenamientos y sueño. Solo registro: no da XP (la XP viene de las misiones). */
export function reduceBody(ctx: Ctx): BodyState {
  const entries: BodyEntry[] = ofType<{ weightKg?: number; workout?: string; note?: string }>(ctx, 'body.logged').map((e) => ({ eventId: e.id, date: e.localDate, ...e.payload }));
  const weights = entries.filter((e) => typeof e.weightKg === 'number');
  const wk = weekStart(ctx.today);
  const sleepByDate = new Map<string, number>();
  for (const e of ofType<{ sleepHours: number }>(ctx, 'checkin.morning')) sleepByDate.set(e.localDate, e.payload.sleepHours);
  return {
    entries,
    lastWeight: weights.length ? { date: weights.at(-1)!.date, kg: weights.at(-1)!.weightKg! } : null,
    firstWeight: weights.length ? { date: weights[0].date, kg: weights[0].weightKg! } : null,
    workoutsThisWeek: entries.filter((e) => e.workout?.trim() && e.date >= wk).length,
    sleep: [...sleepByDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, hours]) => ({ date, hours })),
  };
}

export interface SavingsState {
  current: number;
  target: number;
  progress: number;
  moves: { eventId: string; date: string; amount: number }[];
}

/** Metas de ahorro: dinero real, sistema separado de la XP. */
export function reduceSavings(ctx: Ctx): Record<string, SavingsState> {
  const out: Record<string, SavingsState> = {};
  const evs = ofType<{ goalId: string; amount: number }>(ctx, 'savings.moved');
  for (const g of entitiesOf<SavingsData>(ctx, 'finance', 'savings')) {
    const moves = evs.filter((e) => e.payload.goalId === g.id).map((e) => ({ eventId: e.id, date: e.localDate, amount: e.payload.amount }));
    const current = moves.reduce((s, m) => s + m.amount, 0);
    const target = Math.max(0, g.data.target || 0);
    out[g.id] = { current, target, progress: target > 0 ? Math.max(0, Math.min(1, current / target)) : 0, moves };
  }
  return out;
}

export interface DayClosure {
  eventId: string;
  note: string;
  mood?: number;
}

/** Cierres del día (la última versión del día gana). No dan XP. */
export function reduceDayClosures(ctx: Ctx): Record<string, DayClosure> {
  const out: Record<string, DayClosure> = {};
  for (const e of ofType<{ note: string; mood?: number }>(ctx, 'day.closed')) out[e.localDate] = { eventId: e.id, note: e.payload.note ?? '', mood: e.payload.mood };
  return out;
}
