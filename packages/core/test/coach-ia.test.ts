import { describe, expect, it } from 'vitest';
import {
  EXERCISE_BY_ID,
  TRAINING_SETTINGS_ID,
  addDays,
  buildSnapshot,
  coachPlan,
  coachPlanLines,
  coachStateFor,
  fmtPrescribed,
  memoryAssistantStore,
  nutritionDay,
  patternOptions,
  planPhase,
  project,
  reviewDay,
  runAssistantTool,
  weekReview,
  weekday,
  type AssistantStore,
  type BodyArea,
  type CoachSettings,
  type Entity,
  type EventQuery,
  type GameEvent,
  type SettingsData,
  type TrainingSettingsData,
  type WorkoutExercise,
} from '../src';
import { ev, seed } from './helpers';

/**
 * Herramientas de IA del entrenador y su lugar en "¿Cómo fue tu día?": que la IA vea lo mismo que la app, que no
 * active el plan sin querer, que no gaste CPU de más al registrar y que los datos raros no truenen nada.
 */

const TODAY = '2026-11-18'; // miércoles
const MONDAY = '2026-11-16';
const PROFILE: Partial<SettingsData> = { heightCm: 175, birthDate: '1990-05-10', name: 'Iván Gómez' };
const ON: CoachSettings = { on: true, goal: 'salud', level: 'sedentario', days: [0, 2, 4], sessionMinutes: 45, startDate: '2026-10-05' };

function entities(coach: CoachSettings | null, where: string | null = 'gym', settings: Partial<SettingsData> = PROFILE): Entity[] {
  const base = seed.map((e) => (e.id === 'settings' ? { ...e, data: { ...(e.data as SettingsData), ...settings } } : e));
  if (!base.some((e) => e.id === 'settings')) base.push({ id: 'settings', module: 'core', kind: 'settings', data: { ...settings }, sort: 0 } as Entity);
  const data: TrainingSettingsData = { ...(where ? { where: where as TrainingSettingsData['where'] } : {}), ...(coach ? { coach } : {}) };
  return [...base, { id: TRAINING_SETTINGS_ID, module: 'training', kind: 'settings', data, sort: 0 }];
}

function wk(date: string, exercises: [string, number, number, number?][]): GameEvent {
  const ex: WorkoutExercise[] = exercises.map(([exerciseId, n, reps, kg]) => ({
    exerciseId,
    name: EXERCISE_BY_ID.get(exerciseId)?.name ?? exerciseId,
    sets: Array.from({ length: n }, () => (kg ? { reps, kg } : { reps })),
  }));
  return ev('workout.logged', date, { kind: 'fuerza', exercises: ex });
}

const FULL_A: [string, number, number, number?][] = [
  ['sentadilla-goblet', 3, 10, 20],
  ['press-banca', 3, 10, 40],
  ['remo-barra', 3, 10, 40],
  ['peso-muerto-rumano', 3, 10, 40],
  ['elevaciones-laterales', 2, 12, 6],
];

/** Un año (o más) de vida normal: fuerza lun/mié/vie, comidas, agua por vaso, pasos, sueño y cómo te sientes. */
function yearOfLogs(from: string, to: string, opts: { daily?: boolean } = {}): GameEvent[] {
  const out: GameEvent[] = [];
  let i = 0;
  for (let d = from; d <= to; d = addDays(d, 1), i++) {
    if ([0, 2, 4].includes(weekday(d))) out.push(wk(d, FULL_A));
    if (weekday(d) === 6) out.push(ev('body.logged', d, { weightKg: 90 - i / 100 }));
    if (opts.daily === false) continue;
    out.push(ev('checkin.morning', d, { sleepHours: 7 }));
    out.push(ev('meal.logged', d, { meal: 'desayuno', text: 'huevos', tags: ['proteina'] }));
    out.push(ev('meal.logged', d, { meal: 'comida', text: 'pollo con verduras', tags: ['proteina', 'verduras'] }));
    out.push(ev('meal.logged', d, { meal: 'cena', text: 'tacos', tags: ['proteina'] }));
    for (let g = 0; g < 6; g++) out.push(ev('water.logged', d, { glasses: 1 }));
    out.push(ev('steps.logged', d, { steps: 7000 + (i % 5) * 500 }));
    out.push(ev('coach.readiness', d, { energy: 3 + (i % 2), soreness: 1, pain: [] }));
  }
  return out;
}

