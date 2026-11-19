import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_TOOLS,
  GAME_CONFIG,
  buildSnapshot,
  memoryAssistantStore,
  project,
  runAssistantTool,
  toolInputSchema,
  type Entity,
} from '../src';
import { done, ev, seed } from './helpers';

const TODAY = '2026-11-19';
const run = (store: ReturnType<typeof memoryAssistantStore>, name: string, input: unknown = {}, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });
const mk = (events = [] as ReturnType<typeof ev>[], entities: Entity[] = seed) => memoryAssistantStore({ events, entities, today: TODAY });

describe('herramientas de IA: catálogo', () => {
  it('cada herramienta tiene nombre único, descripción y JSON Schema de objeto', () => {
    const names = new Set<string>();
    for (const t of ASSISTANT_TOOLS) {
      expect(names.has(t.name)).toBe(false);
      names.add(t.name);
      expect(t.name).toMatch(/^[a-z_]{3,40}$/);
      expect(t.description.length).toBeGreaterThan(20);
      const s = toolInputSchema(t);
      expect(s.type).toBe('object');
      expect(s.$schema).toBeUndefined();
    }
    expect(names.has('ver_resumen')).toBe(true);
    expect(names.has('completar_mision')).toBe(true);
  });

  it('en modo solo lectura las herramientas que escriben se niegan y no tocan nada', async () => {
    const store = mk();
    const r = await run(store, 'completar_mision', { mision_id: 'daily-leer' }, false);
    expect(r.isError).toBe(true);
    expect(store.allEvents()).toHaveLength(0);
    const read = await run(store, 'ver_resumen', {}, false);
    expect(read.isError).toBeFalsy();
  });

  it('valida la entrada y explica el error', async () => {
    const r = await run(mk(), 'registrar_dinero', { tipo: 'ingreso', monto: -5, concepto: 'x' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('monto');
  });
});

describe('herramientas de IA: registrar', () => {
  it('completar una diaria del catálogo usa su tamaño y atributo y da su XP', async () => {
    const store = mk();
    const r = await run(store, 'completar_mision', { mision_id: 'daily-entrenar' });
    expect(r.isError).toBeFalsy();
    expect(r.refs?.events).toHaveLength(1);
    const [e] = store.allEvents();
    expect(e.type).toBe('mission.completed');
    expect(e.localDate).toBe(TODAY);
    expect(e.payload).toMatchObject({ missionId: 'daily-entrenar', size: 'chica', attribute: 'fuerza', kind: 'daily' });
    const state = project({ events: store.allEvents(), entities: seed, today: TODAY });
    expect(state.xp.total).toBeGreaterThanOrEqual(GAME_CONFIG.missionXp.chica);
  });

  it('no duplica una diaria el mismo día ni una secundaria ya completada', async () => {
    const store = mk([done(TODAY, 'daily-leer'), done('2026-11-10', 'side-bot-whatsapp', 'grande', 'inteligencia', 'side')]);
    const a = await run(store, 'completar_mision', { mision_id: 'daily-leer' });
    expect(a.text).toContain('ya estaba');
    const b = await run(store, 'completar_mision', { mision_id: 'side-bot-whatsapp' });
    expect(b.text).toContain('una sola vez');
    expect(store.allEvents()).toHaveLength(2);
    // Otro día sí cuenta la diaria.
    const c = await run(store, 'completar_mision', { mision_id: 'daily-leer', fecha: '2026-11-18' });
    expect(c.isError).toBeFalsy();
    expect(store.allEvents()).toHaveLength(3);
  });

  it('algo fuera del catálogo queda como misión rápida con id estable', async () => {
    const store = mk();
    await run(store, 'completar_mision', { titulo: 'Fui al gym', tamano: 'media', atributo: 'fuerza' });
    expect(store.allEvents()[0].payload).toMatchObject({ missionId: 'quick-fui-al-gym', kind: 'quick', size: 'media' });
  });

  it('un título igual a una diaria se registra como esa diaria', async () => {
    const store = mk();
    await run(store, 'completar_mision', { titulo: 'leer 20 paginas' });
    expect(store.allEvents()[0].payload.missionId).toBe('daily-leer');
  });

  it('no registra en el futuro ni hace más de un año', async () => {
    const store = mk();
    expect((await run(store, 'completar_mision', { mision_id: 'daily-leer', fecha: '2026-11-20' })).isError).toBe(true);
    expect((await run(store, 'completar_mision', { mision_id: 'daily-leer', fecha: '2025-01-01' })).isError).toBe(true);
    expect(store.allEvents()).toHaveLength(0);
  });

  it('el dinero real no da XP y reporta el total del mes', async () => {
    const store = mk();
    const r = await run(store, 'registrar_dinero', { tipo: 'ingreso', monto: 5000, concepto: 'Venta' });
    expect(r.text).toContain('5,000');
    const state = project({ events: store.allEvents(), entities: seed, today: TODAY });
    expect(state.xp.total).toBe(0);
    expect(state.money.monthIncome).toBe(5000);
  });

  it('plan del día con ids del catálogo y títulos libres', async () => {
    const store = mk();
    const r = await run(store, 'planear_dia', { cosas: [{ mision_id: 'daily-leer' }, { titulo: 'Llamar al contador' }] });
    expect(r.isError).toBeFalsy();
    await run(store, 'completar_mision', { mision_id: 'daily-leer' });
    await run(store, 'completar_mision', { titulo: 'Llamar al contador' });
    const state = project({ events: store.allEvents(), entities: seed, today: TODAY });
    expect(state.plans[TODAY].completed).toBe(true);
  });

  it('anular un registro lo deja de contar', async () => {
    const store = mk();
    const r = await run(store, 'completar_mision', { mision_id: 'daily-entrenar' });
    const id = r.refs!.events[0];
    const v = await run(store, 'anular_registro', { registro_id: id });
    expect(v.isError).toBeFalsy();
    const state = project({ events: store.allEvents(), entities: seed, today: TODAY });
    expect(state.xp.total).toBe(0);
    expect((await run(store, 'anular_registro', { registro_id: id })).text).toContain('ya estaba anulado');
  });

  it('canjear un premio exige oro suficiente', async () => {
    const reward: Entity = { id: 'rw-1', module: 'shop', kind: 'reward', sort: 1, data: { name: 'Cena', cost: 50 } };
    const store = mk([], [...seed, reward]);
    const r = await run(store, 'canjear_premio', { premio_id: 'rw-1' });
    expect(r.isError).toBe(true);
    expect(store.allEvents()).toHaveLength(0);
  });

  it('retos de N días: marcar inicia si no está en curso', async () => {
    const store = mk([], [...seed, { id: 'ch-1', module: 'challenges', kind: 'challenge', sort: 1, data: { title: 'Leer diario', days: 3, attribute: 'inteligencia', size: 'media' } }]);
    const r = await run(store, 'marcar_reto', { reto_id: 'ch-1' });
    expect(r.isError).toBeFalsy();
    expect(store.allEvents().map((e) => e.type).sort()).toEqual(['challenge.checked', 'challenge.started']);
    expect((await run(store, 'marcar_reto', { reto_id: 'ch-1' })).text).toContain('ya estaba marcado');
  });

  it('gran reto: solo se marca a mano una fase manual', async () => {
    const store = mk();
    const snap = await store.snapshot();
    const manual = snap.bosses.find((b) => !b.locked && b.next?.manual);
    const auto = snap.bosses.find((b) => !b.locked && b.next && !b.next.manual);
    if (manual) {
      const r = await run(store, 'avanzar_gran_reto', { reto_id: manual.id });
      expect(r.isError).toBeFalsy();
      expect(store.allEvents().at(-1)?.payload).toMatchObject({ bossId: manual.id, phaseIndex: manual.next!.index });
    }
    if (auto) {
      const r = await run(store, 'avanzar_gran_reto', { reto_id: auto.id });
      expect(r.isError).toBe(true);
    }
    expect(manual || auto).toBeTruthy();
  });
});

describe('herramientas de IA: organizar', () => {
  it('crea una diaria en la rutina y luego la edita sin perder campos', async () => {
    const store = mk();
    const r = await run(store, 'guardar_mision', { tipo: 'diaria', titulo: 'Meditar 10 min', tamano: 'chica', atributo: 'disciplina', dias: [0, 2, 4] });
    expect(r.isError).toBeFalsy();
    const id = r.refs!.entities[0].id;
    expect(r.refs!.entities[0].prev).toBeNull();
    const e1 = (await store.catalog()).find((e) => e.id === id)!;
    expect(e1).toMatchObject({ module: 'missions', kind: 'daily', data: { title: 'Meditar 10 min', days: [0, 2, 4] } });
    const r2 = await run(store, 'guardar_mision', { id, tamano: 'media' });
    expect(r2.refs!.entities[0].prev?.data.size).toBe('chica');
    const e2 = (await store.catalog()).find((e) => e.id === id)!;
    expect(e2.data).toMatchObject({ title: 'Meditar 10 min', size: 'media', days: [0, 2, 4] });
  });

  it('no borra una meta con avances (su XP depende de ella)', async () => {
    const store = mk();
    const g = await run(store, 'guardar_meta', { titulo: 'Leer 12 libros', objetivo: 12, unidad: 'libros' });
    const id = g.refs!.entities[0].id;
    await run(store, 'avanzar_meta', { meta_id: id, cantidad: 1 });
    const del = await run(store, 'borrar_elemento', { id });
    expect(del.isError).toBe(true);
    expect(del.text).toContain('archív');
    const todo = await run(store, 'agendar_pendiente', { titulo: 'Pagar luz', fecha: '2026-11-21' });
    const del2 = await run(store, 'borrar_elemento', { id: todo.refs!.entities[0].id });
    expect(del2.isError).toBeFalsy();
  });
});

describe('foto del estado', () => {
  it('resume nivel, rutina y lo hecho hoy', async () => {
    const events = [done(TODAY, 'daily-leer'), ev('checkin.morning', TODAY, { sleepHours: 5 })];
    const state = project({ events, entities: seed, today: TODAY });
    const s = buildSnapshot(state, seed, { version: 123, computedBy: 'app' });
    expect(s.version).toBe(123);
    expect(s.day.routine.find((r) => r.id === 'daily-leer')?.done).toBe(true);
    expect(s.day.done.map((d) => d.id)).toContain('daily-leer');
    expect(s.energy.low).toBe(true);
    expect(JSON.stringify(s).length).toBeLessThan(60_000);
    const text = (await run(mk(events), 'ver_resumen')).text;
    expect(text).toContain('Nivel');
    expect(text).toContain('Rutina');
  });
});

describe('herramientas de IA: protegen la XP ganada y las fechas', () => {
  const reto: Entity = { id: 'ch-2', module: 'challenges', kind: 'challenge', sort: 1, data: { title: 'Leer diario', days: 2, attribute: 'inteligencia', size: 'grande' } };

  it('marcar_reto no marca días anteriores al intento ni empieza antes de ayer', async () => {
    const store = mk([], [...seed, reto]);
    expect((await run(store, 'marcar_reto', { reto_id: 'ch-2', fecha: '2026-11-16' })).isError).toBe(true);
    const ayer = await run(store, 'marcar_reto', { reto_id: 'ch-2', fecha: '2026-11-18' });
    expect(ayer.isError).toBeFalsy();
    expect(ayer.text).toContain('día 1 de 2');
    expect((await run(store, 'marcar_reto', { reto_id: 'ch-2', fecha: '2026-11-17' })).isError).toBe(true);
    expect((await run(store, 'marcar_reto', { reto_id: 'ch-2', fecha: '2026-11-18' })).text).toContain('ya estaba marcado');
    const hoy = await run(store, 'marcar_reto', { reto_id: 'ch-2' });
    expect(hoy.text).toContain('completado');
    const state = project({ events: store.allEvents(), entities: [...seed, reto], today: TODAY });
    expect(state.challenges['ch-2'].completions).toBe(1);
  });

  it('no deja cambiar días o tamaño de un reto ya completado (le quitaría XP)', async () => {
    const store = mk([ev('challenge.started', '2026-11-18', { challengeId: 'ch-2' }), ev('challenge.checked', '2026-11-18', { challengeId: 'ch-2' }), ev('challenge.checked', TODAY, { challengeId: 'ch-2' })], [...seed, reto]);
    const before = project({ events: store.allEvents(), entities: await store.catalog(), today: TODAY }).xp.total;
    expect((await run(store, 'guardar_reto', { id: 'ch-2', dias: 5 })).isError).toBe(true);
    expect((await run(store, 'guardar_reto', { id: 'ch-2', tamano: 'chica' })).isError).toBe(true);
    expect((await run(store, 'guardar_reto', { id: 'ch-2', titulo: 'Leer todos los días' })).isError).toBeFalsy();
    expect(project({ events: store.allEvents(), entities: await store.catalog(), today: TODAY }).xp.total).toBe(before);
  });

  it('no deja descumplir una meta cumplida ni bajarle el tamaño', async () => {
    const goal: Entity = { id: 'goal-1', module: 'goals', kind: 'goal', sort: 1, data: { title: 'Leer 2 libros', target: 2, unit: 'libros', attribute: 'inteligencia', size: 'grande' } };
    const store = mk([ev('goal.progress', TODAY, { goalId: 'goal-1', amount: 2 })], [...seed, goal]);
    expect((await run(store, 'guardar_meta', { id: 'goal-1', objetivo: 4 })).isError).toBe(true);
    expect((await run(store, 'guardar_meta', { id: 'goal-1', tamano: 'chica' })).isError).toBe(true);
    expect((await run(store, 'guardar_meta', { id: 'goal-1', archivar: true })).isError).toBeFalsy();
  });

  it('persona clave olvidada: el panorama da el id de su misión y el id de la persona también sirve', async () => {
    const npc: Entity = { id: 'npc-ana', module: 'npcs', kind: 'npc', sort: 1, createdAt: Date.UTC(2026, 0, 1), data: { name: 'Ana', npcType: 'party', relation: 4, key: true, lastContact: '2026-09-01' } };
    const store = mk([], [...seed, npc]);
    const resumen = (await run(store, 'ver_resumen')).text;
    expect(resumen).toContain('[misión npc-npc-ana]');
    const r = await run(store, 'completar_mision', { mision_id: 'npc-ana' });
    expect(r.isError).toBeFalsy();
    expect(store.allEvents()[0].payload).toMatchObject({ missionId: 'npc-npc-ana', kind: 'npc', npcId: 'npc-ana' });
    expect((await run(store, 'ver_catalogo', { tipo: 'personas' })).text).toContain(`último contacto: ${TODAY}`);
  });

  it('las referencias para deshacer guardan la versión que dejó la IA', async () => {
    const store = mk();
    const r = await run(store, 'guardar_premio', { nombre: 'Cena', costo: 40 });
    const ref = r.refs!.entities[0];
    const saved = (await store.catalog()).find((e) => e.id === ref.id)!;
    expect(ref.savedAt).toBe(saved.updatedAt);
  });
});
