import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { serverMeta } from '@igv/db';
import type { AppEnv, Env } from './env';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const PIN_KEY = 'access_pin';

/** Equipo + aplicación + correo de Cloudflare Access que pueden entrar. */
export interface AccessPin {
  team: string;
  aud: string;
  emails: string[];
}

/** Solo se aceptan emisores del tipo https://<equipo>.cloudflareaccess.com */
export function parseAccessTeam(iss: unknown): string | null {
  if (typeof iss !== 'string') return null;
  const m = /^https:\/\/([a-z0-9-]+\.cloudflareaccess\.com)\/?$/i.exec(iss.trim());
  return m ? m[1].toLowerCase() : null;
}

function jwks(team: string) {
  let k = jwksCache.get(team);
  if (!k) {
    k = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwksCache.set(team, k);
  }
  return k;
}

/** Configuración explícita por variables (opcional). */
function pinFromEnv(env: Env): AccessPin | null {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  return {
    team: env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase(),
    aud: env.ACCESS_AUD,
    emails: (env.ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

let pinCache: AccessPin | null = null;

async function readPin(env: Env): Promise<AccessPin | null> {
  if (pinCache) return pinCache;
  const [row] = await drizzle(env.DB).select().from(serverMeta).where(eq(serverMeta.key, PIN_KEY));
  if (row) pinCache = JSON.parse(row.value) as AccessPin;
  return pinCache;
}

async function writePin(env: Env, pin: AccessPin) {
  // onConflictDoNothing: si dos solicitudes llegan a la vez, gana la primera.
  await drizzle(env.DB).insert(serverMeta).values({ key: PIN_KEY, value: JSON.stringify(pin), updatedAt: Date.now() }).onConflictDoNothing();
  pinCache = null;
  return readPin(env);
}

/**
 * Seguridad (segunda capa; la primera es Cloudflare Access en el dominio):
 *  - Toda solicitud debe traer el token firmado de Cloudflare Access.
 *  - Sin configuración manual: en el PRIMER ingreso válido se "ancla" el equipo de Access, la
 *    aplicación (AUD) y tu correo. Desde entonces solo se acepta exactamente eso.
 *  - Si defines ACCESS_TEAM_DOMAIN + ACCESS_AUD (+ ALLOWED_EMAILS), se usan esas variables.
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  if (env.DEV_BYPASS_AUTH === 'true' && !env.ACCESS_AUD) {
    c.set('email', 'dev@local');
    return next();
  }
  const token = c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c.req.header('Cookie'), 'CF_Authorization');
  if (!token) {
    return c.json({ error: 'Activa Cloudflare Access en este Worker (Settings → Domains & Routes → workers.dev → Cloudflare Access).', code: 'access_disabled' }, 401);
  }

  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(token);
  } catch {
    return c.json({ error: 'Token inválido' }, 401);
  }
  const team = parseAccessTeam(claims.iss);
  const tokenAud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
  if (!team || !tokenAud) return c.json({ error: 'Token inválido' }, 401);

  const pin = pinFromEnv(env) ?? (await readPin(env));
  if (pin && (team !== pin.team)) return c.json({ error: 'Equipo de Access no autorizado' }, 403);

  let email: string;
  try {
    const { payload } = await jwtVerify(token, jwks(team), { issuer: `https://${team}`, audience: pin?.aud ?? tokenAud });
    email = String(payload.email ?? '').toLowerCase();
  } catch {
    return c.json({ error: 'Token inválido' }, 401);
  }
  if (!email) return c.json({ error: 'El token no trae correo' }, 403);

  if (!pin) {
    // Primer ingreso: anclar equipo, aplicación y correo.
    const saved = await writePin(env, { team, aud: tokenAud, emails: [email] });
    if (!saved || saved.team !== team || !saved.emails.includes(email)) return c.json({ error: 'Correo no autorizado' }, 403);
  } else if (pin.emails.length && !pin.emails.includes(email)) {
    return c.json({ error: 'Correo no autorizado' }, 403);
  }

  c.set('email', email);
  return next();
};

function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
