import type { Entity, GameEvent } from '@igv/core';

export class AuthError extends Error {}
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Error ${res.status}`, res.status);
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
  gmAsk: (body: { question: string; context: string; history: { role: 'user' | 'assistant'; content: string }[] }) =>
    req<{ answer: string }>('/gm/ask', { method: 'POST', body: JSON.stringify(body) }),
};
