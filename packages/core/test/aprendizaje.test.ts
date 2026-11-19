import { describe, expect, it } from 'vitest';
import {
  ENGLISH_STARTER_PACK,
  addDays,
  buildSnapshot,
  computeLearning,
  englishStarterItems,
  GAME_CONFIG,
  learningErrorKey,
  learningSimilarity,
  learningStudyStreak,
  learningWordDiff,
  leitnerBox,
  memoryAssistantStore,
  normalizeLearningText,
  parseLearningLine,
  project,
  renderOverview,
  runAssistantTool,
  validateEvent,
  type Entity,
  type GameEvent,
  type LearningItemData,
  type LearningTopicData,
} from '../src';
import { bySource, cfgWith, ev, run, seed } from './helpers';

const T0 = '2026-11-02';
const topic = (id = 'lt-en', extra: Partial<LearningTopicData> = {}): Entity<LearningTopicData> => ({
  id,
  module: 'learning',
  kind: 'topic',
  sort: 0,
  data: { name: id === 'lt-en' ? 'Inglés' : `Tema ${id}`, topicKind: 'idioma', level: 'B1', goal: 'Negociar en inglés', lang: 'en-US', ...extra },
});
const item = (id: string, text = `Phrase ${id}`, topicId = 'lt-en'): Entity<LearningItemData> => ({
  id,
  module: 'learning',
  kind: 'item',
  sort: 0,
  data: { topicId, itemType: 'frase', text, meaning: `Significado ${id}`, tags: ['negocios'] },
});
const review = (date: string, itemId: string, result: 'bien' | 'dude' | 'mal') => ev('learning.reviewed', date, { itemId, result });
const test = (date: string, extra: Record<string, unknown> = {}) => ev('learning.test_taken', date, { topicId: 'lt-en', source: 'ia', score: 5, total: 8, errors: [], ...extra });
const err = (correction: string, tag = 'preposiciones', answer = 'depend of') => ({ tag, prompt: 'Traduce: depender de', answer, correction });

const ents = (...extra: Entity[]) => [...seed, topic(), ...extra];
const lstate = (events: GameEvent[], today: string, entities: Entity[] = ents(item('i1')), config = GAME_CONFIG as any) =>
  project({ events, entities, today, config }).learning;

