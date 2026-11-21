/**
 * Entorno de navegador mínimo para las pruebas en Node: localStorage en memoria y `fetch` que por defecto falla
 * como sin conexión (el store sigue funcionando: deja todo en su cola). Impórtalo antes que los archivos de `src`.
 */
import { vi } from 'vitest';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const g = globalThis as unknown as { localStorage?: MemoryStorage; fetch: typeof fetch };
g.localStorage = new MemoryStorage();

/** Respuestas del servidor falso por ruta (`/gm/status` → objeto JSON). Lo que no esté aquí falla sin conexión. */
export const server: { routes: Record<string, () => unknown> } = { routes: {} };

export const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const route = Object.keys(server.routes).find((r) => url.startsWith(`/api${r}`));
  if (!route) throw new TypeError('Failed to fetch');
  return new Response(JSON.stringify(server.routes[route]()), { status: 200, headers: { 'content-type': 'application/json' } });
});
g.fetch = fetchMock as unknown as typeof fetch;
