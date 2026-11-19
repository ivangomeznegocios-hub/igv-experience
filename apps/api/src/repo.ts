import { drizzle } from 'drizzle-orm/d1';
import { count, eq, gt } from 'drizzle-orm';
import { entities, events, type EntityRow, type EventRow } from '@igv/db';
import { seedEntities, type Entity, type GameEvent } from '@igv/core';

export function db(d1: D1Database) {
  return drizzle(d1);
}
export type DB = ReturnType<typeof db>;

export function rowToEvent(r: EventRow): GameEvent {
  return {
    id: r.id,
    type: r.type,
    occurredAt: r.occurredAt,
    localDate: r.localDate,
    payload: JSON.parse(r.payload),
    voidedAt: r.voidedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function rowToEntity(r: EntityRow): Entity {
  return {
    id: r.id,
    module: r.module,
    kind: r.kind,
    data: JSON.parse(r.data),
    sort: r.sort,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  };
}

/** Siembra los datos iniciales si la base está vacía. Idempotente. */
export async function ensureSeeded(d: DB): Promise<void> {
  const [{ n }] = await d.select({ n: count() }).from(entities);
  if (n > 0) return;
  const now = Date.now();
  const rows = seedEntities().map((e) => ({
    id: e.id,
    module: e.module,
    kind: e.kind,
    data: JSON.stringify(e.data),
    sort: e.sort,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));
  await runChunked(d, rows.map((r) => d.insert(entities).values(r).onConflictDoNothing()));
}

/** D1 limita parámetros por consulta: insertamos fila por fila dentro de lotes. */
export async function runChunked(d: DB, stmts: any[], size = 50): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) {
    const chunk = stmts.slice(i, i + size);
    if (chunk.length) await d.batch(chunk as [any, ...any[]]);
  }
}

/** Margen de seguridad para no perder escrituras concurrentes en el mismo milisegundo. */
const SYNC_OVERLAP_MS = 5_000;

export async function changesSince(d: DB, since: number) {
  const from = Math.max(0, since - SYNC_OVERLAP_MS);
  const [ev, en] = await Promise.all([
    since > 0 ? d.select().from(events).where(gt(events.updatedAt, from)) : d.select().from(events),
    since > 0 ? d.select().from(entities).where(gt(entities.updatedAt, from)) : d.select().from(entities),
  ]);
  const cursor = Math.max(since, ...ev.map((r) => r.updatedAt), ...en.map((r) => r.updatedAt));
  return { cursor, events: ev.map(rowToEvent), entities: en.map(rowToEntity) };
}

export async function getEntity(d: DB, id: string) {
  const [r] = await d.select().from(entities).where(eq(entities.id, id));
  return r ? rowToEntity(r) : null;
}