const runTool = (store: AssistantStore, name: string, input: unknown = {}, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });

describe('IA del entrenador: ve el mismo historial que la app', () => {
  // Plan de más de 400 días: antes la IA solo cargaba 400 días y contaba otras semanas entrenadas (y otra descarga).
  const START = '2025-03-03';
  const coach: CoachSettings = { on: true, goal: 'salud', level: 'principiante', days: [0, 2, 4], sessionMinutes: 45, startDate: START };
  const ents = entities(coach);
  const events = yearOfLogs(START, '2026-12-31', { daily: false });

  it('fase, semanas entrenadas y descargas coinciden con la app semana por semana', async () => {
    let deloads = 0;
    for (let today = '2026-04-01'; today <= '2026-12-30'; today = addDays(today, 7)) {
      const evs = events.filter((e) => e.localDate <= today);
      const app = planPhase(project({ events: evs, entities: ents, today }));
      const ia = planPhase(await coachStateFor(memoryAssistantStore({ events: evs, entities: ents, today })));
      expect([ia.key, ia.trainedWeeks], today).toEqual([app.key, app.trainedWeeks]);
      if (app.key === 'descarga') deloads++;
    }
    expect(deloads).toBeGreaterThan(0);
  });

  it('entrenos de antes del plan y de hace más de 400 días: "retomar" con el mismo peso que la app', async () => {
    // Entrenó en 2024 y armó el plan esta semana: la app y el panorama dicen "retoma con X kg", no "primera vez".
    const old: GameEvent[] = [];
    for (let d = '2024-03-04'; d <= '2024-09-27'; d = addDays(d, 1)) {
      if ([0, 3].includes(weekday(d))) old.push(wk(d, [['sentadilla-goblet', 3, 10, 50], ['peso-muerto-rumano', 3, 10, 50]]));
    }
    const ents2 = entities({ on: true, goal: 'salud', level: 'principiante', days: [0, 2, 4], sessionMinutes: 45, startDate: MONDAY });
    const store = memoryAssistantStore({ events: old, entities: ents2, today: TODAY });
    const app = coachPlan(project({ events: old, entities: ents2, today: TODAY }), store.now().toISOString());
    const retomar = app.today.session.exercises.filter((e) => e.progression === 'retomar');
    expect(retomar.map((e) => e.exerciseId).sort()).toEqual(['peso-muerto-rumano', 'sentadilla-goblet']);
    const r = await runTool(store, 'ver_plan_entrenador', {}, false);
    for (const e of app.today.session.exercises) expect(r.text).toContain(`- ${fmtPrescribed(e)}`);
    const snap = (await store.snapshot()) as { coach?: { lines: string[] } };
    for (const e of retomar) expect(snap.coach!.lines.join('\n')).toContain(fmtPrescribed(e));
  });

  it('ver_plan_entrenador dice lo mismo que el panorama (la foto)', async () => {
    const today = '2026-12-16'; // semana de descarga para la app
    const evs = events.filter((e) => e.localDate <= today);
    const store = memoryAssistantStore({ events: evs, entities: ents, today });
    const snap = await store.snapshot();
    const r = await runTool(store, 'ver_plan_entrenador', {}, false);
    const phaseLine = (snap as { coach?: { lines: string[] } }).coach!.lines[0];
    expect(phaseLine).toMatch(/fase descarga/);
    expect(r.text).toContain(phaseLine.match(/fase [^;]*?semanas entrenadas/)![0]);
  });
});