describe('aprendizaje: tarjetas (Leitner)', () => {
  it('sube de caja solo cuando toca repasar; a la caja 4 ya es "Lo sé"', () => {
    const evs = [review(T0, 'i1', 'bien')];
    let s = lstate(evs, T0);
    expect(s.cards.i1).toMatchObject({ box: 1, status: 'aprendiendo', due: addDays(T0, 1) });

    // Repasar otra vez el mismo día no acelera.
    evs.push(review(T0, 'i1', 'bien'));
    s = lstate(evs, T0);
    expect(s.cards.i1).toMatchObject({ box: 1, due: addDays(T0, 1), reviews: 2 });

    evs.push(review(addDays(T0, 1), 'i1', 'bien')); // caja 2, siguiente en 2 días
    evs.push(review(addDays(T0, 3), 'i1', 'bien')); // caja 3, siguiente en 4 días
    s = lstate(evs, addDays(T0, 6));
    expect(s.cards.i1).toMatchObject({ box: 3, status: 'aprendiendo', due: addDays(T0, 7) });
    expect(s.topics['lt-en'].due).toEqual([]);
    s = lstate(evs, addDays(T0, 7));
    expect(s.topics['lt-en'].due).toEqual(['i1']);

    evs.push(review(addDays(T0, 7), 'i1', 'bien'));
    s = lstate(evs, addDays(T0, 7));
    expect(s.cards.i1).toMatchObject({ box: 4, status: 'lo_se' });
    expect(s.topics['lt-en'].known).toEqual(['i1']);
    expect(s.mastered).toBe(1);

    // "Dudé" la saca de "Lo sé" (sin regresarla al inicio); "mal" la regresa a la caja 1.
    evs.push(review(addDays(T0, 20), 'i1', 'dude'));
    s = lstate(evs, addDays(T0, 20));
    expect(s.cards.i1).toMatchObject({ box: 3, status: 'aprendiendo' });
    evs.push(review(addDays(T0, 21), 'i1', 'mal'));
    s = lstate(evs, addDays(T0, 21));
    expect(s.cards.i1).toMatchObject({ box: 1, lapses: 1, due: addDays(T0, 22) });
    // El máximo histórico de "Lo sé" no baja.
    expect(s.mastered).toBe(0);
    expect(s.masteredEver).toBe(1);
  });

  it('leitnerBox: reglas de un paso', () => {
    const cfg = GAME_CONFIG as any;
    expect(leitnerBox(0, 'mal', true, cfg)).toBe(1);
    expect(leitnerBox(0, 'dude', true, cfg)).toBe(1);
    expect(leitnerBox(0, 'bien', false, cfg)).toBe(1);
    expect(leitnerBox(5, 'bien', true, cfg)).toBe(5);
    expect(leitnerBox(5, 'dude', true, cfg)).toBe(3);
    expect(leitnerBox(2, 'bien', false, cfg)).toBe(2);
  });

  it('"Te cuesta": varias "mal" recientes; las listas por estado no se enciman', () => {
    const entities = ents(item('i1'), item('i2'), item('i3'), item('i4'));
    const evs = [review(T0, 'i1', 'mal'), review(addDays(T0, 1), 'i1', 'mal'), review(T0, 'i2', 'bien'), review(T0, 'i3', 'mal')];
    const s = lstate(evs, addDays(T0, 1), entities);
    const t = s.topics['lt-en'];
    expect(t.struggling).toEqual(['i1']);
    expect(t.learning.sort()).toEqual(['i2', 'i3']);
    expect(t.fresh).toEqual(['i4']);
    expect(t.counts).toEqual({ total: 4, nuevo: 1, aprendiendo: 2, teCuesta: 1, loSe: 0 });
    // Nuevas empezadas por día (límite de nuevas por día).
    expect(t.newToday).toBe(0);
    expect(lstate(evs, T0, entities).topics['lt-en'].newToday).toBe(3);
    // Las nuevas no están "por repasar"; las vencidas sí (la más urgente primero).
    expect(t.due).toEqual(['i2', 'i3']);
  });

  it('racha de días de estudio: hoy nunca la rompe', () => {
    expect(learningStudyStreak(['2026-11-01', '2026-11-02', '2026-11-03'], '2026-11-04')).toEqual({ current: 3, best: 3 });
    expect(learningStudyStreak(['2026-11-01', '2026-11-02'], '2026-11-04')).toEqual({ current: 0, best: 2 });
    expect(learningStudyStreak(['2026-11-01', '2026-11-03', '2026-11-04'], '2026-11-04')).toEqual({ current: 2, best: 2 });
    const s = lstate([review(T0, 'i1', 'bien'), test(addDays(T0, 1))], addDays(T0, 1));
    expect(s.topics['lt-en']).toMatchObject({ streak: 2, studiedToday: true, sessionToday: true });
  });
});

