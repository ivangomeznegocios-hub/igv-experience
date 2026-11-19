import type { Ctx } from '../context';
import { ofType } from '../context';
import { monthKey } from '../../util/dates';

export interface MonthMoney {
  income: number;
  expense: number;
  /** Fecha en que el ingreso del mes alcanzó la meta (si la alcanzó). */
  goalReachedOn: string | null;
}

export interface MoneyState {
  goal: number;
  currentMonth: string;
  months: Record<string, MonthMoney>;
  monthIncome: number;
  monthExpense: number;
  /** Lista cronológica de ingresos (fecha, monto) para métricas de jefes. */
  incomes: { date: string; amount: number }[];
}

/** El dinero es un sistema separado: aquí NO se genera XP. */
export function reduceMoney(ctx: Ctx): MoneyState {
  const goal = ctx.settings.monthlyGoal;
  const months: Record<string, MonthMoney> = {};
  const incomes: { date: string; amount: number }[] = [];
  const get = (k: string) => (months[k] ??= { income: 0, expense: 0, goalReachedOn: null });

  for (const ev of ofType<{ amount: number }>(ctx, 'income.recorded')) {
    const m = get(monthKey(ev.localDate));
    m.income += ev.payload.amount;
    incomes.push({ date: ev.localDate, amount: ev.payload.amount });
    if (!m.goalReachedOn && goal > 0 && m.income >= goal) m.goalReachedOn = ev.localDate;
  }
  for (const ev of ofType<{ amount: number }>(ctx, 'expense.recorded')) {
    get(monthKey(ev.localDate)).expense += ev.payload.amount;
  }
  const currentMonth = monthKey(ctx.today);
  return {
    goal,
    currentMonth,
    months,
    monthIncome: months[currentMonth]?.income ?? 0,
    monthExpense: months[currentMonth]?.expense ?? 0,
    incomes,
  };
}
