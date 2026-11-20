import { get, set } from 'idb-keyval';
import { useMemo, useSyncExternalStore } from 'react';
import { project, type Entity, type GameEvent, type GameState, type EventType, type EventPayload } from '@igv/core';
import { api, ApiError, AuthError } from './api';
import { newId, todayLocal } from '../lib/time';

type PendingOp =
  | { op: 'event'; event: GameEvent }
  | { op: 'void'; id: string }
  | { op: 'restore'; id: string }
  | { op: 'entity'; entity: Entity }
  | { op: 'delete'; id: string };

interface Persisted {
  v: 1;
  cursor: number;
  events: GameEvent[];
  entities: Entity[];
  pending: PendingOp[];
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'auth' | 'error';

interface Snapshot {
  ready: boolean;
  version: number;
  events: Map<string, GameEvent>;
  entities: Map<string, Entity>;
  pendingCount: number;
  status: SyncStatus;
  lastSync: number | null;
  today: string;
  /** Marca de tiempo de la última acción local (para animaciones de XP). */
  lastLocalAction: number;
  authMessage: string | null;
}

const KEY = 'igv-data-v1';

let snap: Snapshot = {
  ready: false,
  version: 0,
  events: new Map(),
  entities: new Map(),
  pendingCount: 0,
  status: 'idle',
  lastSync: null,
  today: todayLocal(),
  lastLocalAction: 0,
  authMessage: null,
};
let cursor = 0;
let pending: PendingOp[] = [];
const listeners = new Set<() => void>();
const errorListeners = new Set<(msg: string) => void>();

function emit(patch: Partial<Snapshot> = {}, bump = false) {
  snap = { ...snap, ...patch, pendingCount: pending.length, version: bump ? snap.version + 1 : snap.version };
  listeners.forEach((l) => l());
}

export function onStoreError(fn: (msg: string) => void) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}
function reportError(msg: string) {
  errorListeners.forEach((l) => l(msg));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data: Persisted = { v: 1, cursor, events: [...snap.events.values()], entities: [...snap.entities.values()], pending };
    set(KEY, data).catch(() => {});
  }, 250);
}

function merge(events: GameEvent[], entities: Entity[]) {
  if (!events.length && !entities.length) return;
  const ev = new Map(snap.events);
  const en = new Map(snap.entities);
  for (const e of events) ev.set(e.id, e);
  for (const e of entities) en.set(e.id, e);
  emit({ events: ev, entities: en }, true);
}

// ---------- Sincronización ----------

let flushing: Promise<void> | null = null;

