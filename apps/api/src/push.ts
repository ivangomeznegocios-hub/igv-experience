import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { serverMeta } from '@igv/db';
import type { AppEnv, Env } from './env';
import { generateVapidKeys, sendPush, type PushSubscriptionJSON, type VapidKeys } from './webpush';

/**
 * Notificaciones push.
 * El cálculo del juego vive en el dispositivo, así que el cliente arma un "plan" de recordatorios
 * (check-in de la mañana, racha en riesgo, NPC olvidado…) y lo sube. Un cron del Worker envía los
 * que ya tocan. Todo se guarda en `server_meta` (nunca se sincroniza al cliente).
 */
export const pushRoute = new Hono<AppEnv>();

const K = { vapid: 'push_vapid', subs: 'push_subs', plan: 'push_plan', sent: 'push_sent' } as const;

interface StoredSub extends PushSubscriptionJSON {
  origin: string;
  createdAt: number;
}
export interface PlanItem {
  id: string;
  /** Instante UTC (ISO). */
  at: string;
  title: string;
  body: string;
  url?: string;
}

async function getMeta<T>(env: Env, key: string): Promise<T | null> {
  const [row] = await drizzle(env.DB).select().from(serverMeta).where(eq(serverMeta.key, key));
  return row ? (JSON.parse(row.value) as T) : null;
}
async function setMeta(env: Env, key: string, value: unknown) {
  const now = Date.now();
  await drizzle(env.DB)
    .insert(serverMeta)
    .values({ key, value: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({ target: serverMeta.key, set: { value: JSON.stringify(value), updatedAt: now } });
}

export async function vapidKeys(env: Env): Promise<VapidKeys> {
  const existing = await getMeta<VapidKeys>(env, K.vapid);
  if (existing) return existing;
  const keys = await generateVapidKeys();
  await drizzle(env.DB).insert(serverMeta).values({ key: K.vapid, value: JSON.stringify(keys), updatedAt: Date.now() }).onConflictDoNothing();
  return (await getMeta<VapidKeys>(env, K.vapid))!;
}

const subSchema = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith('https://'), 'El endpoint debe ser https'),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

const planSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        at: z.string().datetime({ offset: true }),
        title: z.string().min(1).max(120),
        body: z.string().max(300),
        url: z.string().max(200).startsWith('/').optional(),
      }),
    )
    .max(60),
});

pushRoute.get('/key', async (c) => c.json({ publicKey: (await vapidKeys(c.env)).publicKey }));

pushRoute.get('/status', async (c) => {
  const subs = (await getMeta<StoredSub[]>(c.env, K.subs)) ?? [];
  const plan = await getMeta<{ items: PlanItem[] }>(c.env, K.plan);
  return c.json({ devices: subs.length, planned: plan?.items.length ?? 0 });
});

pushRoute.post('/subscribe', async (c) => {
  const p = subSchema.safeParse(await c.req.json());
  if (!p.success) return c.json({ error: 'Suscripción inválida' }, 400);
  const subs = ((await getMeta<StoredSub[]>(c.env, K.subs)) ?? []).filter((s) => s.endpoint !== p.data.endpoint);
  subs.push({ ...p.data, origin: new URL(c.req.url).origin, createdAt: Date.now() });
  await setMeta(c.env, K.subs, subs.slice(-5));
  return c.json({ ok: true, devices: Math.min(subs.length, 5) });
});

pushRoute.post('/unsubscribe', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { endpoint?: string };
  const subs = ((await getMeta<StoredSub[]>(c.env, K.subs)) ?? []).filter((s) => s.endpoint !== body.endpoint);
  await setMeta(c.env, K.subs, subs);
  return c.json({ ok: true, devices: subs.length });
});

pushRoute.put('/plan', async (c) => {
  const p = planSchema.safeParse(await c.req.json());
  if (!p.success) return c.json({ error: 'Plan inválido' }, 400);
  await setMeta(c.env, K.plan, { items: p.data.items, updatedAt: Date.now() });
  return c.json({ ok: true, count: p.data.items.length });
});

pushRoute.post('/test', async (c) => {
  const sent = await deliver(c.env, [{ id: `test-${Date.now()}`, at: new Date().toISOString(), title: 'IGV EXPERIENCE', body: 'Las notificaciones funcionan. ⚔️', url: '/' }]);
  return c.json({ ok: true, sent });
});

async function deliver(env: Env, items: PlanItem[]): Promise<number> {
  const subs = (await getMeta<StoredSub[]>(env, K.subs)) ?? [];
  if (!subs.length || !items.length) return 0;
  const keys = await vapidKeys(env);
  const dead = new Set<string>();
  let sent = 0;
  for (const item of items) {
    for (const s of subs) {
      if (dead.has(s.endpoint)) continue;
      try {
        const status = await sendPush(s, { title: item.title, body: item.body, url: item.url ?? '/', tag: item.id }, keys, s.origin);
        if (status === 404 || status === 410) dead.add(s.endpoint);
        else if (status < 300) sent++;
      } catch (err) {
        console.error('push', err);
      }
    }
  }
  if (dead.size) await setMeta(env, K.subs, subs.filter((s) => !dead.has(s.endpoint)));
  return sent;
}

/** Cron: envía los recordatorios del plan que ya tocan (máximo 2 h de retraso) y que no se han enviado. */
export async function runScheduledPush(env: Env, now = Date.now()): Promise<number> {
  const plan = await getMeta<{ items: PlanItem[] }>(env, K.plan);
  if (!plan?.items.length) return 0;
  const sent = new Set((await getMeta<string[]>(env, K.sent)) ?? []);
  const due = plan.items.filter((i) => {
    const t = Date.parse(i.at);
    return t <= now && t > now - 2 * 3600_000 && !sent.has(i.id);
  });
  if (!due.length) return 0;
  const n = await deliver(env, due);
  for (const d of due) sent.add(d.id);
  await setMeta(env, K.sent, [...sent].slice(-300));
  return n;
}
