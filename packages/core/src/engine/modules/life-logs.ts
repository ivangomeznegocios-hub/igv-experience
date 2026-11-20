import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { SavingsData } from '../../types';
import { weekStart } from '../../util/dates';
import { measureDates, measuresAsOf, type BodyMeasures } from '../physique';

export interface BodyEntry extends BodyMeasures {
  eventId: string;
  date: string;
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
  /** Último valor conocido de cada medida (peso, % de grasa, contornos). */
  latest: BodyMeasures;
  /** Fechas en las que cambió alguna medida (puntos de la línea de tiempo del personaje). */
  measureDates: string[];
}

/** Cuerpo: peso, entrenamientos y sueño. Solo registro: no da XP (la XP viene de las misiones). */
export function reduceBody(ctx: Ctx): BodyState {
  const entries: BodyEntry[] = ofType<BodyMeasures & { workout?: string; note?: string }>(ctx, 'body.logged').map((e) => ({ eventId: e.id, date: e.localDate, ...e.payload }));
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
    latest: measuresAsOf(entries, ctx.today),
    measureDates: measureDates(entries),
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
  /** Diarias que tocaban al cerrar (si se guardaron). */
  routine?: string[];
}

/** Cierres del día (la última versión del día gana). No dan XP. */
export function reduceDayClosures(ctx: Ctx): Record<string, DayClosure> {
  const out: Record<string, DayClosure> = {};
  for (const e of ofType<{ note: string; mood?: number; routine?: string[] }>(ctx, 'day.closed')) {
    // Editar la nota o el ánimo después no descongela la rutina del día: se conserva la que ya estaba.
    const routine = e.payload.routine ?? out[e.localDate]?.routine;
    out[e.localDate] = { eventId: e.id, note: e.payload.note ?? '', mood: e.payload.mood, routine };
  }
  return out;
}
