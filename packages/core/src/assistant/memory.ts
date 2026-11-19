import { project } from '../engine/project';
import type { Entity, GameEvent } from '../types';
import { buildSnapshot, type AssistantSnapshot } from './snapshot';
import type { AssistantStore, EventQuery } from './tools';

/** Filtra eventos según una consulta (lo usa el almacén en memoria; D1 hace lo mismo en SQL). */
export function filterEvents(all: GameEvent[], q: EventQuery): GameEvent[] {
  let out = all.filter(
    (e) =>
      (q.includeVoided || !e.voidedAt) &&
      (!q.from || e.localDate >= q.from) &&
      (!q.to || e.localDate <= q.to) &&
      (!q.types || q.types.includes(e.type)) &&
      (!q.match || Object.entries(q.match).every(([k, v]) => String((e.payload as Record<string, unknown>)?.[k]) === v)),
  );
  out.sort((a, b) => (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0)));
  if (q.order === 'desc') out = out.reverse();
  return q.limit ? out.slice(0, q.limit) : out;
}

/**
 * Almacén en memoria para herramientas de IA (pruebas y prototipos). Calcula la foto con `project()`
 * cada vez que se pide.
 */
export function memoryAssistantStore(init: { events: GameEvent[]; entities: Entity[]; today: string; now?: () => Date }) {
  const events = new Map(init.events.map((e) => [e.id, { ...e }]));
  const entities = new Map(init.entities.map((e) => [e.id, { ...e }]));
  let seq = 0;
  const now = init.now ?? (() => new Date(`${init.today}T18:00:00.000Z`));
  const store: AssistantStore & { allEvents(): GameEvent[]; allEntities(): Entity[] } = {
    today: init.today,
    now,
    newId: () => `mem-${String(++seq).padStart(6, '0')}-${Math.random().toString(36).slice(2, 8)}`,
    async catalog() {
      return [...entities.values()].filter((e) => !e.deletedAt);
    },
    async events(q) {
      return filterEvents([...events.values()], q);
    },
    async getEvent(id) {
      return events.get(id) ?? null;
    },
    async snapshot(): Promise<AssistantSnapshot> {
      const state = project({ events: [...events.values()], entities: [...entities.values()], today: init.today });
      return buildSnapshot(state, [...entities.values()], { version: 0, computedBy: 'servidor', now: now() });
    },
    async addEvents(list) {
      for (const e of list) if (!events.has(e.id)) events.set(e.id, e);
    },
    async putEntity(e) {
      entities.set(e.id, e);
      return e;
    },
    async deleteEntity(id) {
      const e = entities.get(id);
      if (!e) return false;
      entities.set(id, { ...e, deletedAt: Date.now() });
      return true;
    },
    async voidEvent(id) {
      const e = events.get(id);
      if (!e || e.voidedAt) return false;
      events.set(id, { ...e, voidedAt: now().toISOString() });
      return true;
    },
    allEvents: () => [...events.values()],
    allEntities: () => [...entities.values()],
  };
  return store;
}