describe('aprendizaje: tests y errores que repites', () => {
  it('agrupa por etiqueta + corrección normalizada; un error repetido en el mismo test cuenta una vez', () => {
    const evs = [
      test('2026-11-01', { errors: [err('depend on'), err('Depend on!')] }),
      test('2026-11-03', { errors: [err('depend ON', 'Preposiciones', 'depends of')] }),
      test('2026-11-04', { errors: [err('I have been', 'tiempos verbales', 'I am')] }),
    ];
    const t = lstate(evs, '2026-11-04').topics['lt-en'];
    const dep = t.errors.find((e) => e.key === learningErrorKey('preposiciones', 'depend on'))!;
    expect(dep).toMatchObject({ count: 2, repeated: true, improving: false, firstSeen: '2026-11-01', lastSeen: '2026-11-03', testsSince: 1, answer: 'depends of' });
    expect(t.errors[0].key).toBe(dep.key); // los que repites van primero
    expect(t.errors.find((e) => e.correction === 'I have been')?.repeated).toBe(false);
    expect(t.tests.map((x) => x.pct)).toEqual([63, 63, 63]);
  });

  it('va "mejorando" si no aparece en los siguientes 2 tests del mismo tipo (las tarjetas y la voz no cuentan)', () => {
    const evs = [test('2026-11-01', { errors: [err('depend on')] }), test('2026-11-02', { errors: [err('depend on')] })];
    evs.push(test('2026-11-03', { source: 'tarjetas' }), test('2026-11-03', { source: 'voz' }), test('2026-11-04'));
    let e = lstate(evs, '2026-11-05').topics['lt-en'].errors[0];
    expect(e).toMatchObject({ testsSince: 1, improving: false });
    evs.push(test('2026-11-05', { score: 8, total: 8 }));
    const t = lstate(evs, '2026-11-05').topics['lt-en'];
    e = t.errors[0];
    expect(e).toMatchObject({ testsSince: 2, improving: true, repeated: true });
    expect(t.bestPct).toBe(100);
    expect(t.lastTest?.pct).toBe(100);
  });

  it('guarda el nivel estimado del último test que lo trae', () => {
    const t = lstate([test('2026-11-01', { level: 'B1' }), test('2026-11-02', { level: 'B2' }), test('2026-11-03')], '2026-11-03').topics['lt-en'];
    expect(t.estimatedLevel).toBe('B2');
  });

  it('valida el evento: aciertos ≤ total y tamaños acotados', () => {
    const base = { id: 'abcdefgh-1', type: 'learning.test_taken', occurredAt: '2026-11-19T18:00:00.000Z', localDate: '2026-11-19' };
    expect(validateEvent({ ...base, payload: { topicId: 'lt-en', source: 'ia', score: 9, total: 8 } }).ok).toBe(false);
    expect(validateEvent({ ...base, payload: { topicId: 'lt-en', source: 'otro', score: 1, total: 8 } }).ok).toBe(false);
    expect(validateEvent({ ...base, payload: { topicId: 'lt-en', source: 'ia', score: 1, total: 8, errors: Array.from({ length: 51 }, () => err('x')) } }).ok).toBe(false);
    const okEv = validateEvent({ ...base, payload: { topicId: 'lt-en', source: 'voz', score: 3, total: 4 } });
    expect(okEv.ok && (okEv.event.payload as { errors: unknown[] }).errors).toEqual([]);
    expect(validateEvent({ ...base, type: 'learning.reviewed', payload: { itemId: 'i1', result: 'regular' } }).ok).toBe(false);
  });
});

