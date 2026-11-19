import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, addDays, energyFromSleep, isLowEnergy, lifeCellRange, lifeCellState, lifeStats, toLocalDate, weekStart, weekday, ageOn } from '../src';

describe('energía diaria', () => {
  it('7 h o más = 100, 6 h = 75, 5 h o menos = 50', () => {
    expect(energyFromSleep(9, GAME_CONFIG)).toBe(100);
    expect(energyFromSleep(7, GAME_CONFIG)).toBe(100);
    expect(energyFromSleep(6.5, GAME_CONFIG)).toBe(75);
    expect(energyFromSleep(6, GAME_CONFIG)).toBe(75);
    expect(energyFromSleep(5.9, GAME_CONFIG)).toBe(50);
    expect(energyFromSleep(5, GAME_CONFIG)).toBe(50);
    expect(energyFromSleep(0, GAME_CONFIG)).toBe(50);
  });
  it('energía baja con 50 o menos (dormir menos de 6 h)', () => {
    expect(isLowEnergy(50, GAME_CONFIG)).toBe(true);
    expect(isLowEnergy(75, GAME_CONFIG)).toBe(false);
    expect(isLowEnergy(energyFromSleep(5.5, GAME_CONFIG), GAME_CONFIG)).toBe(true);
    expect(isLowEnergy(energyFromSleep(6, GAME_CONFIG), GAME_CONFIG)).toBe(false);
  });
});

describe('fechas', () => {
  it('semana de lunes a domingo', () => {
    expect(weekday('2026-11-23')).toBe(0); // lunes
    expect(weekday('2027-02-21')).toBe(6); // domingo
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(addDays('2026-11-23', 13 * 7 - 1)).toBe('2027-02-21'); // temporada de 13 semanas
  });
  it('día local en la Ciudad de México', () => {
    // 2026-11-20 03:00 UTC = 2026-11-19 21:00 en CDMX
    expect(toLocalDate('2026-11-20T03:00:00Z', 'America/Mexico_City')).toBe('2026-11-19');
    expect(toLocalDate('2026-11-20T07:00:00Z', 'America/Mexico_City')).toBe('2026-11-20');
  });
  it('edad', () => {
    expect(ageOn('1990-06-15', '2026-06-14').years).toBe(35);
    expect(ageOn('1990-06-15', '2026-06-15').years).toBe(36);
    expect(ageOn('2000-02-29', '2026-02-28').years).toBe(26);
  });
});

describe('mi vida en semanas', () => {
  it('estadísticas', () => {
    const s = lifeStats('1990-06-15', '2026-11-19', GAME_CONFIG);
    expect(s.ageYears).toBe(36);
    // 13306 días / 7
    expect(s.weeksLived).toBe(Math.floor(13306 / 7));
    expect(s.totalWeeks).toBe(90 * 52);
    expect(s.weeksRemaining).toBe(4680 - s.weeksLived);
    expect(s.percentLived).toBeCloseTo((s.weeksLived / 4680) * 100);
    // 2026-06-15 → 2026-11-19 = 157 días → semana 22
    expect(s.current).toEqual({ row: 36, col: 22 });
  });
  it('el día del cumpleaños es la casilla 0 de la fila nueva', () => {
    const s = lifeStats('1990-06-15', '2026-06-15', GAME_CONFIG);
    expect(s.current).toEqual({ row: 36, col: 0 });
  });
  it('la última semana del año absorbe los días sobrantes', () => {
    const s = lifeStats('1990-06-15', '2027-06-14', GAME_CONFIG);
    expect(s.current).toEqual({ row: 36, col: 51 });
    expect(lifeCellRange('1990-06-15', 36, 51, GAME_CONFIG)).toEqual({ start: '2027-06-07', end: '2027-06-14' });
    expect(lifeCellRange('1990-06-15', 36, 0, GAME_CONFIG)).toEqual({ start: '2026-06-15', end: '2026-06-21' });
  });
  it('estado de cada casilla', () => {
    const cur = { row: 36, col: 22 };
    expect(lifeCellState(35, 51, cur)).toBe('lived');
    expect(lifeCellState(36, 21, cur)).toBe('lived');
    expect(lifeCellState(36, 22, cur)).toBe('current');
    expect(lifeCellState(36, 23, cur)).toBe('future');
    expect(lifeCellState(80, 0, cur)).toBe('future');
  });
  it('vividas + restantes = total', () => {
    const s = lifeStats('1985-01-01', '2026-11-19', GAME_CONFIG);
    expect(s.weeksLived + s.weeksRemaining).toBe(s.totalWeeks);
  });
});
