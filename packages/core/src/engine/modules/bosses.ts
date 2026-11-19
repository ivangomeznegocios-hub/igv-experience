import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { AttributeId, BossData, MainQuestData, PhaseMetric, RecurringBossData } from '../../types';
import { addDays, maxDate, monthKey, nextMonthKey, weekStart } from '../../util/dates';
import type { MissionsState } from './missions';
import type { MoneyState } from './money';

export interface PhaseState {
  title: string;
  done: boolean;
  date: string | null;
  auto: boolean;
  progress: { current: number; target: number; unit: string } | null;
}

export interface BossState {
  id: string;
  phases: PhaseState[];
  phasesDone: number;
  defeated: boolean;
  defeatedOn: string | null;
  locked: boolean;
  unlockedOn: string | null;
}

export interface RecurringState {
  defeats: number;
  lastDate: string | null;
  dates: string[];
}

export interface BossesState {
  bosses: Record<string, BossState>;
  recurring: Record<string, RecurringState>;
}

interface MetricResult {
  date: string | null;
  progress: PhaseState['progress'];
}

function evalMonthIncome(amount: number, money: MoneyState, notBefore: string | null): MetricResult {
  const totals = new Map<string, number>();
  for (const inc of money.incomes) {
    const k = monthKey(inc.date);
    const t = (totals.get(k) ?? 0) + inc.amount;
    totals.set(k, t);
    if (t >= amount && (!notBefore || inc.date >= notBefore)) return { date: inc.date, progress: { current: amount, target: amount, unit: 'MXN' } };
  }
  return { date: null, progress: { current: money.monthIncome, target: amount, unit: 'MXN' } };
}

function evalConsecutiveMonths(amount: number, months: number, money: MoneyState, today: string, notBefore: string | null): MetricResult {
  // fecha en que cada mes cruzó el umbral
  const crossed = new Map<string, string>();
  const totals = new Map<string, number>();
  for (const inc of money.incomes) {
    const k = monthKey(inc.date);
    const t = (totals.get(k) ?? 0) + inc.amount;
    totals.set(k, t);
    if (t >= amount && !crossed.has(k)) crossed.set(k, inc.date);
  }
  const keys = [...totals.keys()].sort();
  if (!keys.length) return { date: null, progress: { current: 0, target: months, unit: 'meses' } };
  const current = monthKey(today);
  let run = 0;
  for (let k = keys[0]; k <= current; k = nextMonthKey(k)) {
    const c = crossed.get(k);
    if (c) {
      run++;
      if (run >= months && (!notBefore || c >= notBefore)) return { date: c, progress: { current: months, target: months, unit: 'meses' } };
    } else if (k < current) {
      run = 0;
    }
  }
  return { date: null, progress: { current: run, target: months, unit: 'meses' } };
}

function evalWeeklyStreak(m: Extract<PhaseMetric, { type: 'weekly_streak' }>, missions: MissionsState, today: string, notBefore: string | null): MetricResult {
  const dates: string[] = [];
  for (const id of m.missionIds) dates.push(...(missions.completions[id]?.dates ?? []));
  dates.sort();
  if (!dates.length) return { date: null, progress: { current: 0, target: m.weeks, unit: 'semanas' } };
  const byWeek = new Map<string, string[]>();
  for (const d of dates) {
    const w = weekStart(d);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w)!.push(d);
  }
  const currentWeek = weekStart(today);
  let run = 0;
  for (let w = weekStart(dates[0]); w <= currentWeek; w = addDays(w, 7)) {
    const ds = byWeek.get(w) ?? [];
    if (ds.length >= m.perWeek) {
      run++;
      const satisfiedOn = ds[m.perWeek - 1];
      if (run >= m.weeks && (!notBefore || satisfiedOn >= notBefore)) return { date: satisfiedOn, progress: { current: m.weeks, target: m.weeks, unit: 'semanas' } };
    } else if (w < currentWeek) {
      run = 0;
    }
  }
  return { date: null, progress: { current: run, target: m.weeks, unit: 'semanas' } };
}

