import type { Ctx } from '../context';
import { entitiesOf, nthDate, ofType } from '../context';
import type { AchievementCondition, AchievementData } from '../../types';
import type { MissionsState } from './missions';
import type { StreakState } from './streak';
import type { LessonsState } from './lessons';
import type { BossesState } from './bosses';
import type { MoneyState } from './money';
import type { MapState } from './world';
import type { SeasonsState } from './seasons';

export interface AchievementState {
  unlocked: boolean;
  date: string | null;
  auto: boolean;
  /** Progreso para mostrar (si se puede medir). */
  progress: { current: number; target: number } | null;
}

interface Deps {
  missions: MissionsState;
  streak: StreakState;
  lessons: LessonsState;
  bosses: BossesState;
  money: MoneyState;
  map: MapState;
  seasons: SeasonsState;
}

function evaluate(c: AchievementCondition, d: Deps): { date: string | null; progress: AchievementState['progress'] } {
  switch (c.type) {
    case 'missions_completed':
      return { date: nthDate(d.missions.completionDates, c.count), progress: { current: Math.min(d.missions.completionDates.length, c.count), target: c.count } };
    case 'streak':
      return { date: d.streak.reachedOn[c.days] ?? null, progress: { current: Math.min(d.streak.best, c.days), target: c.days } };
    case 'lessons':
      return { date: nthDate(d.lessons.dates, c.count), progress: { current: Math.min(d.lessons.count, c.count), target: c.count } };
    case 'recurring_defeats': {
      const r = d.bosses.recurring[c.bossId];
      return { date: nthDate(r?.dates ?? [], c.count), progress: { current: Math.min(r?.defeats ?? 0, c.count), target: c.count } };
    }
    case 'boss_phase': {
      const ph = d.bosses.bosses[c.bossId]?.phases[c.phase];
      return { date: ph?.date ?? null, progress: null };
    }
    case 'month_income_goal': {
      const dates = Object.values(d.money.months)
        .map((m) => m.goalReachedOn)
        .filter((x): x is string => !!x)
        .sort();
      return { date: dates[0] ?? null, progress: { current: Math.min(d.money.monthIncome, d.money.goal), target: d.money.goal } };
    }
    case 'discoveries':
      return { date: nthDate(d.map.discoveryDates, c.count), progress: { current: Math.min(d.map.discoveryDates.length, c.count), target: c.count } };
    case 'season_completed':
      return { date: d.seasons.completedDates[0] ?? null, progress: null };
    case 'manual':
    default:
      return { date: null, progress: null };
  }
}

/** Logros: automáticos si la condición se puede medir; si no, manuales. Cada uno da XP una vez (sin atributo). */
export function reduceAchievements(ctx: Ctx, deps: Deps): Record<string, AchievementState> {
  const manual = new Map<string, string>();
  for (const ev of ofType<{ achievementId: string }>(ctx, 'achievement.unlocked')) {
    if (!manual.has(ev.payload.achievementId)) manual.set(ev.payload.achievementId, ev.localDate);
  }
  const out: Record<string, AchievementState> = {};
  for (const ent of entitiesOf<AchievementData>(ctx, 'achievements', 'achievement')) {
    const auto = ent.data.condition?.type !== 'manual';
    const r = auto ? evaluate(ent.data.condition, deps) : { date: manual.get(ent.id) ?? null, progress: null };
    // Un logro automático también se puede desbloquear a mano (por si la medición no captó algo).
    const date = r.date ?? manual.get(ent.id) ?? null;
    out[ent.id] = { unlocked: !!date, date, auto, progress: r.progress };
    if (date) {
      ctx.addXp({ date, amount: ctx.cfg.rewards.achievement, source: 'achievement', label: `Logro: ${ent.data.name}`, attribute: null, refId: ent.id });
    }
  }
  return out;
}
