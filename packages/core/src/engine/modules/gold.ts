import type { Ctx, XpEntry } from '../context';
import { ofType } from '../context';
import { pickForDate } from '../reports';
import type { DayPlan } from './plans';

export interface Redemption {
  eventId: string;
  date: string;
  rewardId: string;
  name: string;
  cost: number;
  /** false si no alcanzaba el oro en ese momento (no cuenta). */
  valid: boolean;
}

export interface GoldBonus {
  date: string;
  amount: number;
  source: 'plan' | 'day_close' | 'pledge';
  label: string;
}

export interface Pledge {
  pledgeId: string;
  eventId: string;
  title: string;
  stake: number;
  madeOn: string;
  deadline: string;
  /** false si no alcanzaba el oro al hacerlo (no cuenta). */
  valid: boolean;
  status: 'open' | 'kept' | 'missed';
  resolvedOn: string | null;
  resolveEventId: string | null;
  /** Oro que regresó (stake × multiplicador si cumpliste). */
  payout: number;
}

export interface GoldState {
  earned: number;
  /** Oro ganado por bonos (plan cumplido, cierre del día, compromisos). Incluido en `earned`. */
  bonuses: GoldBonus[];
  pledges: Pledge[];
  /** Oro apostado en compromisos abiertos (ya descontado del saldo). */
  locked: number;
  spent: number;
  balance: number;
  earnedToday: number;
  redemptions: Redemption[];
}

/** Oro que da una entrada de XP. */
export function goldFor(entry: Pick<XpEntry, 'amount'>, xpPerGold: number): number {
  return xpPerGold > 0 ? Math.floor(entry.amount / xpPerGold) : 0;
}

/** Bono sorpresa (determinista) de cerrar un día. */
export function dayCloseBonus(date: string, options: readonly number[]): number {
  return pickForDate([...options], date, 'cierre') ?? 0;
}

/**
 * Oro: moneda del juego separada de la XP. Se gana con cada entrada de XP y con bonos, y se gasta en
 * la tienda y en compromisos.
 * Canjear un premio NUNCA toca la XP. Un canje solo cuenta si en su fecha alcanzaba el oro
 * (se evalúan en orden cronológico), así el saldo nunca es negativo.
 */
