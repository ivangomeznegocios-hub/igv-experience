import { Hono, type Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import type { AppEnv, Env } from '../env';
import { verifyPkce } from './crypto';
import {
  consumeCode,
  createCode,
  createGrant,
  getAiSettings,
  getClient,
  isAllowedRedirect,
  redirectMatches,
  refreshGrant,
  registerClient,
  revokeToken,
  type ClientData,
} from './credentials';
import { appOrigin } from './urls';

/**
 * OAuth 2.1 mínimo para el MCP (lo que piden Claude, ChatGPT, Codex y Antigravity):
 *  - Metadatos (RFC 9728 y RFC 8414), registro dinámico de clientes (RFC 7591), PKCE S256 obligatorio,
 *    refresh tokens que rotan y revocación (RFC 7009).
 *  - La autorización ocurre en la APP (protegida por Cloudflare Access): ahí Iván ve qué app pide acceso
 *    y toca "Permitir". Sin ese paso nadie obtiene tokens.
 */

const SCOPE = 'igv';

// ---------------- En el Worker del MCP (público) ----------------

export const oauthServerRoutes = new Hono<{ Bindings: Env }>();

const resourceMetadata = (c: Context<{ Bindings: Env }>) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'IGV EXPERIENCE',
  });
};
oauthServerRoutes.get('/.well-known/oauth-protected-resource', resourceMetadata);
oauthServerRoutes.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata);