describe('aprendizaje: XP (reglas de oro)', () => {
  const XP = GAME_CONFIG.missionXp[GAME_CONFIG.learning.sessionSize];

  it('un test o sesión da XP una vez por día y tema; los repasos solos no dan XP', () => {
    const entities = ents(topic('lt-fin', { topicKind: 'materia', attribute: 'finanzas' }), item('i1'));
    const evs = [review(T0, 'i1', 'bien'), test(T0), test(T0, { source: 'voz' }), test(T0, { topicId: 'lt-fin' }), test(addDays(T0, 1), { source: 'tarjetas' })];
    const s = run(evs, addDays(T0, 1), { entities });
    expect(bySource(s, 'learning')).toBe(3 * XP);
    const ledger = s.xp.ledger.filter((e) => e.source === 'learning');
    expect(ledger.find((e) => e.refId === 'lt-fin')?.attribute).toBe('finanzas');
    expect(ledger.find((e) => e.refId === 'lt-en')?.attribute).toBe(GAME_CONFIG.learning.attribute);
    expect(run([review(T0, 'i1', 'bien')], T0, { entities }).xp.total).toBe(0);
  });

  it('hitos de "Lo sé": por el máximo alcanzado, una vez cada uno, aunque después baje', () => {
    const config = cfgWith((c) => {
      c.learning.masteryMilestones = [2, 3];
    });
    const entities = ents(item('a'), item('b'), item('c'));
    const evs: GameEvent[] = [];
    // Llevar "a" y "b" a "Lo sé" (días 0, 1, 3, 7).
    for (const d of [0, 1, 3, 7]) evs.push(review(addDays(T0, d), 'a', 'bien'), review(addDays(T0, d), 'b', 'bien'));
    let s = run(evs, addDays(T0, 7), { entities, config });
    expect(s.learning.milestones).toEqual([
      { count: 2, date: addDays(T0, 7) },
      { count: 3, date: null },
    ]);
    expect(bySource(s, 'learning')).toBe(GAME_CONFIG.learning.masteryXp);
    const before = s.xp.total;
    // Olvida una y la vuelve a dominar: el hito no se paga dos veces y la XP nunca baja.
    evs.push(review(addDays(T0, 10), 'a', 'mal'));
    s = run(evs, addDays(T0, 10), { entities, config });
    expect(s.learning.mastered).toBe(1);
    expect(s.xp.total).toBe(before);
    for (const d of [10, 11, 13, 17]) evs.push(review(addDays(T0, d), 'a', 'bien'));
    s = run(evs, addDays(T0, 17), { entities, config });
    expect(s.xp.total).toBe(before);
    expect(s.learning.nextMilestone).toBe(3);
    // Un "mal" con fecha anterior (p. ej. de otro dispositivo sin conexión) tampoco deshace el hito.
    evs.push(review(addDays(T0, 2), 'b', 'mal'));
    s = run(evs, addDays(T0, 17), { entities, config });
    expect(s.xp.total).toBe(before);
    expect(s.learning.masteredEver).toBe(2);
  });

  it('borrar una frase no quita la XP del hito ya alcanzado', () => {
    const config = cfgWith((c) => {
      c.learning.masteryMilestones = [1];
    });
    const evs = [0, 1, 3, 7].map((d) => review(addDays(T0, d), 'a', 'bien'));
    const withItem = run(evs, addDays(T0, 8), { entities: ents(item('a')), config });
    const deleted = run(evs, addDays(T0, 8), { entities: ents({ ...item('a'), deletedAt: 1 }), config });
    expect(withItem.xp.total).toBe(GAME_CONFIG.learning.masteryXp);
    expect(deleted.xp.total).toBe(withItem.xp.total);
    expect(deleted.learning.mastered).toBe(0);
  });

  it('propiedad: agregar cualquier evento de aprendizaje nunca baja la XP ni los atributos', () => {
    const rng = (seedN: number) => () => ((seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const config = cfgWith((c) => {
      c.learning.masteryMilestones = [1, 2, 3, 4];
    });
    const entities = ents(topic('lt-2'), item('a'), item('b'), item('c', 'Phrase c', 'lt-2'), item('d'));
    const results = ['bien', 'dude', 'mal'] as const;
    for (let seedN = 1; seedN <= 12; seedN++) {
      const r = rng(seedN);
      const evs: GameEvent[] = [];
      let prev = run([], '2027-02-28', { entities, config });
      for (let i = 0; i < 70; i++) {
        const date = addDays(T0, Math.floor(r() * 90));
        const k = r();
        if (k < 0.7) evs.push(review(date, ['a', 'b', 'c', 'd', 'zz'][Math.floor(r() * 5)], results[Math.floor(r() * 3)]));
        else {
          const total = 1 + Math.floor(r() * 10);
          evs.push(test(date, { topicId: r() < 0.5 ? 'lt-en' : 'lt-2', source: ['ia', 'tarjetas', 'voz'][Math.floor(r() * 3)], total, score: Math.floor(r() * (total + 1)), errors: r() < 0.5 ? [err('depend on')] : [] }));
        }
        const s = run(evs, '2027-02-28', { entities, config });
        expect(s.xp.total).toBeGreaterThanOrEqual(prev.xp.total);
        for (const a of Object.keys(s.attributes.values) as (keyof typeof s.attributes.values)[]) expect(s.attributes.values[a].value).toBeGreaterThanOrEqual(prev.attributes.values[a].value);
        expect(s.learning.masteredEver).toBeGreaterThanOrEqual(prev.learning.masteredEver);
        expect(s.xp.ledger.every((e) => e.amount > 0)).toBe(true);
        prev = s;
      }
    }
  });
});

describe('aprendizaje: texto y voz', () => {
  it('normaliza acentos, puntuación y contracciones', () => {
    expect(normalizeLearningText("  I'll get BACK to you! ")).toBe('i will get back to you');
    expect(normalizeLearningText('We won’t / can’t')).toBe('we will not can not');
    expect(normalizeLearningText('Qué tal, ¿cómo estás?')).toBe('que tal como estas');
    expect(learningErrorKey('Preposiciones', 'Depend on.')).toBe(learningErrorKey(' preposiciones ', 'depend on'));
  });

  it('similitud: igual = 1, casi = intermedio, distinto = bajo', () => {
    const exp = 'Let me get back to you on that.';
    expect(learningSimilarity(exp, 'let me get back to you on that')).toBe(1);
    const close = learningSimilarity(exp, 'let me get back to you in that');
    expect(close).toBeGreaterThanOrEqual(GAME_CONFIG.learning.voiceClose);
    expect(close).toBeLessThan(1);
    expect(learningSimilarity(exp, 'what is your best offer')).toBeLessThan(GAME_CONFIG.learning.voiceClose);
    expect(learningSimilarity(exp, '')).toBe(0);
  });

  it('diff palabra por palabra', () => {
    const d = learningWordDiff('Is there any flexibility on the price?', 'is there flexibility in the price');
    expect(d.filter((x) => x.op === 'missing').map((x) => x.word)).toEqual(['any', 'on']);
    expect(d.filter((x) => x.op === 'extra').map((x) => x.word)).toEqual(['in']);
    expect(d.filter((x) => x.op === 'ok').length).toBe(5);
  });

  it('registro rápido en una línea', () => {
    expect(parseLearningLine("Let's circle back = Retomemos esto")).toEqual({ text: "Let's circle back", meaning: 'Retomemos esto' });
    expect(parseLearningLine('follow-up | seguimiento')).toEqual({ text: 'follow-up', meaning: 'seguimiento' });
    expect(parseLearningLine('to sum up - en resumen')).toEqual({ text: 'to sum up', meaning: 'en resumen' });
    expect(parseLearningLine('follow-up call')).toEqual({ text: 'follow-up call', meaning: '' });
  });

  it('paquete inicial de inglés: ~30 frases, ids fijos y sin duplicar', () => {
    expect(ENGLISH_STARTER_PACK.length).toBeGreaterThanOrEqual(30);
    const first = englishStarterItems('lt-en');
    expect(first).toHaveLength(ENGLISH_STARTER_PACK.length);
    expect(new Set(first.map((e) => e.id)).size).toBe(first.length);
    expect(first.every((e) => e.module === 'learning' && e.kind === 'item' && e.data.meaning && e.data.tags.length)).toBe(true);
    expect(englishStarterItems('lt-en', first)).toHaveLength(0);
    // Si ya tenía una de esas frases (escrita a mano), no se repite.
    const mine = item('mine', "what's your best offer");
    expect(englishStarterItems('lt-en', [mine])).toHaveLength(ENGLISH_STARTER_PACK.length - 1);
  });

  it('computeLearning ignora eventos del futuro', () => {
    const s = computeLearning({ events: [review('2026-12-01', 'i1', 'bien')], topics: [topic()], items: [item('i1')], today: '2026-11-19', cfg: GAME_CONFIG as any });
    expect(s.cards.i1).toBeUndefined();
  });
});

describe('aprendizaje: herramientas de IA', () => {
  const TODAY = '2026-11-19';
  const call = (store: ReturnType<typeof memoryAssistantStore>, name: string, input: unknown = {}, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });
  const mk = (events: GameEvent[] = [], entities: Entity[] = seed) => memoryAssistantStore({ events, entities, today: TODAY });

  it('guardar_tema crea un idioma con nivel CEFR, no duplica y valida el nivel', async () => {
    const store = mk();
    const r = await call(store, 'guardar_tema', { nombre: 'Inglés', nivel: 'b1', meta: 'Negociar y presentar' });
    expect(r.isError).toBeFalsy();
    expect(r.refs?.entities).toHaveLength(1);
    const t = store.allEntities().find((e) => e.module === 'learning')!;
    expect(t.data).toMatchObject({ name: 'Inglés', topicKind: 'idioma', level: 'B1', lang: 'en-US' });
    expect((await call(store, 'guardar_tema', { nombre: 'inglés' })).isError).toBe(true);
    expect((await call(store, 'guardar_tema', { id: t.id, nivel: 'Z9' })).isError).toBe(true);
    const ed = await call(store, 'guardar_tema', { id: t.id, nivel: 'B2' });
    expect(ed.refs?.entities[0].prev?.data.level).toBe('B1');
  });

  it('agregar_frase agrega al tema por defecto (Inglés) sin duplicar', async () => {
    const store = mk([], ents(topic('lt-fin', { name: 'Finanzas', topicKind: 'materia' }), item('i1', 'Let me get back to you')));
    const r = await call(store, 'agregar_frase', {
      frases: [
        { texto: "Let me get back to you!", significado: 'Te confirmo' },
        { texto: 'We could meet you halfway', significado: 'Punto medio', etiquetas: ['Negociación'] },
        { texto: 'we could meet you halfway.', significado: 'dup en el mismo lote' },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(r.refs?.entities).toHaveLength(1);
    const added = store.allEntities().filter((e) => e.module === 'learning' && e.kind === 'item' && e.id !== 'i1');
    expect(added).toHaveLength(1);
    expect(added[0].data).toMatchObject({ topicId: 'lt-en', tags: ['negociación'], origin: 'ia', itemType: 'frase' });
    expect(r.text).toContain('Ya estaban');
    const none = await call(store, 'agregar_frase', { frases: [{ texto: 'let me get back to you', significado: 'x' }] });
    expect(none.refs).toBeUndefined();
    expect(none.text).toContain('No agregué');
  });

  it('agregar_frase pide el tema si hay varios y ninguno es Inglés', async () => {
    const store = mk([], [...seed, topic('lt-a', { name: 'Francés' }), topic('lt-b', { name: 'Finanzas' })]);
    const r = await call(store, 'agregar_frase', { frases: [{ texto: 'Bonjour', significado: 'Hola' }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('tema_id');
  });

  it('registrar_test guarda el resultado, da XP una vez por día y avisa de errores repetidos', async () => {
    const store = mk([test('2026-11-10', { errors: [err('depend on')] })], ents());
    const r = await call(store, 'registrar_test', {
      aciertos: 6,
      total: 8,
      nivel: 'b1',
      errores: [{ etiqueta: 'Preposiciones', pregunta: 'Traduce: depender de', respuesta: 'depend of', correccion: 'Depend on' }],
    });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('75%');
    expect(r.text).toContain(`+${GAME_CONFIG.missionXp.chica} XP`);
    expect(r.text).toContain('ahora 2 veces');
    const ev = store.allEvents().find((e) => e.type === 'learning.test_taken' && e.localDate === TODAY)!;
    expect(ev.payload).toMatchObject({ topicId: 'lt-en', source: 'ia', score: 6, total: 8, level: 'B1' });
    const again = await call(store, 'registrar_test', { aciertos: 8, total: 8 });
    expect(again.text).toContain('ya contaba');
    expect((await call(store, 'registrar_test', { aciertos: 9, total: 8 })).isError).toBe(true);
    expect((await call(store, 'registrar_test', { aciertos: 1, total: 2, fecha: '2026-11-20' })).isError).toBe(true);
    const s = project({ events: store.allEvents(), entities: store.allEntities(), today: TODAY });
    expect(s.learning.topics['lt-en'].errors[0]).toMatchObject({ count: 2, repeated: true });
  });

  it('ver_aprendizaje, la foto y el panorama muestran lo que sabe, lo que le cuesta y los errores que repite', async () => {
    const entities = ents(item('k', 'I have been working here'), item('s', 'Depend on'));
    const evs = [...[0, 1, 3, 7].map((d) => review(addDays('2026-11-01', d), 'k', 'bien')), review('2026-11-17', 's', 'mal'), review('2026-11-18', 's', 'mal')];
    evs.push(test('2026-11-15', { errors: [err('depend on')] }), test('2026-11-18', { errors: [err('depend on')], level: 'B1' }));
    const store = mk(evs, entities);
    const r = await call(store, 'ver_aprendizaje', { ver_frases: true }, false);
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Inglés');
    expect(r.text).toContain('Errores que repite');
    expect(r.text).toContain('"depend on"');
    expect(r.text).toContain('Lo que ya sabe decir: "I have been working here"');
    expect(r.text).toContain('Le cuestan: "Depend on"');

    const state = project({ events: evs, entities, today: TODAY });
    const snap = buildSnapshot(state, entities, { version: 0, computedBy: 'app' });
    const t = snap.aprendizaje!.topics[0];
    expect(t).toMatchObject({ id: 'lt-en', known: 1, struggling: 1, estimatedLevel: 'B1', struggles: ['Depend on'] });
    expect(t.errors[0]).toMatchObject({ correction: 'depend on', count: 2 });
    const text = renderOverview(snap);
    expect(text).toContain('## Aprendizaje');
    expect(text).toContain('Errores que repite');

    // Una foto vieja sin aprendizaje no rompe el panorama.
    const old = { ...snap, aprendizaje: undefined };
    expect(renderOverview(old)).not.toContain('## Aprendizaje');
  });

  it('en solo lectura no se puede escribir', async () => {
    const store = mk([], ents());
    expect((await call(store, 'agregar_frase', { frases: [{ texto: 'Hi', significado: 'Hola' }] }, false)).isError).toBe(true);
    expect((await call(store, 'registrar_test', { aciertos: 1, total: 1 }, false)).isError).toBe(true);
    expect(store.allEvents()).toHaveLength(0);
  });
});
