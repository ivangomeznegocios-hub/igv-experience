import { and, desc, asc, eq, gte, inArray, isNull, lte, max, or, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { aiActivity, entities, events, serverMeta } from '@igv/db';
import {
  CONFIG_FINGERPRINT,
  GAME_CONFIG,
  SNAPSHOT_SCHEMA,
  buildSnapshot,
  challengeAttempts,
  isValidEntityKind,
  project,
  toLocalDate,
  type ActivityRefs,
  type AssistantSnapshot,
  type AssistantStore,
  type ChallengeData,
  type Entity,
  type EventQuery,
  type GameEvent,
} from '@igv/core';
import { ensureSeeded, rowToEntity, rowToEvent, runChunked } from '../repo';
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

  /** Catálogo completo, incluidos los borrados (para deshacer). */
  async allEntities(): Promise<Entity[]> {
    return (await this.db.select().from(entities)).map(rowToEntity);
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

  /** En un solo lote (transacción de D1): o se guardan todos o ninguno, nunca a medias. */
  async addEvents(list: GameEvent[]): Promise<void> {
    const now = Date.now();
    const stmts = list.map((e) =>
      this.db
        .insert(events)
        .values({ id: e.id, type: e.type, occurredAt: e.occurredAt, localDate: e.localDate, payload: JSON.stringify(e.payload ?? {}), voidedAt: null, createdAt: e.createdAt ?? now, updatedAt: now })
        .onConflictDoNothing(),
    );
    await runChunked(this.db, stmts);
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

  const ownEvents = (await Promise.all(refs.events.map((evId) => store.getEvent(evId)))).filter((e): e is GameEvent => !!e && !e.voidedAt);
  const keep = await protectedChallengeEvents(store, ownEvents, own);
  kept += keep.challenges;
  const keepCity = await protectedCityEvents(store, ownEvents, own);
  kept += keepCity.size;
  for (const ev of ownEvents) if (!keep.ids.has(ev.id) && !keepCity.has(ev.id)) await store.voidEvent(ev.id);
  for (const evId of refs.voided ?? []) await store.restoreEvent(evId);

  // Elementos de esta acción que aún no se revisan (no cuentan como "de Iván" al ver si otro depende de ellos).
  const pending = new Set(refs.entities.map((x) => x.id));
  // En orden inverso: si se editó dos veces lo mismo, queda la versión original.
  for (const ent of [...refs.entities].reverse()) {
    pending.delete(ent.id);
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
    const guard = current ? UNDO_GUARDS[`${current.module}/${current.kind}`] : undefined;
    const used = guard ? await usedByIvan(d1, guard, ent.id, own, pending) : false;
    if (used && current) {
      // Tiene registros de Iván: metas y retos se archivan (su XP depende de que existan); lo demás se queda.
      if (guard!.archive) await store.putEntity({ ...current, data: { ...current.data, archived: true } });
      kept++;
    } else {
      await store.deleteEntity(ent.id);
    }
  }
  await db.update(aiActivity).set({ undoneAt: Date.now() }).where(eq(aiActivity.id, id));
  return { ok: true, kept };
}

/**
 * Un registro que apunta al elemento: `key` = campo del payload con su id. Con `list`, el campo es una lista: de ids
 * (p. ej. `npcIds`) o, con `key`, de objetos que traen el id en ese campo (p. ej. `exercises[].exerciseId`).
 */
interface UndoRef {
  types: string[];
  key?: string;
  list?: string;
}

interface UndoGuard {
  refs: UndoRef[];
  /** Elementos del catálogo que cuelgan de él (p. ej. las frases de un tema): si queda alguno, tampoco se borra. */
  children?: { module: string; kind: string; key: string };
  archive: boolean;
}

/**
 * Elementos que la IA creó y en los que Iván registró algo después: deshacer no los borra. `archive` = se archivan
 * (metas y retos: su XP depende de la entidad); si no, se quedan tal cual (lugares, chequeos, personas, frases…).
 * Cada uno lista TODOS los registros que lo usan (los mismos que cuenta el motor), no solo el principal.
 */
const UNDO_GUARDS: Record<string, UndoGuard> = {
  'goals/goal': { refs: [{ types: ['goal.progress'], key: 'goalId' }], archive: true },
  'challenges/challenge': { refs: [{ types: ['challenge.started', 'challenge.checked'], key: 'challengeId' }], archive: true },
  'map/place': { refs: [{ types: ['place.visited', 'map.status_changed', 'npc.interaction', 'workout.logged'], key: 'placeId' }], archive: false },
  'npcs/npc': {
    refs: [
      { types: ['npc.interaction', 'mission.completed'], key: 'npcId' },
      { types: ['place.visited'], list: 'npcIds' },
    ],
    archive: false,
  },
  'habits/vice': { refs: [{ types: ['vice.relapse'], key: 'viceId' }], archive: false },
  'health/checkup': { refs: [{ types: ['health.checkup_done'], key: 'checkupId' }], archive: false },
  'learning/topic': { refs: [{ types: ['learning.test_taken'], key: 'topicId' }], children: { module: 'learning', kind: 'item', key: 'topicId' }, archive: false },
  'learning/item': { refs: [{ types: ['learning.reviewed'], key: 'itemId' }], archive: false },
  'library/book': { refs: [{ types: ['library.progress', 'library.note', 'library.finished'], key: 'bookId' }], archive: false },
  'skills/skill': { refs: [{ types: ['skill.rank_unlocked', 'time.logged'], key: 'skillId' }], archive: false },
  'training/exercise': { refs: [{ types: ['workout.logged'], list: 'exercises', key: 'exerciseId' }], archive: false },
};

/**
 * ¿Iván ya usó este elemento? Algún registro vigente que no sea de la propia acción lo referencia, o (para un tema)
 * tiene elementos que no se van a borrar con esta acción. Una consulta para los registros y otra para los hijos.
 */
async function usedByIvan(d1: D1Database, guard: UndoGuard, id: string, own: Set<string>, pending: Set<string>): Promise<boolean> {
  const db = drizzle(d1);
  const field = (k: string) => `$.${k}`;
  const conds = guard.refs.map((r) => {
    const hit = r.list
      ? sql`EXISTS (SELECT 1 FROM json_each(${events.payload}, ${field(r.list)}) AS j WHERE ${r.key ? sql`json_extract(j.value, ${field(r.key)})` : sql`j.value`} = ${id})`
      : sql`json_extract(${events.payload}, ${field(r.key!)}) = ${id}`;
    return and(inArray(events.type, r.types), hit)!;
  });
  // Los de la propia acción ya se anularon (salvo días de retos protegidos): basta con uno más que ellos.
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(isNull(events.voidedAt), or(...conds)))
    .limit(own.size + 1);
  if (rows.some((r) => !own.has(r.id))) return true;
  const c = guard.children;
  if (!c) return false;
  const kids = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(isNull(entities.deletedAt), eq(entities.module, c.module), eq(entities.kind, c.kind), sql`json_extract(${entities.data}, ${field(c.key)}) = ${id}`))
    .limit(pending.size + 1);
  return kids.some((k) => !pending.has(k.id));
}

