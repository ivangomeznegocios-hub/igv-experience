import { describe, expect, it, vi } from 'vitest';
import { validateEvent } from '@igv/core';

// API de Claude simulada: cada prueba programa la siguiente respuesta.
const calls: any[] = [];
const next: { reply: any; error?: unknown } = { reply: null };
vi.mock('@anthropic-ai/sdk', async (orig) => {
  const actual = await orig<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic extends actual.default {
    constructor(opts: any) {
      super(opts);
      (this as any).beta = {
        messages: {
          create: async (req: any) => {
            calls.push(structuredClone(req));
            if (next.error) throw next.error;
            return next.reply;
          },
        },
      };
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const json = (obj: unknown, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify(obj) }] });
const env = (extra: Record<string, unknown> = {}) => ({ DEV_BYPASS_AUTH: 'true', ANTHROPIC_API_KEY: 'sk-test', ...extra }) as any;
const post = async (path: string, body: unknown, e = env()) => {
  const app = (await import('../src/index')).default;
  return app.request(`/api/learn/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, e);
};
const topic = { name: 'Inglés', kind: 'idioma', level: 'B1', goal: 'Negociar en inglés' };

const QUIZ = {
  title: 'Negociación en inglés',
  questions: [
    { type: 'traducir', instruction: 'Traduce al inglés', prompt: 'Depende del precio.', options: ['x'], expected: 'It depends on the price.', tag: 'preposiciones' },
    { type: 'opcion', instruction: 'Elige la opción correcta', prompt: "Let's ___ back to this later.", options: ['circle', 'round', 'turn'], expected: 'circle', tag: 'phrasal verbs' },
    { type: 'completar', instruction: 'Completa', prompt: 'We could meet you ___.', options: null, expected: 'halfway', tag: 'negociación' },
  ],
};

describe('tests con IA (/api/learn)', () => {
  it('sin clave responde 503 con un mensaje en español', async () => {
    const res = await post('quiz', { topic }, env({ ANTHROPIC_API_KEY: undefined }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('ANTHROPIC_API_KEY');
    const g = await post('grade', { topic, questions: [] }, env({ ANTHROPIC_API_KEY: undefined }));
    expect(g.status).toBe(503);
  });

  it('está detrás de Access como el resto de la API', async () => {
    const app = (await import('../src/index')).default;
    const res = await app.request('/api/learn/status', {}, { ANTHROPIC_API_KEY: 'sk-test' } as any);
    expect(res.status).toBe(401);
    const ok = await app.request('/api/learn/status', {}, env());
    expect(await ok.json()).toEqual({ enabled: true });
  });

  it('quiz: manda nivel, errores y frases; pide salida estructurada con respaldo; numera y limpia las preguntas', async () => {
    calls.length = 0;
    next.reply = json(QUIZ);
    const res = await post('quiz', {
      topic,
      count: 3,
      focus: 'negociación',
      learning: ['We could meet you halfway'],
      known: ["Let's get started"],
      errors: [{ tag: 'preposiciones', answer: 'depend of', correction: 'depend on', count: 3 }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; questions: { id: string; type: string; options: string[] | null }[] };
    expect(body.title).toBe('Negociación en inglés');
    expect(body.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(body.questions[0].options).toBeNull(); // solo "opcion" lleva opciones
    expect(body.questions[1].options).toEqual(['circle', 'round', 'turn']);

    const req = calls[0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.output_config.effort).toBe('low');
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    const content = req.messages[0].content as string;
    expect(content).toContain('nivel B1');
    expect(content).toContain('"depend of" → "depend on" (3 veces)');
    expect(content).toContain('We could meet you halfway');
    expect(content).toContain('Enfoque elegido: negociación');
  });

  it('quiz: respeta ANTHROPIC_MODEL, recorta al número pedido y valida la entrada', async () => {
    calls.length = 0;
    next.reply = json(QUIZ);
    const res = await post('quiz', { topic, count: 3 }, env({ ANTHROPIC_MODEL: 'claude-sonnet-5-5' }));
    expect(calls[0].model).toBe('claude-sonnet-5-5');
    expect(res.status).toBe(200);
    expect((await post('quiz', { topic, count: 50 })).status).toBe(400);
    expect((await post('quiz', { count: 5 })).status).toBe(400);
  });

  it('quiz: formato inesperado → 502; rechazo → 422; error de la API → 502/429 en español', async () => {
    next.reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'no es json' }] };
    expect((await post('quiz', { topic })).status).toBe(502);
    next.reply = json({ title: 'x', questions: [] });
    expect((await post('quiz', { topic })).status).toBe(502);
    next.reply = { stop_reason: 'refusal', content: [] };
    expect((await post('quiz', { topic })).status).toBe(422);
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    next.error = new Anthropic.RateLimitError(429, { type: 'error' }, 'rate', new Headers());
    const r = await post('quiz', { topic });
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: string }).error).toContain('Límite');
    next.error = new Anthropic.APIError(529, { type: 'error' }, 'overloaded', new Headers());
    expect((await post('quiz', { topic })).status).toBe(502);
    next.error = undefined;
  });

  it('grade: cuenta los aciertos en el servidor, arma los errores para el evento y filtra sugerencias repetidas', async () => {
    calls.length = 0;
    next.reply = json({
      results: [
        { id: 'q1', correct: false, corrected: 'It depends on the price.', wrong: 'depends of', fix: 'Depend on', tag: 'preposiciones', explanation: '"Depend" va con "on", no con "of".' },
        { id: 'q2', correct: true, corrected: null, wrong: null, fix: null, tag: null, explanation: null },
        // La IA dice que está bien pero la respuesta está en blanco: no cuenta.
        { id: 'q3', correct: true, corrected: null, wrong: null, fix: null, tag: null, explanation: null },
      ],
      estimatedLevel: 'B1',
      feedback: 'Vas bien con phrasal verbs; sigue fallando "depend on".',
      suggestions: [
        { text: 'It depends on the volume.', meaning: 'Depende del volumen.', example: null, tags: ['preposiciones'] },
        { text: 'We could meet you halfway', meaning: 'Ya la tiene', example: null, tags: [] },
        { text: 'it depends on the volume', meaning: 'Duplicada', example: null, tags: [] },
      ],
    });
    const questions = QUIZ.questions.map((q, i) => ({ id: `q${i + 1}`, ...q, options: q.type === 'opcion' ? q.options : null, answer: ['It depends of the price', 'circle', ''][i] }));
    const res = await post('grade', {
      topic,
      questions,
      knownErrors: [{ tag: 'preposiciones', correction: 'depend on' }],
      existing: ['We could meet you halfway.'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.score).toBe(1);
    expect(body.total).toBe(3);
    expect(body.estimatedLevel).toBe('B1');
    expect(body.results.map((r: { correct: boolean }) => r.correct)).toEqual([false, true, false]);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0]).toEqual({
      tag: 'preposiciones',
      prompt: 'Traduce al inglés: Depende del precio.',
      answer: 'depends of',
      correction: 'Depend on',
      explanation: '"Depend" va con "on", no con "of".',
    });
    expect(body.errors[1]).toMatchObject({ answer: '(en blanco)', correction: 'halfway', tag: 'otro' });
    expect(body.suggestions.map((s: { text: string }) => s.text)).toEqual(['It depends on the volume.']);

    // Lo que devuelve sirve tal cual para el evento learning.test_taken.
    const v = validateEvent({
      id: 'abcdefgh-9',
      type: 'learning.test_taken',
      occurredAt: '2026-11-19T18:00:00.000Z',
      localDate: '2026-11-19',
      payload: { topicId: 'lt-en', source: 'ia', score: body.score, total: body.total, level: body.estimatedLevel, errors: body.errors },
    });
    expect(v.ok).toBe(true);

    const content = calls[0].messages[0].content as string;
    expect(content).toContain('[q1] (traducir) Traduce al inglés: Depende del precio.');
    expect(content).toContain('Su respuesta: (en blanco)');
    expect(content).toContain('preposiciones → depend on');
    expect(calls[0].output_config.format.schema.required).toContain('suggestions');
  });

  it('grade: un campo largo o una sugerencia vacía del modelo se recortan o descartan, no tumban la calificación', async () => {
    next.reply = json({
      results: [{ id: 'q1', correct: false, corrected: 'x'.repeat(700), wrong: 'w'.repeat(400), fix: 'f'.repeat(400), tag: 'gramatica', explanation: 'e'.repeat(800) }],
      estimatedLevel: 'B1',
      feedback: 'b'.repeat(1500),
      suggestions: [
        { text: '', meaning: 'vacía', example: null, tags: [] },
        { text: 'It depends on the scope.', meaning: 'm'.repeat(400), example: null, tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
      ],
    });
    const res = await post('grade', { topic, questions: [{ id: 'q1', type: 'responder', instruction: 'Responde', prompt: 'Why?', answer: 'a'.repeat(580) }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.feedback).toHaveLength(1200);
    expect(body.results[0].corrected).toHaveLength(600);
    expect(body.results[0].fix).toHaveLength(300);
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0].meaning).toHaveLength(300);
    expect(body.suggestions[0].tags).toHaveLength(6);
  });

  it('grade: temas que no son idioma no llevan nivel CEFR y valida tamaños', async () => {
    next.reply = json({ results: [], estimatedLevel: 'C1', feedback: 'ok', suggestions: [] });
    const res = await post('grade', { topic: { name: 'Finanzas', kind: 'materia' }, questions: [{ id: 'q1', type: 'responder', instruction: 'Responde', prompt: '¿Qué es el EBITDA?', answer: 'Utilidad antes de…' }] });
    const body = (await res.json()) as any;
    expect(body.estimatedLevel).toBeNull();
    expect(body.score).toBe(0);
    expect(body.errors).toHaveLength(0); // sin calificación ni referencia: no hay corrección que guardar
    expect((await post('grade', { topic, questions: Array.from({ length: 13 }, (_, i) => ({ id: `q${i}`, type: 'traducir', instruction: 'x', prompt: 'y', answer: 'z' })) })).status).toBe(400);
  });
});
