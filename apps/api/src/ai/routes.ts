import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { CONFIG_FINGERPRINT, SNAPSHOT_SCHEMA, type AssistantSnapshot } from '@igv/core';
import type { AppEnv } from '../env';
import { createKey, getAiSettings, listAccess, revokeGrant, revokeKey, setAiSettings } from './credentials';
import { dataVersion, listActivity, readSnapshot, todayCdmx, undoActivity, writeSnapshot } from './store';
import { mcpOrigin } from './urls';

/** Endpoints de la pantalla "Conectar IA" de la app (detrás de Cloudflare Access). */
export const aiRoute = new Hono<AppEnv>();

aiRoute.get('/status', async (c) => {
  const db = drizzle(c.env.DB);
  const origin = mcpOrigin(c.env, c.req.url);
  const [settings, access] = await Promise.all([getAiSettings(db), listAccess(db)]);
  return c.json({ mcpUrl: origin ? `${origin}/mcp` : null, coach: !!c.env.ANTHROPIC_API_KEY, ...settings, ...access });
});

aiRoute.put('/settings', async (c) => {
  const p = z.object({ allowWrites: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Datos inválidos' }, 400);
  await setAiSettings(drizzle(c.env.DB), p.data);
  return c.json({ ok: true, ...p.data });
});

aiRoute.post('/keys', async (c) => {
  const p = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'Ponle un nombre a la llave' }, 400);
  const k = await createKey(drizzle(c.env.DB), p.data.name);
  return c.json({ ok: true, key: { id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: null }, token: k.token });
});

aiRoute.delete('/keys/:id', async (c) => {
  const ok = await revokeKey(drizzle(c.env.DB), c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'No encontrada' }, 404);
});

aiRoute.delete('/connections/:id', async (c) => {
  const id = c.req.param('id');
  if (!id.startsWith('grant_')) return c.json({ error: 'No encontrada' }, 404);
  const ok = await revokeGrant(drizzle(c.env.DB), id);
  return ok ? c.json({ ok: true }) : c.json({ error: 'No encontrada' }, 404);
});

aiRoute.get('/activity', async (c) => c.json({ items: await listActivity(c.env.DB, Number(c.req.query('limit') ?? 60) || 60) }));

aiRoute.post('/activity/:id/undo', async (c) => {
  const r = await undoActivity(c.env.DB, c.req.param('id'));
  return r.ok ? c.json({ ok: true, kept: r.kept ?? 0 }) : c.json({ error: r.error }, 400);
});

/**
 * La app sube su "foto" del estado tras sincronizar (ya la calculó; así el Worker no gasta CPU).
 * Solo se guarda si es de hoy, del esquema actual y al menos tan nueva como la que ya hay.
 */
aiRoute.put('/snapshot', async (c) => {
  const text = await c.req.text();
  if (text.length > 400_000) return c.json({ error: 'Demasiado grande' }, 413);
  let s: AssistantSnapshot;
  try {
    s = JSON.parse(text) as AssistantSnapshot;
  } catch {
    return c.json({ error: 'JSON inválido' }, 400);
  }
  if (s?.schema !== SNAPSHOT_SCHEMA || typeof s.version !== 'number' || typeof s.today !== 'string' || !s.level || !s.day) {
    return c.json({ ok: false, reason: 'schema' });
  }
  // Una PWA con el código anterior calcula con otros números del juego: no se acepta.
  if (s.config !== CONFIG_FINGERPRINT) return c.json({ ok: false, reason: 'config' });
  if (s.today !== todayCdmx()) return c.json({ ok: false, reason: 'day' });
  const [current, version] = await Promise.all([readSnapshot(c.env.DB), dataVersion(c.env.DB)]);
  if (s.version < version) return c.json({ ok: false, reason: 'stale' });
  if (current && current.today === s.today && current.version > s.version) return c.json({ ok: false, reason: 'older' });
  await writeSnapshot(c.env.DB, { ...s, computedBy: 'app' });
  return c.json({ ok: true });
});
