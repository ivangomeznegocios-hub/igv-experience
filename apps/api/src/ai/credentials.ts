import { and, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { aiCredentials, serverMeta, type AiCredentialRow } from '@igv/db';
import { base64url, fromBase64url, hmacSign, hmacVerify, randomId, randomToken, sha256Hex } from './crypto';

/**
 * Credenciales de los asistentes de IA (tabla `ai_credentials`):
 *  - (las apps registradas por OAuth no se guardan: su client_id va firmado, ver registerClient)
 *  - code:    código de autorización (10 min, un solo uso). data = client, redirect, PKCE.
 *  - grant:   una conexión aprobada por ti (Claude, ChatGPT…). Revocarla corta todos sus tokens.
 *  - access:  token de acceso OAuth (1 h).  refresh: token de renovación (90 días, rota en cada uso).
 *  - key:     llave personal creada en la app (Codex, Antigravity, Claude Code…). No caduca.
 * Los tokens se guardan solo como SHA-256: si alguien lee la base, no puede usarlos.
 */

export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 90 * 86_400_000;
const CODE_TTL_MS = 10 * 60_000;
const TOUCH_EVERY_MS = 5 * 60_000;

export type Db = ReturnType<typeof drizzle>;

export interface ClientData {
  client_name: string;
  redirect_uris: string[];
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
}

export interface CodeData {
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource?: string;
  email: string;
}

export interface GrantData {
  clientName: string;
  email: string;
  scope: string;
}

export interface KeyData {
  name: string;
}

/** Quién está llamando al MCP (para la bitácora y para revocar). */
export interface Caller {
  kind: 'key' | 'oauth';
  /** id de la llave o del grant */
  id: string;
  label: string;
}

const parse = <T>(row: AiCredentialRow) => JSON.parse(row.data) as T;

// ---------- Clientes OAuth (registro dinámico, RFC 7591) ----------
//
// Sin estado: el client_id lleva los metadatos de la app (nombre y redirect_uris) firmados con HMAC usando un
// secreto del servidor. Registrar no lee ni escribe D1, así que el registro público no se puede usar para
// llenar la base ni para bloquear conexiones nuevas. Solo quien conoce el secreto puede fabricar un client_id.

export function isAllowedRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  const scheme = u.protocol.replace(/:$/, '');
  if (scheme === 'https') return true;
  if (scheme === 'http') return isLoopback(u.hostname);
  // Esquemas propios de apps nativas (cursor://, vscode://…); nunca los peligrosos.
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !['javascript', 'data', 'file', 'blob', 'vbscript', 'about'].includes(scheme);
}

function isLoopback(host: string) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Coincidencia exacta; para loopback (apps de escritorio y CLI) se ignora el puerto (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' || !isLoopback(u.hostname)) return false;
  return registered.some((r) => {
    try {
      const x = new URL(r);
      return x.protocol === 'http:' && isLoopback(x.hostname) && x.pathname === u.pathname && x.search === u.search;
    } catch {
      return false;
    }
  });
}

const SECRET_KEY = 'ai_secret';
let secretCache: string | null = null;

/** Secreto del servidor para firmar los client_id (se crea una vez y vive en server_meta, nunca se sincroniza). */
async function serverSecret(db: Db): Promise<string> {
  if (secretCache) return secretCache;
  const read = async () => (await db.select().from(serverMeta).where(eq(serverMeta.key, SECRET_KEY)))[0]?.value;
  let value = await read();
  if (!value) {
    // onConflictDoNothing: si dos solicitudes llegan a la vez, gana la primera y ambas usan esa.
    await db.insert(serverMeta).values({ key: SECRET_KEY, value: randomToken(''), updatedAt: Date.now() }).onConflictDoNothing();
    value = await read();
  }
  if (!value) throw new Error('No se pudo crear el secreto del servidor');
  secretCache = value;
  return value;
}

const CLIENT_PREFIX = 'cli1.';

export async function registerClient(db: Db, meta: ClientData): Promise<{ id: string; createdAt: number }> {
  const now = Date.now();
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ n: meta.client_name, r: meta.redirect_uris, t: Math.floor(now / 1000) })));
  const sig = await hmacSign(await serverSecret(db), payload);
  return { id: `${CLIENT_PREFIX}${payload}.${sig}`, createdAt: now };
}

export async function getClient(db: Db, clientId: string): Promise<(ClientData & { id: string }) | null> {
  if (!clientId.startsWith(CLIENT_PREFIX) || clientId.length > 4000) return null;
  const [payload, sig, extra] = clientId.slice(CLIENT_PREFIX.length).split('.');
  if (!payload || !sig || extra !== undefined) return null;
  if (!(await hmacVerify(await serverSecret(db), payload, sig))) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as { n: string; r: string[] };
    if (typeof d.n !== 'string' || !Array.isArray(d.r)) return null;
    return { id: clientId, client_name: d.n, redirect_uris: d.r };
  } catch {
    return null;
  }
}

