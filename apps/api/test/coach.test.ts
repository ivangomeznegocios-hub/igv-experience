import { describe, expect, it, vi } from 'vitest';
import { fakeD1 } from './fake-d1';

// API de Claude simulada: primero pide una herramienta y luego responde con texto.
const calls: any[] = [];
vi.mock('@anthropic-ai/sdk', async (orig) => {
  const actual = await orig<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic extends actual.default {
    constructor(opts: any) {
      super(opts);
      (this as any).beta = {
        messages: {
          create: async (req: any) => {
            calls.push(structuredClone(req));
            if (calls.length === 1) {
              return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'completar_mision', input: { mision_id: 'daily-entrenar' } }] };
            }
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Listo: registré "Entrenar 30 min" (+10 XP).' }] };
          },
        },
      };
    }
  }
  return { ...actual, default: FakeAnthropic };
});

describe('Coach con herramientas', () => {
  it('ejecuta la herramienta que pide el modelo, devuelve el resultado y registra la acción', async () => {
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    const res = await app.request('/api/gm/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Registra que entrené', history: [] }) }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; actions: { tool: string; summary: string; activityId: string }[] };
    expect(body.answer).toContain('Entrenar');
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0].tool).toBe('completar_mision');

    // Primera llamada: con herramientas y el estado de la app en el primer mensaje.
    expect(calls[0].tools.some((t: { name: string }) => t.name === 'completar_mision')).toBe(true);
    expect(calls[0].messages[0].content).toContain('Panorama');
    // Segunda llamada: trae el resultado de la herramienta.
    const last = calls[1].messages.at(-1);
    expect(last.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: false });
    expect(last.content[0].content).toContain('Entrenar 30 min');

    const sync = (await (await app.request('/api/sync?since=0', {}, env)).json()) as { events: { type: string; payload: any }[] };
    expect(sync.events.find((e) => e.type === 'mission.completed')?.payload.missionId).toBe('daily-entrenar');
    const act = (await (await app.request('/api/ai/activity', {}, env)).json()) as { items: { source: string }[] };
    expect(act.items[0].source).toBe('Coach');
  });
});