describe('ajustar_entrenador: solo arma el plan si se lo pides', () => {
  const coachOf = async (store: AssistantStore) => ((await store.catalog()).find((e) => e.id === TRAINING_SETTINGS_ID)?.data as TrainingSettingsData | undefined) ?? null;

  it('sin nada que cambiar responde con error y no guarda nada', async () => {
    const store = memoryAssistantStore({ events: [], entities: entities(null), today: TODAY });
    const r = await runTool(store, 'ajustar_entrenador', {});
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No mandaste nada que cambiar/);
    expect((await coachOf(store))?.coach).toBeUndefined();
  });

  it('solo el lugar o el nombre del coach se guardan sin activar el plan', async () => {
    const store = memoryAssistantStore({ events: [], entities: entities(null), today: TODAY });
    const r = await runTool(store, 'ajustar_entrenador', { lugar: 'casa' });
    expect(r.isError).toBeFalsy();
    expect(r.text).not.toMatch(/plan activado/);
    expect(r.text).toMatch(/sin armar/);
    const after = await coachOf(store);
    expect(after?.where).toBe('casa');
    expect(after?.coach?.on).toBeFalsy();
    expect(after?.coach?.startDate).toBeUndefined();
    const n = await runTool(store, 'ajustar_entrenador', { nombre_coach: 'Rocky' });
    expect(n.isError).toBeFalsy();
    expect((await coachOf(store))?.coach).toEqual({ name: 'Rocky' });
    const state = project({ events: [], entities: await store.catalog(), today: TODAY });
    expect(coachPlan(state, `${TODAY}T18:00:00.000Z`).brief.actions.map((a) => a.kind)).toContain('arrancar');
  });

  it('reiniciar un plan que no existe es un error', async () => {
    const store = memoryAssistantStore({ events: [], entities: entities(null), today: TODAY });
    const r = await runTool(store, 'ajustar_entrenador', { reiniciar: true });
    expect(r.isError).toBe(true);
    expect((await coachOf(store))?.coach).toBeUndefined();
  });

  it('con datos del plan o activar: true lo arma desde hoy', async () => {
    const a = memoryAssistantStore({ events: [], entities: entities(null), today: TODAY });
    const r = await runTool(a, 'ajustar_entrenador', { objetivo: 'fuerza', nombre_coach: 'Rocky' });
    expect(r.text).toMatch(/plan activado/);
    expect((await coachOf(a))?.coach).toMatchObject({ on: true, goal: 'fuerza', name: 'Rocky', startDate: TODAY });
    const b = memoryAssistantStore({ events: [], entities: entities(null), today: TODAY });
    expect((await runTool(b, 'ajustar_entrenador', { activar: true })).text).toMatch(/plan activado/);
    expect((await coachOf(b))?.coach).toMatchObject({ on: true, startDate: TODAY });
  });

  it('con el plan armado, cambiar el lugar no lo reinicia', async () => {
    const store = memoryAssistantStore({ events: [], entities: entities(ON), today: TODAY });
    const r = await runTool(store, 'ajustar_entrenador', { lugar: 'casa' });
    expect(r.text).not.toMatch(/plan activado/);
    expect((await coachOf(store))?.coach).toMatchObject({ on: true, startDate: ON.startDate });
    expect((await runTool(store, 'ajustar_entrenador', { activar: true })).isError).toBe(true);
  });
});