// ---------- Códigos de autorización ----------

export async function createCode(db: Db, clientId: string, data: CodeData): Promise<string> {
  const code = randomToken('igv_code_');
  const now = Date.now();
  await db.insert(aiCredentials).values({
    id: randomId(),
    kind: 'code',
    tokenHash: await sha256Hex(code),
    clientId,
    data: JSON.stringify(data),
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
  });
  return code;
}

/** Canjea un código (un solo uso). Devuelve null si no existe, caducó o ya se usó. */
export async function consumeCode(db: Db, code: string): Promise<{ clientId: string; data: CodeData } | null> {
  const now = Date.now();
  const hash = await sha256Hex(code);
  const res = await db
    .update(aiCredentials)
    .set({ revokedAt: now })
    .where(and(eq(aiCredentials.tokenHash, hash), eq(aiCredentials.kind, 'code'), isNull(aiCredentials.revokedAt)))
    .returning();
  const row = res[0];
  if (!row || !row.clientId || (row.expiresAt ?? 0) < now) return null;
  return { clientId: row.clientId, data: parse<CodeData>(row) };
}

// ---------- Grants y tokens ----------

export interface TokenPair {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issuePair(db: Db, grantId: string, clientId: string, scope: string): Promise<TokenPair> {
  const now = Date.now();
  // Limpieza ligera: códigos y access tokens caducados hace más de un día, y refresh tokens revocados hace
  // más de 30 días (se guardan un tiempo para detectar si alguien reusa uno ya rotado).
  await db.delete(aiCredentials).where(and(inArray(aiCredentials.kind, ['code', 'access']), lt(aiCredentials.expiresAt, now - 86_400_000)));
  await db.delete(aiCredentials).where(and(eq(aiCredentials.kind, 'refresh'), lt(aiCredentials.revokedAt, now - 30 * 86_400_000)));
  const access = randomToken('igv_at_');
  const refresh = randomToken('igv_rt_');
  await db.insert(aiCredentials).values([
    { id: randomId(), kind: 'access', tokenHash: await sha256Hex(access), clientId, grantId, data: '{}', createdAt: now, expiresAt: now + ACCESS_TTL_S * 1000 },
    { id: randomId(), kind: 'refresh', tokenHash: await sha256Hex(refresh), clientId, grantId, data: '{}', createdAt: now, expiresAt: now + REFRESH_TTL_MS },
  ]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

export async function createGrant(db: Db, clientId: string, data: GrantData): Promise<TokenPair> {
  const grantId = `grant_${randomId().replace(/-/g, '')}`;
  await db.insert(aiCredentials).values({ id: grantId, kind: 'grant', clientId, grantId, data: JSON.stringify(data), createdAt: Date.now() });
  return issuePair(db, grantId, clientId, data.scope);
}

export type RefreshResult = { ok: true; tokens: TokenPair } | { ok: false; error: 'invalid_grant' | 'invalid_client' };

/**
 * Margen para refrescos simultáneos o reintentos (los clientes refrescan en paralelo y en el celular la respuesta
 * se puede perder): un refresh token rotado hace menos de esto todavía se acepta, sin revocar nada.
 */
export const REFRESH_GRACE_MS = 60_000;

/**
 * Rota el refresh token. Si alguien reusa uno rotado hace más de REFRESH_GRACE_MS, se revoca toda la conexión
 * (posible robo). Los access tokens vigentes no se anulan al rotar: caducan solos en 1 h.
 */
export async function refreshGrant(db: Db, refreshToken: string, clientId: string | undefined): Promise<RefreshResult> {
  const now = Date.now();
  const hash = await sha256Hex(refreshToken);
  const [row] = await db
    .select()
    .from(aiCredentials)
    .where(and(eq(aiCredentials.tokenHash, hash), eq(aiCredentials.kind, 'refresh')));
  if (!row || !row.grantId) return { ok: false, error: 'invalid_grant' };
  if (clientId && row.clientId !== clientId) return { ok: false, error: 'invalid_grant' };
  if ((row.expiresAt ?? 0) < now) return { ok: false, error: 'invalid_grant' };
  const [grant] = await db
    .select()
    .from(aiCredentials)
    .where(and(eq(aiCredentials.id, row.grantId), eq(aiCredentials.kind, 'grant')));
  if (!grant || grant.revokedAt) return { ok: false, error: 'invalid_grant' };
  if (row.revokedAt) {
    if (now - row.revokedAt > REFRESH_GRACE_MS) {
      await revokeGrant(db, row.grantId);
      return { ok: false, error: 'invalid_grant' };
    }
    // Dentro del margen: refresco concurrente o reintento legítimo.
  } else {
    await db.update(aiCredentials).set({ revokedAt: now }).where(and(eq(aiCredentials.id, row.id), isNull(aiCredentials.revokedAt)));
  }
  return { ok: true, tokens: await issuePair(db, row.grantId, row.clientId!, parse<GrantData>(grant).scope) };
}

export async function revokeGrant(db: Db, grantId: string): Promise<boolean> {
  const now = Date.now();
  const res = await db
    .update(aiCredentials)
    .set({ revokedAt: now })
    .where(and(eq(aiCredentials.grantId, grantId), isNull(aiCredentials.revokedAt)))
    .returning({ id: aiCredentials.id });
  return res.length > 0;
}

/** Revoca un token (RFC 7009). Revocar cualquiera de una conexión la corta completa. */
export async function revokeToken(db: Db, token: string): Promise<void> {
  const [row] = await db.select().from(aiCredentials).where(eq(aiCredentials.tokenHash, await sha256Hex(token)));
  if (row?.grantId && (row.kind === 'access' || row.kind === 'refresh')) await revokeGrant(db, row.grantId);
}

// ---------- Llaves personales ----------

export async function createKey(db: Db, name: string): Promise<{ id: string; name: string; createdAt: number; token: string }> {
  const token = randomToken('igv_key_');
  const now = Date.now();
  const id = `key_${randomId().replace(/-/g, '').slice(0, 16)}`;
  await db.insert(aiCredentials).values({ id, kind: 'key', tokenHash: await sha256Hex(token), data: JSON.stringify({ name } satisfies KeyData), createdAt: now });
  return { id, name, createdAt: now, token };
}

export async function revokeKey(db: Db, id: string): Promise<boolean> {
  const res = await db
    .update(aiCredentials)
    .set({ revokedAt: Date.now() })
    .where(and(eq(aiCredentials.id, id), eq(aiCredentials.kind, 'key'), isNull(aiCredentials.revokedAt)))
    .returning({ id: aiCredentials.id });
  return res.length > 0;
}

// ---------- Verificar quién llama ----------

export async function verifyBearer(db: Db, token: string): Promise<Caller | null> {
  if (!/^igv_(key|at)_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const now = Date.now();
  const [row] = await db.select().from(aiCredentials).where(eq(aiCredentials.tokenHash, await sha256Hex(token)));
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < now)) return null;
  if (row.kind === 'key') {
    if (!row.lastUsedAt || now - row.lastUsedAt > TOUCH_EVERY_MS) await db.update(aiCredentials).set({ lastUsedAt: now }).where(eq(aiCredentials.id, row.id));
    return { kind: 'key', id: row.id, label: parse<KeyData>(row).name || 'Llave' };
  }
  if (row.kind !== 'access' || !row.grantId) return null;
  const [grant] = await db.select().from(aiCredentials).where(eq(aiCredentials.id, row.grantId));
  if (!grant || grant.revokedAt) return null;
  if (!grant.lastUsedAt || now - grant.lastUsedAt > TOUCH_EVERY_MS) await db.update(aiCredentials).set({ lastUsedAt: now }).where(eq(aiCredentials.id, grant.id));
  return { kind: 'oauth', id: grant.id, label: parse<GrantData>(grant).clientName || 'App conectada' };
}

// ---------- Para la pantalla "Conectar IA" ----------

export async function listAccess(db: Db) {
  const rows = await db
    .select()
    .from(aiCredentials)
    .where(and(inArray(aiCredentials.kind, ['key', 'grant']), isNull(aiCredentials.revokedAt)))
    .orderBy(desc(aiCredentials.createdAt));
  return {
    keys: rows.filter((r) => r.kind === 'key').map((r) => ({ id: r.id, name: parse<KeyData>(r).name, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt })),
    connections: rows
      .filter((r) => r.kind === 'grant')
      .map((r) => ({ id: r.id, name: parse<GrantData>(r).clientName, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt })),
  };
}

// ---------- Ajustes ----------

export interface AiSettings {
  /** Si la IA puede registrar y cambiar cosas (si no, solo consulta). */
  allowWrites: boolean;
}
const SETTINGS_KEY = 'ai_settings';

export async function getAiSettings(db: Db): Promise<AiSettings> {
  const [row] = await db.select().from(serverMeta).where(eq(serverMeta.key, SETTINGS_KEY));
  const s = row ? (JSON.parse(row.value) as Partial<AiSettings>) : {};
  return { allowWrites: s.allowWrites !== false };
}

export async function setAiSettings(db: Db, s: AiSettings): Promise<void> {
  const value = JSON.stringify(s);
  await db
    .insert(serverMeta)
    .values({ key: SETTINGS_KEY, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: serverMeta.key, set: { value, updatedAt: Date.now() } });
}
