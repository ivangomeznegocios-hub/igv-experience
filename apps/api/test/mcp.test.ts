import { describe, expect, it, vi } from 'vitest';
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
    // Solo ASCII (RFC 6750): el cliente de Codex rechaza otros bytes en este encabezado.
    expect(/^[\x20-\x7e]*$/.test(bad.headers.get('www-authenticate')!)).toBe(true);
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

    // Sin marcar la casilla (p. ej. un doble clic engañado) no se aprueba.
    const noConfirm = await main('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
      body: new URLSearchParams({ ...Object.fromEntries(q), decision: 'allow' }).toString(),
    });
    expect(noConfirm.status).toBe(400);

    const approve = await main('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
      body: new URLSearchParams({ ...Object.fromEntries(q), decision: 'allow', confirm: '1' }).toString(),
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
      body: new URLSearchParams({ ...Object.fromEntries(q), decision: 'allow', confirm: '1' }).toString(),
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
    expect((await rpc(tok2.access_token, 'ping')).status).toBe(200);
    // Los access tokens vigentes no se anulan al rotar (refrescos en paralelo): caducan solos en 1 h.
    expect((await rpc(tok.access_token, 'ping')).status).toBe(200);

    // Reintento o refresco simultáneo dentro del margen: se acepta sin revocar nada.
    const retry = await mcp('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId }));
    expect(retry.status).toBe(200);

    // Reusar un refresh rotado fuera del margen revoca la conexión completa (posible robo).
    const realNow = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
    try {
      const reuse = await mcp('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId }));
      expect(reuse.status).toBe(400);
      expect(((await reuse.json()) as any).error).toBe('invalid_grant');
      expect((await rpc(tok2.access_token, 'ping')).status).toBe(401);
    } finally {
      vi.restoreAllMocks();
    }
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

describe('pantalla Permitir y registro abierto', () => {
  const challenge = 'x'.repeat(43);
  it('avisa si una app dice ser Claude pero regresa a otro dominio', async () => {
    const reg = (await (await mcp('/oauth/register', json({ client_name: 'Claude', redirect_uris: ['https://script.google.com/macros/s/abc/exec'] }))).json()) as any;
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://script.google.com/macros/s/abc/exec', code_challenge: challenge, code_challenge_method: 'S256' });
    const html = await (await main(`/api/oauth/authorize?${q}`)).text();
    expect(html).toContain('Cuidado');
    expect(html).toContain('script.google.com/macros/s/abc/exec');
    expect(html).toContain('name="confirm"');
  });

  it('el registro dinámico no escribe en D1 y un client_id alterado no sirve', async () => {
    const fresh = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true' } as any;
    const reg = async () => (await (await mcpApp.request('/oauth/register', json({ client_name: 'x', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }), fresh)).json()) as any;
    const first = await reg();
    const count = async () => ((await fresh.DB.prepare('SELECT count(*) AS n FROM ai_credentials').first()) as { n: number }).n;
    const before = await count();
    for (let i = 0; i < 50; i++) await reg();
    expect(await count()).toBe(before);
    expect(before).toBe(0);
    // Cambiar los datos del client_id (p. ej. la dirección de regreso) invalida la firma.
    const [prefix, payload, sig] = first.client_id.split('.');
    const forged = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    forged.r = ['https://evil.example/cb'];
    const forgedId = [prefix, btoa(JSON.stringify(forged)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), sig].join('.');
    const q = new URLSearchParams({ response_type: 'code', client_id: forgedId, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await app.request(`/api/oauth/authorize?${q}`, {}, fresh);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('App desconocida');
  });
});

describe('deshacer respeta lo que pasó después', () => {
  it('no pisa una edición posterior y archiva (no borra) una meta con avances propios', async () => {
    const e = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true' } as any;
    const m = (path: string, init?: RequestInit) => app.request(path, init, e);
    const key = ((await (await m('/api/ai/keys', json({ name: 'k' }))).json()) as any).token;
    const call2 = async (name: string, args: unknown) => {
      const res = await mcpApp.request('/mcp', json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { authorization: `Bearer ${key}` }), e);
      return ((await res.json()) as any).result;
    };
    // La IA crea una meta; Iván registra avance desde la app.
    const created = await call2('guardar_meta', { titulo: 'Leer 2 libros', objetivo: 2, unidad: 'libros' });
    const goalId = /Id \[([^\]]+)\]/.exec(created.content[0].text)![1];
    await m('/api/events', json({ id: 'evt-app-0001', type: 'goal.progress', occurredAt: new Date().toISOString(), localDate: '2026-11-19', payload: { goalId, amount: 2 } }));
    // La IA crea una diaria e Iván la edita después.
    const daily = await call2('guardar_mision', { tipo: 'diaria', titulo: 'Meditar', tamano: 'chica', atributo: 'disciplina' });
    const dailyId = /Id \[([^\]]+)\]/.exec(daily.content[0].text)![1];
    await m(`/api/entities/${dailyId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ module: 'missions', kind: 'daily', data: { title: 'Meditar 15 min', size: 'chica', attribute: 'disciplina' } }) });

    const items = ((await (await m('/api/ai/activity')).json()) as any).items as { id: string; tool: string }[];
    for (const it of items) {
      const r = (await (await m(`/api/ai/activity/${it.id}/undo`, { method: 'POST' })).json()) as any;
      expect(r.ok).toBe(true);
      expect(r.kept).toBe(1);
    }
    const sync = (await (await m('/api/sync?since=0')).json()) as { entities: { id: string; data: any; deletedAt: number | null }[] };
    const goal = sync.entities.find((x) => x.id === goalId)!;
    expect(goal.deletedAt).toBeNull();
    expect(goal.data.archived).toBe(true);
    const d = sync.entities.find((x) => x.id === dailyId)!;
    expect(d.deletedAt).toBeNull();
    expect(d.data.title).toBe('Meditar 15 min');
  });
});

describe('deshacer: retos iniciados por la IA y orden', () => {
  it('no borra los días que Iván marcó en un reto que la IA creó e inició', async () => {
    const e = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true' } as any;
    const m = (path: string, init?: RequestInit) => app.request(path, init, e);
    const key = ((await (await m('/api/ai/keys', json({ name: 'k' }))).json()) as any).token;
    const call2 = async (name: string, args: unknown) => {
      const res = await mcpApp.request('/mcp', json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { authorization: `Bearer ${key}` }), e);
      return ((await res.json()) as any).result;
    };
    const created = await call2('guardar_reto', { titulo: 'Sin azúcar', dias: 2, tamano: 'grande', iniciar: true });
    const id = /Id \[([^\]]+)\]/.exec(created.content[0].text)![1];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    await m('/api/events', json({ id: 'evt-check-0001', type: 'challenge.checked', occurredAt: new Date().toISOString(), localDate: today, payload: { challengeId: id } }));
    const items = ((await (await m('/api/ai/activity')).json()) as any).items as { id: string }[];
    const r = (await (await m(`/api/ai/activity/${items[0].id}/undo`, { method: 'POST' })).json()) as any;
    expect(r.ok).toBe(true);
    const sync = (await (await m('/api/sync?since=0')).json()) as { events: { type: string; voidedAt: string | null }[]; entities: { id: string; data: any; deletedAt: number | null }[] };
    expect(sync.events.find((x) => x.type === 'challenge.started')?.voidedAt).toBeNull();
    const ent = sync.entities.find((x) => x.id === id)!;
    expect(ent.deletedAt).toBeNull();
    expect(ent.data.archived).toBe(true);
  });

  it('deshacer en orden (lo más reciente primero) regresa al estado original', async () => {
    const e = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true' } as any;
    const m = (path: string, init?: RequestInit) => app.request(path, init, e);
    const key = ((await (await m('/api/ai/keys', json({ name: 'k' }))).json()) as any).token;
    const call2 = async (name: string, args: unknown) => {
      const res = await mcpApp.request('/mcp', json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { authorization: `Bearer ${key}` }), e);
      return ((await res.json()) as any).result;
    };
    const created = await call2('guardar_premio', { nombre: 'Cena', costo: 40 });
    const id = /Id \[([^\]]+)\]/.exec(created.content[0].text)![1];
    await call2('guardar_premio', { id, costo: 60 });
    const items = ((await (await m('/api/ai/activity')).json()) as any).items as { id: string }[];
    for (const it of items) {
      const r = (await (await m(`/api/ai/activity/${it.id}/undo`, { method: 'POST' })).json()) as any;
      expect(r).toMatchObject({ ok: true, kept: 0 });
    }
    const sync = (await (await m('/api/sync?since=0')).json()) as { entities: { id: string; deletedAt: number | null }[] };
    expect(sync.entities.find((x) => x.id === id)?.deletedAt).not.toBeNull();
  });

  it('protege por intento: conserva el día 1 que marcó la IA si Iván siguió, y deshace un intento ya terminado', async () => {
    const e = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true' } as any;
    const m = (path: string, init?: RequestInit) => app.request(path, init, e);
    const key = ((await (await m('/api/ai/keys', json({ name: 'k' }))).json()) as any).token;
    const call2 = async (name: string, args: unknown) => {
      const res = await mcpApp.request('/mcp', json({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { authorization: `Bearer ${key}` }), e);
      return ((await res.json()) as any).result;
    };
    const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(d);
    const today = fmt(new Date());
    const [y, mo, d] = today.split('-').map(Number);
    const yesterday = new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10);
    const put = (id: string, days: number) =>
      m(`/api/entities/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ module: 'challenges', kind: 'challenge', data: { title: id, days, attribute: 'disciplina', size: 'media' } }) });
    const check = (id: string, cid: string, date: string, type = 'challenge.checked') =>
      m('/api/events', json({ id, type, occurredAt: new Date().toISOString(), localDate: date, payload: { challengeId: cid } }));
    const undoLast = async () => {
      const items = ((await (await m('/api/ai/activity')).json()) as any).items as { id: string; undoneAt: number | null }[];
      return (await (await m(`/api/ai/activity/${items.find((x) => !x.undoneAt)!.id}/undo`, { method: 'POST' })).json()) as any;
    };
    const live = async (cid: string) =>
      ((await (await m('/api/sync?since=0')).json()) as { events: { type: string; localDate: string; voidedAt: string | null; payload: any }[] }).events.filter(
        (x) => x.payload?.challengeId === cid && !x.voidedAt,
      );

    // (1) La IA empieza ayer marcando el día 1; Iván marca hoy. Deshacer no debe romper su cadena.
    await put('ch-largo', 7);
    expect((await call2('marcar_reto', { reto_id: 'ch-largo', fecha: yesterday })).isError).toBe(false);
    await check('evt-ivan-hoy-01', 'ch-largo', today);
    expect((await undoLast())).toMatchObject({ ok: true, kept: 1 });
    expect((await live('ch-largo')).map((x) => `${x.type}@${x.localDate}`).sort()).toEqual([`challenge.checked@${today}`, `challenge.checked@${yesterday}`, `challenge.started@${yesterday}`].sort());

    // (2) Intento de la IA ya terminado (reto de 1 día, ayer) y luego Iván empieza otro hoy: deshacer sí anula lo de la IA.
    await put('ch-corto', 1);
    expect((await call2('marcar_reto', { reto_id: 'ch-corto', fecha: yesterday })).isError).toBe(false);
    await check('evt-ivan-start-02', 'ch-corto', today, 'challenge.started');
    await check('evt-ivan-check-02', 'ch-corto', today);
    expect((await undoLast())).toMatchObject({ ok: true, kept: 0 });
    expect((await live('ch-corto')).map((x) => x.localDate)).toEqual([today, today]);
  });
});

