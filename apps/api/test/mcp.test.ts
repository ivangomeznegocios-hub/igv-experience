import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { mcpApp } from '../src/ai/mcp';
import { fakeD1 } from './fake-d1';

const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true' } as any;
const main = (path: string, init?: RequestInit) => app.request(path, init, env);
const mcp = (path: string, init?: RequestInit) => mcpApp.request(path, init, env);
const json = (body: unknown, extra: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });

let rpcId = 0;
async function rpc(token: string, method: string, params?: unknown) {
  const res = await mcp('/mcp', json({ jsonrpc: '2.0', id: ++rpcId, method, params }, { authorization: `Bearer ${token}` }));
  return { status: res.status, body: (await res.json()) as any };
}
const call = async (token: string, name: string, args: unknown = {}) => (await rpc(token, 'tools/call', { name, arguments: args })).body.result as { content: { text: string }[]; isError: boolean };

function b64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('servidor MCP con llave personal', () => {
  let key = '';

  it('sin credencial responde 401 y apunta a los metadatos OAuth', async () => {
    const res = await mcp('/mcp', json({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="http://localhost/.well-known/oauth-protected-resource"');
    const bad = await mcp('/mcp', json({ jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: 'Bearer igv_key_noexisteeeeeeeeeeeeeeeeeeeeeee' }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toContain('invalid_token');
  });

  it('la app crea una llave (se muestra una sola vez) y con ella se inicia sesión MCP', async () => {
    const res = await main('/api/ai/keys', json({ name: 'Codex' }));
    const body = (await res.json()) as { token: string };
    key = body.token;
    expect(key).toMatch(/^igv_key_/);
    const init = await rpc(key, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.body.result.protocolVersion).toBe('2025-06-18');
    expect(init.body.result.serverInfo.name).toBe('igv-experience');
    expect(init.body.result.instructions).toContain('IGV EXPERIENCE');
    const note = await mcp('/mcp', json({ jsonrpc: '2.0', method: 'notifications/initialized' }, { authorization: `Bearer ${key}` }));
    expect(note.status).toBe(202);
    const status = (await (await main('/api/ai/status')).json()) as any;
    expect(status.keys.map((k: { name: string }) => k.name)).toContain('Codex');
    expect(JSON.stringify(status)).not.toContain(key);
  });

  it('lista herramientas con esquema y registra en D1 con bitácora y deshacer', async () => {
    const list = await rpc(key, 'tools/list');
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('ver_resumen');
    expect(names).toContain('completar_mision');
    expect(list.body.result.tools[0].inputSchema.type).toBe('object');

    const done = await call(key, 'completar_mision', { mision_id: 'daily-leer' });
    expect(done.isError).toBe(false);
    expect(done.content[0].text).toContain('Leer 20 páginas');

    const resumen = await call(key, 'ver_resumen');
    expect(resumen.content[0].text).toContain('Nivel');
    expect(resumen.content[0].text).toContain('Rutina: 1/7');

    const sync = (await (await main('/api/sync?since=0')).json()) as { events: { type: string; voidedAt: string | null }[] };
    expect(sync.events.filter((e) => e.type === 'mission.completed' && !e.voidedAt)).toHaveLength(1);

    const act = (await (await main('/api/ai/activity')).json()) as { items: { id: string; source: string; undoable: boolean }[] };
    expect(act.items[0].source).toBe('Codex');
    expect(act.items[0].undoable).toBe(true);
    const undo = await main(`/api/ai/activity/${act.items[0].id}/undo`, { method: 'POST' });
    expect(undo.status).toBe(200);
    const after = (await (await main('/api/sync?since=0')).json()) as { events: { type: string; voidedAt: string | null }[] };
    expect(after.events.filter((e) => e.type === 'mission.completed' && !e.voidedAt)).toHaveLength(0);
  });

  it('un error de la herramienta vuelve como isError, no como fallo del protocolo', async () => {
    const r = await call(key, 'completar_mision', { mision_id: 'no-existe' });
    expect(r.isError).toBe(true);
    const unknown = await rpc(key, 'tools/call', { name: 'borrar_todo', arguments: {} });
    expect(unknown.body.error.code).toBe(-32602);
  });

  it('modo solo lectura: oculta y bloquea las herramientas que escriben', async () => {
    await main('/api/ai/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowWrites: false }) });
    const names = (await rpc(key, 'tools/list')).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('ver_resumen');
    expect(names).not.toContain('completar_mision');
    expect((await call(key, 'completar_mision', { mision_id: 'daily-leer' })).isError).toBe(true);
    await main('/api/ai/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowWrites: true }) });
  });

  it('revocar la llave la corta de inmediato', async () => {
    const status = (await (await main('/api/ai/status')).json()) as any;
    await main(`/api/ai/keys/${status.keys[0].id}`, { method: 'DELETE' });
    expect((await rpc(key, 'ping')).status).toBe(401);
  });
});

describe('OAuth para Claude, ChatGPT y demás', () => {
  const verifier = 'v'.repeat(20) + 'erificador-de-prueba-pkce-1234567890';
  let challenge = '';
  let clientId = '';
  const redirect = 'https://claude.ai/api/mcp/auth_callback';

  it('publica metadatos que apuntan a la app para autorizar', async () => {
    challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const pr = (await (await mcp('/.well-known/oauth-protected-resource')).json()) as any;
    expect(pr.resource).toBe('http://localhost/mcp');
    expect(pr.authorization_servers[0]).toBe('http://localhost');
    const as = (await (await mcp('/.well-known/oauth-authorization-server')).json()) as any;
    expect(as.authorization_endpoint).toBe('http://localhost:8787/api/oauth/authorize');
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('registro dinámico: rechaza redirecciones inseguras', async () => {
    expect((await mcp('/oauth/register', json({ redirect_uris: ['http://evil.com/cb'] }))).status).toBe(400);
    expect((await mcp('/oauth/register', json({ redirect_uris: ['javascript:alert(1)'] }))).status).toBe(400);
    const res = await mcp('/oauth/register', json({ client_name: 'Claude', redirect_uris: [redirect] }));
    expect(res.status).toBe(201);
    clientId = ((await res.json()) as any).client_id;
  });

  it('flujo completo: permitir → código → tokens → MCP → rotación', async () => {
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'igv' });
    const pageRes = await main(`/api/oauth/authorize?${q}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain('Claude');
    expect(html).toContain('Permitir');

    // Sin Origin (otro sitio intentando enviar el formulario) se rechaza.
    const csrf = await main('/api/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...Object.fromEntries(q), decision: 'allow' }).toString() });
    expect(csrf.status).toBe(403);

    const approve = await main('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
      body: new URLSearchParams({ ...Object.fromEntries(q), decision: 'allow' }).toString(),
    });
    expect(approve.status).toBe(302);
    const loc = new URL(approve.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(redirect);
    expect(loc.searchParams.get('state')).toBe('xyz');
    const code = loc.searchParams.get('code')!;

    const form = (p: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p).toString() });
    const badPkce = await mcp('/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: 'x'.repeat(50) }));
    expect(badPkce.status).toBe(400);
    // El código ya se consumió en el intento fallido: un solo uso. Pedimos otro.
    const again = await main('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
      body: new URLSearchParams({ ...Object.fromEntries(q), decision: 'allow' }).toString(),
    });
    const code2 = new URL(again.headers.get('location')!).searchParams.get('code')!;
    const tokRes = await mcp('/oauth/token', form({ grant_type: 'authorization_code', code: code2, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }));
    expect(tokRes.status).toBe(200);
    const tok = (await tokRes.json()) as any;
    expect(tok.token_type).toBe('Bearer');
    expect(tok.refresh_token).toMatch(/^igv_rt_/);

    const r = await call(tok.access_token, 'registrar_dinero', { tipo: 'gasto', monto: 250, concepto: 'Comida' });
    expect(r.isError).toBe(false);
    const act = (await (await main('/api/ai/activity')).json()) as { items: { source: string }[] };
    expect(act.items[0].source).toBe('Claude');
    const status = (await (await main('/api/ai/status')).json()) as any;
    expect(status.connections.map((x: { name: string }) => x.name)).toContain('Claude');

    const ref = await mcp('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId }));
    expect(ref.status).toBe(200);
    const tok2 = (await ref.json()) as any;
    expect((await rpc(tok.access_token, 'ping')).status).toBe(401); // el access viejo ya no sirve
    expect((await rpc(tok2.access_token, 'ping')).status).toBe(200);

    // Reusar un refresh ya rotado revoca la conexión completa.
    const reuse = await mcp('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId }));
    expect(reuse.status).toBe(400);
    expect(((await reuse.json()) as any).error).toBe('invalid_grant');
    expect((await rpc(tok2.access_token, 'ping')).status).toBe(401);
  });

  it('cancelar regresa access_denied', async () => {
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
    const res = await main('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
      body: new URLSearchParams({ ...Object.fromEntries(q), decision: 'deny' }).toString(),
    });
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
  });

  it('redirecciones de loopback (Claude Code, Codex) se aceptan en cualquier puerto', async () => {
    const reg = (await (await mcp('/oauth/register', json({ client_name: 'Claude Code', redirect_uris: ['http://localhost/callback'] }))).json()) as any;
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'http://localhost:51234/callback', code_challenge: challenge, code_challenge_method: 'S256' });
    expect((await main(`/api/oauth/authorize?${q}`)).status).toBe(200);
    const bad = new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: 'http://localhost:51234/otra' });
    expect((await main(`/api/oauth/authorize?${bad}`)).status).toBe(400);
  });
});