describe('ajustar_entrenador: cambiar_ejercicio respeta el patrón y el lugar', () => {
  it('rechaza un ejercicio de otro patrón y dice qué opciones hay', async () => {
    const store = memoryAssistantStore({ events: [], entities: entities(ON), today: TODAY });
    const r = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'curl de biceps' } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Opciones/);
    expect(r.text).toContain('Sentadilla goblet');
    expect(((await store.catalog()).find((e) => e.id === TRAINING_SETTINGS_ID)!.data as TrainingSettingsData).coach?.swaps).toBeUndefined();
  });

  it('reconoce el patrón por clave o por nombre, sin importar acentos ni guiones', async () => {
    for (const patron of ['press_horizontal', 'Press horizontal', 'press de pecho', 'PRESS-DE-PECHO']) {
      const store = memoryAssistantStore({ events: [], entities: entities(ON, 'gym'), today: TODAY });
      const r = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron, ejercicio: 'press con mancuernas' } });
      expect(r.text, patron).not.toMatch(/No conozco el patrón/);
    }
    const bad = await runTool(memoryAssistantStore({ events: [], entities: entities(ON, 'gym'), today: TODAY }), 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'volar', ejercicio: 'press' } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/press_horizontal \(Press de pecho\)/);
  });

  it('en casa no acepta máquinas (tampoco si el lugar llega en la misma llamada)', async () => {
    const casa = memoryAssistantStore({ events: [], entities: entities(ON, 'casa'), today: TODAY });
    const r = await runTool(casa, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'prensa' } });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain('Prensa de pierna,');
    const gym = memoryAssistantStore({ events: [], entities: entities(ON, 'gym'), today: TODAY });
    expect((await runTool(gym, 'ajustar_entrenador', { lugar: 'casa', cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'prensa' } })).isError).toBe(true);
    expect((await runTool(gym, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'prensa' } })).isError).toBeFalsy();
  });

  it('sin lugar guardado usa el de tus entrenos, como el plan (y no dice "Listo" a algo que no aplica)', async () => {
    // Plan armado por la IA sin "lugar": la app arma la sesión con el lugar de tus últimos entrenos (casa).
    const casa = [MONDAY, '2026-11-13', '2026-11-11'].map((d) => {
      const e = wk(d, [['sentadilla-goblet', 3, 10, 16]]);
      return { ...e, payload: { ...(e.payload as object), where: 'casa' } } as GameEvent;
    });
    const ents2 = entities({ ...ON, startDate: MONDAY }, null);
    const store = memoryAssistantStore({ events: casa, entities: ents2, today: TODAY });
    expect(coachPlan(project({ events: casa, entities: ents2, today: TODAY }), store.now().toISOString()).profile.where).toBe('casa');
    const r = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'prensa' } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/entrenando en casa/);
    expect(r.text).toContain('Sentadilla goblet');
    const saved = (await store.catalog()).find((e) => e.id === TRAINING_SETTINGS_ID)!.data as TrainingSettingsData;
    expect(saved.coach?.swaps).toBeUndefined();
    // Con un plan sin armar pasa lo mismo: el lugar de tus entrenos manda mientras no guardes uno.
    const off = memoryAssistantStore({ events: casa, entities: entities(null, null), today: TODAY });
    expect((await runTool(off, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'prensa' } })).isError).toBe(true);
    const ok = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'sentadilla goblet' } });
    expect(ok.isError).toBeFalsy();
    expect(ok.text).toMatch(/^Listo: sentadilla: Sentadilla goblet\. Fase /);
  });

  it('no acepta lo que carga una zona con molestias (la app tampoco lo ofrece)', async () => {
    const store = memoryAssistantStore({ events: [], entities: entities({ ...ON, limitations: ['rodilla'] }), today: TODAY });
    const r = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'sentadilla con barra' } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/carga rodilla/);
    // Si en la misma llamada quita la molestia, ya cabe.
    const ok = await runTool(store, 'ajustar_entrenador', { molestias: [], cambiar_ejercicio: { patron: 'sentadilla', ejercicio: 'sentadilla con barra' } });
    expect(ok.isError).toBeFalsy();
    expect(((await store.catalog()).find((e) => e.id === TRAINING_SETTINGS_ID)!.data as TrainingSettingsData).coach?.swaps).toEqual({ sentadilla: 'sentadilla' });
  });

  it('acepta una opción válida del patrón', async () => {
    const casa = memoryAssistantStore({ events: [], entities: entities(ON, 'casa'), today: TODAY });
    const r = await runTool(casa, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'Sentadilla', ejercicio: 'sentadilla goblet' } });
    expect(r.isError).toBeFalsy();
    expect(((await casa.catalog()).find((e) => e.id === TRAINING_SETTINGS_ID)!.data as TrainingSettingsData).coach?.swaps).toEqual({ sentadilla: 'sentadilla-goblet' });
  });
});

