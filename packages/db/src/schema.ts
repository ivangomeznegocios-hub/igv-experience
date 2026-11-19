import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

/**
 * Tabla de eventos: hechos con fecha. Nunca se borran ni se editan; solo se anulan (voided_at).
 * updated_at sirve como cursor de sincronización entre dispositivos.
 */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    localDate: text('local_date').notNull(),
    payload: text('payload').notNull(), // JSON
    voidedAt: text('voided_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('events_updated_at_idx').on(t.updatedAt), index('events_local_date_idx').on(t.localDate), index('events_type_idx').on(t.type)],
);

/**
 * Catálogo editable de todos los módulos (misiones, jefes, NPCs, lugares…).
 * data es JSON validado en @igv/core. Borrar = marcar deleted_at (para que se sincronice).
 */
export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    module: text('module').notNull(),
    kind: text('kind').notNull(),
    data: text('data').notNull(), // JSON
    sort: real('sort').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('entities_updated_at_idx').on(t.updatedAt), index('entities_module_idx').on(t.module, t.kind)],
);

export type EventRow = typeof events.$inferSelect;
export type EntityRow = typeof entities.$inferSelect;

/**
 * Configuración interna del servidor (nunca se sincroniza al cliente).
 * Guarda el equipo de Cloudflare Access y el correo "anclados" en el primer ingreso.
 */
export const serverMeta = sqliteTable('server_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