export function reduceGold(ctx: Ctx, xp: XpEntry[], deps: { activeDays: Set<string>; plans: Record<string, DayPlan> } = { activeDays: new Set(), plans: {} }): GoldState {
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
  // Bonos fijos (no dependen del saldo).
  const bonuses: GoldBonus[] = [];
  const addCredit = (date: string, amount: number) => {
    if (amount <= 0) return;
    earned += amount;
    if (date === ctx.today) earnedToday += amount;
    earnedByDate.set(date, (earnedByDate.get(date) ?? 0) + amount);
  };
  for (const plan of Object.values(deps.plans)) {
    if (!plan.completed || plan.forDate > ctx.today) continue;
    const amount = ctx.cfg.goldBonus.planCompleted;
    bonuses.push({ date: plan.forDate, amount, source: 'plan', label: 'Cumpliste tu plan del día' });
    addCredit(plan.forDate, amount);
  }
  const closedDates = new Set(ofType(ctx, 'day.closed').map((e) => e.localDate));
  for (const d of [...closedDates].sort()) {
    if (!deps.activeDays.has(d)) continue;
    const amount = dayCloseBonus(d, ctx.cfg.goldBonus.dayCloseOptions);
    bonuses.push({ date: d, amount, source: 'day_close', label: 'Bono sorpresa por cerrar el día' });
    addCredit(d, amount);
  }

  // Oro ganado hasta una fecha (inclusive). Los cargos se evalúan en orden cronológico, así que basta con un
  // cursor que avanza (antes se recorrían todas las fechas por cada cargo). Los pagos de compromisos que se
  // acreditan durante el recorrido pueden caer en una fecha ya pasada por el cursor: se suman aparte.
  const creditDates = [...earnedByDate.keys()].sort();
  let cursorIdx = 0;
  let cursorSum = 0;
  let cursorDate = '';
  const lateCredits: { date: string; amount: number }[] = [];
  const earnedThrough = (date: string) => {
    while (cursorIdx < creditDates.length && creditDates[cursorIdx] <= date) {
      cursorSum += earnedByDate.get(creditDates[cursorIdx]) ?? 0;
      cursorIdx++;
    }
    cursorDate = date;
    let late = 0;
    for (const c of lateCredits) if (c.date <= date) late += c.amount;
    return cursorSum + late;
  };
  const addLateCredit = (date: string, amount: number) => {
    addCredit(date, amount);
    // Si la fecha ya la pasó el cursor (o no estaba en la lista), se cuenta aparte; si no, el cursor la
    // recogerá de `earnedByDate` cuando llegue.
    if (date <= cursorDate || !creditDates.includes(date)) lateCredits.push({ date, amount });
  };

  // Resultados de compromisos (cuenta el primero, y solo si es en o después de la fecha del compromiso).
  const resolutions = new Map<string, { date: string; kept: boolean; eventId: string }>();

  const redemptions: Redemption[] = [];
  const pledges: Pledge[] = [];
  let spent = 0;
  type Debit = { kind: 'reward' | 'pledge'; ev: (typeof ctx.events)[number] };
  const debits: Debit[] = [
    ...ofType(ctx, 'reward.redeemed').map((ev) => ({ kind: 'reward' as const, ev })),
    ...ofType(ctx, 'pledge.made').map((ev) => ({ kind: 'pledge' as const, ev })),
  ].sort((a, b) =>
    a.ev.localDate < b.ev.localDate ? -1 : a.ev.localDate > b.ev.localDate ? 1 : (a.ev.createdAt ?? 0) - (b.ev.createdAt ?? 0) || (a.ev.occurredAt < b.ev.occurredAt ? -1 : 1),
  );
  const madeOn = new Map<string, string>();
  for (const d of debits) if (d.kind === 'pledge' && !madeOn.has(d.ev.payload.pledgeId)) madeOn.set(d.ev.payload.pledgeId, d.ev.localDate);
  for (const e of ofType<{ pledgeId: string; kept: boolean }>(ctx, 'pledge.resolved')) {
    const m = madeOn.get(e.payload.pledgeId);
    if (!m || e.localDate < m || resolutions.has(e.payload.pledgeId)) continue;
    resolutions.set(e.payload.pledgeId, { date: e.localDate, kept: e.payload.kept, eventId: e.id });
  }

  const seenPledges = new Set<string>();
  for (const { kind, ev } of debits) {
    if (kind === 'reward') {
      const p = ev.payload as { rewardId: string; name: string; cost: number };
      const valid = earnedThrough(ev.localDate) - spent >= p.cost;
      if (valid) spent += p.cost;
      redemptions.push({ eventId: ev.id, date: ev.localDate, rewardId: p.rewardId, name: p.name, cost: p.cost, valid });
      continue;
    }
    const p = ev.payload as { pledgeId: string; title: string; stake: number; deadline: string };
    if (seenPledges.has(p.pledgeId)) continue; // id repetido: cuenta el primero
    seenPledges.add(p.pledgeId);
    const valid = earnedThrough(ev.localDate) - spent >= p.stake;
    const res = resolutions.get(p.pledgeId);
    const status: Pledge['status'] = !res ? 'open' : res.kept ? 'kept' : 'missed';
    let payout = 0;
    if (valid) {
      spent += p.stake;
      if (status === 'kept') {
        payout = Math.round(p.stake * ctx.cfg.pledge.payoutMultiplier);
        bonuses.push({ date: res!.date, amount: payout - p.stake, source: 'pledge', label: `Compromiso cumplido: ${p.title}` });
        // Regresa lo apostado + la ganancia el día que lo cumpliste.
        addLateCredit(res!.date, payout);
      }
    }
    pledges.push({
      pledgeId: p.pledgeId,
      eventId: ev.id,
      title: p.title,
      stake: p.stake,
      madeOn: ev.localDate,
      deadline: p.deadline,
      valid,
      status,
      resolvedOn: res?.date ?? null,
      resolveEventId: res?.eventId ?? null,
      payout,
    });
  }
  bonuses.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const locked = pledges.filter((p) => p.valid && p.status === 'open').reduce((s, p) => s + p.stake, 0);
  return { earned, spent, balance: earned - spent, earnedToday, redemptions, bonuses, pledges, locked };
}