oauthServerRoutes.get('/.well-known/oauth-authorization-server', (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    issuer: origin,
    authorization_endpoint: `${appOrigin(c.env, c.req.url)}/api/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    service_documentation: `${appOrigin(c.env, c.req.url)}/conectar-ia`,
  });
});

oauthServerRoutes.post('/oauth/register', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_client_metadata', error_description: 'JSON inválido' }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!uris.length || uris.length > 5 || !uris.every((u) => u.length <= 300 && isAllowedRedirect(u))) {
    return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris debe tener URLs https, de loopback (http://localhost) o de una app nativa.' }, 400);
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const meta: ClientData = {
    client_name: str(body.client_name, 80) ?? 'App sin nombre',
    redirect_uris: uris,
  };
  const { id, createdAt } = await registerClient(drizzle(c.env.DB), meta);
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(createdAt / 1000),
      client_name: meta.client_name,
      redirect_uris: meta.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
    },
    201,
  );
});

async function readForm(c: Context): Promise<Record<string, string>> {
  const ct = c.req.header('Content-Type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? '')]));
  }
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  return Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
}

/** client_id puede venir en el cuerpo o en Basic auth (algunos clientes lo mandan así aunque sean públicos). */
function clientIdFrom(c: Context, form: Record<string, string>): string | undefined {
  if (form.client_id) return form.client_id;
  const m = /^Basic\s+(.+)$/i.exec(c.req.header('Authorization') ?? '');
  if (!m) return undefined;
  try {
    return decodeURIComponent(atob(m[1]).split(':')[0]);
  } catch {
    return undefined;
  }
}

const tokenError = (c: Context, error: string, description: string, status: 400 | 401 = 400) =>
  c.json({ error, error_description: description }, status, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });

oauthServerRoutes.post('/oauth/token', async (c) => {
  const db = drizzle(c.env.DB);
  const form = await readForm(c);
  const clientId = clientIdFrom(c, form);

  if (form.grant_type === 'authorization_code') {
    if (!form.code || !form.code_verifier) return tokenError(c, 'invalid_request', 'Faltan code o code_verifier');
    const code = await consumeCode(db, form.code);
    if (!code) return tokenError(c, 'invalid_grant', 'Código inválido, caducado o ya usado');
    if (clientId && clientId !== code.clientId) return tokenError(c, 'invalid_grant', 'El código es de otro cliente');
    if (form.redirect_uri && form.redirect_uri !== code.data.redirectUri) return tokenError(c, 'invalid_grant', 'redirect_uri no coincide');
    if (!(await verifyPkce(form.code_verifier, code.data.codeChallenge))) return tokenError(c, 'invalid_grant', 'PKCE inválido');
    const client = await getClient(db, code.clientId);
    if (!client) return tokenError(c, 'invalid_client', 'Cliente desconocido', 401);
    const tokens = await createGrant(db, client.id, { clientName: client.client_name, email: code.data.email, scope: code.data.scope });
    return c.json(tokens, 200, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  }

  if (form.grant_type === 'refresh_token') {
    if (!form.refresh_token) return tokenError(c, 'invalid_request', 'Falta refresh_token');
    const r = await refreshGrant(db, form.refresh_token, clientId);
    if (!r.ok) return tokenError(c, r.error, 'La conexión caducó o se revocó. Vuelve a conectar desde tu asistente.');
    return c.json(r.tokens, 200, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  }

  return tokenError(c, 'unsupported_grant_type', 'Solo authorization_code y refresh_token');
});

oauthServerRoutes.post('/oauth/revoke', async (c) => {
  const form = await readForm(c);
  if (form.token) await revokeToken(drizzle(c.env.DB), form.token);
  return c.body(null, 200);
});

// ---------------- En la app (detrás de Cloudflare Access): pantalla "Permitir" ----------------

export const consentRoute = new Hono<AppEnv>();

/**
 * Hosts EXACTOS de regreso de asistentes conocidos (solo para avisar si la dirección es otra). Sin sufijos: dominios
 * como google.com alojan páginas de terceros. Si una app dice ser uno de estos asistentes, debe regresar a su host.
 */
const KNOWN_ASSISTANTS: { name: RegExp; hosts: string[] }[] = [
  { name: /claude|anthropic/i, hosts: ['claude.ai', 'claude.com'] },
  { name: /chatgpt|openai/i, hosts: ['chatgpt.com', 'chat.openai.com'] },
];
const KNOWN_HOSTS = KNOWN_ASSISTANTS.flatMap((a) => a.hosts);

const AUTH_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const;
type AuthParams = Partial<Record<(typeof AUTH_PARAMS)[number], string>>;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · IGV EXPERIENCE</title>
<meta name="robots" content="noindex">
<style>
:root{--bg:#0a0e16;--card:#121826;--line:#232c3d;--text:#e8ecf3;--muted:#8a94a7;--gold:#d4a84b;--red:#e26d6d}
@media (prefers-color-scheme: light){:root{--bg:#f4f5f7;--card:#fff;--line:#e2e5ea;--text:#141a24;--muted:#5d6676;--gold:#a87a1c}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px}
.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);font-weight:700}
h1{font-size:22px;margin:6px 0 4px;letter-spacing:-.01em}p{margin:8px 0;color:var(--muted)}
ul{margin:14px 0;padding-left:18px}li{margin:6px 0}b{color:var(--text)}
.row{display:flex;gap:10px;margin-top:18px}button{flex:1;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--text);font:600 15px system-ui;cursor:pointer}
button.primary{background:var(--gold);border-color:var(--gold);color:#111}.small{font-size:13px}.warn{color:var(--red)}
.confirm{display:flex;gap:10px;align-items:flex-start;margin:16px 0 4px;font-size:14px;color:var(--text);cursor:pointer}.confirm input{width:20px;height:20px;margin:1px 0 0;accent-color:var(--gold);flex:none}
code{font-size:13px;background:rgba(127,127,127,.15);padding:1px 5px;border-radius:6px;word-break:break-all}
</style></head><body><main class="card"><div class="eyebrow">IGV EXPERIENCE · Conectar IA</div>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" },
  });
}

type Checked = { ok: true; client: ClientData & { id: string }; redirectUri: string } | { ok: false; response: Response };

async function check(env: Env, p: AuthParams): Promise<Checked> {
  const client = p.client_id ? await getClient(drizzle(env.DB), p.client_id) : null;
  if (!client) return { ok: false, response: page('Error', '<h1>App desconocida</h1><p>Esta app no está registrada. Vuelve a intentar conectar desde tu asistente.</p>', 400) };
  const redirectUri = p.redirect_uri || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : '');
  if (!redirectUri || !redirectMatches(client.redirect_uris, redirectUri)) {
    return { ok: false, response: page('Error', '<h1>Dirección de regreso inválida</h1><p>La app pidió volver a una dirección que no registró. Por seguridad no continúo.</p>', 400) };
  }
  const fail = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', description);
    if (p.state) u.searchParams.set('state', p.state);
    return { ok: false as const, response: Response.redirect(u.toString(), 302) };
  };
  if (p.response_type !== 'code') return fail('unsupported_response_type', 'Solo response_type=code');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return fail('invalid_request', 'Se requiere PKCE con S256');
  return { ok: true, client, redirectUri };
}

consentRoute.get('/authorize', async (c) => {
  const p = Object.fromEntries(AUTH_PARAMS.map((k) => [k, c.req.query(k)])) as AuthParams;
  const r = await check(c.env, p);
  if (!r.ok) return r.response;
  const { allowWrites } = await getAiSettings(drizzle(c.env.DB));
  const target = (() => {
    try {
      const u = new URL(r.redirectUri);
      return u.protocol === 'http:' || u.protocol === 'https:' ? { host: u.host, hostname: u.hostname, show: `${u.host}${u.pathname}` } : { host: '', hostname: '', show: `${u.protocol}//` };
    } catch {
      return { host: '', hostname: '', show: r.redirectUri };
    }
  })();
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(target.hostname);
  const known = KNOWN_HOSTS.includes(target.hostname);
  const claims = KNOWN_ASSISTANTS.find((a) => a.name.test(r.client.client_name));
  const impostor = !!claims && !loopback && !claims.hosts.includes(target.hostname);
  const warning = impostor
    ? `<p class="small warn"><b>Cuidado:</b> dice ser «${esc(r.client.client_name)}» pero no regresa a ${claims!.hosts.join(' ni ')}. Si no lo esperabas, cancela.</p>`
    : loopback
      ? '<p class="small warn">Es una app en tu computadora: acepta solo si tú iniciaste la conexión.</p>'
      : known
        ? ''
        : '<p class="small warn">No es la dirección de un asistente conocido (Claude, ChatGPT…): acepta solo si tú iniciaste la conexión.</p>';
  const hidden = AUTH_PARAMS.map((k) => (k === 'redirect_uri' ? `<input type="hidden" name="${k}" value="${esc(r.redirectUri)}">` : p[k] ? `<input type="hidden" name="${k}" value="${esc(p[k]!)}">` : '')).join('');
  return page(
    'Permitir acceso',
    `<h1>¿Conectar «${esc(r.client.client_name)}»?</h1>
<p>Esta app de IA quiere usar tu IGV EXPERIENCE como <b>${esc(c.get('email'))}</b>.</p>
<ul>
<li>Ver tu progreso, tu día, tu catálogo y tus registros.</li>
${allowWrites ? '<li>Registrar y organizar cosas por ti (misiones, dinero, metas, agenda…). Todo queda en <b>Más → Conectar IA → Actividad</b> y se puede deshacer.</li>' : '<li>Solo lectura: tienes desactivados los cambios por IA.</li>'}
</ul>
<p class="small">Al aceptar volverás a <code>${esc(target.show)}</code>. Puedes desconectarla cuando quieras en la app.</p>
${warning}
<form method="post" action="/api/oauth/authorize">${hidden}
<label class="confirm"><input type="checkbox" name="confirm" value="1" required> Yo inicié esta conexión desde mi asistente</label>
<div class="row"><button type="submit" name="decision" value="deny" formnovalidate>Cancelar</button><button class="primary" type="submit" name="decision" value="allow">Permitir</button></div>
</form>`,
  );
});

