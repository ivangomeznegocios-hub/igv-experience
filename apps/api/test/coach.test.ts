import { describe, expect, it, vi } from 'vitest';
import { fakeD1 } from './fake-d1';

// API de Claude simulada: primero pide una herramienta y luego responde con texto.
const calls: any[] = [];
const mode = { failSecond: false };
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
            if (mode.failSecond) throw new actual.APIError(529, { type: 'error' }, 'overloaded', new Headers());
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

  it('si la API de Claude falla a la mitad, devuelve lo que ya registró (con su Deshacer)', async () => {
    calls.length = 0;
    mode.failSecond = true;
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    const res = await app.request('/api/gm/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Registra que entrené', history: [] }) }, env);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; actions: { activityId: string }[] };
    expect(body.actions).toHaveLength(1);
    expect(body.error).toContain('Alcancé a hacer');
    mode.failSecond = false;
  });

  it('el reporte semanal (solo lectura con datos propios) no recibe herramientas que escriben ni el panorama de hoy', async () => {
    calls.length = 0;
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    await app.request('/api/gm/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Resumen', history: [], context: 'Semana del 2026-11-09', readOnly: true }) }, env);
    expect(calls[0].tools.some((t: { name: string }) => t.name === 'completar_mision')).toBe(false);
    expect(calls[0].messages[0].content).toContain('Semana del 2026-11-09');
    expect(calls[0].messages[0].content).not.toContain('Panorama');
  });
});

describe('Coach en modo dictado (botón Hablar)', () => {
  const ask = (app: any, env: any, body: Record<string, unknown>) =>
    app.request('/api/gm/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ history: [], ...body }) }, env);

  it('agrega la instrucción de dictado, envuelve lo dictado con la fecha y registra con las herramientas', async () => {
    calls.length = 0;
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    const res = await ask(app, env, { question: 'hoy fui al jim y gasté 200 en comida', mode: 'dictado', context: 'Personas (id | nombre):\nnpc-ana | Ana' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; actions: { tool: string; activityId: string }[] };
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0].tool).toBe('completar_mision');

    // Sistema: el bloque principal (con caché) + el de dictado.
    expect(calls[0].system).toHaveLength(2);
    expect(calls[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(calls[0].system[1].text).toContain('MODO DICTADO');
    expect(calls[0].system[1].text).toContain('SIN pedir confirmación');
    // Lo dictado va citado y con la fecha de hoy; los datos de la pantalla van con el panorama.
    const last = calls[0].messages.at(-1);
    expect(last.content).toMatch(/^Hoy es \d{4}-\d{2}-\d{2}\. Esto dicté:/);
    expect(last.content).toContain('hoy fui al jim y gasté 200 en comida');
    expect(calls[0].messages[0].content).toContain('npc-ana | Ana');
    // Con herramientas que escriben (incluidas las de notas).
    const names = calls[0].tools.map((t: { name: string }) => t.name);
    expect(names).toContain('registrar_dinero');
    expect(names).toContain('marcar_nota');
  });

  it('una conversación normal no lleva la instrucción de dictado', async () => {
    calls.length = 0;
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    await ask(app, env, { question: 'Registra que entrené' });
    expect(calls[0].system).toHaveLength(1);
    expect(calls[0].messages.at(-1).content).toBe('Registra que entrené');
  });

  it('en solo lectura responde 409 sin llamar a la API de Claude (la app deja la nota pendiente)', async () => {
    calls.length = 0;
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    const put = await app.request('/api/ai/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowWrites: false }) }, env);
    expect(put.status).toBe(200);
    const res = await ask(app, env, { question: 'gasté 200 en comida', mode: 'dictado' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; actions: unknown[] };
    expect(body.code).toBe('read_only');
    expect(body.actions).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('rechaza un modo desconocido o dictado de solo lectura', async () => {
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    expect((await ask(app, env, { question: 'x', mode: 'otro' })).status).toBe(400);
    expect((await ask(app, env, { question: 'x', mode: 'dictado', readOnly: true })).status).toBe(400);
  });
});
