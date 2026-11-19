import type { Ctx, XpEntry } from '../context';
import { ofType } from '../context';

export interface Redemption {
  eventId: string;
  date: string;
  rewardId: string;
  name: string;
  cost: number;
  /** false si no alcanzaba el oro en ese momento (no cuenta). */
  valid: boolean;
}

export interface GoldState {
  earned: number;
  spent: number;
  balance: number;
  earnedToday: number;
  redemptions: Redemption[];
}

/** Oro que da una entrada de XP. */
export function goldFor(entry: Pick<XpEntry, 'amount'>, xpPerGold: number): number {
  return xpPerGold > 0 ? Math.floor(entry.amount / xpPerGold) : 0;
}

/**
 * Oro: moneda del juego separada de la XP. Se gana con cada entrada de XP y se gasta en la tienda.
 * Canjear un premio NUNCA toca la XP. Un canje solo cuenta si en su fecha alcanzaba el oro
 * (se evalúan en orden cronológico), así el saldo nunca es negativo.
 */
export function reduceGold(ctx: Ctx, xp: XpEntry[]): GoldState {
  const per = ctx.cfg.gold.xpPerGold;
  const earnedByDate = new Map<string, number>();
  let earned = 0;
  let earnedToday = 0;
  for (const e of xp) {
    const g = goldFor(e, per);
    if (!g) continue;
    earned += g;
    if (e.date === ctx.today) earnedToday += g;
    earnedByDate.set(e.date, (earnedByDate.get(e.date) ?? 0) + g);
  }
  const dates = [...earnedByDate.keys()].sort();
  const earnedThrough = (date: string) => {
    let s = 0;
    for (const d of dates) {
      if (d > date) break;
      s += earnedByDate.get(d)!;
    }
    return s;
  };

  const redemptions: Redemption[] = [];
  let spent = 0;
  const evs = [...ofType<{ rewardId: string; name: string; cost: number }>(ctx, 'reward.redeemed')].sort(
    (a, b) => (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0)),
  );
  for (const ev of evs) {
    const valid = earnedThrough(ev.localDate) - spent >= ev.payload.cost;
    if (valid) spent += ev.payload.cost;
    redemptions.push({ eventId: ev.id, date: ev.localDate, rewardId: ev.payload.rewardId, name: ev.payload.name, cost: ev.payload.cost, valid });
  }
  return { earned, spent, balance: earned - spent, earnedToday, redemptions };
}