describe('registrar_checkin_semanal: semanas válidas', () => {
  it('no acepta semanas de hace más de un año ni de antes del plan', async () => {
    const store = memoryAssistantStore({ events: [], entities: entities(ON), today: TODAY });
    const base = { pesado: 3, energia: 3, animo: 3 };
    expect((await runTool(store, 'registrar_checkin_semanal', { ...base, semana: '2020-01-06' })).isError).toBe(true);
    expect((await runTool(store, 'registrar_checkin_semanal', { ...base, semana: '2026-09-28' })).isError).toBe(true);
    expect((await runTool(store, 'registrar_checkin_semanal', { ...base, semana: '2026-11-25' })).isError).toBe(true);
    expect(await store.events({ types: ['coach.checkin'] })).toHaveLength(0);
    expect((await runTool(store, 'registrar_checkin_semanal', { ...base, semana: '2026-10-05' })).isError).toBeFalsy();
    expect((await runTool(store, 'registrar_checkin_semanal', { ...base, semana: '2026-11-12' })).isError).toBeFalsy();
  });

  it('un plan de más de un año tampoco acepta semanas de hace más de un año', async () => {
    const store = memoryAssistantStore({ events: [], entities: entities({ ...ON, startDate: '2025-05-26' }), today: TODAY });
    const r = await runTool(store, 'registrar_checkin_semanal', { pesado: 5, energia: 3, animo: 3, molestias: ['rodilla'], semana: '2025-09-01' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/un año/);
  });
});

/** Envuelve un almacén para ver qué lee y en qué orden respecto a lo que escribe. */
function spyStore(inner: AssistantStore) {
  const log: { op: string; q?: EventQuery; n?: number }[] = [];
  const store: AssistantStore = {
    ...inner,
    async events(q) {
      const r = await inner.events(q);
      log.push({ op: 'events', q, n: r.length });
      return r;
    },
    async snapshot() {
      log.push({ op: 'snapshot' });
      return inner.snapshot();
    },
    async addEvents(l) {
      log.push({ op: 'write' });
      return inner.addEvents(l);
    },
    async putEntity(e) {
      log.push({ op: 'write' });
      return inner.putEntity(e);
    },
  };
  const readsAfterWrite = () => log.slice(log.findIndex((x) => x.op === 'write') + 1).filter((x) => x.op !== 'write');
  const typesRead = () => [...new Set(log.flatMap((x) => x.q?.types ?? (x.op === 'events' ? ['*'] : [])))].sort();
  const eventsRead = () => log.reduce((s, x) => s + (x.n ?? 0), 0);
  return { store, log, readsAfterWrite, typesRead, eventsRead };
}

describe('herramientas que escriben: respuesta barata (sin proyectar todo después de guardar)', () => {
  const ents = entities(ON);
  const history = yearOfLogs('2025-11-01', addDays(TODAY, -1));
  const mk = () => spyStore(memoryAssistantStore({ events: history, entities: ents, today: TODAY }));
  const fullPlan = async (s: AssistantStore) => coachPlan(project({ events: await s.events({}), entities: await s.catalog(), today: TODAY }), s.now().toISOString());

  it('registrar_comida: lee solo el peso y lo de ese día, y su puntaje es el de la app', async () => {
    const s = mk();
    const r = await runTool(s.store, 'registrar_comida', { tipo: 'comida', descripcion: 'Pechuga con nopales', etiquetas: ['proteina', 'verduras'], proteina_g: 40 });
    expect(r.isError).toBeFalsy();
    expect(s.readsAfterWrite()).toEqual([]);
    expect(s.typesRead()).toEqual(['body.logged', 'meal.logged', 'water.logged']);
    expect(s.eventsRead()).toBeLessThan(120);
    const p = await fullPlan(s.store);
    expect(r.text).toContain(`Día de comida: ${p.nutrition.today.score}/100`);
    const past = await runTool(s.store, 'registrar_comida', { tipo: 'cena', descripcion: 'Tacos', etiquetas: ['proteina'], fecha: '2026-11-10' });
    const full = project({ events: await s.store.events({}), entities: ents, today: TODAY });
    const day = nutritionDay(full.coach, '2026-11-10', coachPlan(full, s.store.now().toISOString()).nutrition.targets);
    expect(past.text).toMatch(/\(cena del /);
    expect(past.text).toContain(`Día de comida: ${day.score}/100 (${day.checks.map((c) => `${c.label} ${c.done ? '✓' : c.detail}`).join(', ')})`);
  });

  it('registrar_pasos: lee solo los pasos de la semana y da la meta de la app', async () => {
    const s = mk();
    const r = await runTool(s.store, 'registrar_pasos', { pasos: 4000 });
    expect(s.readsAfterWrite()).toEqual([]);
    expect(s.typesRead()).toEqual(['steps.logged']);
    expect(s.eventsRead()).toBeLessThanOrEqual(8);
    const p = await fullPlan(s.store);
    expect(r.text).toContain(`meta ${p.targets.steps.target.toLocaleString('es-MX')}`);
  });

  it('registrar_como_me_siento: calcula antes de guardar, sin comidas ni agua, y da la sesión de la app', async () => {
    const s = mk();
    const r = await runTool(s.store, 'registrar_como_me_siento', { energia: 2, adolorido: 1, molestias: ['rodilla'] });
    expect(r.isError).toBeFalsy();
    expect(s.readsAfterWrite()).toEqual([]);
    expect(s.typesRead()).not.toContain('meal.logged');
    expect(s.typesRead()).not.toContain('water.logged');
    const p = await fullPlan(s.store);
    expect(r.text).toContain(`Sesión de hoy ajustada: ${p.today.session.title}.`);
    for (const a of p.today.session.adjustments) expect(r.text).toContain(a);
  });

  it('registrar_como_me_siento: la misma sesión que la app cualquier día de la semana', async () => {
    const all = yearOfLogs('2025-11-01', '2026-11-22');
    for (let today = MONDAY; today <= '2026-11-22'; today = addDays(today, 1)) {
      for (const [energia, molestias] of [[1, []], [2, ['rodilla']], [4, []]] as const) {
        // El lunes ya entrenó (sesión hecha); los demás días, solo lo de días anteriores.
        const evs = all.filter((e) => e.localDate < today || (today === MONDAY && e.localDate === today && e.type === 'workout.logged'));
        const store = memoryAssistantStore({ events: evs, entities: ents, today });
        const r = await runTool(store, 'registrar_como_me_siento', { energia, molestias });
        const p = coachPlan(project({ events: await store.events({}), entities: ents, today }), store.now().toISOString());
        expect(r.text, `${today} energía ${energia}`).toContain(`Sesión de hoy ajustada: ${p.today.session.title}.${p.today.session.adjustments.length ? ` ${p.today.session.adjustments.join(' ')}` : ''} [`);
      }
    }
  });

  it('registrar_checkin_semanal y ajustar_entrenador también calculan antes de guardar', async () => {
    const s = mk();
    const c = await runTool(s.store, 'registrar_checkin_semanal', { pesado: 3, energia: 4, animo: 4, semana: '2026-11-09' });
    expect(c.isError).toBeFalsy();
    expect(s.readsAfterWrite()).toEqual([]);
    const w = weekReview(project({ events: await s.store.events({}), entities: ents, today: TODAY }), '2026-11-09');
    expect(c.text).toContain(`Fuerza ${w.strength.done}/${w.strength.target}, cardio ${w.cardio.done}/${w.cardio.target} min, cumplimiento ${w.compliance}%. ${w.verdictText}`);
    const old = await runTool(s.store, 'registrar_checkin_semanal', { pesado: 5, energia: 2, animo: 3, semana: '2026-10-12' });
    const w2 = weekReview(project({ events: await s.store.events({}), entities: ents, today: TODAY }), '2026-10-12');
    expect(old.text).toContain(`Fuerza ${w2.strength.done}/${w2.strength.target}, cardio ${w2.cardio.done}/${w2.cardio.target} min, cumplimiento ${w2.compliance}%. ${w2.verdictText}`);
    const t = spyStore(memoryAssistantStore({ events: history, entities: ents, today: TODAY }));
    const a = await runTool(t.store, 'ajustar_entrenador', { minutos: 60 });
    expect(a.isError).toBeFalsy();
    expect(t.readsAfterWrite()).toEqual([]);
    expect(t.typesRead()).not.toContain('meal.logged');
    const p = await fullPlan(t.store);
    expect(a.text).toContain(`hoy: ${p.today.session.title}`);
  });
});

describe('revisión final: agua, check-in de semanas viejas y cambio de ejercicio contra la sesión de hoy', () => {
  it('registrar_agua lee el total ANTES de guardar y lo cuenta bien', async () => {
    const water = (d: string, glasses: number) => ev('water.logged', d, { glasses });
    const s = spyStore(memoryAssistantStore({ events: [water(TODAY, 3), water(TODAY, 1), water(addDays(TODAY, -1), 5)], entities: entities(ON), today: TODAY }));
    const r = await runTool(s.store, 'registrar_agua', { vasos: 2 });
    expect(r.isError).toBeFalsy();
    expect(s.readsAfterWrite()).toEqual([]);
    expect(s.typesRead()).toEqual(['water.logged']);
    expect(r.text).toContain('llevas 6 ese día');
  });

  it('registrar_checkin_semanal de una semana vieja lee solo el registro diario de esa semana (y da lo mismo)', async () => {
    const ents = entities({ ...ON, startDate: '2025-11-03' });
    const history = yearOfLogs('2025-11-01', addDays(TODAY, -1));
    const s = spyStore(memoryAssistantStore({ events: history, entities: ents, today: TODAY }));
    const r = await runTool(s.store, 'registrar_checkin_semanal', { pesado: 3, energia: 3, animo: 3, semana: '2025-12-01' });
    expect(r.isError).toBeFalsy();
    const daily = s.log.filter((x) => x.op === 'events' && x.q?.types?.includes('meal.logged'));
    expect(daily.length).toBeGreaterThan(0);
    for (const x of daily) expect(x.q!.to! <= '2025-12-07').toBe(true);
    const w = weekReview(project({ events: await s.store.events({}), entities: ents, today: TODAY }), '2025-12-01');
    expect(r.text).toContain(`Fuerza ${w.strength.done}/${w.strength.target}, cardio ${w.cardio.done}/${w.cardio.target} min, cumplimiento ${w.compliance}%. ${w.verdictText}`);
  });

  it('cambiar_ejercicio no dice "Listo" si hoy te molesta una zona que ese ejercicio carga (check-in o cómo te sientes)', async () => {
    const prev = addDays(MONDAY, -7);
    const checkin = ev('coach.checkin', addDays(prev, 6), { weekStart: prev, effort: 3, energy: 3, mood: 3, pain: ['espalda_baja'] });
    const readiness = ev('coach.readiness', MONDAY, { energy: 3, soreness: 0, pain: ['espalda_baja'] });
    for (const events of [[checkin], [readiness]]) {
      const store = memoryAssistantStore({ events, entities: entities(ON), today: MONDAY });
      const before = coachPlan(project({ events, entities: entities(ON), today: MONDAY }), store.now().toISOString());
      expect(before.today.session.exercises.some((e) => e.slot === 'remo')).toBe(true);
      const r = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'remo', ejercicio: 'remo con barra' } });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/espalda baja/i);
      expect(r.text).toMatch(/no lo cambié/);
      expect(((await store.catalog()).find((e) => e.id === TRAINING_SETTINGS_ID)!.data as TrainingSettingsData).coach?.swaps).toBeUndefined();
    }
  });

  it('cambiar_ejercicio no acepta un ejercicio que ya va en otro patrón de la sesión de hoy; sí uno que aplica', async () => {
    // Recorre sesiones distintas (nivel, días, lugar y lo que ya entrenaste en la semana) buscando patrones que comparten
    // opciones con otro ejercicio de la misma sesión (p. ej. femoral y bisagra en pierna).
    let found = 0;
    let applied = 0;
    for (const level of ['sedentario', 'intermedio'] as const)
      for (const days of [[0, 1, 3, 4], [0, 1, 2, 3, 4]])
        for (const where of ['gym', 'casa'] as const)
          for (let k = 0; k < 4; k++) {
            const today = addDays(MONDAY, k);
            const coach = { ...ON, level, days, sessionMinutes: 60, startDate: '2026-09-07' };
            const ents = entities(coach, where);
            // Una sesión hecha cada día anterior de esta semana: hoy toca la k-ésima en orden.
            const events = Array.from({ length: k }, (_, j) => wk(addDays(MONDAY, j), [['plancha', 1, 1]]));
            const store = memoryAssistantStore({ events, entities: ents, today });
            const ex = coachPlan(project({ events, entities: ents, today }), store.now().toISOString()).today.session.exercises;
            const ids = (slot: string) => patternOptions(slot, { where, avoid: [], beginner: false }).map((o) => o.id);
            for (const e of ex)
              for (const f of ex) {
                if (f === e || !ids(e.slot).includes(f.exerciseId)) continue;
                found++;
                const r = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron: e.slot, ejercicio: f.name } });
                const tag = `${level} ${days} ${where} ${today} ${e.slot} → ${f.exerciseId}`;
                expect(r.isError, tag).toBe(true);
                expect(r.text, tag).toMatch(/ya va en la sesión de hoy/);
              }
            expect(((await store.catalog()).find((x) => x.id === TRAINING_SETTINGS_ID)!.data as TrainingSettingsData).coach?.swaps).toBeUndefined();
            // Una alternativa que la app ofrece sí se guarda y aplica hoy.
            const e = ex.find((x) => x.alternatives.length);
            if (!e) continue;
            const alt = e.alternatives[0];
            const okR = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron: e.slot, ejercicio: alt.name } });
            expect(okR.isError, `${e.slot} → ${alt.id}: ${okR.text}`).toBeFalsy();
            const after = coachPlan(project({ events, entities: await store.catalog(), today }), store.now().toISOString());
            expect(after.today.session.exercises.find((x) => x.slot === e.slot)?.exerciseId).toBe(alt.id);
            applied++;
          }
    expect(found).toBeGreaterThan(0);
    expect(applied).toBeGreaterThan(10);
  });
});