/**
 * Retos de N días: un día marcado depende de que el intento siga vivo. Si la IA inició o marcó días de un intento
 * en el que Iván marcó días DESPUÉS, anular lo de la IA rompería la cadena y borraría los días de Iván (y su XP).
 * Esos eventos se conservan. Se evalúa intento por intento con la misma regla del motor (`challengeAttempts`).
 */
async function protectedChallengeEvents(store: D1AssistantStore, ownEvents: GameEvent[], own: Set<string>): Promise<{ ids: Set<string>; challenges: number }> {
  const ids = new Set<string>();
  let challenges = 0;
  const byChallenge = new Map<string, GameEvent[]>();
  for (const e of ownEvents) {
    if (e.type !== 'challenge.started' && e.type !== 'challenge.checked') continue;
    const cid = String(e.payload?.challengeId ?? '');
    if (!byChallenge.has(cid)) byChallenge.set(cid, []);
    byChallenge.get(cid)!.push(e);
  }
  if (!byChallenge.size) return { ids, challenges };
  const catalog = new Map((await store.allEntities()).map((e) => [e.id, e]));
  for (const [cid, mine] of byChallenge) {
    const data = catalog.get(cid)?.data as ChallengeData | undefined;
    if (!data) continue;
    const days = Math.max(1, Math.min(365, Math.round(data.days || GAME_CONFIG.challenge.defaultDays)));
    const all = await store.events({ types: ['challenge.started', 'challenge.checked'], match: { challengeId: cid } });
    const checks = all.filter((e) => e.type === 'challenge.checked');
    const attempts = challengeAttempts(all.filter((e) => e.type === 'challenge.started').map((e) => e.localDate), new Set(checks.map((e) => e.localDate)), days, store.today);
    const foreignChecks = new Set(checks.filter((e) => !own.has(e.id)).map((e) => e.localDate));
    const foreignStarts = new Set(all.filter((e) => e.type === 'challenge.started' && !own.has(e.id)).map((e) => e.localDate));
    let any = false;
    for (const e of mine) {
      const a = attempts.find((x) => e.localDate >= x.startDate && e.localDate <= (x.closedOn ?? x.endDate));
      if (!a) continue;
      const protect =
        e.type === 'challenge.started'
          ? a.startDate === e.localDate && !foreignStarts.has(e.localDate) && a.checked.some((d) => foreignChecks.has(d))
          : !foreignChecks.has(e.localDate) && a.checked.some((d) => d > e.localDate && foreignChecks.has(d));
      if (protect) {
        ids.add(e.id);
        any = true;
      }
    }
    if (any) challenges++;
  }
  return { ids, challenges };
}

/**
 * Ciudad: cada obra se valida en orden contra los materiales y la obra en curso. Si Iván construyó, inauguró o
 * recogió DESPUÉS de una acción de ciudad de la IA, anularla podría dejar sin efecto lo de Iván (p. ej. su obra ya no
 * alcanzaría sin lo que recogió la IA). Esas acciones de la IA se conservan.
 */
const CITY_TYPES = ['city.build_started', 'city.inaugurated', 'city.collected'];
async function protectedCityEvents(store: D1AssistantStore, ownEvents: GameEvent[], own: Set<string>): Promise<Set<string>> {
  const ids = new Set<string>();
  const mine = ownEvents.filter((e) => CITY_TYPES.includes(e.type));
  if (!mine.length) return ids;
  const after = (a: GameEvent, b: GameEvent) => (a.localDate !== b.localDate ? a.localDate > b.localDate : (a.createdAt ?? 0) > (b.createdAt ?? 0));
  const foreign = (await store.events({ types: CITY_TYPES })).filter((e) => !own.has(e.id) && !e.voidedAt);
  for (const e of mine) if (foreign.some((f) => after(f, e))) ids.add(e.id);
  return ids;
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