async function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    while (pending.length) {
      const op = pending[0];
      try {
        if (op.op === 'event') {
          // agrupar eventos consecutivos
          const batch: GameEvent[] = [];
          while (pending[batch.length]?.op === 'event' && batch.length < 100) batch.push((pending[batch.length] as { event: GameEvent }).event);
          await api.postEvents(batch);
          pending.splice(0, batch.length);
        } else {
          if (op.op === 'void') await api.voidEvent(op.id);
          else if (op.op === 'restore') await api.restoreEvent(op.id);
          else if (op.op === 'entity') await api.putEntity(op.entity);
          else if (op.op === 'delete') await api.deleteEntity(op.id);
          pending.shift();
        }
        persist();
        emit();
      } catch (err) {
        if (err instanceof AuthError) {
          emit({ status: 'auth', authMessage: err.message });
          throw err;
        }
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          // El servidor rechazó la operación: se descarta y se recarga todo desde el servidor.
          pending.shift();
          persist();
          reportError(err.message);
          cursor = 0;
          continue;
        }
        emit({ status: navigator.onLine ? 'error' : 'offline' });
        throw err;
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

let syncing: Promise<void> | null = null;

export function sync(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    emit({ status: 'syncing', today: todayLocal() });
    try {
      await flush();
      const full = cursor === 0;
      const res = await api.sync(cursor);
      if (full) {
        // carga completa: reemplaza el estado local (excepto lo pendiente de subir)
        const ev = new Map(res.events.map((e) => [e.id, e]));
        const en = new Map(res.entities.map((e) => [e.id, e]));
        for (const p of pending) {
          if (p.op === 'event') ev.set(p.event.id, p.event);
          if (p.op === 'entity') en.set(p.entity.id, p.entity);
        }
        emit({ events: ev, entities: en }, true);
      } else {
        merge(res.events, res.entities);
      }
      cursor = res.cursor;
      persist();
      emit({ status: 'idle', lastSync: Date.now(), ready: snap.ready || snap.entities.size > 0 });
    } catch (err) {
      if (err instanceof AuthError) emit({ status: 'auth', authMessage: err.message });
      else emit({ status: navigator.onLine ? 'error' : 'offline' });
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export async function initStore() {
  try {
    const saved = (await get(KEY)) as Persisted | undefined;
    if (saved?.v === 1) {
      cursor = saved.cursor;
      pending = saved.pending ?? [];
      snap = {
        ...snap,
        events: new Map(saved.events.map((e) => [e.id, e])),
        entities: new Map(saved.entities.map((e) => [e.id, e])),
      };
    }
  } catch {
    // sin IndexedDB: se trabaja solo en memoria
  }
  const hasData = snap.entities.size > 0;
  emit({ ready: hasData }, true);
  const first = sync();
  if (!hasData) {
    await first;
    // Solo arrancamos cuando el catálogo existe; si falló, la pantalla de carga ofrece reintentar.
    emit({ ready: snap.entities.size > 0 });
  }

  const resync = () => {
    if (document.visibilityState === 'visible') sync();
  };
  document.addEventListener('visibilitychange', resync);
  window.addEventListener('focus', resync);
  window.addEventListener('online', () => sync());
  setInterval(() => {
    if (document.visibilityState === 'visible') sync();
    const t = todayLocal();
    if (t !== snap.today) emit({ today: t }, true);
  }, 60_000);
}

function enqueue(op: PendingOp) {
  pending.push(op);
  persist();
  emit({ lastLocalAction: Date.now() });
  flush()
    .then(() => sync())
    .catch(() => {});
}

// ---------- Acciones ----------

export function addEvent<T extends EventType>(type: T, payload: EventPayload<T>, opts: { localDate?: string } = {}): GameEvent {
  const now = new Date();
  const event: GameEvent = {
    id: newId(),
    type,
    occurredAt: now.toISOString(),
    localDate: opts.localDate ?? todayLocal(),
    payload,
    voidedAt: null,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
  };
  const ev = new Map(snap.events);
  ev.set(event.id, event);
  emit({ events: ev }, true);
  enqueue({ op: 'event', event });
  return event;
}

export function voidEvent(id: string) {
  const e = snap.events.get(id);
  if (!e) return;
  const ev = new Map(snap.events);
  ev.set(id, { ...e, voidedAt: new Date().toISOString() });
  emit({ events: ev }, true);
  enqueue({ op: 'void', id });
}

export function restoreEvent(id: string) {
  const e = snap.events.get(id);
  if (!e) return;
  const ev = new Map(snap.events);
  ev.set(id, { ...e, voidedAt: null });
  emit({ events: ev }, true);
  enqueue({ op: 'restore', id });
}

export function saveEntity<D>(entity: Omit<Entity<D>, 'sort'> & { sort?: number }): Entity<D> {
  const prev = snap.entities.get(entity.id);
  const full: Entity<D> = {
    ...entity,
    sort: entity.sort ?? prev?.sort ?? Date.now(),
    createdAt: prev?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
  };
  const en = new Map(snap.entities);
  en.set(full.id, full);
  emit({ entities: en }, true);
  enqueue({ op: 'entity', entity: full });
  return full;
}

export function deleteEntity(id: string) {
  const prev = snap.entities.get(id);
  if (!prev) return;
  const en = new Map(snap.entities);
  en.set(id, { ...prev, deletedAt: Date.now() });
  emit({ entities: en }, true);
  enqueue({ op: 'delete', id });
}

/** Estado de la sincronización (para saber si lo local coincide exactamente con el servidor). */
export function getSyncInfo() {
  return { cursor, pending: pending.length, status: snap.status };
}

/** Eventos actuales (sin suscribirse). */
export function getEvents(): GameEvent[] {
  return [...snap.events.values()];
}

/** Un elemento del catálogo (sin suscribirse). */
export function getEntity(id: string): Entity | undefined {
  const e = snap.entities.get(id);
  return e && !e.deletedAt ? e : undefined;
}

/** Escucha cambios del store fuera de React (p. ej. para subir el plan de notificaciones). */
export function onStoreChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tras importar un respaldo: recargar todo desde el servidor. */
export async function resetAndResync() {
  cursor = 0;
  await sync();
}

// ---------- Hooks ----------

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore(): Snapshot {
  return useSyncExternalStore(subscribe, () => snap);
}

export interface Game {
  state: GameState;
  events: GameEvent[];
  entities: Entity[];
  byId: Map<string, Entity>;
  /** Entidades activas de un módulo/tipo, ordenadas por `sort`. */
  list: <D = any>(module: string, kind?: string) => Entity<D>[];
  store: Snapshot;
}

/**
 * Una sola proyección por cambio para toda la app (antes, cada componente que llamaba `useGame()` volvía a
 * calcular el juego completo; en Hoy eran 20+ veces por toque). Lo derivado se guarda por `version` + `today`;
 * `store` NO va en la caché: cambia sin subir la versión (ready, status, pendientes) y cada componente debe ver
 * el actual.
 */
type GameCore = Omit<Game, 'store'>;
let gameCache: { version: number; today: string; core: GameCore } | null = null;

function buildCore(store: Snapshot): GameCore {
  if (gameCache && gameCache.version === store.version && gameCache.today === store.today) return gameCache.core;
  const events = [...store.events.values()];
  const entities = [...store.entities.values()].filter((e) => !e.deletedAt);
  const state = project({ events, entities, today: store.today });
  const byId = new Map(entities.map((e) => [e.id, e]));
  const lists = new Map<string, Entity[]>();
  const list = <D,>(module: string, kind?: string) => {
    const key = `${module}/${kind ?? ''}`;
    let out = lists.get(key);
    if (!out) {
      out = entities.filter((e) => e.module === module && (!kind || e.kind === kind)).sort((a, b) => a.sort - b.sort);
      lists.set(key, out);
    }
    // Copia: hay pantallas que ordenan el resultado en su lugar.
    return out.slice() as Entity<D>[];
  };
  const core = { state, events, entities, byId, list };
  gameCache = { version: store.version, today: store.today, core };
  return core;
}

export function useGame(): Game {
  const store = useStore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const core = useMemo(() => buildCore(store), [store.version, store.today]);
  return useMemo(() => ({ ...core, store }), [core, store]);
}

/** Proyección en una fecha pasada (fotos de atributos al inicio/fin de temporada). */
export function projectAsOf(events: GameEvent[], entities: Entity[], date: string): GameState {
  return project({ events, entities, today: date });
}
