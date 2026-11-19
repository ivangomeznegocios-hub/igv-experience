import type { GameConfigInput } from '../config/game';

export function energyFromSleep(hours: number, cfg: Pick<GameConfigInput, 'energy'>): number {
  const rules = [...cfg.energy.rules].sort((a, b) => b.minHours - a.minHours);
  for (const r of rules) if (hours >= r.minHours) return r.energy;
  return rules[rules.length - 1]?.energy ?? 0;
}

/** Con energía baja solo se sugieren misiones chicas y de recuperación. */
export function isLowEnergy(energy: number, cfg: Pick<GameConfigInput, 'energy'>): boolean {
  return energy <= cfg.energy.lowThreshold;
}
