import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { ViceData } from '../../types';
import type { HabitTrend, HabitVerdict } from '../habits';
import { dayNum, diffDays, monthKey } from '../../util/dates';

export interface ViceState {
  /** Días seguidos sin caer (hasta hoy). */
  current: number;
  best: number;
  relapses: { eventId: string; date: string; note?: string }[];
  lastRelapse: string | null;
  /** Ya se registró una recaída hoy. */
  relapsedToday: boolean;

  // ---- Análisis (solo lectura; nunca da ni quita XP). Cuenta días con recaída, no registros. ----
  /** Días que lleva contándose (incluye hoy). */
  trackedDays: number;
  /** Días con recaída en los últimos 30 días y en los 30 anteriores. */
  relapses30: number;
  relapsesPrev30: number;
  /** Comparado contra los 30 días anteriores (null si aún no hay con qué comparar). */
  trend: HabitTrend | null;
  /** Vas muy bien (sin recaídas), a medias o flojo, según las recaídas de los últimos 30 días. */
  verdict: HabitVerdict;
  /** Días con recaída por mes, de los últimos 6 meses desde que se cuenta (el último es el mes en curso). */
  byMonth: { month: string; count: number }[];
  /** Día de la semana (0 = lunes) en que más recaes, si hay un patrón claro (últimos 90 días). */
  worstWeekday: number | null;
  /** "Una recaída cada N días" en los últimos 90 días (null con menos de 2). */
  everyDays: number | null;
}

const wdOf = (n: number) => (((n + 3) % 7) + 7) % 7;

function lastMonths(today: string, n: number): string[] {
  let [y, m] = monthKey(today).split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Malos hábitos ("enemigos"): solo cuentan días sin caer. Nunca dan ni quitan XP. */
export function reduceVices(ctx: Ctx): Record<string, ViceState> {
  const cfg = ctx.cfg.habits;
  const out: Record<string, ViceState> = {};
  const all = ofType<{ viceId: string; note?: string }>(ctx, 'vice.relapse');
  const t = dayNum(ctx.today);
  const months = lastMonths(ctx.today, 6);
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

    // Análisis por días con recaída.
    const s = dayNum(start);
    const days = [...new Set(relapses.map((r) => dayNum(r.date)))].sort((a, b) => a - b);
    const countIn = (a: number, b: number) => days.filter((n) => n >= a && n <= b).length;
    const trackedIn = (a: number, b: number) => Math.max(0, b - Math.max(a, s) + 1);
    const relapses30 = countIn(t - 29, t);
    const relapsesPrev30 = countIn(t - 59, t - 30);
    const tracked30 = trackedIn(t - 29, t);
    const trackedPrev = trackedIn(t - 59, t - 30);
    let trend: HabitTrend | null = null;
    if (trackedPrev >= 14 && tracked30 > 0) {
      const delta = (relapses30 / tracked30) * 30 - (relapsesPrev30 / trackedPrev) * 30;
      trend = delta <= -cfg.viceTrendDelta ? 'mejorando' : delta >= cfg.viceTrendDelta ? 'empeorando' : 'estable';
    }
    const verdict: HabitVerdict = tracked30 < 3 ? 'nuevo' : relapses30 <= cfg.viceGoodMax ? 'bien' : relapses30 <= cfg.viceOkMax ? 'medias' : 'flojo';

    const recent = days.filter((n) => n >= t - 89 && n <= t);
    let worstWeekday: number | null = null;
    if (recent.length >= 3) {
      const per = new Array(7).fill(0) as number[];
      for (const n of recent) per[wdOf(n)]++;
      const max = Math.max(...per);
      if (max >= 2 && max / recent.length >= 0.4) worstWeekday = per.indexOf(max);
    }
    const tracked90 = trackedIn(t - 89, t);

    out[v.id] = {
      current,
      best,
      relapses,
      lastRelapse: relapses.at(-1)?.date ?? null,
      relapsedToday: relapses.some((r) => r.date === ctx.today),
      trackedDays: trackedIn(s, t),
      relapses30,
      relapsesPrev30,
      trend,
      verdict,
      byMonth: months.filter((month) => month >= monthKey(start)).map((month) => ({ month, count: new Set(relapses.filter((r) => r.date.startsWith(month)).map((r) => r.date)).size })),
      worstWeekday,
      everyDays: recent.length >= 2 ? Math.max(1, Math.round(tracked90 / recent.length)) : null,
    };
  }
  return out;
}
