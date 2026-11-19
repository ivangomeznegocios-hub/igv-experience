import type { GameConfigInput } from '../config/game';

/** XP acumulada necesaria para llegar al nivel L (nivel 1 = 0). */
export function xpToReachLevel(level: number, cfg: Pick<GameConfigInput, 'levels'>): number {
  if (level <= 1) return 0;
  return (cfg.levels.factor * level * (level - 1)) / 2;
}

/** XP necesaria para pasar del nivel n al n+1. */
export function xpForNextLevel(level: number, cfg: Pick<GameConfigInput, 'levels'>): number {
  return cfg.levels.factor * level;
}

export function levelFromXp(xp: number, cfg: Pick<GameConfigInput, 'levels'>): number {
  const total = Math.max(0, xp);
  // Solución de factor·L(L−1)/2 ≤ xp, ajustada para evitar errores de redondeo.
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * total) / cfg.levels.factor)) / 2));
  while (xpToReachLevel(level + 1, cfg) <= total) level++;
  while (level > 1 && xpToReachLevel(level, cfg) > total) level--;
  return level;
}

export function titleForLevel(level: number, cfg: Pick<GameConfigInput, 'titles'>): string {
  let title = cfg.titles[0]?.title ?? '';
  for (const t of cfg.titles) if (level >= t.level) title = t.title;
  return title;
}

export interface LevelInfo {
  level: number;
  title: string;
  totalXp: number;
  levelStartXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpNeeded: number;
  /** 0..1 */
  progress: number;
  nextTitle: { level: number; title: string } | null;
  nextRewardLevel: number;
}

export function levelInfo(xp: number, cfg: Pick<GameConfigInput, 'levels' | 'titles' | 'rewardEveryLevels'>): LevelInfo {
  const level = levelFromXp(xp, cfg);
  const start = xpToReachLevel(level, cfg);
  const next = xpToReachLevel(level + 1, cfg);
  const every = cfg.rewardEveryLevels;
  return {
    level,
    title: titleForLevel(level, cfg),
    totalXp: xp,
    levelStartXp: start,
    nextLevelXp: next,
    xpIntoLevel: xp - start,
    xpNeeded: next - start,
    progress: (xp - start) / (next - start),
    nextTitle: cfg.titles.find((t) => t.level > level) ?? null,
    nextRewardLevel: Math.floor(level / every) * every + every,
  };
}
