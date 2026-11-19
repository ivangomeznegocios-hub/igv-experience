import type { GameConfigInput } from '../config/game';
import { addDays, ageOn, birthdayInYear, diffDays } from '../util/dates';

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