describe('¿Cómo fue tu día? con el entrenador', () => {
  it('la revisión Comida aplica desde que armaste el plan, no antes', () => {
    const ents = entities({ ...ON, startDate: MONDAY });
    const ids = (date: string) => reviewDay({ date, today: TODAY, events: [], entities: ents }).checks.map((c) => c.id);
    expect(ids('2026-10-01')).not.toContain('comida');
    expect(ids('2026-11-15')).not.toContain('comida');
    expect(ids(MONDAY)).toContain('comida');
    expect(ids(TODAY)).toContain('comida');
  });

  it('comidas, agua, pasos y cómo te sientes van en Cuerpo y sueño; el agua del día es un solo renglón', () => {
    const events = [
      ev('meal.logged', TODAY, { meal: 'desayuno', text: 'huevos', tags: ['proteina'] }),
      ...Array.from({ length: 6 }, () => ev('water.logged', TODAY, { glasses: 1 })),
      ev('meal.logged', TODAY, { meal: 'comida', text: 'pollo', tags: ['proteina'] }),
      ev('steps.logged', TODAY, { steps: 8000 }),
      ev('coach.readiness', TODAY, { energy: 3, soreness: 0, pain: [] }),
      ev('coach.checkin', TODAY, { weekStart: '2026-11-09', effort: 3, energy: 3, mood: 3, pain: [] }),
    ];
    const r = reviewDay({ date: TODAY, today: TODAY, events, entities: entities(ON) });
    expect(r.logged.map((g) => g.area.id)).toEqual(['cuerpo']);
    const items = r.logged[0].items;
    expect(items.map((i) => i.type)).toEqual(['meal.logged', 'water.logged', 'meal.logged', 'steps.logged', 'coach.readiness', 'coach.checkin']);
    expect(items.find((i) => i.type === 'water.logged')!.text).toBe('6 vasos');
  });
});

