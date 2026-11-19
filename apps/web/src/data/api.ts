import type { AssistantSnapshot, Entity, GameEvent } from '@igv/core';

export class AuthError extends Error {}

export interface PushPlanItem {
  id: string;
  at: string;
  title: string;
  body: string;
  url?: string;
}

export interface GmProposal {
  kind: 'mission' | 'income' | 'expense' | 'npc' | 'lesson' | 'body' | 'goal' | 'rest';
  title: string | null;
  matchId: string | null;
  size: 'chica' | 'media' | 'grande' | 'epica' | null;
  attribute: 'fuerza' | 'inteligencia' | 'carisma' | 'finanzas' | 'disciplina' | 'relaciones' | 'creatividad' | null;
  amount: number | null;
  concept: string | null;
  category: string | null;
  text: string | null;
  weightKg: number | null;
  workout: string | null;
  daysAgo: number;
}
export interface GmParseResult {
  reply: string;
  proposals: GmProposal[];
}
/** Una llave personal o una app conectada por OAuth (Claude, ChatGPT…). */
export interface AiAccess {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}
export interface AiStatus {
  mcpUrl: string | null;
  coach: boolean;
  allowWrites: boolean;
  keys: AiAccess[];
  connections: AiAccess[];
}
export interface AiActivityItem {
  id: string;
  at: number;
  source: string;
  tool: string;
  summary: string;
  undoneAt: number | null;
  undoable: boolean;
}
/** Algo que el Coach hizo en la app durante una respuesta. */
export interface CoachAction {
  tool: string;
  summary: string;
  activityId: string;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}

/** Petición a /api con manejo de sesión de Access. Los sistemas nuevos la usan en su propio archivo data/<sistema>Api.ts. */
export async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  // Cloudflare Access redirige al login cuando la sesión expira.
  if (res.type === 'opaqueredirect') throw new AuthError('Sesión expirada');
  if (res.status === 401 || res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new AuthError(body.code === 'access_disabled' ? 'access_disabled' : body.error ?? 'Sesión expirada');
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (res.ok) throw new AuthError('Respuesta inesperada (¿sesión expirada?)');
    throw new ApiError(`Error ${res.status}`, res.status);
  }
  const body = await res.json();
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Error ${res.status}`, res.status, body);
  return body as T;
}

export const api = {
  sync: (since: number) => req<{ cursor: number; events: GameEvent[]; entities: Entity[] }>(`/sync?since=${since}`),
  postEvents: (events: GameEvent[]) => req<{ ok: true }>('/events', { method: 'POST', body: JSON.stringify(events) }),
  voidEvent: (id: string) => req<{ ok: true; event: GameEvent }>(`/events/${encodeURIComponent(id)}/void`, { method: 'POST' }),
  restoreEvent: (id: string) => req<{ ok: true; event: GameEvent }>(`/events/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  putEntity: (e: Entity) => req<{ ok: true; entity: Entity }>(`/entities/${encodeURIComponent(e.id)}`, { method: 'PUT', body: JSON.stringify({ module: e.module, kind: e.kind, data: e.data, sort: e.sort }) }),
  deleteEntity: (id: string) => req<{ ok: true }>(`/entities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  backupUrl: '/api/backup',
  importBackup: (data: unknown, mode: 'replace' | 'merge') => req<{ ok: true; events: number; entities: number }>(`/backup/import?mode=${mode}`, { method: 'POST', body: JSON.stringify(data) }),
  me: () => req<{ email: string }>('/me'),
  gmStatus: () => req<{ enabled: boolean; model?: string }>('/gm/status'),
  gmParse: (body: { text: string; today: string; catalog: string }) => req<GmParseResult>('/gm/parse', { method: 'POST', body: JSON.stringify(body) }),
  pushKey: () => req<{ publicKey: string }>('/push/key'),
  pushStatus: () => req<{ devices: number; planned: number }>('/push/status'),
  pushSubscribe: (sub: unknown) => req<{ ok: true; devices: number }>('/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string) => req<{ ok: true }>('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  pushPlan: (items: PushPlanItem[]) => req<{ ok: true }>('/push/plan', { method: 'PUT', body: JSON.stringify({ items }) }),
  pushTest: () => req<{ ok: true; sent: number }>('/push/test', { method: 'POST' }),
  gmAsk: (body: { question: string; history: { role: 'user' | 'assistant'; content: string }[]; context?: string; readOnly?: boolean }) =>
    req<{ answer: string; actions: CoachAction[] }>('/gm/ask', { method: 'POST', body: JSON.stringify(body) }),
  aiStatus: () => req<AiStatus>('/ai/status'),
  aiSettings: (allowWrites: boolean) => req<{ ok: true }>('/ai/settings', { method: 'PUT', body: JSON.stringify({ allowWrites }) }),
  aiCreateKey: (name: string) => req<{ ok: true; key: AiAccess; token: string }>('/ai/keys', { method: 'POST', body: JSON.stringify({ name }) }),
  aiRevokeKey: (id: string) => req<{ ok: true }>(`/ai/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  aiRevokeConnection: (id: string) => req<{ ok: true }>(`/ai/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  aiActivity: () => req<{ items: AiActivityItem[] }>('/ai/activity'),
  aiUndo: (id: string) => req<{ ok: true; kept: number }>(`/ai/activity/${encodeURIComponent(id)}/undo`, { method: 'POST' }),
  aiSnapshot: (snapshot: AssistantSnapshot) => req<{ ok: boolean; reason?: string }>('/ai/snapshot', { method: 'PUT', body: JSON.stringify(snapshot) }),
};
