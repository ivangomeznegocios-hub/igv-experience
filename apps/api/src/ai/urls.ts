import type { Env } from '../env';

/**
 * El MCP vive en un segundo Worker (`igv-experience-mcp`) SIN Cloudflare Access, porque los asistentes de IA
 * no pueden pasar por el inicio de sesión de Access. La app (`igv-experience`) sigue protegida por Access y
 * en ella está la pantalla donde apruebas cada conexión.
 *   app: https://igv-experience.<subdominio>.workers.dev
 *   MCP: https://igv-experience-mcp.<subdominio>.workers.dev/mcp
 * Con dominio propio, define APP_URL y MCP_URL (variables del Worker).
 */
const MCP_SUFFIX = '-mcp';

function trimSlash(s: string) {
  return s.replace(/\/+$/, '');
}

/** Origen público del Worker del MCP visto desde la app (null si no se puede deducir). */
export function mcpOrigin(env: Env, requestUrl: string): string | null {
  if (env.MCP_URL) return trimSlash(env.MCP_URL).replace(/\/mcp$/, '');
  const u = new URL(requestUrl);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return `${u.protocol}//${u.hostname}:8788`;
  const [first, ...rest] = u.hostname.split('.');
  if (rest.join('.').endsWith('workers.dev') && !first.endsWith(MCP_SUFFIX)) return `https://${first}${MCP_SUFFIX}.${rest.join('.')}`;
  return null;
}

/** Origen público de la app (donde se aprueban las conexiones) visto desde el Worker del MCP. */
export function appOrigin(env: Env, requestUrl: string): string {
  if (env.APP_URL) return trimSlash(env.APP_URL);
  const u = new URL(requestUrl);
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return `${u.protocol}//${u.hostname}:8787`;
  const [first, ...rest] = u.hostname.split('.');
  if (first.endsWith(MCP_SUFFIX)) return `${u.protocol}//${first.slice(0, -MCP_SUFFIX.length)}.${rest.join('.')}`;
  return u.origin;
}
