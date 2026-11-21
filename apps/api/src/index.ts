import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { entities, events } from '@igv/db';
import { BACKUP_VERSION, backupSchema, isValidEntityKind, validateEvent, type Backup } from '@igv/core';
import type { AppEnv } from './env';
import { requireAccess } from './auth';
import { changesSince, db, ensureSeeded, getEntity, rowToEntity, rowToEvent, runChunked } from './repo';
import { gmRoute } from './gm';
import { pushRoute, runScheduledPush } from './push';
import { aiRoute } from './ai/routes';
import { consentRoute } from './ai/oauth';

// ---- Sistemas nuevos (rutas) ----
// [[voz]]

// [[entreno]]

// [[gente]]

// [[mapa]]

// [[habilidades]]

// [[aprendizaje]]
import { learnRoute } from './learn';

// [[salud]]
import { medicoRoute } from './medico';

// [[habitos]]

import type { Env } from './env';

const app = new Hono<AppEnv>().basePath('/api');

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Error interno', detail: String(err?.message ?? err) }, 500);
});

app.get('/health', (c) => c.json({ ok: true }));

app.use('*', requireAccess);

app.get('/me', (c) => c.json({ email: c.get('email') }));

/** Sincronización incremental: todo lo que cambió desde `since` (ms). */
app.get('/sync', async (c) => {
  const d = db(c.env.DB);
  await ensureSeeded(d);
  const since = Number(c.req.query('since') ?? 0) || 0;
  return c.json(await changesSince(d, since));
});

