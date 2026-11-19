import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, levelFromXp, levelInfo, titleForLevel, xpForNextLevel, xpToReachLevel } from '../src';

const cfg = GAME_CONFIG;

describe('niveles: XP para pasar de n a n+1 = 250 × n', () => {
  it('XP acumulada de los niveles de referencia', () => {
    expect(xpToReachLevel(1, cfg)).toBe(0);
    expect(xpToReachLevel(2, cfg)).toBe(250);
    expect(xpToReachLevel(3, cfg)).toBe(750);
    expect(xpToReachLevel(5, cfg)).toBe(2500);
    expect(xpToReachLevel(10, cfg)).toBe(11250);
    expect(xpToReachLevel(20, cfg)).toBe(47500);
  });

  it('cada salto cuesta 250 × n', () => {
    for (let n = 1; n < 60; n++) {
      expect(xpToReachLevel(n + 1, cfg) - xpToReachLevel(n, cfg)).toBe(250 * n);
      expect(xpForNextLevel(n, cfg)).toBe(250 * n);
    }
  });

  it('nivel a partir de XP, en los bordes', () => {
    expect(levelFromXp(0, cfg)).toBe(1);
    expect(levelFromXp(249, cfg)).toBe(1);
    expect(levelFromXp(250, cfg)).toBe(2);
    expect(levelFromXp(2499, cfg)).toBe(4);
    expect(levelFromXp(2500, cfg)).toBe(5);
    expect(levelFromXp(11249, cfg)).toBe(9);
    expect(levelFromXp(11250, cfg)).toBe(10);
    for (let L = 1; L < 200; L++) {
      expect(levelFromXp(xpToReachLevel(L, cfg), cfg)).toBe(L);
      if (L > 1) expect(levelFromXp(xpToReachLevel(L, cfg) - 1, cfg)).toBe(L - 1);
    }
  });

  it('títulos', () => {
    expect(titleForLevel(1, cfg)).toBe('Aprendiz');
    expect(titleForLevel(4, cfg)).toBe('Aprendiz');
    expect(titleForLevel(5, cfg)).toBe('Explorador');
    expect(titleForLevel(10, cfg)).toBe('Constructor');
    expect(titleForLevel(15, cfg)).toBe('Estratega');
    expect(titleForLevel(20, cfg)).toBe('Leyenda');
    expect(titleForLevel(37, cfg)).toBe('Leyenda');
  });

  it('progreso dentro del nivel y próximo premio cada 5 niveles', () => {
    const info = levelInfo(375, cfg); // nivel 2: 250..750
    expect(info.level).toBe(2);
    expect(info.xpIntoLevel).toBe(125);
    expect(info.xpNeeded).toBe(500);
    expect(info.progress).toBeCloseTo(0.25);
    expect(info.nextRewardLevel).toBe(5);
    expect(levelInfo(2500, cfg).nextRewardLevel).toBe(10);
    expect(levelInfo(2500, cfg).nextTitle).toEqual({ level: 10, title: 'Constructor' });
  });
});
