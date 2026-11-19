import { and, desc, asc, eq, gte, inArray, isNull, lte, max, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { aiActivity, entities, events, serverMeta } from '@igv/db';
import {
  CONFIG_FINGERPRINT,
  GAME_CONFIG,
  SNAPSHOT_SCHEMA,
  buildSnapshot,
  isValidEntityKind,
  project,
  toLocalDate,
  type ActivityRefs,
  type AssistantSnapshot,
  type AssistantStore,
  type Entity,
  type EventQuery,
  type GameEvent,
} from '@igv/core';
import { ensureSeeded, rowToEntity, rowToEvent } from '../repo';
import { randomId } from './crypto';

const SNAPSHOT_KEY = 'ai_snapshot';

export function todayCdmx(now = new Date()): string {
  return toLocalDate(now, GAME_CONFIG.timezone);
}

/** Mayor `updated_at` de eventos y catálogo: identifica la "versión" de los datos. */
export async function dataVersion(d1: D1Database): Promise<number> {
  const db = drizzle(d1);
  const [[a], [b]] = await Promise.all([db.select({ v: max(events.updatedAt) }).from(events), db.select({ v: max(entities.updatedAt) }).from(entities)]);
  return Math.max(Number(a?.v ?? 0), Number(b?.v ?? 0));
}

export async function readSnapshot(d1: D1Database): Promise<AssistantSnapshot | null> {
  const [row] = await drizzle(d1).select().from(serverMeta).where(eq(serverMeta.key, SNAPSHOT_KEY));
  if (!row) return null;
  const s = JSON.parse(row.value) as AssistantSnapshot;
  return s.schema === SNAPSHOT_SCHEMA ? s : null;
}

export async function writeSnapshot(d1: D1Database, s: AssistantSnapshot): Promise<void> {
  const value = JSON.stringify(s);
  await drizzle(d1)
    .insert(serverMeta)
    .values({ key: SNAPSHOT_KEY, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: serverMeta.key, set: { value, updatedAt: Date.now() } });
}

/**
 * Almacén de las herramientas de IA sobre D1.
 * El estado del juego se toma de la "foto" que sube la app; solo si quedó vieja (hubo cambios después
 * o cambió el día) se recalcula aquí con `project()`. Así el Worker casi nunca gasta CPU en proyectar.
 */
export class D1AssistantStore implements AssistantStore {
  readonly today: string;
  private db;
  private catalogCache: Entity[] | null = null;

  constructor(private d1: D1Database, now = new Date()) {
    this.db = drizzle(d1);
    this.today = todayCdmx(now);
  }

  now() {
    return new Date();
  }

  newId() {
    return randomId();
  }

  async catalog(): Promise<Entity[]> {
    if (!this.catalogCache) {
      await ensureSeeded(this.db);
      const rows = await this.db.select().from(entities).where(isNull(entities.deletedAt));
      this.catalogCache = rows.map(rowToEntity);
    }
    return this.catalogCache;
  }

  async events(q: EventQuery): Promise<GameEvent[]> {
    const conds: SQL[] = [];
    if (!q.includeVoided) conds.push(isNull(events.voidedAt));
    if (q.from) conds.push(gte(events.localDate, q.from));
    if (q.to) conds.push(lte(events.localDate, q.to));
    if (q.types?.length) conds.push(inArray(events.type, q.types));
    for (const [k, v] of Object.entries(q.match ?? {})) {
      if (!/^[A-Za-z]{1,40}$/.test(k)) throw new Error('Campo inválido');
      conds.push(sql`json_extract(${events.payload}, ${'$.' + k}) = ${v}`);
    }
    const order = q.order === 'desc' ? [desc(events.localDate), desc(events.createdAt)] : [asc(events.localDate), asc(events.createdAt)];
    const base = this.db
      .select()
      .from(events)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(...order);
    const rows = q.limit ? await base.limit(q.limit) : await base;
    return rows.map(rowToEvent);
  }

  async getEvent(id: string): Promise<GameEvent | null> {
    const [r] = await this.db.select().from(events).where(eq(events.id, id));
    return r ? rowToEvent(r) : null;
  }

  async snapshot(): Promise<AssistantSnapshot> {
    const [version, cached] = await Promise.all([dataVersion(this.d1), readSnapshot(this.d1)]);
    if (cached && cached.config === CONFIG_FINGERPRINT && cached.today === this.today && cached.version >= version) return cached;
    const [ev, en] = await Promise.all([this.db.select().from(events), this.db.select().from(entities)]);
    const list = en.map(rowToEntity);
    const state = project({ events: ev.map(rowToEvent), entities: list, today: this.today });
    const snap = buildSnapshot(state, list, { version, computedBy: 'servidor' });
    await writeSnapshot(this.d1, snap);
    return snap;
  }

  async addEvents(list: GameEvent[]): Promise<void> {
    const now = Date.now();
    for (const e of list) {
      await this.db
        .insert(events)
        .values({ id: e.id, type: e.type, occurredAt: e.occurredAt, localDate: e.localDate, payload: JSON.stringify(e.payload ?? {}), voidedAt: null, createdAt: e.createdAt ?? now, updatedAt: now })
        .onConflictDoNothing();
    }
  }

  async putEntity(e: Entity): Promise<Entity> {
    if (!isValidEntityKind(e.module, e.kind)) throw new Error(`Tipo no permitido: ${e.module}/${e.kind}`);
    if (!/^[\w-]{1,80}$/.test(e.id)) throw new Error('id inválido');
    const now = Date.now();
    const row = { id: e.id, module: e.module, kind: e.kind, data: JSON.stringify(e.data), sort: e.sort ?? now, createdAt: e.createdAt ?? now, updatedAt: now, deletedAt: null };
    const [saved] = await this.db
      .insert(entities)
      .values(row)
      .onConflictDoUpdate({ target: entities.id, set: { module: row.module, kind: row.kind, data: row.data, sort: row.sort, updatedAt: now, deletedAt: null } })
      .returning();
    this.catalogCache = null;
    return rowToEntity(saved);
  }

  async deleteEntity(id: string): Promise<boolean> {
    if (id === 'settings') return false;
    const now = Date.now();
    const res = await this.db.update(entities).set({ deletedAt: now, updatedAt: now }).where(eq(entities.id, id)).returning({ id: entities.id });
    this.catalogCache = null;
    return res.length > 0;
  }

  async voidEvent(id: string): Promise<boolean> {
    const now = Date.now();
    const res = await this.db
      .update(events)
      .set({ voidedAt: new Date(now).toISOString(), updatedAt: now })
      .where(and(eq(events.id, id), isNull(events.voidedAt)))
      .returning({ id: events.id });
    return res.length > 0;
  }

  async restoreEvent(id: string): Promise<boolean> {
    const res = await this.db.update(events).set({ voidedAt: null, updatedAt: Date.now() }).where(eq(events.id, id)).returning({ id: events.id });
    return res.length > 0;
  }
}

// ---------- Bitácora de actividad ----------

export async function recordActivity(d1: D1Database, a: { source: string; tool: string; summary: string; refs: ActivityRefs }): Promise<string> {
  const id = randomId();
  await drizzle(d1).insert(aiActivity).values({ id, at: Date.now(), source: a.source.slice(0, 80), tool: a.tool, summary: a.summary.slice(0, 400), refs: JSON.stringify(a.refs) });
  return id;
}

export async function listActivity(d1: D1Database, limit = 60) {
  const rows = await drizzle(d1).select().from(aiActivity).orderBy(desc(aiActivity.at)).limit(Math.min(200, Math.max(1, limit)));
  return rows.map((r) => {
    const refs = JSON.parse(r.refs) as ActivityRefs;
    return { id: r.id, at: r.at, source: r.source, tool: r.tool, summary: r.summary, undoneAt: r.undoneAt, undoable: !r.undoneAt && (refs.events.length > 0 || refs.entities.length > 0 || !!refs.voided?.length) };
  });
}

/**
 * Deshace una acción de la IA: anula sus registros, restaura lo que anuló y devuelve el catálogo a como estaba.
 * Respeta lo que Iván haya hecho después: no revierte un elemento que se editó o borró luego, y una meta o un
 * reto creados por la IA que ya tienen avances propios se ARCHIVAN en vez de borrarse (su XP depende de ellos).
 */
export async function undoActivity(d1: D1Database, id: string): Promise<{ ok: boolean; error?: string; kept?: number }> {
  const db = drizzle(d1);
  const [row] = await db.select().from(aiActivity).where(eq(aiActivity.id, id));
  if (!row) return { ok: false, error: 'No encontrado' };
  if (row.undoneAt) return { ok: false, error: 'Ya se había deshecho' };
  const refs = JSON.parse(row.refs) as ActivityRefs;
  const store = new D1AssistantStore(d1);
  const own = new Set(refs.events);
  let kept = 0;

  for (const evId of refs.events) {
    const ev = await store.getEvent(evId);
    if (!ev || ev.voidedAt) continue;
    // Un reto iniciado por la IA en el que Iván ya marcó días: anular su inicio borraría esos días (y su XP).
    if (ev.type === 'challenge.started') {
      const checks = await store.events({ types: ['challenge.checked'], match: { challengeId: String(ev.payload.challengeId) }, from: ev.localDate });
      if (checks.some((c) => !own.has(c.id))) {
        kept++;
        continue;
      }
    }
    await store.voidEvent(evId);
  }
  for (const evId of refs.voided ?? []) await store.restoreEvent(evId);

  // En orden inverso: si se editó dos veces lo mismo, queda la versión original.
  for (const ent of [...refs.entities].reverse()) {
    const [cur] = await db.select().from(entities).where(eq(entities.id, ent.id));
    const current = cur ? rowToEntity(cur) : null;
    if (ent.savedAt !== undefined) {
      // La IA creó o editó: solo se revierte si sigue tal cual lo dejó.
      if (!current || current.deletedAt || current.updatedAt !== ent.savedAt) {
        kept++;
        continue;
      }
    } else if (current && !current.deletedAt) {
      // La IA lo borró y alguien ya lo recuperó.
      kept++;
      continue;
    }
    if (ent.prev) {
      const restored = await store.putEntity(ent.prev);
      // Las acciones anteriores sobre este elemento lo dejaron en la versión que se acaba de restaurar: se les
      // actualiza la referencia para que deshacerlas después (en orden) también funcione.
      if (ent.prev.updatedAt !== undefined) await remapSavedAt(d1, id, ent.id, ent.prev.updatedAt, restored.updatedAt ?? Date.now());
      continue;
    }
    const guard = current?.module === 'goals' ? { types: ['goal.progress'], key: 'goalId' } : current?.module === 'challenges' ? { types: ['challenge.started', 'challenge.checked'], key: 'challengeId' } : null;
    const used = guard ? (await store.events({ types: guard.types, match: { [guard.key]: ent.id } })).some((e) => !own.has(e.id)) : false;
    if (used && current) {
      // Tiene avances de Iván: se archiva (su XP depende de que exista).
      await store.putEntity({ ...current, data: { ...current.data, archived: true } });
      kept++;
    } else {
      await store.deleteEntity(ent.id);
    }
  }
  await db.update(aiActivity).set({ undoneAt: Date.now() }).where(eq(aiActivity.id, id));
  return { ok: true, kept };
}

async function remapSavedAt(d1: D1Database, exceptId: string, entityId: string, from: number, to: number) {
  const db = drizzle(d1);
  const rows = await db.select().from(aiActivity).where(isNull(aiActivity.undoneAt)).orderBy(desc(aiActivity.at)).limit(200);
  for (const r of rows) {
    if (r.id === exceptId || !r.refs.includes(entityId)) continue;
    const refs = JSON.parse(r.refs) as ActivityRefs;
    let changed = false;
    for (const e of refs.entities) {
      if (e.id === entityId && e.savedAt === from) {
        e.savedAt = to;
        changed = true;
      }
    }
    if (changed) await db.update(aiActivity).set({ refs: JSON.stringify(refs) }).where(eq(aiActivity.id, r.id));
  }
}