/** Registrar uno o varios eventos (idempotente por id: reintentar es seguro). */
app.post('/events', async (c) => {
  const body = await c.req.json();
  const list: unknown[] = Array.isArray(body) ? body : [body];
  if (list.length > 200) return c.json({ error: 'Máximo 200 eventos por solicitud' }, 400);
  const now = Date.now();
  const rows = [];
  for (const item of list) {
    const v = validateEvent(item);
    if (!v.ok) return c.json({ error: v.error }, 400);
    rows.push({
      id: v.event.id,
      type: v.event.type,
      occurredAt: v.event.occurredAt,
      localDate: v.event.localDate,
      payload: JSON.stringify(v.event.payload),
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  const d = db(c.env.DB);
  await runChunked(d, rows.map((r) => d.insert(events).values(r).onConflictDoNothing()));
  return c.json({ ok: true, count: rows.length });
});

/** Anular un evento (se conserva, pero deja de contar). Corrige errores; no es un castigo. */
app.post('/events/:id/void', async (c) => {
  const d = db(c.env.DB);
  const now = Date.now();
  const res = await d
    .update(events)
    .set({ voidedAt: new Date(now).toISOString(), updatedAt: now })
    .where(and(eq(events.id, c.req.param('id')), isNull(events.voidedAt)))
    .returning();
  if (!res.length) return c.json({ error: 'Evento no encontrado o ya anulado' }, 404);
  return c.json({ ok: true, event: rowToEvent(res[0]) });
});

/** Restaurar un evento anulado por error. */
app.post('/events/:id/restore', async (c) => {
  const d = db(c.env.DB);
  const now = Date.now();
  const res = await d.update(events).set({ voidedAt: null, updatedAt: now }).where(eq(events.id, c.req.param('id'))).returning();
  if (!res.length) return c.json({ error: 'Evento no encontrado' }, 404);
  return c.json({ ok: true, event: rowToEvent(res[0]) });
});

const entityBody = z.object({
  module: z.string().min(1).max(40),
  kind: z.string().min(1).max(40),
  data: z.record(z.string(), z.unknown()),
  sort: z.number().optional(),
});

/** Crear o actualizar un elemento del catálogo. */
app.put('/entities/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[\w-]{1,80}$/.test(id)) return c.json({ error: 'id inválido' }, 400);
  const parsed = entityBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, 400);
  const { module, kind, data, sort } = parsed.data;
  if (!isValidEntityKind(module, kind)) return c.json({ error: `Tipo no permitido: ${module}/${kind}` }, 400);
  const d = db(c.env.DB);
  const now = Date.now();
  const existing = await getEntity(d, id);
  const row = {
    id,
    module,
    kind,
    data: JSON.stringify(data),
    sort: sort ?? existing?.sort ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  };
  const [saved] = await d
    .insert(entities)
    .values(row)
    .onConflictDoUpdate({ target: entities.id, set: { module, kind, data: row.data, sort: row.sort, updatedAt: now, deletedAt: null } })
    .returning();
  return c.json({ ok: true, entity: rowToEntity(saved) });
});

/** Borrar (lógico) un elemento del catálogo para que el borrado se sincronice. */
app.delete('/entities/:id', async (c) => {
  if (c.req.param('id') === 'settings') return c.json({ error: 'No se pueden borrar los ajustes' }, 400);
  const d = db(c.env.DB);
  const now = Date.now();
  const res = await d.update(entities).set({ deletedAt: now, updatedAt: now }).where(eq(entities.id, c.req.param('id'))).returning();
  if (!res.length) return c.json({ error: 'No encontrado' }, 404);
  return c.json({ ok: true });
});

/** Respaldo completo en JSON. */
app.get('/backup', async (c) => {
  const d = db(c.env.DB);
  const [ev, en] = await Promise.all([d.select().from(events), d.select().from(entities)]);
  const backup: Backup = {
    app: 'igv-experience',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    events: ev.map(rowToEvent),
    entities: en.map(rowToEntity),
  };
  const date = backup.exportedAt.slice(0, 10);
  return c.body(JSON.stringify(backup, null, 2), 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="igv-experience-respaldo-${date}.json"`,
  });
});

/** Importar un respaldo. mode=replace borra todo y restaura; mode=merge agrega/actualiza por id. */
app.post('/backup/import', async (c) => {
  const mode = c.req.query('mode') === 'merge' ? 'merge' : 'replace';
  const parsed = backupSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Archivo de respaldo inválido: ' + (parsed.error.issues[0]?.message ?? '') }, 400);
  const b = parsed.data;
  for (const e of b.events) {
    const v = validateEvent(e);
    if (!v.ok) return c.json({ error: `Evento ${e.id} inválido: ${v.error}` }, 400);
  }
  for (const e of b.entities) {
    if (!isValidEntityKind(e.module, e.kind)) return c.json({ error: `Entidad ${e.id} con tipo no permitido` }, 400);
  }
  const d = db(c.env.DB);
  const now = Date.now();
  const stmts: any[] = [];
  if (mode === 'replace') {
    stmts.push(d.delete(events), d.delete(entities));
  }
  for (const e of b.events) {
    const row = {
      id: e.id,
      type: e.type,
      occurredAt: e.occurredAt,
      localDate: e.localDate,
      payload: JSON.stringify(e.payload ?? {}),
      voidedAt: e.voidedAt ?? null,
      createdAt: e.createdAt ?? now,
      updatedAt: now,
    };
    stmts.push(d.insert(events).values(row).onConflictDoUpdate({ target: events.id, set: { ...row, id: undefined } as any }));
  }
  for (const e of b.entities) {
    const row = {
      id: e.id,
      module: e.module,
      kind: e.kind,
      data: JSON.stringify(e.data ?? {}),
      sort: e.sort,
      createdAt: e.createdAt ?? now,
      updatedAt: now,
      deletedAt: e.deletedAt ?? null,
    };
    stmts.push(d.insert(entities).values(row).onConflictDoUpdate({ target: entities.id, set: { ...row, id: undefined } as any }));
  }
  // replace: el borrado y la restauración van en el mismo primer lote cuando caben; si no, en lotes sucesivos.
  await runChunked(d, stmts, 80);
  return c.json({ ok: true, mode, events: b.events.length, entities: b.entities.length });
});

app.route('/gm', gmRoute);
app.route('/push', pushRoute);
app.route('/ai', aiRoute);
app.route('/oauth', consentRoute);

// [[voz]]

// [[entreno]]

// [[gente]]

// [[mapa]]

// [[habilidades]]

// [[aprendizaje]]
app.route('/learn', learnRoute);

// [[salud]]
app.route('/medico', medicoRoute);

// [[habitos]]


app.notFound((c) => c.json({ error: 'No encontrado' }, 404));

/** El Worker: `fetch` sirve la API y `scheduled` (cron) envía los recordatorios push que ya tocan. */
export default {
  fetch: app.fetch,
  request: app.request,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledPush(env).then(() => undefined));
  },
};
