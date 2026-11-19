import type { Ctx, XpEntry } from '../context';
import { ofType } from '../context';
import { ATTRIBUTE_IDS, type AttributeId } from '../../types';

export interface AttributeState {
  base: number;
  xp: number;
  /** Puntos ganados por XP (xp / xpPerPoint). */
  gained: number;
  value: number;
  /** 0..1 hacia el siguiente punto */
  progressToNext: number;
}

export interface AttributesState {
  rated: boolean;
  ratedOn: string | null;
  values: Record<AttributeId, AttributeState>;
}

/** Atributos: valor inicial (calificado una sola vez) + 1 punto por cada 100 XP de atributo, tope 100. */
export function reduceAttributes(ctx: Ctx, xp: XpEntry[]): AttributesState {
  const rated = ofType<{ values: Partial<Record<AttributeId, number>> }>(ctx, 'profile.attributes_rated')[0];
  const base = rated?.payload.values ?? {};
  const xpBy: Record<string, number> = {};
  for (const e of xp) if (e.attribute) xpBy[e.attribute] = (xpBy[e.attribute] ?? 0) + e.amount;

  const { xpPerPoint, min, max } = ctx.cfg.attributes;
  const values = {} as Record<AttributeId, AttributeState>;
  for (const a of ATTRIBUTE_IDS) {
    const b = Math.max(min, Math.min(max, base[a] ?? 0));
    const x = xpBy[a] ?? 0;
    const gained = Math.floor(x / xpPerPoint);
    const value = Math.min(max, b + gained);
    values[a] = { base: b, xp: x, gained, value, progressToNext: value >= max ? 1 : (x % xpPerPoint) / xpPerPoint };
  }
  return { rated: !!rated, ratedOn: rated?.localDate ?? null, values };
}
