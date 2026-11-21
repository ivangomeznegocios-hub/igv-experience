import { describe, expect, it, vi } from 'vitest';
import { fakeD1 } from './fake-d1';

// API de Claude simulada: primero pide una herramienta y luego responde con texto.
const calls: any[] = [];
const mode = { failSecond: false, script: null as any[] | null };
vi.mock('@anthropic-ai/sdk', async (orig) => {
  const actual = await orig<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic extends actual.default {
    constructor(opts: any) {
      super(opts);
      (this as any).beta = {
        messages: {
          create: async (req: any) => {
            calls.push(structuredClone(req));
            if (mode.script) return mode.script[calls.length - 1] ?? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Listo.' }] };
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

/** Como D1 en el plan gratis de Workers: pasar de `max` consultas en una invocación falla. */
function limitedD1(d1: D1Database, limit: { n: number; max: number }): D1Database {
  return new Proxy(d1, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (++limit.n > limit.max) throw new Error('Too many API requests by single worker invocation.');
          return target.prepare(sql);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

describe('Coach: límite de consultas a D1', () => {
  it('no empieza una escritura que no cabe en las 50 consultas: nada queda a medias ni sin "Deshacer"', async () => {
    calls.length = 0;
    const app = (await import('../src/index')).default;
    const limit = { n: 0, max: Infinity };
    const env = { DB: limitedD1(fakeD1(), limit), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    const put = (id: string, module: string, kind: string, data: Record<string, unknown>) =>
      app.request(`/api/entities/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ module, kind, data }) }, env);
    const people = Array.from({ length: 20 }, (_, i) => `npc-p${String(i).padStart(2, '0')}`);
    for (const [i, id] of people.entries()) await put(id, 'npcs', 'npc', { name: `Persona ${i}`, circle: 'amigos' });
    await put('lt-ingles', 'learning', 'topic', { name: 'Inglés', topicKind: 'idioma' });
    const frases = Array.from({ length: 25 }, (_, i) => ({ texto: `Phrase number ${i}`, significado: `Frase ${i}` }));
    mode.script = [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_a', name: 'registrar_contacto', input: { personas: people, canal: 'persona' } },
          { type: 'tool_use', id: 'tu_b', name: 'agregar_frase', input: { tema_id: 'lt-ingles', frases } },
        ],
      },
    ];
    try {
      limit.n = 0;
      limit.max = 50;
      const res = await app.request('/api/gm/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Registra todo', history: [] }) }, env);
      expect(limit.n).toBeLessThanOrEqual(50);
      limit.max = Infinity;
      expect(res.status).toBe(200);
      const body = (await res.json()) as { actions: { tool: string; activityId: string }[] };
      // Los 20 contactos sí cabían (y quedan con su "Deshacer"); las 25 frases ya no: ni se empiezan.
      expect(body.actions.map((a) => a.tool)).toEqual(['registrar_contacto']);
      const results = calls[1].messages.at(-1).content;
      expect(results[0]).toMatchObject({ tool_use_id: 'tu_a', is_error: false });
      expect(results[1]).toMatchObject({ tool_use_id: 'tu_b', is_error: true });
      expect(results[1].content).toContain('límite');
      const sync = (await (await app.request('/api/sync?since=0', {}, env)).json()) as { events: { type: string }[]; entities: { module: string; kind: string }[] };
      expect(sync.events.filter((e) => e.type === 'npc.interaction')).toHaveLength(20);
      expect(sync.entities.filter((e) => e.module === 'learning' && e.kind === 'item')).toHaveLength(0);
    } finally {
      mode.script = null;
      limit.max = Infinity;
    }
  });
});

describe('Coach en modo entrenador', () => {
  it('agrega la instrucción del entrenador, la búsqueda web y reanuda un turno pausado por la búsqueda', async () => {
    calls.length = 0;
    const paused = {
      stop_reason: 'pause_turn',
      content: [{ type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'proteína por kg hipertrofia metaanálisis' } }],
    };
    mode.script = [
      paused,
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_9', name: 'ver_plan_entrenador', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hoy toca cuerpo completo A. 1.6 g/kg de proteína (Morton 2018).' }] },
    ];
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    const res = await app.request('/api/gm/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '¿Qué hago hoy y cuánta proteína como?', history: [], mode: 'entrenador' }) }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string };
    expect(body.answer).toContain('cuerpo completo');
    expect(calls[0].system.map((b: { text: string }) => b.text).join('\n')).toContain('MODO ENTRENADOR');
    expect(calls[0].tools.find((t: { name: string }) => t.name === 'web_search')).toMatchObject({ type: 'web_search_20260209' });
    expect(calls[0].tools.some((t: { name: string }) => t.name === 'ver_plan_entrenador')).toBe(true);
    // Tras la pausa se reenvía el turno del asistente tal cual, sin un mensaje "continúa".
    expect(calls[1].messages.at(-1)).toMatchObject({ role: 'assistant', content: paused.content });
    // La herramienta del entrenador corre y su resultado vuelve al modelo.
    expect(calls[2].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_9', is_error: false });
    expect(calls[2].messages.at(-1).content[0].content).toContain('Plan del entrenador');
    mode.script = null;
  });

  const askCoach = async (question: string) => {
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    const res = await app.request('/api/gm/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, history: [], mode: 'entrenador' }) }, env);
    expect(res.status).toBe(200);
    return (await res.json()) as { answer: string; actions: unknown[]; sources?: { title: string; url: string }[] };
  };
  const EXAMINE = 'https://examine.com/supplements/creatine/';
  const PUBMED = 'https://pubmed.ncbi.nlm.nih.gov/28615996/';
  const cite = (url: string, title: string | null) => ({ type: 'web_search_result_location', url, title, encrypted_index: 'idx', cited_text: '…' });
  const search = (id: string, query: string) => [
    { type: 'server_tool_use', id, name: 'web_search', input: { query } },
    { type: 'web_search_tool_result', tool_use_id: id, content: [{ type: 'web_search_result', url: EXAMINE, title: 'Creatine - Examine', encrypted_content: 'enc', page_age: null }] },
  ];

  it('una respuesta citada en varios bloques sale en una sola frase (sin saltos a media oración) y trae sus fuentes', async () => {
    calls.length = 0;
    mode.script = [
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'Déjame revisar la evidencia.' },
          ...search('srvtoolu_1', 'creatina fuerza metaanálisis'),
          // Con búsqueda web la API siempre cita: el texto llega partido justo donde empieza y termina cada cita.
          { type: 'text', text: 'Sí. ' },
          { type: 'text', text: 'La creatina monohidratada (3–5 g al día) mejora la fuerza', citations: [cite(EXAMINE, 'Creatine - Examine')] },
          { type: 'text', text: ' y la masa muscular cuando entrenas', citations: [cite(PUBMED, 'ISSN position stand: creatine - PubMed'), cite(EXAMINE, 'Creatine - Examine')] },
          { type: 'text', text: '. Tómala diario, con o sin entreno.' },
        ],
      },
    ];
    try {
      const body = await askCoach('¿Sirve la creatina?');
      // Los bloques seguidos ya traen sus espacios: se pegan tal cual. Solo lo que corta un bloque que no es texto
      // (la búsqueda) va en otro párrafo.
      expect(body.answer).toBe('Déjame revisar la evidencia.\n\nSí. La creatina monohidratada (3–5 g al día) mejora la fuerza y la masa muscular cuando entrenas. Tómala diario, con o sin entreno.');
      // Fuentes de las citas, sin repetir y en orden de aparición.
      expect(body.sources).toEqual([
        { title: 'Creatine - Examine', url: EXAMINE },
        { title: 'ISSN position stand: creatine - PubMed', url: PUBMED },
      ]);
    } finally {
      mode.script = null;
    }
  });

  it('una fuente sin título usa su dirección, y una respuesta sin citas no trae fuentes', async () => {
    calls.length = 0;
    mode.script = [
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Camina 8,000 pasos', citations: [cite(PUBMED, null)] }, { type: 'text', text: ' al día.' }] },
    ];
    try {
      const body = await askCoach('¿Cuántos pasos?');
      expect(body.answer).toBe('Camina 8,000 pasos al día.');
      expect(body.sources).toEqual([{ title: PUBMED, url: PUBMED }]);
    } finally {
      mode.script = null;
    }
    calls.length = 0;
    mode.script = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hoy descansa.' }] }];
    try {
      const body = await askCoach('¿Qué hago hoy?');
      expect(body.answer).toBe('Hoy descansa.');
      expect(body.sources).toBeUndefined();
    } finally {
      mode.script = null;
    }
  });

  it('no pierde el texto escrito antes de que la búsqueda pausara el turno', async () => {
    calls.length = 0;
    mode.script = [
      {
        stop_reason: 'pause_turn',
        content: [
          { type: 'text', text: 'Hoy toca cuerpo completo A:\n• Sentadilla goblet: 2×12 @ 16 kg' },
          { type: 'server_tool_use', id: 'srvtoolu_2', name: 'web_search', input: { query: 'creatina dosis' } },
        ],
      },
      // La continuación solo trae lo nuevo: el resultado de la búsqueda y el resto de la respuesta.
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', content: [] },
          { type: 'text', text: 'Sobre la creatina: ' },
          { type: 'text', text: '3–5 g al día', citations: [cite(EXAMINE, 'Creatine - Examine')] },
          { type: 'text', text: '.' },
        ],
      },
    ];
    try {
      const body = await askCoach('¿Qué hago hoy y sirve la creatina?');
      expect(body.answer).toBe('Hoy toca cuerpo completo A:\n• Sentadilla goblet: 2×12 @ 16 kg\n\nSobre la creatina: 3–5 g al día.');
      expect(body.sources).toEqual([{ title: 'Creatine - Examine', url: EXAMINE }]);
      expect(calls).toHaveLength(2);
    } finally {
      mode.script = null;
    }
  });

  it('el texto previo a una herramienta propia no se junta con la respuesta final (aunque viniera de un tramo pausado)', async () => {
    calls.length = 0;
    mode.script = [
      { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Busco la evidencia…' }, { type: 'server_tool_use', id: 'srvtoolu_3', name: 'web_search', input: { query: 'proteína' } }] },
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_3', content: [] },
          { type: 'text', text: 'Reviso tu plan.' },
          { type: 'tool_use', id: 'tu_p', name: 'ver_plan_entrenador', input: {} },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Come 1.6 g/kg de proteína al día.' }] },
    ];
    try {
      const body = await askCoach('¿Cuánta proteína?');
      expect(body.answer).toBe('Come 1.6 g/kg de proteína al día.');
    } finally {
      mode.script = null;
    }
  });

  it('si se acaban las rondas con el turno pausado y sin texto, lo dice en vez de "Sin respuesta."', async () => {
    calls.length = 0;
    const toolRound = (i: number) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu_r${i}`, name: 'herramienta_inexistente', input: {} }] });
    mode.script = [
      ...Array.from({ length: 8 }, (_, i) => toolRound(i)),
      { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 'srvtoolu_5', name: 'web_search', input: { query: 'x' } }] },
    ];
    try {
      const body = await askCoach('Investiga todo');
      expect(calls).toHaveLength(9);
      expect(body.answer).toContain('a medias');
    } finally {
      mode.script = null;
    }
  });

  it('si se acaban las rondas con texto (preámbulo), también avisa que quedó a medias', async () => {
    calls.length = 0;
    const toolRound = (i: number) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu_p${i}`, name: 'herramienta_inexistente', input: {} }] });
    mode.script = [
      ...Array.from({ length: 8 }, (_, i) => toolRound(i)),
      { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Déjame revisar la evidencia sobre la creatina.' }, { type: 'server_tool_use', id: 'srvtoolu_6', name: 'web_search', input: { query: 'creatina' } }] },
    ];
    try {
      const body = await askCoach('¿Sirve la creatina?');
      expect(body.answer).toContain('Déjame revisar la evidencia sobre la creatina.');
      expect(body.answer).toContain('a medias');
    } finally {
      mode.script = null;
    }
    // Lo mismo si la última ronda pide herramientas que ya no corren: no se presenta el preámbulo como respuesta completa.
    calls.length = 0;
    mode.script = [
      ...Array.from({ length: 8 }, (_, i) => toolRound(i + 10)),
      { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Ahora registro tu comida.' }, { type: 'tool_use', id: 'tu_last', name: 'herramienta_inexistente', input: {} }] },
    ];
    try {
      const body = await askCoach('Registra todo');
      expect(body.answer).toContain('a medias');
    } finally {
      mode.script = null;
    }
  });

  it('reenvía el contenedor de la respuesta en cada continuación (pausa y ronda de herramientas)', async () => {
    calls.length = 0;
    const box = (id: string) => ({ id, expires_at: '2026-11-21T20:00:00Z', skills: null });
    mode.script = [
      { stop_reason: 'pause_turn', container: box('container_abc'), content: [{ type: 'server_tool_use', id: 'srvtoolu_4', name: 'web_search', input: { query: 'sentadilla técnica' } }] },
      { stop_reason: 'tool_use', container: box('container_abc'), content: [{ type: 'tool_use', id: 'tu_c', name: 'ver_plan_entrenador', input: {} }] },
      // Una respuesta sin contenedor no borra el que ya se tenía.
      { stop_reason: 'tool_use', container: null, content: [{ type: 'tool_use', id: 'tu_d', name: 'ver_plan_entrenador', input: {} }] },
      { stop_reason: 'end_turn', container: box('container_xyz'), content: [{ type: 'text', text: 'Listo.' }] },
    ];
    try {
      await askCoach('Explícame la sentadilla');
      expect(calls).toHaveLength(4);
      expect(calls[0].container).toBeUndefined();
      expect(calls[1].container).toBe('container_abc');
      expect(calls[2].container).toBe('container_abc');
      expect(calls[3].container).toBe('container_abc');
    } finally {
      mode.script = null;
    }
  });

  it('el tope de búsquedas vale por mensaje (búsqueda directa) y el historial entre rondas va con caché', async () => {
    calls.length = 0;
    mode.script = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_e', name: 'ver_plan_entrenador', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Listo.' }] },
    ];
    try {
      await askCoach('Arma mi plan y explícame la evidencia');
      // Con `allowed_callers: ['direct']` las búsquedas de rondas anteriores del mismo turno cuentan contra
      // max_uses; con el valor por defecto (desde code execution) cada ronda traería 3 búsquedas nuevas.
      for (const call of calls) {
        expect(call.tools.find((t: { name: string }) => t.name === 'web_search')).toMatchObject({ type: 'web_search_20260209', max_uses: 3, allowed_callers: ['direct'] });
        // Caché automática: el punto de caché avanza con el historial y cada ronda lee las anteriores.
        expect(call.cache_control).toEqual({ type: 'ephemeral' });
        expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
      }
      // Las herramientas no cambian entre rondas (cambiarlas rompería la caché y la reanudación).
      expect(JSON.stringify(calls[1].tools)).toBe(JSON.stringify(calls[0].tools));
    } finally {
      mode.script = null;
    }
  });

  it('fuera del modo entrenador no hay búsqueda web', async () => {
    calls.length = 0;
    mode.script = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hola.' }] }];
    const app = (await import('../src/index')).default;
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test' } as any;
    await app.request('/api/gm/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Hola', history: [] }) }, env);
    expect(calls[0].tools.some((t: { name: string }) => t.name === 'web_search')).toBe(false);
    mode.script = null;
  });
});
