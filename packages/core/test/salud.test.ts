import { describe, expect, it } from 'vitest';
import {
  GAME_CONFIG,
  HEALTH_PROFILE_ID,
  HEALTH_SUGGESTIONS,
  addDays,
  addMonthsClamped,
  buildSnapshot,
  checkupTiming,
  classifyHealthMetric,
  healthMetricKey,
  healthSuggestionsFor,
  memoryAssistantStore,
  project,
  renderOverview,
  runAssistantTool,
  suggestionCheckupId,
  validateEvent,
  type CheckupData,
  type Entity,
  type GameEvent,
} from '../src';
import { bySource, cfgWith, ev, run, seed } from './helpers';

const TODAY = '2026-11-19';
const MEDIA = GAME_CONFIG.missionXp.media;

function checkup(id: string, data: Partial<CheckupData> = {}): Entity<CheckupData> {
  return { id, module: 'health', kind: 'checkup', sort: 0, data: { name: id, category: 'dental', everyMonths: 6, active: true, ...data } };
}
const doneEv = (date: string, checkupId: string, extra: Record<string, unknown> = {}, env: Partial<GameEvent> = {}) =>
  ev('health.checkup_done', date, { checkupId, name: checkupId, ...extra }, env);

describe('salud: fechas y estados', () => {
  it('suma meses y recorta al último día del mes', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-05-19', 6)).toBe('2026-11-19');
    expect(addMonthsClamped('2026-11-19', 12)).toBe('2027-11-19');
    expect(addMonthsClamped('2026-12-15', 120)).toBe('2036-12-15');
  });

  it('al día / te toca pronto / atrasado / sin registro', () => {
    const soon = GAME_CONFIG.health.soonDays;
    expect(checkupTiming(null, 6, TODAY, soon).status).toBe('sin_registro');
    // Hace 6 meses exactos: toca hoy → pronto, 0 días.
    expect(checkupTiming('2026-05-19', 6, TODAY, soon)).toMatchObject({ status: 'pronto', daysLeft: 0, nextDue: TODAY });
    // Tocaba ayer → atrasado.
    expect(checkupTiming('2026-05-18', 6, TODAY, soon)).toMatchObject({ status: 'atrasado', daysLeft: -1 });
    // Toca en 30 días → pronto; en 31 → al día.
    expect(checkupTiming('2026-06-19', 6, TODAY, soon)).toMatchObject({ status: 'pronto', daysLeft: 30 });
    expect(checkupTiming('2026-06-20', 6, TODAY, soon)).toMatchObject({ status: 'al_dia', daysLeft: 31 });
    // De una sola vez y ya hecho: al día para siempre.
    expect(checkupTiming('2020-01-01', 0, TODAY, soon)).toMatchObject({ status: 'al_dia', nextDue: null });
  });

  it('un chequeo mensual recién hecho queda al día (la ventana de "pronto" es a lo más un tercio del intervalo)', () => {
    const soon = GAME_CONFIG.health.soonDays;
    expect(checkupTiming(TODAY, 1, TODAY, soon)).toMatchObject({ status: 'al_dia', daysLeft: 30 });
    expect(checkupTiming('2026-10-30', 1, TODAY, soon)).toMatchObject({ status: 'al_dia', daysLeft: 11 });
    expect(checkupTiming('2026-10-29', 1, TODAY, soon)).toMatchObject({ status: 'pronto', daysLeft: 10 });
    expect(checkupTiming('2026-10-19', 1, TODAY, soon)).toMatchObject({ status: 'pronto', daysLeft: 0 });
  });

  it('la fecha siguiente sale del último registro o de la fecha anotada a mano (la más nueva)', () => {
    const ents = [...seed, checkup('chk-a', { lastDone: '2026-02-01' }), checkup('chk-b', { lastDone: '2026-10-01' }), checkup('chk-c')];
    const s = run([doneEv('2026-03-10', 'chk-a'), doneEv('2026-03-10', 'chk-b')], TODAY, { entities: ents });
    expect(s.health.checkups['chk-a']).toMatchObject({ lastDone: '2026-03-10', nextDue: '2026-09-10', status: 'atrasado', daysLeft: -70 });
    expect(s.health.checkups['chk-b']).toMatchObject({ lastDone: '2026-10-01', nextDue: '2027-04-01', status: 'al_dia' });
    expect(s.health.checkups['chk-c'].status).toBe('sin_registro');
  });

  it('expone la lista "due" (atrasados primero, luego pronto) y el puntaje', () => {
    const ents = [
      ...seed,
      checkup('chk-late', { lastDone: '2026-01-01' }),
      checkup('chk-soon', { lastDone: '2026-06-01' }),
      checkup('chk-ok', { lastDone: '2026-10-01' }),
      checkup('chk-new'),
      checkup('chk-paused', { active: false, lastDone: '2020-01-01' }),
    ];
    const s = run([], TODAY, { entities: ents });
    expect(s.health.due.map((d) => [d.checkupId, d.status])).toEqual([
      ['chk-late', 'atrasado'],
      ['chk-soon', 'pronto'],
    ]);
    expect(s.health.unknown).toEqual(['chk-new']);
    expect(s.health.counts).toEqual({ active: 4, alDia: 1, pronto: 1, atrasado: 1, sinRegistro: 1 });
    // Al día = al día + te toca pronto (todavía no se pasa la fecha). Los pausados no cuentan.
    expect(s.health.score).toBe(50);
    expect(run([], TODAY).health.score).toBeNull();
  });
});

