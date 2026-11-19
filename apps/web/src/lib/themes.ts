import type { GameState } from '@igv/core';

export interface ThemeItem {
  /** Id del canje (`reward.redeemed`); se conserva el prefijo histórico `armory-skin-`. */
  id: string;
  /** Valor del atributo `data-skin` en <html> (y de `settings.equipped.skin`). */
  key: string;
  name: string;
  description: string;
  cost: number;
  /** Colores de muestra: fondo, tarjeta y acento. */
  swatch: [string, string, string];
}

/**
 * Estilos de la app: paletas de color que se desbloquean con oro.
 * Las compras usan el evento estándar `reward.redeemed` (recalculable; nunca toca la XP).
 */
export const THEMES: ThemeItem[] = [
  { id: 'armory-skin-obsidian', key: 'obsidian', name: 'Grafito', description: 'Negro grafito con detalles dorados. El clásico.', cost: 0, swatch: ['#0b0d12', '#151a24', '#e6a938'] },
  { id: 'armory-skin-emerald', key: 'emerald', name: 'Bosque', description: 'Verde profundo, tranquilo y natural.', cost: 80, swatch: ['#08110e', '#12211b', '#10b981'] },
  { id: 'armory-skin-crimson', key: 'crimson', name: 'Vino', description: 'Tonos borgoña oscuros y cálidos.', cost: 110, swatch: ['#12090b', '#211216', '#e11d48'] },
  { id: 'armory-skin-royal', key: 'royal', name: 'Medianoche', description: 'Azul marino con dorado brillante.', cost: 160, swatch: ['#090d17', '#141c31', '#f0b849'] },
];

/** Prefijos de cosméticos que ya no existen (auras y emblemas del avatar). */
const RETIRED_PREFIXES = ['armory-aura-', 'armory-emblem-'];

export function ownedThemeIds(state: GameState): Set<string> {
  const owned = new Set<string>(THEMES.filter((t) => t.cost === 0).map((t) => t.id));
  for (const r of state.gold.redemptions) if (r.valid) owned.add(r.rewardId);
  return owned;
}

export function getTheme(key: string | undefined): ThemeItem {
  return THEMES.find((t) => t.key === key) ?? THEMES[0]!;
}

/** Canjes válidos de cosméticos retirados: se pueden anular para recuperar el oro. */
export function retiredPurchases(state: GameState) {
  return state.gold.redemptions.filter((r) => r.valid && RETIRED_PREFIXES.some((p) => r.rewardId.startsWith(p)));
}