export function reduceBosses(ctx: Ctx, missions: MissionsState, money: MoneyState): BossesState {
  const bosses: Record<string, BossState> = {};
  const manual = new Map<string, string>(); // `${bossId}|${phase}` → fecha
  for (const ev of ofType<{ bossId: string; phaseIndex: number }>(ctx, 'boss.phase_completed')) {
    const k = `${ev.payload.bossId}|${ev.payload.phaseIndex}`;
    if (!manual.has(k)) manual.set(k, ev.localDate);
  }

  const list = entitiesOf<BossData>(ctx, 'bosses', 'boss');
  // Resolver primero los que no dependen de otros (bloqueos encadenados).
  const resolve = (id: string, stack: Set<string> = new Set()): BossState | null => {
    if (bosses[id]) return bosses[id];
    const ent = list.find((b) => b.id === id);
    if (!ent || stack.has(id)) return null;
    stack.add(id);
    const data = ent.data;
    let unlockedOn: string | null = null;
    let locked = false;
    if (data.lockedUntilBossId) {
      const dep = resolve(data.lockedUntilBossId, stack);
      if (dep) {
        locked = !dep.defeated;
        unlockedOn = dep.defeatedOn;
      }
    }

    const quest = data.mainQuestId ? (ctx.entityById.get(data.mainQuestId)?.data as MainQuestData | undefined) : undefined;
    const attribute = (quest?.attribute ?? data.attribute ?? null) as AttributeId | null;

    const phases: PhaseState[] = [];
    let prevDate: string | null = unlockedOn;
    let chainBroken = locked;
    data.phases.forEach((ph, i) => {
      let r: MetricResult = { date: null, progress: null };
      const auto = ph.metric.type !== 'manual';
      if (!chainBroken) {
        switch (ph.metric.type) {
          case 'manual': {
            const d = manual.get(`${id}|${i}`) ?? null;
            r = { date: d ? maxDate(d, prevDate) : null, progress: null };
            break;
          }
          case 'month_income':
            r = evalMonthIncome(ph.metric.amount, money, prevDate);
            break;
          case 'consecutive_months_income':
            r = evalConsecutiveMonths(ph.metric.amount, ph.metric.months, money, ctx.today, prevDate);
            break;
          case 'weekly_streak':
            r = evalWeeklyStreak(ph.metric, missions, ctx.today, prevDate);
            break;
        }
      }
      const done = !!r.date;
      phases.push({ title: ph.title, done, date: r.date, auto, progress: r.progress });
      if (done) {
        ctx.addXp({
          date: r.date!,
          amount: ctx.cfg.rewards.bossPhase,
          source: 'boss_phase',
          label: `${data.name}: ${ph.title}`,
          attribute,
          refId: id,
        });
        prevDate = r.date;
      } else {
        chainBroken = true;
      }
    });

    const phasesDone = phases.filter((p) => p.done).length;
    const defeated = phases.length > 0 && phasesDone === phases.length;
    const st: BossState = {
      id,
      phases,
      phasesDone,
      defeated,
      defeatedOn: defeated ? phases[phases.length - 1].date : null,
      locked,
      unlockedOn,
    };
    bosses[id] = st;
    return st;
  };
  for (const b of list) resolve(b.id);

  const recurring: Record<string, RecurringState> = {};
  for (const ev of ofType<{ bossId: string }>(ctx, 'boss.recurring_defeated')) {
    const ent = ctx.entityById.get(ev.payload.bossId);
    const data = ent?.data as RecurringBossData | undefined;
    const r = (recurring[ev.payload.bossId] ??= { defeats: 0, lastDate: null, dates: [] });
    r.defeats++;
    r.lastDate = ev.localDate;
    r.dates.push(ev.localDate);
    ctx.addXp({
      date: ev.localDate,
      amount: ctx.cfg.rewards.recurringBoss,
      source: 'recurring_boss',
      label: `${data?.name ?? 'Jefe recurrente'} vencido`,
      attribute: data?.attribute ?? null,
      eventId: ev.id,
      refId: ev.payload.bossId,
    });
  }
  return { bosses, recurring };
}
