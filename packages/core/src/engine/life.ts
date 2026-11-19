import type { GameConfigInput } from '../config/game';
import { addDays, ageOn, birthdayInYear, diffDays, weekStart } from '../util/dates';

export interface LifeStats {
  ageYears: number;
  weeksLived: number;
  totalWeeks: number;
  weeksRemaining: number;
  percentLived: number;
  /** Casilla actual de la cuadrícula: fila = año de edad, columna = semana dentro de ese año. */
  current: { row: number; col: number };
}

export function lifeStats(birthDate: string, today: string, cfg: Pick<GameConfigInput, 'life'>): LifeStats {
  const { years: ageYears, lastBirthday } = ageOn(birthDate, today);
  const days = Math.max(0, diffDays(birthDate, today));
  const weeksLived = Math.floor(days / 7);
  const totalWeeks = cfg.life.years * cfg.life.weeksPerYear;
  const col = Math.min(cfg.life.weeksPerYear - 1, Math.floor(diffDays(lastBirthday, today) / 7));
  return {
    ageYears,
    weeksLived,
    totalWeeks,
    weeksRemaining: Math.max(0, totalWeeks - weeksLived),
    percentLived: Math.min(100, (weeksLived / totalWeeks) * 100),
    current: { row: ageYears, col },
  };
}

/** Rango de fechas que representa la casilla (fila, columna). La última columna absorbe los días sobrantes del año. */
export function lifeCellRange(birthDate: string, row: number, col: number, cfg: Pick<GameConfigInput, 'life'>): { start: string; end: string } {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const yearStart = birthdayInYear(bm, bd, by + row);
  const nextYearStart = birthdayInYear(bm, bd, by + row + 1);
  const start = addDays(yearStart, col * 7);
  const end = col === cfg.life.weeksPerYear - 1 ? addDays(nextYearStart, -1) : addDays(start, 6);
  return { start, end };
}

export type LifeCellState = 'lived' | 'current' | 'future';

export function lifeCellState(row: number, col: number, current: { row: number; col: number }): LifeCellState {
  if (row < current.row || (row === current.row && col < current.col)) return 'lived';
  if (row === current.row && col === current.col) return 'current';
  return 'future';
}

// ---------- Vista por año calendario ----------

export interface CalendarWeek {
  /** Lunes de la semana (puede caer en el año anterior). */
  monday: string;
  /** Primer y último día de la semana DENTRO del año (la semana se recorta al año). */
  start: string;
  end: string;
}

/** Semanas (lunes a domingo) que tocan el año calendario, recortadas al año. Son 53 o 54. */
export function calendarYearWeeks(year: number): CalendarWeek[] {
  const jan1 = `${year}-01-01`;
  const dec31 = `${year}-12-31`;
  const out: CalendarWeek[] = [];
  for (let monday = weekStart(jan1); monday <= dec31; monday = addDays(monday, 7)) {
    const sunday = addDays(monday, 6);
    out.push({ monday, start: monday < jan1 ? jan1 : monday, end: sunday > dec31 ? dec31 : sunday });
  }
  return out;
}

/** Máximo de columnas que puede tener un año calendario. */
export const CALENDAR_MAX_WEEKS = 54;

export type CalendarCellState = 'before' | 'lived' | 'current' | 'future' | 'after';

/** Estado de una semana del calendario respecto a la vida (antes de nacer, vivida, actual, por vivir, después de los 90). */
export function calendarCellState(week: Pick<CalendarWeek, 'start' | 'end'>, birthDate: string, today: string, lifeEnd: string): CalendarCellState {
  if (week.end < birthDate) return 'before';
  if (week.start > lifeEnd) return 'after';
  if (week.start <= today && today <= week.end) return 'current';
  if (week.end < today) return 'lived';
  return 'future';
}

/** Último día de la vida en la cuadrícula: el día anterior al cumpleaños número `years`. */
export function lifeEndDate(birthDate: string, cfg: Pick<GameConfigInput, 'life'>): string {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  return addDays(birthdayInYear(bm, bd, by + cfg.life.years), -1);
}

/** Los 7 días (lunes a domingo) de la semana que contiene `date`. */
export function weekDays(date: string): string[] {
  const m = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(m, i));
}
