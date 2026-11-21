import { describe, expect, it, vi } from 'vitest';
import { fakeD1 } from './fake-d1';

// API de Claude simulada: responde lo que diga `next` y guarda cada solicitud.
const calls: any[] = [];
const next = { text: '{}', stop: 'end_turn' as string };
vi.mock('@anthropic-ai/sdk', async (orig) => {
  const actual = await orig<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic extends actual.default {
    constructor(opts: any) {
      super(opts);
      (this as any).beta = {
        messages: {
          create: async (req: any) => {
            calls.push(req);
            return { stop_reason: next.stop, content: [{ type: 'text', text: next.text }] };
          },
        },
      };
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const PDF = Buffer.from('%PDF-1.4\n% estudio de prueba\n').toString('base64');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64');

async function setup(key = true) {
  const app = (await import('../src/index')).default;
  const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true', ...(key ? { ANTHROPIC_API_KEY: 'sk-test' } : {}) } as any;
  const req = (path: string, init: RequestInit = {}) => app.request(`/api/medico${path}`, init, env);
  const json = (path: string, body: unknown) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const upload = (b64: string, mime: string, name = 'estudio.pdf') => req(`/files?name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime)}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: b64 });
  return { app, env, req, json, upload };
}

describe('Archivos de salud', () => {
  it('sube, baja y borra un PDF; el estado cuenta archivos y bytes', async () => {
    const { req, upload } = await setup();
    const res = await upload(PDF, 'application/pdf', 'Química sanguínea.pdf');
    expect(res.status).toBe(200);
    const f = (await res.json()) as { id: string; name: string; mime: string; size: number };
    expect(f).toMatchObject({ name: 'Química sanguínea.pdf', mime: 'application/pdf', size: Buffer.from(PDF, 'base64').length });
    const got = (await (await req(`/files/${f.id}`)).json()) as { data: string; mime: string };
    expect(got.data).toBe(PDF);
    const st = (await (await req('/status')).json()) as { enabled: boolean; files: number; bytes: number };
    expect(st).toMatchObject({ enabled: true, files: 1, bytes: f.size });
    expect((await req(`/files/${f.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await req(`/files/${f.id}`)).status).toBe(404);
  });

  it('parte en trozos los archivos grandes y los vuelve a juntar igual', async () => {
    const { req, upload } = await setup();
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1_500_000, 7)]).toString('base64');
    const f = (await (await upload(big, 'application/pdf')).json()) as { id: string };
    const got = (await (await req(`/files/${f.id}`)).json()) as { data: string };
    expect(got.data.length).toBe(big.length);
    expect(got.data === big).toBe(true);
  });

  it('rechaza tipos no permitidos y contenido que no coincide con su tipo', async () => {
    const { upload } = await setup();
    expect((await upload(PDF, 'text/html')).status).toBe(400);
    expect((await upload(JPG, 'application/pdf')).status).toBe(400);
    expect((await upload('no es base64!!', 'image/jpeg')).status).toBe(400);
    expect((await upload(JPG, 'image/jpeg', 'foto.jpg')).status).toBe(200);
  });
});

describe('Tu médico IA', () => {
  it('lee un estudio: manda el PDF como documento y valida/recorta lo que responde', async () => {
    const { json, upload } = await setup();
    const f = (await (await upload(PDF, 'application/pdf')).json()) as { id: string };
    calls.length = 0;
    next.text = JSON.stringify({
      title: 'Química sanguínea',
      type: 'laboratorio',
      date: '2026-11-10',
      place: 'Laboratorio Centro',
      doctor: null,
      cost: 450,
      summary: 'Tus triglicéridos salieron altos; lo demás en rango.',
      findings: ['Triglicéridos 210 mg/dL (alto)'],
      values: [
        { name: 'Glucosa', kind: 'glucosa', value: 92, value2: null, text: null, unit: 'mg/dL', ref: '70-99', low: 70, high: 99, flag: null },
        { name: 'Triglicéridos', kind: 'inventado', value: 210, value2: null, text: null, unit: 'mg/dL', ref: '<150', low: null, high: 150, flag: 'alto' },
      ],
      recommendations: ['Repetir en 3 meses'],
      checkup: 'laboratorios',
    });
    const res = await json('/read', { fileIds: [f.id], today: '2026-11-21', profile: 'Hombre, 34 años' });
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    expect(out.values).toHaveLength(2);
    expect(out.values[1].kind).toBeNull(); // clave desconocida → null (no rompe la lectura)
    expect(out.checkup).toBe('laboratorios');
    const req0 = calls[0];
    expect(req0.messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF } });
    expect(req0.output_config.format.type).toBe('json_schema');
    expect(req0.fallbacks).toBe('default');
  });

  it('la revisión del médico usa el expediente y normaliza la respuesta', async () => {
    const { json } = await setup();
    calls.length = 0;
    next.text = JSON.stringify({
      title: 'Arranquemos con lo básico',
      message: 'Hola, soy tu médico IA.\n\nNecesito tus análisis.',
      status: 'raro',
      highlights: [{ tone: 'pendiente', text: 'Sin análisis de sangre' }],
      actions: [{ text: 'Hazte una química sanguínea', why: 'Para saber cómo vas', type: 'estudio', priority: 'alta', checkup: { name: 'Laboratorios', category: 'estudios', everyMonths: 999 }, metric: null }],
      missing: ['Antecedentes familiares'],
      nextReviewDays: 365,
    });
    const res = await json('/consult', { dossier: '# Expediente de salud de Iván · hoy 2026-11-21\n...', today: '2026-11-21', kind: 'inicial' });
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    expect(out.status).toBe('atencion');
    expect(out.actions[0].checkup.everyMonths).toBe(240);
    expect(out.nextReviewDays).toBe(90);
    expect(calls[0].messages[0].content[0].text).toContain('PRIMERA revisión');
    expect(calls[0].messages[0].content[0].text).toContain('Expediente de salud');
    expect(calls[0].output_config.effort).toBe('high');
  });

  it('una respuesta que no es JSON o se cortó da un error claro', async () => {
    const { json } = await setup();
    next.text = 'no es json';
    expect((await json('/consult', { dossier: 'x'.repeat(30), today: '2026-11-21' })).status).toBe(502);
    next.text = '{"title":';
    next.stop = 'max_tokens';
    expect((await json('/consult', { dossier: 'x'.repeat(30), today: '2026-11-21' })).status).toBe(502);
    next.stop = 'end_turn';
  });

  it('preguntar con un estudio adjunto manda la imagen junto a la pregunta', async () => {
    const { json, upload } = await setup();
    const f = (await (await upload(JPG, 'image/jpeg', 'receta.jpg')).json()) as { id: string };
    calls.length = 0;
    next.text = 'Esa receta es de un antibiótico. Tómalo como te indicó tu médico.';
    const res = await json('/ask', { dossier: 'x'.repeat(30), today: '2026-11-21', question: '¿Qué es esto?', fileIds: [f.id] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { answer: string }).answer).toContain('receta');
    const last = calls[0].messages.at(-1);
    expect(last.content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });
    expect(last.content[1]).toMatchObject({ type: 'text', text: '¿Qué es esto?' });
  });

  it('sin clave de la API responde 503; con un archivo que no existe, 404', async () => {
    const off = await setup(false);
    expect((await off.json('/consult', { dossier: 'x'.repeat(30), today: '2026-11-21' })).status).toBe(503);
    const on = await setup();
    expect((await on.json('/read', { fileIds: ['hf-nada'], today: '2026-11-21' })).status).toBe(404);
  });
});
