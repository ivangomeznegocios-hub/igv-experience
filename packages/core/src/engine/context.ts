import type { GameConfigInput } from '../config/game';
import type { AttributeId, Entity, GameEvent, SettingsData } from '../types';

export type XpSource =
  | 'mission'
  | 'streak'
  | 'lesson'
  | 'achievement'
  | 'skill'
  | 'boss_phase'
  | 'recurring_boss'
  | 'discovery'
  | 'bounty'
  | 'goal'
  | 'library'
  | 'challenge'
  // [[voz]]

  // [[entreno]]
  | 'training_record'

  // [[gente]]
  /** Mi gente: alcanzar un nivel de cercanía con una persona (una vez por nivel). */
  | 'relationship'

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]
  | 'learning'

  // [[salud]]
  | 'health'

  // [[habitos]]
  ;

/** Una línea del libro de XP. Siempre amount ≥ 0 (la XP nunca se resta). */
export interface XpEntry {
  date: string;
  amount: number;
  source: XpSource;
  label: string;
  attribute: AttributeId | null;
  eventId?: string;
  refId?: string;
}

/** Contexto compartido entre módulos durante una proyección. */
export interface Ctx {
  cfg: GameConfigInput;
  today: string;
  /** Eventos válidos (no anulados, ≤ today), en orden cronológico. */
  events: GameEvent[];
  byType: Map<string, GameEvent[]>;
  entities: Entity[];
  /** Todas las entidades, también las borradas (p. ej. para no perder la liga de un lugar borrado). */
  allEntities?: Entity[];
  entityById: Map<string, Entity>;
  settings: SettingsData;
  xp: XpEntry[];
  addXp(entry: XpEntry): void;
}

export function ofType<P = any>(ctx: Ctx, type: string): GameEvent<P>[] {
  return (ctx.byType.get(type) ?? []) as GameEvent<P>[];
}

export function entitiesOf<D = any>(ctx: Ctx, module: string, kind?: string): Entity<D>[] {
  return ctx.entities.filter((e) => e.module === module && (!kind || e.kind === kind)) as Entity<D>[];
}

/** Devuelve la fecha del N-ésimo elemento de una lista ordenada de fechas (o null). */
export function nthDate(dates: string[], n: number): string | null {
  return n >= 1 && dates.length >= n ? dates[n - 1] : null;
}