consentRoute.post('/authorize', async (c) => {
  // Protección CSRF: el formulario solo puede enviarse desde esta misma página.
  const self = new URL(c.req.url).origin;
  const origin = c.req.header('Origin');
  const site = c.req.header('Sec-Fetch-Site');
  if (origin ? origin !== self : site !== 'same-origin') return page('Error', '<h1>Solicitud rechazada</h1><p>Abre la conexión desde tu asistente de IA.</p>', 403);
  const form = (await c.req.parseBody()) as Record<string, string>;
  const p = Object.fromEntries(AUTH_PARAMS.map((k) => [k, typeof form[k] === 'string' ? form[k] : undefined])) as AuthParams;
  const r = await check(c.env, p);
  if (!r.ok) return r.response;
  // La casilla obligatoria evita aprobar con un doble clic engañado (double-clickjacking).
  if (form.decision === 'allow' && form.confirm !== '1') return page('Falta confirmar', '<h1>Falta confirmar</h1><p>Marca «Yo inicié esta conexión desde mi asistente» y vuelve a intentar desde tu asistente.</p>', 400);
  const back = new URL(r.redirectUri);
  if (form.decision !== 'allow') {
    back.searchParams.set('error', 'access_denied');
    back.searchParams.set('error_description', 'Iván canceló la conexión');
  } else {
    const code = await createCode(drizzle(c.env.DB), r.client.id, {
      redirectUri: r.redirectUri,
      codeChallenge: p.code_challenge!,
      scope: SCOPE,
      resource: p.resource,
      email: c.get('email'),
    });
    back.searchParams.set('code', code);
  }
  if (p.state) back.searchParams.set('state', p.state);
  return c.redirect(back.toString(), 302);
});

