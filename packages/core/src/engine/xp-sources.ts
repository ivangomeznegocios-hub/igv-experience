import type { XpSource } from './context';

/**
 * Nombre visible de cada fuente de XP: `one` para una entrada del historial ("Misión") y `group` para totales por
 * fuente ("Misiones"). Es un Record completo: si agregas una fuente en context.ts, TypeScript pide su nombre aquí.
 */
export const XP_SOURCE_LABELS: Record<XpSource, { one: string; group: string }> = {
  mission: { one: 'Misión', group: 'Misiones' },
  streak: { one: 'Racha', group: 'Racha' },
  lesson: { one: 'Lección', group: 'Lecciones' },
  achievement: { one: 'Logro', group: 'Logros' },
  skill: { one: 'Habilidad', group: 'Habilidades' },
  boss_phase: { one: 'Gran reto', group: 'Grandes retos' },
  recurring_boss: { one: 'Reto recurrente', group: 'Retos recurrentes' },
  discovery: { one: 'Mapa', group: 'Mapa' },
  bounty: { one: 'Misión sorpresa', group: 'Sorpresas' },
  goal: { one: 'Meta', group: 'Metas' },
  library: { one: 'Biblioteca', group: 'Biblioteca' },
  challenge: { one: 'Reto completado', group: 'Retos' },
  relationship: { one: 'Mi gente', group: 'Mi gente' },
  learning: { one: 'Aprendizaje', group: 'Aprendizaje' },
  health: { one: 'Salud', group: 'Salud' },
};

export function xpSourceLabel(source: string, form: 'one' | 'group' = 'one'): string {
  return (XP_SOURCE_LABELS as Record<string, { one: string; group: string }>)[source]?.[form] ?? source;
}
