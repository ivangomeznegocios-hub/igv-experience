import type { Ctx } from '../context';
import { ofType } from '../context';
import type { TimeArea } from '../../types';
import { weekStart } from '../../util/dates';
import { emptyByArea, sumMinutes, timeByArea, timeEntries, type TimeEntry } from '../habilidades';

export interface TimeState {
  /** Todos los registros de tiempo (≤ hoy, sin anulados), en orden de día y hora. */
  entries: TimeEntry[];
  /** Minutos registrados por día. */
  byDate: Record<string, number>;
  todayMinutes: number;
  todayByArea: Record<TimeArea, number>;
  /** Esta semana (lunes a hoy). */
  weekByArea: Record<TimeArea, number>;
  weekMinutes: number;
}

/**
 * Tu tiempo ("¿a qué te dedicas?"). SOLO registro: este reductor nunca llama a `ctx.addXp`
 * (regla de oro 3: XP por acciones y resultados, no por horas).
 */
export function reduceTime(ctx: Ctx): TimeState {
  const entries = timeEntries(ofType(ctx, 'time.logged'));
  const byDate: Record<string, number> = {};
  for (const t of entries) byDate[t.date] = (byDate[t.date] ?? 0) + t.minutes;
  const todayByArea = entries.length ? timeByArea(entries, ctx.today, ctx.today) : emptyByArea();
  const weekByArea = entries.length ? timeByArea(entries, weekStart(ctx.today), ctx.today) : emptyByArea();
  return {
    entries,
    byDate,
    todayMinutes: sumMinutes(todayByArea),
    todayByArea,
    weekByArea,
    weekMinutes: sumMinutes(weekByArea),
  };
}
