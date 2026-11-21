import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

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

/**
 * Credenciales para asistentes de IA (servidor MCP). Nunca se sincronizan al cliente.
 * kind: 'client' (app registrada por OAuth), 'code' (código de autorización), 'access' / 'refresh'
 * (tokens OAuth) o 'key' (llave personal creada en la app). Los tokens se guardan solo como SHA-256.
 */
export const aiCredentials = sqliteTable(
  'ai_credentials',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    tokenHash: text('token_hash'),
    clientId: text('client_id'),
    /** Para tokens: id del permiso (grant) que los une; revocar el grant revoca toda la familia. */
    grantId: text('grant_id'),
    data: text('data').notNull(), // JSON
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => [uniqueIndex('ai_credentials_hash_idx').on(t.tokenHash), index('ai_credentials_kind_idx').on(t.kind), index('ai_credentials_grant_idx').on(t.grantId)],
);

/** Bitácora de lo que hicieron los asistentes de IA (para verlo y deshacerlo desde la app). */
export const aiActivity = sqliteTable(
  'ai_activity',
  {
    id: text('id').primaryKey(),
    at: integer('at').notNull(),
    /** Quién: "Claude", "Codex", "Coach"… */
    source: text('source').notNull(),
    tool: text('tool').notNull(),
    summary: text('summary').notNull(),
    /** JSON: { events: string[], entities: { id, prev }[] } */
    refs: text('refs').notNull(),
    undoneAt: integer('undone_at'),
  },
  (t) => [index('ai_activity_at_idx').on(t.at)],
);

export type AiCredentialRow = typeof aiCredentials.$inferSelect;
export type AiActivityRow = typeof aiActivity.$inferSelect;

/**
 * Archivos de Salud (estudios, recetas, fotos de resultados). Nunca se sincronizan al cliente: la app guarda solo la
 * referencia en el catálogo (`health/record`) y baja el archivo al abrirlo. El contenido va en base64 partido en
 * trozos (`health_file_chunks`) para no pasar el tamaño máximo de una fila de D1.
 */
export const healthFiles = sqliteTable('health_files', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  /** Bytes del archivo original. */
  size: integer('size').notNull(),
  chunks: integer('chunks').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const healthFileChunks = sqliteTable(
  'health_file_chunks',
  {
    fileId: text('file_id').notNull(),
    idx: integer('idx').notNull(),
    /** Base64. */
    data: text('data').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.idx] })],
);

export type HealthFileRow = typeof healthFiles.$inferSelect;
