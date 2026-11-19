import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Segunda capa de seguridad: además de que Cloudflare Access bloquea el dominio completo,
 * la API verifica la firma del token de Access y que el correo sea el permitido.
 * Si Access no está configurado, la API se niega a responder (falla cerrada).
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  if (env.DEV_BYPASS_AUTH === 'true' && !env.ACCESS_AUD) {
    c.set('email', 'dev@local');
    return next();
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ALLOWED_EMAILS) {
    return c.json({ error: 'Acceso no configurado: faltan ACCESS_TEAM_DOMAIN, ACCESS_AUD o ALLOWED_EMAILS.' }, 503);
  }
  const token = c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c.req.header('Cookie'), 'CF_Authorization');
  if (!token) return c.json({ error: 'No autenticado' }, 401);

  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  let jwks = jwksCache.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwksCache.set(team, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: env.ACCESS_AUD });
    const email = String(payload.email ?? '').toLowerCase();
    const allowed = env.ALLOWED_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!email || !allowed.includes(email)) return c.json({ error: 'Correo no autorizado' }, 403);
    c.set('email', email);
  } catch {
    return c.json({ error: 'Token inválido' }, 401);
  }
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
