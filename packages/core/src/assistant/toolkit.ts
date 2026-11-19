import { z } from 'zod';
import { validateEvent, type EventPayload, type EventType } from '../events';
import { ATTRIBUTE_IDS, MISSION_SIZES, type Entity, type GameEvent, type SettingsData } from '../types';
import { diffDays, isDateString } from '../util/dates';
import type { AssistantSnapshot } from './snapshot';

/**
 * Piezas comunes para escribir herramientas de IA (las usan tools.ts y los archivos tools-<sistema>.ts).
 * Para agregar herramientas de un sistema nuevo: crea `assistant/tools-<sistema>.ts`, importa de aquí y
 * agrega sus herramientas a ASSISTANT_TOOLS en tools.ts.
 */

// ---------------------------------------------------------------------------------------------
// Contrato con quien guarda los datos (D1 en el Worker, memoria en las pruebas).
// ---------------------------------------------------------------------------------------------

export interface EventQuery {
  from?: string;
  to?: string;
  types?: string[];
  /** Coincidencia exacta de campos del payload (p. ej. { missionId: 'daily-leer' }). */
  match?: Record<string, string>;
  includeVoided?: boolean;
  limit?: number;
  order?: 'asc' | 'desc';
}

export interface AssistantStore {
  /** Día local (CDMX) de hoy. */
  today: string;
  now(): Date;
  newId(): string;
  /** Catálogo activo (sin borrados). */
  catalog(): Promise<Entity[]>;
  events(q: EventQuery): Promise<GameEvent[]>;
  getEvent(id: string): Promise<GameEvent | null>;
  /** Estado derivado actual (se recalcula si hace falta). */
  snapshot(): Promise<AssistantSnapshot>;
  addEvents(events: GameEvent[]): Promise<void>;
  putEntity(entity: Entity): Promise<Entity>;
  deleteEntity(id: string): Promise<boolean>;
  voidEvent(id: string): Promise<boolean>;
}

/** Lo que una acción de la IA cambió, para poder deshacerla desde la app. */
export interface ActivityRefs {
  /** Registros creados (deshacer = anularlos). */
  events: string[];
  /**
   * Elementos del catálogo creados, editados o borrados, con su versión previa (null = no existía) y el
   * `updatedAt` de la versión que dejó la IA (sin él = la IA lo borró). Deshacer solo revierte si nadie lo
   * cambió después.
   */
  entities: { id: string; prev: Entity | null; savedAt?: number }[];
  /** Registros que la IA anuló (deshacer = restaurarlos). */
  voided?: string[];
}

export interface ToolResult {
  text: string;
  isError?: boolean;
  /** Una línea para la bitácora de actividad (solo herramientas que escriben). */
  summary?: string;
  refs?: ActivityRefs;
}

export type ToolGroup = 'consultar' | 'registrar' | 'organizar';

export interface AssistantTool<I = any> {
  name: string;
  title: string;
  description: string;
  group: ToolGroup;
  writes: boolean;
  destructive?: boolean;
  input: z.ZodType<I>;
  run(input: I, store: AssistantStore): Promise<ToolResult>;
}

export class ToolError extends Error {}

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------

export const MAX_PAST_DAYS = 366;
export const SIZE_HELP = 'Tamaño: chica (10 XP, minutos), media (30, ~1 hora o esfuerzo real), grande (100, logro importante), epica (300, excepcional).';

export const zDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato YYYY-MM-DD')
  .refine(isDateString, 'Fecha inválida');
export const zFecha = zDate.optional().describe('Día al que pertenece (YYYY-MM-DD, hora de CDMX). Si se omite, hoy.');
export const zSize = z.enum(MISSION_SIZES);
export const zAttr = z.enum(ATTRIBUTE_IDS);
export const zText = (max: number) => z.string().trim().min(1).max(max);
export const zId = z.string().trim().min(1).max(100);

export function pastDate(store: AssistantStore, fecha?: string): string {
  const d = fecha ?? store.today;
  if (d > store.today) throw new ToolError(`No se puede registrar en el futuro (${d}). Hoy es ${store.today}. Para planear usa planear_dia o agendar_pendiente.`);
  if (diffDays(d, store.today) > MAX_PAST_DAYS) throw new ToolError(`La fecha ${d} es demasiado antigua (máximo un año atrás).`);
  return d;
}

export function makeEvent<T extends EventType>(store: AssistantStore, type: T, payload: EventPayload<T>, localDate: string): GameEvent {
  const now = store.now();
  const v = validateEvent({ id: store.newId(), type, occurredAt: now.toISOString(), localDate, payload });
  if (!v.ok) throw new ToolError(`Datos inválidos: ${v.error}`);
  return { ...v.event, voidedAt: null, createdAt: now.getTime(), updatedAt: now.getTime() };
}

export async function addEvents(store: AssistantStore, events: GameEvent[]): Promise<string[]> {
  await store.addEvents(events);
  return events.map((e) => e.id);
}

export function find<D>(catalog: Entity[], id: string, module: string, kinds?: string[], what = 'elemento'): Entity<D> {
  const e = catalog.find((x) => x.id === id);
  if (!e || e.module !== module || (kinds && !kinds.includes(e.kind))) {
    throw new ToolError(`No encontré ${what} con id "${id}". Consulta los ids con ver_catalogo.`);
  }
  return e as Entity<D>;
}

export const list = <D>(catalog: Entity[], module: string, kind?: string) =>
  catalog.filter((e) => e.module === module && (!kind || e.kind === kind)).sort((a, b) => a.sort - b.sort) as Entity<D>[];

export const settingsOf = (catalog: Entity[]) => (catalog.find((e) => e.id === 'settings')?.data ?? {}) as Partial<SettingsData>;
export const currencyOf = (catalog: Entity[]) => settingsOf(catalog).currency ?? 'MXN';

export function newEntityId(store: AssistantStore, prefix: string) {
  return `${prefix}-${store.newId().replace(/-/g, '').slice(0, 8)}`;
}

/** Crea o actualiza un elemento del catálogo y devuelve la referencia para "deshacer". */
export async function upsert<D>(store: AssistantStore, existing: Entity | null, entity: Omit<Entity<D>, 'sort'> & { sort?: number }) {
  const now = store.now().getTime();
  const saved = await store.putEntity({ ...entity, sort: entity.sort ?? existing?.sort ?? now, createdAt: existing?.createdAt ?? now, updatedAt: now, deletedAt: null } as Entity);
  return { saved, ref: { id: saved.id, prev: existing, savedAt: saved.updatedAt ?? now } };
}

export const ok = (text: string, summary?: string, refs?: Partial<ActivityRefs>): ToolResult => ({
  text,
  summary,
  refs: summary ? { events: refs?.events ?? [], entities: refs?.entities ?? [], ...(refs?.voided ? { voided: refs.voided } : {}) } : undefined,
});

export function tool<S extends z.ZodTypeAny>(def: Omit<AssistantTool<z.infer<S>>, 'input'> & { input: S }): AssistantTool<z.infer<S>> {
  return def as unknown as AssistantTool<z.infer<S>>;
}
