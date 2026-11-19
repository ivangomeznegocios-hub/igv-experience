import type { GameState } from '@igv/core';

export type ArmorySlot = 'aura' | 'emblem' | 'skin';

export interface ArmoryItem {
  id: string;
  slot: ArmorySlot;
  name: string;
  description: string;
  cost: number;
  accent: string;
  icon: string;
  /** Solo para skin: valor del atributo data-skin en <html>. */
  skinKey?: string;
}

/**
 * Armería del juego: mejoras cosméticas y visuales comprables con Oro.
 * Las compras usan el evento estándar `reward.redeemed` (100 % recalculable; nunca toca la XP).
 */
export const ARMORY_ITEMS: ArmoryItem[] = [
  // --- Auras de personaje ---
  {
    id: 'armory-aura-ember',
    slot: 'aura',
    name: 'Aura de Brasa',
    description: 'Anillo de fuego templado alrededor de tu personaje.',
    cost: 40,
    accent: '#ff6b35',
    icon: 'flame',
  },
  {
    id: 'armory-aura-emerald',
    slot: 'aura',
    name: 'Aura Esmeralda',
    description: 'Resplandor vital verde alrededor de tu retrato.',
    cost: 60,
    accent: '#2dd4bf',
    icon: 'shield',
  },
  {
    id: 'armory-aura-solar',
    slot: 'aura',
    name: 'Halo Solar',
    description: 'Corona rúnica dorada en órbita lenta.',
    cost: 120,
    accent: '#f4b740',
    icon: 'sun',
  },
  {
    id: 'armory-aura-dragon',
    slot: 'aura',
    name: 'Furia del Dragón',
    description: 'Doble anillo incandescente carmesí y oro.',
    cost: 240,
    accent: '#ef4444',
    icon: 'crown',
  },

  // --- Emblemas / Atuendo del personaje ---
  {
    id: 'armory-emblem-cloak',
    slot: 'emblem',
    name: 'Broche del Explorador',
    description: 'Brújula forjada en el pecho de tu personaje.',
    cost: 50,
    accent: '#38bdf8',
    icon: 'compass',
  },
  {
    id: 'armory-emblem-forge',
    slot: 'emblem',
    name: 'Hombreras de Forja',
    description: 'Armadura dorada sobre los hombros del avatar.',
    cost: 90,
    accent: '#f4b740',
    icon: 'sword',
  },
  {
    id: 'armory-emblem-crown',
    slot: 'emblem',
    name: 'Corona de Estratega',
    description: 'Corona dorada sobre tu retrato, sin importar el nivel.',
    cost: 180,
    accent: '#ffd77a',
    icon: 'crown',
  },

  // --- Atmósferas / Temas del HUD ---
  {
    id: 'armory-skin-obsidian',
    slot: 'skin',
    name: 'Forja Obsidiana',
    description: 'Estilo clásico de obsidiana y oro forjado.',
    cost: 0,
    accent: '#e5a93c',
    icon: 'sparkles',
    skinKey: 'obsidian',
  },
  {
    id: 'armory-skin-emerald',
    slot: 'skin',
    name: 'Santuario Esmeralda',
    description: 'Bosque profundo, jade y oro antiguo.',
    cost: 80,
    accent: '#10b981',
    icon: 'globe',
    skinKey: 'emerald',
  },
  {
    id: 'armory-skin-crimson',
    slot: 'skin',
    name: 'Ciudadela Carmesí',
    description: 'Acero oscuro, brasas y carmesí imperial.',
    cost: 110,
    accent: '#e11d48',
    icon: 'flame',
    skinKey: 'crimson',
  },
  {
    id: 'armory-skin-royal',
    slot: 'skin',
    name: 'Salón de Leyenda',
    description: 'Noche azul real y oro bruñido.',
    cost: 160,
    accent: '#d9a441',
    icon: 'crown',
    skinKey: 'royal',
  },
];

export function ownedArmoryIds(state: GameState): Set<string> {
  const owned = new Set<string>(ARMORY_ITEMS.filter((i) => i.cost === 0).map((i) => i.id));
  for (const r of state.gold.redemptions) {
    if (r.valid && r.rewardId.startsWith('armory-')) owned.add(r.rewardId);
  }
  return owned;
}

export function getArmoryItem(id: string | undefined): ArmoryItem | undefined {
  return id ? ARMORY_ITEMS.find((i) => i.id === id || i.skinKey === id) : undefined;
}