describe('salud: XP', () => {
  it('hacer un chequeo da XP de misión media a Fuerza física, una vez por chequeo por día', () => {
    const ents = [...seed, checkup('chk-dental'), checkup('chk-vista', { category: 'vista', everyMonths: 24 })];
    const s = run([doneEv(TODAY, 'chk-dental'), doneEv(TODAY, 'chk-dental'), doneEv(TODAY, 'chk-vista'), doneEv('2026-11-18', 'chk-dental')], TODAY, { entities: ents });
    expect(bySource(s, 'health')).toBe(MEDIA * 3);
    const entries = s.xp.ledger.filter((e) => e.source === 'health');
    expect(entries.every((e) => e.attribute === 'fuerza')).toBe(true);
    expect(s.health.history).toHaveLength(3);
    expect(s.health.checkups['chk-dental']).toMatchObject({ timesDone: 2, doneToday: true, lastDone: TODAY });
  });

  it('usa el tamaño guardado en el registro (no el del catálogo actual) y no depende del catálogo', () => {
    const ents = [...seed, checkup('chk-x', { size: 'chica' })];
    const s = run([doneEv('2026-11-01', 'chk-x', { size: 'grande' }), doneEv('2026-11-02', 'chk-borrado', { name: 'Ultrasonido' })], TODAY, { entities: ents });
    expect(bySource(s, 'health')).toBe(GAME_CONFIG.missionXp.grande + MEDIA);
    expect(s.health.history.map((h) => h.name)).toEqual(['Ultrasonido', 'chk-x']);
  });

  it('el tamaño por defecto y el atributo se toman de la config', () => {
    const cfg = cfgWith((c) => {
      c.health.checkupSize = 'grande';
      c.health.attribute = 'disciplina';
    });
    const s = run([doneEv(TODAY, 'chk-a')], TODAY, { entities: [...seed, checkup('chk-a')], config: cfg });
    expect(bySource(s, 'health')).toBe(GAME_CONFIG.missionXp.grande);
    expect(s.xp.ledger.find((e) => e.source === 'health')?.attribute).toBe('disciplina');
  });

  it('las mediciones y la ficha médica no dan XP', () => {
    const ents = [...seed, { id: HEALTH_PROFILE_ID, module: 'health', kind: 'profile', sort: 0, data: { bloodType: 'O+' } }];
    const s = run([ev('health.metric', TODAY, { kind: 'presion', value: 118, value2: 76 }), ev('health.metric', TODAY, { kind: 'glucosa', value: 90 })], TODAY, { entities: ents });
    expect(s.xp.total).toBe(0);
    expect(s.health.card?.bloodType).toBe('O+');
    expect(s.health.metrics.presion[0]).toMatchObject({ value: 118, value2: 76, unit: 'mmHg', level: 'ok' });
    // 120/80 ya no es "menos de 120/80": la diastólica de 80 es etapa 1 (AHA/ACC).
    expect(classifyHealthMetric('presion', 120, 80)?.level).toBe('atencion');
  });

  it('propiedad: agregar cualquier registro de salud nunca baja la XP ni los atributos', () => {
    let seedN = 7;
    const r = () => ((seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const sizes = ['chica', 'media', 'grande', 'epica', undefined];
    for (let round = 0; round < 8; round++) {
      const ents = [...seed, checkup('chk-a'), checkup('chk-b', { size: 'grande' }), checkup('chk-c', { everyMonths: 0 })];
      const events: GameEvent[] = [];
      let prev = run([], TODAY, { entities: ents });
      for (let i = 0; i < 40; i++) {
        const date = addDays('2026-09-01', Math.floor(r() * 80));
        const k = Math.floor(r() * 3);
        // createdAt aleatorio: un registro "viejo" puede llegar después (sincronización).
        const env = { createdAt: Math.floor(r() * 1000) };
        if (k === 0) events.push(doneEv(date, ['chk-a', 'chk-b', 'chk-c', 'chk-z'][Math.floor(r() * 4)], { size: sizes[Math.floor(r() * sizes.length)] }, env));
        else if (k === 1) events.push(ev('health.metric', date, { kind: 'glucosa', value: 70 + Math.floor(r() * 80) }, env));
        else events.push(ev('health.metric', date, { kind: 'presion', value: 130, value2: 85 }, env));
        const s = run(events, TODAY, { entities: ents });
        expect(s.xp.total).toBeGreaterThanOrEqual(prev.xp.total);
        for (const a of Object.keys(s.attributes.values) as (keyof typeof s.attributes.values)[]) {
          expect(s.attributes.values[a].value).toBeGreaterThanOrEqual(prev.attributes.values[a].value);
        }
        expect(s.xp.ledger.every((e) => e.amount > 0)).toBe(true);
        prev = s;
      }
    }
  });
});

describe('salud: validación, recomendaciones y referencias', () => {
  const env = (type: string, payload: unknown) => ({ id: 'abcdefgh-1', type, occurredAt: `${TODAY}T12:00:00.000Z`, localDate: TODAY, payload });

  it('valida los registros', () => {
    expect(validateEvent(env('health.checkup_done', { checkupId: 'chk-a', result: 'Todo bien' })).ok).toBe(true);
    expect(validateEvent(env('health.checkup_done', {})).ok).toBe(false);
    expect(validateEvent(env('health.metric', { kind: 'presion', value: 120, value2: 80 })).ok).toBe(true);
    expect(validateEvent(env('health.metric', { kind: 'presion', value: 120 })).ok).toBe(false);
    expect(validateEvent(env('health.metric', { kind: 'presion', value: 80, value2: 120 })).ok).toBe(false);
    expect(validateEvent(env('health.metric', { kind: 'otro', value: 150 })).ok).toBe(false);
    expect(validateEvent(env('health.metric', { kind: 'otro', value: 150, label: 'Triglicéridos', unit: 'mg/dL' })).ok).toBe(true);
    expect(validateEvent(env('health.metric', { kind: 'glucosa', value: -1 })).ok).toBe(false);
  });

  it('recomendaciones según la edad (sin fecha de nacimiento, las de edad quedan pendientes)', () => {
    const generic = healthSuggestionsFor(null, TODAY);
    expect(generic.find((s) => s.id === 'dental')?.recommended).toBe(true);
    expect(generic.find((s) => s.id === 'colorrectal')).toMatchObject({ applies: null, recommended: false, ageText: '45–75 años' });
    const at35 = healthSuggestionsFor('1991-05-01', TODAY);
    expect(at35.find((s) => s.id === 'prostata')?.applies).toBe(false);
    const at50 = healthSuggestionsFor('1976-01-01', TODAY);
    expect(at50.find((s) => s.id === 'prostata')?.recommended).toBe(true);
    expect(at50.find((s) => s.id === 'colorrectal')?.recommended).toBe(true);
    // Ids únicos y frecuencias razonables.
    expect(new Set(HEALTH_SUGGESTIONS.map((s) => s.id)).size).toBe(HEALTH_SUGGESTIONS.length);
    expect(HEALTH_SUGGESTIONS.find((s) => s.id === 'td')?.everyMonths).toBe(120);
  });

  it('rangos de referencia como contexto', () => {
    expect(classifyHealthMetric('presion', 118, 76)?.level).toBe('ok');
    expect(classifyHealthMetric('presion', 125, 78)?.text).toBe('Elevada');
    expect(classifyHealthMetric('presion', 132, 84)?.level).toBe('atencion');
    expect(classifyHealthMetric('presion', 145, 92)?.level).toBe('alto');
    expect(classifyHealthMetric('glucosa', 95)?.level).toBe('ok');
    expect(classifyHealthMetric('glucosa', 110)?.level).toBe('atencion');
    expect(classifyHealthMetric('colesterol', 250)?.level).toBe('alto');
    expect(classifyHealthMetric('frecuencia_reposo', 55)?.level).toBe('ok');
    expect(classifyHealthMetric('otro', 10)).toBeNull();
    expect(healthMetricKey('otro', 'Triglicéridos')).toBe('otro:trigliceridos');
  });

  it('la foto para la IA incluye la salud', () => {
    const ents = [...seed, checkup('chk-a', { lastDone: '2026-01-01' })];
    const state = project({ events: [ev('health.metric', TODAY, { kind: 'presion', value: 128, value2: 82 })], entities: ents, today: TODAY });
    const snap = buildSnapshot(state, ents, { version: 0, computedBy: 'app' });
    expect(snap.health.checkups[0]).toMatchObject({ id: 'chk-a', status: 'atrasado' });
    expect(snap.health.metrics[0].last.text).toBe('128/82 mmHg');
    const text = renderOverview(snap);
    expect(text).toContain('## Salud');
    expect(text).toContain('[chk-a]');
  });
});

describe('salud: herramientas de IA', () => {
  const mk = (events: GameEvent[] = [], entities: Entity[] = seed) => memoryAssistantStore({ events, entities, today: TODAY });
  const call = (store: ReturnType<typeof mk>, name: string, input: unknown = {}, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });
  const xpOf = (store: ReturnType<typeof mk>) => project({ events: store.allEvents(), entities: store.allEntities(), today: TODAY });

  it('registrar_chequeo activa una recomendación, da XP una vez por día y no duplica', async () => {
    const store = mk();
    const r = await call(store, 'registrar_chequeo', { recomendacion: 'dental', resultado: 'Todo bien' });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain(`+${MEDIA} XP`);
    expect(r.text).toContain('2027'); // vuelve a tocar en mayo de 2027
    expect(r.refs?.events).toHaveLength(1);
    expect(r.refs?.entities).toHaveLength(1);
    const id = suggestionCheckupId('dental');
    expect(store.allEntities().find((e) => e.id === id)?.data).toMatchObject({ name: 'Limpieza dental', everyMonths: 6, active: true, suggestionId: 'dental' });
    expect(store.allEvents()[0].payload).toMatchObject({ checkupId: id, name: 'Limpieza dental', size: 'media', result: 'Todo bien' });

    const again = await call(store, 'registrar_chequeo', { chequeo_id: id });
    expect(again.text).toContain('ya estaba');
    expect(store.allEvents()).toHaveLength(1);
    const s = xpOf(store);
    expect(bySource(s, 'health')).toBe(MEDIA);
    expect(s.health.checkups[id]).toMatchObject({ status: 'al_dia', nextDue: '2027-05-19' });

    // Otro día sí cuenta; nunca en el futuro.
    expect((await call(store, 'registrar_chequeo', { chequeo_id: id, fecha: '2026-11-01' })).isError).toBeFalsy();
    expect((await call(store, 'registrar_chequeo', { chequeo_id: id, fecha: '2026-11-20' })).isError).toBe(true);
    expect(store.allEvents()).toHaveLength(2);
  });

  it('registrar_chequeo por nombre: reutiliza el existente o crea uno nuevo', async () => {
    const store = mk([], [...seed, checkup('chk-ojos', { name: 'Examen de la vista', category: 'vista', everyMonths: 24 })]);
    await call(store, 'registrar_chequeo', { nombre: 'examen de la VISTA' });
    expect(store.allEvents()[0].payload.checkupId).toBe('chk-ojos');
    const r = await call(store, 'registrar_chequeo', { nombre: 'Ultrasonido de abdomen', categoria: 'estudios', cada_meses: 24 });
    expect(r.isError).toBeFalsy();
    const created = store.allEntities().find((e) => e.module === 'health' && e.data.name === 'Ultrasonido de abdomen');
    expect(created?.data).toMatchObject({ category: 'estudios', everyMonths: 24, active: true });
    expect((await call(store, 'registrar_chequeo', { chequeo_id: 'no-existe' })).isError).toBe(true);
  });

  it('guardar_chequeo: activar, anotar la última vez sin XP, pausar y editar', async () => {
    const store = mk();
    const a = await call(store, 'guardar_chequeo', { recomendacion: 'laboratorios', ultima_vez: '2025-10-01' });
    expect(a.isError).toBeFalsy();
    const id = suggestionCheckupId('laboratorios');
    let s = xpOf(store);
    expect(s.health.checkups[id]).toMatchObject({ status: 'atrasado', lastDone: '2025-10-01', nextDue: '2026-10-01' });
    expect(s.xp.total).toBe(0);
    expect(s.health.due.map((d) => d.checkupId)).toEqual([id]);

    await call(store, 'guardar_chequeo', { id, activo: false });
    s = xpOf(store);
    expect(s.health.checkups[id].active).toBe(false);
    expect(s.health.due).toHaveLength(0);

    const c = await call(store, 'guardar_chequeo', { nombre: 'Audiometría', categoria: 'consulta', cada_meses: 36 });
    expect(c.isError).toBeFalsy();
    expect((await call(store, 'guardar_chequeo', { nombre: 'audiometria' })).isError).toBe(true);
    expect((await call(store, 'guardar_chequeo', { recomendacion: 'vista', ultima_vez: '2027-01-01' })).isError).toBe(true);
  });

  it('guardar_chequeo con el id de una recomendación ya activada edita la suya (no la pisa) y deja "prev" para deshacer', async () => {
    const id = suggestionCheckupId('dental');
    const mine = {
      ...checkup(id, { name: 'Limpieza dental', everyMonths: 4, size: 'grande', notes: 'Dra. López', lastDone: '2026-08-01', active: false, suggestionId: 'dental' }),
      sort: 5,
      createdAt: 1000,
    };
    const store = mk([], [...seed, mine]);
    const r = await call(store, 'guardar_chequeo', { id: 'dental', notas: 'Consultorio nuevo' });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Chequeo actualizado');
    const saved = store.allEntities().find((e) => e.id === id)!;
    expect(saved).toMatchObject({ sort: 5, createdAt: 1000 });
    expect(saved.data).toMatchObject({ everyMonths: 4, size: 'grande', notes: 'Consultorio nuevo', lastDone: '2026-08-01', active: false });
    expect(r.refs?.entities).toHaveLength(1);
    expect(r.refs?.entities[0].prev?.data).toMatchObject({ notes: 'Dra. López', everyMonths: 4 });

    // Sin activar todavía: el id de la recomendación la crea con sus valores.
    const fresh = mk();
    const c = await call(fresh, 'guardar_chequeo', { id: 'dental', ultima_vez: '2026-06-01' });
    expect(c.text).toContain('Chequeo agregado');
    expect(c.refs?.entities[0].prev).toBeNull();
    expect(fresh.allEntities().find((e) => e.id === id)?.data).toMatchObject({ everyMonths: 6, lastDone: '2026-06-01', suggestionId: 'dental' });
  });

  it('registrar_medicion: guarda y da contexto con el rango de referencia', async () => {
    const store = mk();
    const r = await call(store, 'registrar_medicion', { tipo: 'presion', valor: 135, valor2: 85 });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('135/85 mmHg');
    expect(r.text).toContain('etapa 1');
    expect(r.text).toContain('no sustituye a tu médico');
    expect((await call(store, 'registrar_medicion', { tipo: 'presion', valor: 135 })).isError).toBe(true);
    expect((await call(store, 'registrar_medicion', { tipo: 'otro', valor: 160 })).isError).toBe(true);
    const o = await call(store, 'registrar_medicion', { tipo: 'otro', valor: 160, nombre: 'Triglicéridos', unidad: 'mg/dL' });
    expect(o.isError).toBeFalsy();
    const s = xpOf(store);
    expect(s.xp.total).toBe(0);
    // "Triglicéridos" en mg/dL se reconoce como la medición de laboratorio (con su rango propio).
    expect(Object.keys(s.health.metrics).sort()).toEqual(['presion', 'trigliceridos']);
    expect(o.text).toContain('150');
    // En otra unidad se queda como "otra" (no se mezcla con la serie en mg/dL).
    await call(store, 'registrar_medicion', { tipo: 'otro', valor: 1.8, nombre: 'Triglicéridos', unidad: 'mmol/L' });
    expect(Object.keys(xpOf(store).health.metrics).sort()).toEqual(['otro:trigliceridos', 'presion', 'trigliceridos']);
  });

  it('guardar_ficha_medica y ver_salud', async () => {
    const store = mk([], [...seed, checkup('chk-a', { name: 'Limpieza dental', lastDone: '2026-01-01' })]);
    const f = await call(store, 'guardar_ficha_medica', { tipo_sangre: 'O+', alergias: 'Penicilina' });
    expect(f.isError).toBeFalsy();
    await call(store, 'guardar_ficha_medica', { medicamentos: 'Ninguno', alergias: '' });
    const card = store.allEntities().find((e) => e.id === HEALTH_PROFILE_ID);
    expect(card).toMatchObject({ module: 'health', kind: 'profile', data: { bloodType: 'O+', medications: 'Ninguno' } });
    expect(card?.data.allergies).toBeUndefined();

    const v = await call(store, 'ver_salud', {}, false);
    expect(v.isError).toBeFalsy();
    expect(v.text).toContain('## Ya le toca');
    expect(v.text).toContain('Limpieza dental [chk-a]');
    expect(v.text).toContain('Tipo de sangre: O+');
    expect(v.text).toContain('Recomendaciones sin activar');
    expect(v.text).toContain('no sustituye a tu médico');
  });

  it('en solo lectura no registran nada', async () => {
    const store = mk();
    for (const [name, input] of [
      ['registrar_chequeo', { recomendacion: 'dental' }],
      ['registrar_medicion', { tipo: 'glucosa', valor: 90 }],
      ['guardar_chequeo', { recomendacion: 'dental' }],
      ['guardar_ficha_medica', { tipo_sangre: 'A+' }],
    ] as const) {
      expect((await call(store, name, input, false)).isError).toBe(true);
    }
    expect(store.allEvents()).toHaveLength(0);
    expect(store.allEntities()).toHaveLength(seed.length);
  });
});
