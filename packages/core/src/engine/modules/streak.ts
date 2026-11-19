import type { Ctx } from '../context';
import { ofType } from '../context';
import { addDays, compareDates, weekStart } from '../../util/dates';

export interface StreakState {
  /** Días seguidos actuales (si hoy aún no hay misión, la racha sigue viva). */
  current: number;
  best: number;
  todayActive: boolean;
  todayRest: boolean;
  /** Días de descanso válidos (respetando el límite semanal). */
  restDays: Set<string>;
  restDaysThisWeek: number;
  restDaysLeftThisWeek: number;
  /** Bono que da (o daría) hoy al completar una misión. */
  bonusToday: number;
  /** Primera fecha en que la racha alcanzó n días: reachedOn[n] */
  reachedOn: Record<number, string>;
}

export function streakBonus(n: number, cfg: Ctx['cfg']): number {
  return n <= 0 ? 0 : Math.min(cfg.streak.perDay * n, cfg.streak.maxPerDay);
}

/**
 * Regla de racha:
 *  - Día con al menos una misión completada → la racha suma 1 y da bono min(5·n, 35) a Disciplina.
 *  - Día de descanso marcado (máx. N por semana) → la racha NO se rompe, pero no suma día ni da bono.
 *  - Día sin nada (ya terminado) → la racha vuelve a 0. Nunca se resta XP.
 *  - Hoy, mientras no termine, no rompe la racha.
 */
export function reduceStreak(ctx: Ctx, activeDays: Set<string>): StreakState {
  const limit = ctx.cfg.streak.restDaysPerWeek;
  const restDays = new Set<string>();
  const perWeek = new Map<string, number>();
  // Se procesan en el orden en que se registraron (no por fecha): así un descanso registrado
  // después nunca "desplaza" a uno anterior y la XP nunca baja al agregar eventos.
  // Un día con misiones completadas no gasta cupo de descanso.
  const marks = [...ofType(ctx, 'rest_day.marked')].sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0),
  );
  for (const ev of marks) {
    if (restDays.has(ev.localDate) || activeDays.has(ev.localDate)) continue;
    const wk = weekStart(ev.localDate);
    const used = perWeek.get(wk) ?? 0;
    if (used >= limit) continue; // excede el límite semanal: se ignora
    perWeek.set(wk, used + 1);
    restDays.add(ev.localDate);
  }

  const allDays = [...activeDays, ...restDays].sort(compareDates);
  let n = 0;
  let best = 0;
  const reachedOn: Record<number, string> = {};
  if (allDays.length) {
    for (let d = allDays[0]; d <= ctx.today; d = addDays(d, 1)) {
      if (activeDays.has(d)) {
        n++;
        if (!reachedOn[n]) reachedOn[n] = d;
        best = Math.max(best, n);
        const bonus = streakBonus(n, ctx.cfg);
        ctx.addXp({ date: d, amount: bonus, source: 'streak', label: `Racha día ${n}`, attribute: ctx.cfg.streak.attribute as any });
      } else if (restDays.has(d)) {
        // la racha se mantiene
      } else if (d < ctx.today) {
        n = 0;
      }
    }
  }

  const todayActive = activeDays.has(ctx.today);
  const thisWeek = weekStart(ctx.today);
  const restDaysThisWeek = perWeek.get(thisWeek) ?? 0;
  return {
    current: n,
    best,
    todayActive,
    todayRest: restDays.has(ctx.today),
    restDays,
    restDaysThisWeek,
    restDaysLeftThisWeek: Math.max(0, limit - restDaysThisWeek),
    bonusToday: todayActive ? streakBonus(n, ctx.cfg) : streakBonus(n + 1, ctx.cfg),
    reachedOn,
  };
}