describe('zonas de molestia que esta versión no conoce', () => {
  it('se ignoran al proyectar: la foto y el plan no truenan', () => {
    const ents = entities(ON);
    const events = [
      ev('coach.readiness', TODAY, { energy: 3, soreness: 0, pain: ['pie', 'rodilla', 'rodilla'] }),
      ev('coach.checkin', '2026-11-14', { weekStart: '2026-11-09', effort: 3, energy: 3, mood: 3, pain: ['pie'] }),
    ];
    const state = project({ events, entities: ents, today: TODAY });
    expect(state.coach.readiness[TODAY].pain).toEqual(['rodilla']);
    expect(state.coach.checkins['2026-11-09'].pain).toEqual([]);
    expect(() => buildSnapshot(state, ents, { version: 0, computedBy: 'app' })).not.toThrow();
  });

  it('el texto del plan para la IA no truena con una zona desconocida', () => {
    const state = project({ events: [], entities: entities(ON), today: TODAY });
    const p = coachPlan(state, `${TODAY}T18:00:00.000Z`);
    const pie = 'pie' as BodyArea;
    const odd = { ...p, profile: { ...p.profile, limitations: [pie] }, today: { ...p.today, readiness: { energy: 3, soreness: 0, pain: [pie] } } };
    const text = coachPlanLines(odd, true).join('\n');
    expect(text).toMatch(/Molestias o lesiones: pie/);
    expect(text).toMatch(/molestia en pie/);
  });
});
