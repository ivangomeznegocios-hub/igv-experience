import { Hono, type Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { APP_GUIDE, ASSISTANT_TOOLS, runAssistantTool, toolInputSchema } from '@igv/core';
import type { Env } from '../env';
import { getAiSettings, verifyBearer, type Caller } from './credentials';
import { D1AssistantStore, recordActivity } from './store';
import { oauthServerRoutes } from './oauth';

/**
 * Servidor MCP (Model Context Protocol) por "Streamable HTTP", sin estado: cada POST /mcp trae un mensaje
 * JSON-RPC y se responde con JSON. Sin sesiones ni SSE (no hacen falta: no hay notificaciones del servidor).
 * Lo usan Claude (web, escritorio, móvil y Claude Code), ChatGPT, Codex, Antigravity, Cursor…
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'igv-experience', title: 'IGV EXPERIENCE', version: '1.0.0' };

export const MCP_INSTRUCTIONS = `${APP_GUIDE}

Eres un asistente conectado a la app de Iván. Responde en español de México, directo y cálido. Consulta antes de registrar, registra solo lo que él te diga y confirma en una línea qué quedó.`;

type Id = string | number | null;
interface RpcRequest {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });
const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });

export interface RpcContext {
  env: Env;
  caller: Caller;
}

/** Procesa un mensaje JSON-RPC. Devuelve null para notificaciones (no llevan respuesta). */
export async function handleRpc(msg: unknown, ctx: RpcContext): Promise<object | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request');
  const m = msg as RpcRequest;
  const isNotification = !('id' in m) || m.id === undefined;
  const id: Id = isNotification ? null : (m.id ?? null);
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return isNotification ? null : rpcError(id, -32600, 'Invalid Request');
  if (isNotification) return null; // notifications/initialized, notifications/cancelled…

  switch (m.method) {
    case 'initialize': {
      const requested = String(m.params?.protocolVersion ?? '');
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list': {
      const { allowWrites } = await getAiSettings(drizzle(ctx.env.DB));
      const tools = ASSISTANT_TOOLS.filter((t) => allowWrites || !t.writes).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: toolInputSchema(t),
        annotations: { title: t.title, readOnlyHint: !t.writes, destructiveHint: !!t.destructive, idempotentHint: !t.writes, openWorldHint: false },
      }));
      return rpcResult(id, { tools });
    }
    case 'tools/call': {
      const name = String(m.params?.name ?? '');
      if (!ASSISTANT_TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Herramienta desconocida: ${name}`);
      const { allowWrites } = await getAiSettings(drizzle(ctx.env.DB));
      const store = new D1AssistantStore(ctx.env.DB);
      const result = await runAssistantTool(name, m.params?.arguments ?? {}, store, { allowWrites });
      if (!result.isError && result.summary && result.refs) {
        await recordActivity(ctx.env.DB, { source: ctx.caller.label, tool: name, summary: result.summary, refs: result.refs });
      }
      return rpcResult(id, { content: [{ type: 'text', text: result.text }], isError: !!result.isError });
    }
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    case 'logging/setLevel':
      return rpcResult(id, {});
    default:
      return rpcError(id, -32601, `Método no soportado: ${m.method}`);
  }
}

// ---------- Worker del MCP (público, sin Access) ----------

type McpEnv = { Bindings: Env; Variables: { caller: Caller } };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

function unauthorized(c: Context<McpEnv>, invalid: boolean) {
  const origin = new URL(c.req.url).origin;
  const params = [`resource_metadata="${origin}/.well-known/oauth-protected-resource"`];
  // Solo ASCII en este encabezado (RFC 6750): algunos clientes (rmcp, el de Codex) rechazan otros bytes.
  if (invalid) params.push('error="invalid_token"', 'error_description="Invalid, expired or revoked token"');
  return c.json(
    { error: invalid ? 'invalid_token' : 'unauthorized', error_description: 'Conecta este asistente desde IGV EXPERIENCE (Más → Conectar IA).' },
    401,
    { 'WWW-Authenticate': `Bearer ${params.join(', ')}` },
  );
}

export const mcpApp = new Hono<McpEnv>();

mcpApp.onError((err, c) => {
  console.error(err);
  return c.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Error interno del servidor' } }, 500, CORS_HEADERS);
});

mcpApp.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return c.body(null, 204, CORS_HEADERS);
  await next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) c.res.headers.set(k, v);
});

mcpApp.get('/', (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({ name: 'IGV EXPERIENCE · servidor MCP', mcp: `${origin}/mcp`, ayuda: 'Abre la app → Más → Conectar IA para ver cómo conectar Claude, ChatGPT, Codex o Antigravity.' });
});

mcpApp.route('/', oauthServerRoutes);

mcpApp.use('/mcp', async (c, next) => {
  const auth = c.req.header('Authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return unauthorized(c, false);
  const caller = await verifyBearer(drizzle(c.env.DB), m[1]);
  if (!caller) return unauthorized(c, true);
  c.set('caller', caller);
  await next();
});

mcpApp.post('/mcp', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400);
  }
  const ctx: RpcContext = { env: c.env, caller: c.get('caller') };
  if (Array.isArray(body)) {
    if (!body.length) return c.json(rpcError(null, -32600, 'Invalid Request'), 400);
    const out = (await Promise.all(body.slice(0, 20).map((msg) => handleRpc(msg, ctx)))).filter(Boolean);
    return out.length ? c.json(out) : c.body(null, 202);
  }
  const res = await handleRpc(body, ctx);
  return res ? c.json(res) : c.body(null, 202);
});

// Sin SSE ni sesiones: GET (flujo de notificaciones) y DELETE (cerrar sesión) no aplican.
mcpApp.on(['GET', 'DELETE'], '/mcp', (c) => c.body(null, 405, { Allow: 'POST' }));

mcpApp.notFound((c) => c.json({ error: 'No encontrado' }, 404));
