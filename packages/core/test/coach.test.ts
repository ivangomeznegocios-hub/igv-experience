import { describe, expect, it } from 'vitest';
import {
  BODY_AREAS,
  EVENT_SCHEMAS,
  EXERCISE_BY_ID,
  EXERCISE_LIBRARY,
  GAME_CONFIG,
  JOINT_STRESS,
  MEAL_LIMIT_TAGS,
  MEAL_TAGS,
  PATTERNS,
  SESSION_TEMPLATES,
  TRAINING_SETTINGS_ID,
  addDays,
  buildSnapshot,
  coachPlan,
  nutritionDay,
  nutritionTargets,
  coachProfile,
  planPhase,
  prescribeSession,
  progressionFor,
  stepsTarget,
  weekReview,
  memoryAssistantStore,
  project,
  runAssistantTool,
  type CoachSettings,
  type Entity,
  type GameEvent,
  type SettingsData,
  type WorkoutExercise,
} from '../src';
import { ev, run, seed } from './helpers';

const TODAY = '2026-11-18'; // miércoles
const MONDAY = '2026-11-16';
const NOON = (d: string) => `${d}T18:00:00.000Z`; // 12:00 en CDMX

function entities(coach: CoachSettings | null, settings: Partial<SettingsData> = {}, where: string | null = 'gym'): Entity[] {
  const base = seed.map((e) => (e.id === 'settings' ? { ...e, data: { ...(e.data as SettingsData), ...settings } } : e));
  if (!base.some((e) => e.id === 'settings')) base.push({ id: 'settings', module: 'core', kind: 'settings', data: { ...settings }, sort: 0 } as Entity);
  const ts: Entity = { id: TRAINING_SETTINGS_ID, module: 'training', kind: 'settings', data: { where, ...(coach ? { coach } : {}) }, sort: 0 };
  return [...base, ts];
}

const ON: CoachSettings = { on: true, goal: 'salud', level: 'sedentario', days: [0, 2, 4], sessionMinutes: 45, startDate: '2026-10-05' };
const PROFILE = { heightCm: 175, birthDate: '1990-05-10', name: 'Iván Gómez' };

function wk(date: string, exercises: [string, number, number, number?][], extra: Record<string, unknown> = {}): GameEvent {
  const ex: WorkoutExercise[] = exercises.map(([exerciseId, n, reps, kg]) => ({
    exerciseId,
    name: EXERCISE_BY_ID.get(exerciseId)?.name ?? exerciseId,
    sets: Array.from({ length: n }, () => (kg ? { reps, kg } : { reps })),
  }));
  return ev('workout.logged', date, { kind: 'fuerza', exercises: ex, ...extra });
}
const walk = (date: string, minutes: number) => ev('workout.logged', date, { kind: 'caminata', minutes });
const weight = (date: string, kg: number, extra: Record<string, number> = {}) => ev('body.logged', date, { weightKg: kg, ...extra });

describe('entrenador: datos', () => {
  it('los esquemas aceptan las etiquetas y zonas de types.ts', () => {
    for (const tag of MEAL_TAGS) expect(EVENT_SCHEMAS['meal.logged'].safeParse({ meal: 'comida', tags: [tag] }).success).toBe(true);
    expect(EVENT_SCHEMAS['meal.logged'].safeParse({ meal: 'comida', tags: ['pizza'] }).success).toBe(false);
    expect(EVENT_SCHEMAS['meal.logged'].safeParse({ meal: 'comida', tags: [] }).success).toBe(false);
    expect(EVENT_SCHEMAS['meal.logged'].safeParse({ meal: 'cena', text: 'tacos de pollo' }).success).toBe(true);
    for (const a of BODY_AREAS) {
      expect(EVENT_SCHEMAS['coach.readiness'].safeParse({ energy: 3, pain: [a] }).success).toBe(true);
      expect(EVENT_SCHEMAS['coach.checkin'].safeParse({ weekStart: MONDAY, effort: 3, energy: 3, mood: 3, pain: [a] }).success).toBe(true);
      expect(JOINT_STRESS[a].length).toBeGreaterThan(0);
    }
    expect(EVENT_SCHEMAS['steps.logged'].safeParse({ steps: 8000 }).success).toBe(true);
    expect(EVENT_SCHEMAS['water.logged'].safeParse({ glasses: 0 }).success).toBe(false);
  });

  it('todos los patrones y plantillas usan ejercicios que existen en la biblioteca', () => {
    for (const p of Object.values(PATTERNS)) for (const id of [...p.beginner, ...p.standard]) expect(EXERCISE_BY_ID.has(id), id).toBe(true);
    for (const t of Object.values(SESSION_TEMPLATES)) for (const s of t.slots) expect(PATTERNS[s], s).toBeTruthy();
    for (const ids of Object.values(JOINT_STRESS)) for (const id of ids) expect(EXERCISE_LIBRARY.some((e) => e.id === id), id).toBe(true);
  });

  it('agua se suma, pasos y cómo te sientes: gana el último del día; check-in por semana', () => {
    const s = run(
      [
        ev('water.logged', TODAY, { glasses: 2 }),
        ev('water.logged', TODAY, { glasses: 3 }),
        ev('steps.logged', TODAY, { steps: 3000 }),
        ev('steps.logged', TODAY, { steps: 6500 }),
        ev('coach.readiness', TODAY, { energy: 2, soreness: 1, pain: [] }),
        ev('coach.readiness', TODAY, { energy: 4, soreness: 0, pain: ['rodilla'] }),
        ev('coach.checkin', TODAY, { weekStart: MONDAY, effort: 3, energy: 4, mood: 4 }),
      ],
      TODAY,
    );
    expect(s.coach.water[TODAY]).toBe(5);
    expect(s.coach.steps[TODAY]).toBe(6500);
    expect(s.coach.readiness[TODAY]).toMatchObject({ energy: 4, pain: ['rodilla'] });
    expect(s.coach.checkins[MONDAY]).toMatchObject({ effort: 3, energy: 4 });
  });
});

describe('entrenador: fases del plan (poco a poco)', () => {
  const phaseOf = (events: GameEvent[], coach: CoachSettings = ON) => planPhase(run(events, TODAY, { entities: entities(coach, PROFILE) }));

  it('un sedentario empieza en adaptación y pasa a base tras 2 semanas entrenadas', () => {
    expect(phaseOf([]).key).toBe('adaptacion');
    const a = addDays(MONDAY, -14);
    const b = addDays(MONDAY, -7);
    const w1 = [wk(a, [['prensa', 2, 12, 40]]), wk(addDays(a, 2), [['prensa', 2, 12, 40]])];
    const w2 = [wk(b, [['prensa', 2, 12, 40]]), wk(addDays(b, 2), [['prensa', 2, 12, 40]])];
    const start = { ...ON, startDate: a };
    expect(phaseOf(w1, start).key).toBe('adaptacion');
    expect(phaseOf([...w1, ...w2], start).key).toBe('base');
    // Las mismas dos semanas hace 6 semanas, y luego nada: el plan regresa a adaptación para retomar.
    expect(phaseOf([...w1, ...w2].map((e) => ({ ...e, localDate: addDays(e.localDate, -28) })), { ...ON, startDate: addDays(a, -28) }).key).toBe('adaptacion');
  });

  it('una sola sesión no avanza la semana; semanas vacías seguidas regresan el plan', () => {
    const one = [wk('2026-10-05', [['prensa', 2, 12, 40]]), wk('2026-10-12', [['prensa', 2, 12, 40]])];
    expect(phaseOf(one).trainedWeeks).toBe(0);
    // Principiante (trae 2 semanas) que no entrena 6 semanas: regresa a adaptación.
    expect(phaseOf([], { ...ON, level: 'principiante', startDate: '2026-10-05' }).key).toBe('adaptacion');
    expect(phaseOf([], { ...ON, level: 'principiante', startDate: TODAY }).key).toBe('base');
  });

  it('un check-in con "demasiado" o molestias no avanza y hace ligera la semana siguiente', () => {
    const prev = addDays(MONDAY, -7);
    const s = [wk(prev, [['prensa', 2, 12, 40]]), wk(addDays(prev, 2), [['prensa', 2, 12, 40]]), ev('coach.checkin', addDays(prev, 6), { weekStart: prev, effort: 5, energy: 3, mood: 3 })];
    const p = phaseOf(s, { ...ON, startDate: prev });
    expect(p.trainedWeeks).toBe(0);
    expect(p.light).toBe(true);
    expect(p.reason).toMatch(/ligera/);
  });

  it('en progreso hay una semana de descarga cada N semanas entrenadas', () => {
    const cfg = GAME_CONFIG.coach;
    const start = addDays(MONDAY, -7 * (cfg.deloadEvery - 1));
    const events: GameEvent[] = [];
    for (let w = start; w < MONDAY; w = addDays(w, 7)) events.push(wk(w, [['prensa', 3, 10, 60]]), wk(addDays(w, 2), [['prensa', 3, 10, 60]]));
    expect(phaseOf(events, { ...ON, level: 'intermedio', startDate: start }).key).toBe('descarga');
  });
});

describe('entrenador: la sesión que te toca', () => {
  const base = (over: Partial<Parameters<typeof prescribeSession>[1]> = {}) => ({
    phase: planPhase(run([], TODAY, { entities: entities(ON, PROFILE) })),
    goal: 'salud' as const,
    level: 'sedentario' as const,
    where: 'gym' as const,
    avoid: [],
    sessionMinutes: 60,
    favorites: [],
    swaps: {},
    records: {},
    today: TODAY,
    ...over,
  });

  it('adaptación: 2 series, rangos altos, lejos del fallo y ejercicios fáciles de aprender', () => {
    const s = prescribeSession('full_a', base());
    const P = GAME_CONFIG.coach.phases.adaptacion;
    expect(s.exercises.length).toBeLessThanOrEqual(P.maxExercises);
    expect(s.exercises[0].exerciseId).toBe('sentadilla-goblet');
    for (const e of s.exercises) {
      expect(e.sets).toBe(2);
      expect(e.rir).toEqual([P.rir[0], P.rir[1]]);
      expect(e.cue.length).toBeGreaterThan(10);
      expect(e.progression).toBe('nuevo');
    }
    expect(s.warmup.length).toBeGreaterThan(0);
  });

  it('en casa solo usa peso corporal, mancuernas, bandas o kettlebell', () => {
    const s = prescribeSession('torso_a', base({ where: 'casa' }));
    expect(s.exercises.length).toBeGreaterThan(2);
    for (const e of s.exercises) expect(['corporal', 'mancuerna', 'banda', 'kettlebell']).toContain(e.equipment);
  });

  it('con molestias evita los ejercicios que cargan esa zona', () => {
    for (const area of BODY_AREAS) {
      for (const key of Object.keys(SESSION_TEMPLATES) as (keyof typeof SESSION_TEMPLATES)[]) {
        const s = prescribeSession(key, base({ avoid: [area], level: 'intermedio' }));
        for (const e of s.exercises) expect(JOINT_STRESS[area], `${area} ${e.exerciseId}`).not.toContain(e.exerciseId);
      }
    }
  });

  it('la sesión cabe en tu tiempo (siempre lo principal)', () => {
    const short = prescribeSession('full_a', base({ sessionMinutes: 20 }));
    const long = prescribeSession('full_a', base({ sessionMinutes: 90 }));
    expect(short.exercises.length).toBe(3);
    expect(long.exercises.length).toBeGreaterThan(short.exercises.length);
  });

  it('el ejercicio que cambiaste se respeta y lo que ya usas va primero', () => {
    expect(prescribeSession('full_a', base({ swaps: { sentadilla: 'prensa' } })).exercises[0].exerciseId).toBe('prensa');
    expect(prescribeSession('full_a', base({ favorites: ['sentadilla'] })).exercises[0].exerciseId).toBe('sentadilla');
  });

  it('día pesado ("light"): una serie menos y más reserva', () => {
    const n = prescribeSession('full_a', base({ phase: { ...base().phase, key: 'base' } }));
    const l = prescribeSession('full_a', base({ phase: { ...base().phase, key: 'base' }, light: true }));
    expect(l.exercises[0].sets).toBe(n.exercises[0].sets - 1);
    expect(l.exercises[0].rir[0]).toBe(n.exercises[0].rir[0] + 1);
  });
});

describe('entrenador: sobrecarga progresiva (doble progresión)', () => {
  const press = EXERCISE_BY_ID.get('press-banca')!;
  const goblet = EXERCISE_BY_ID.get('sentadilla-goblet')!;
  const rx = { reps: [8, 12] as [number, number], seconds: null, rir: [2, 3] as [number, number], compound: true };
  const rec = (sets: { reps?: number; kg?: number }[], lastDate = '2026-11-14') => ({ exerciseId: 'x', name: 'x', measure: 'peso' as const, sessions: 3, firstDate: '2026-10-01', lastDate, best: {}, history: [], lastSets: sets });

  it('tope del rango en todas las series → sube el peso', () => {
    const p = progressionFor(press, rec([{ reps: 12, kg: 60 }, { reps: 12, kg: 60 }, { reps: 12, kg: 60 }]), rx, TODAY);
    expect(p.progression).toBe('subir');
    expect(p.targetKg).toBe(60 + GAME_CONFIG.coach.increments.torso);
    expect(p.targetReps).toBe(8);
    const g = progressionFor(goblet, rec([{ reps: 12, kg: 16 }, { reps: 12, kg: 16 }]), rx, TODAY);
    expect(g.targetKg).toBe(16 + GAME_CONFIG.coach.increments.mancuerna);
  });

  it('abajo del tope → mismo peso y una repetición más', () => {
    const p = progressionFor(press, rec([{ reps: 10, kg: 60 }, { reps: 9, kg: 60 }, { reps: 8, kg: 60 }]), rx, TODAY);
    expect(p).toMatchObject({ progression: 'repetir', targetKg: 60, targetReps: 9 });
  });

  it('mucho tiempo sin hacerlo → retoma con menos peso; primera vez → por reserva', () => {
    const p = progressionFor(press, rec([{ reps: 10, kg: 60 }], '2026-09-01'), rx, TODAY);
    expect(p.progression).toBe('retomar');
    expect(p.targetKg!).toBeLessThan(60);
    expect(progressionFor(press, undefined, rx, TODAY)).toMatchObject({ progression: 'nuevo', targetKg: null });
  });
});

describe('entrenador: el plan del día', () => {
  const plan = (events: GameEvent[], coach: CoachSettings | null = ON, today = TODAY, hourUtc = '18:00') =>
    coachPlan(run(events, today, { entities: entities(coach, PROFILE) }), `${today}T${hourUtc}:00.000Z`);

  it('sin configurar: te invita a armar tu plan', () => {
    const p = plan([], null);
    expect(p.profile.configured).toBe(false);
    expect(p.brief.actions[0].kind).toBe('arrancar');
  });

  it('día de fuerza: te da la sesión con ejercicios y te anima', () => {
    const p = plan([]);
    expect(p.today.session.kind).toBe('fuerza');
    expect(p.today.session.exercises.length).toBeGreaterThan(2);
    expect(p.brief.mood).toMatch(/animo|serio/);
    expect(p.brief.actions.some((a) => a.kind === 'sesion')).toBe(true);
    expect(p.week.filter((d) => d.kind === 'fuerza').map((d) => d.weekday)).toEqual([0, 2, 4]);
    expect(p.week.some((d) => d.kind === 'descanso')).toBe(true);
  });

  it('ya entrenaste hoy: te felicita y te dice la siguiente', () => {
    const p = plan([wk(MONDAY, [['prensa', 2, 12, 40]]), wk(TODAY, [['prensa', 2, 12, 40]])]);
    expect(p.today.strengthDone).toBe(true);
    expect(p.brief.mood).toBe('feliz');
    expect(p.today.next).not.toBeNull();
    expect(p.targets.strength).toEqual({ done: 2, target: 3 });
  });

  it('dormiste muy poco: recuperación en vez de pesas', () => {
    const p = plan([ev('checkin.morning', TODAY, { sleepHours: 4 })]);
    expect(p.today.session.kind).toBe('recuperacion');
    expect(p.brief.mood).toBe('atento');
  });

  it('dormiste poco o vienes cansado: sesión más ligera', () => {
    const normal = plan([]);
    const tired = plan([ev('checkin.morning', TODAY, { sleepHours: 5.5 })]);
    expect(tired.today.session.kind).toBe('fuerza');
    expect(tired.today.session.exercises[0].sets).toBe(Math.max(1, normal.today.session.exercises[0].sets - 1));
    expect(tired.today.session.adjustments.join(' ')).toMatch(/5.5 h/);
  });

  it('te duele algo hoy: lo quita de la sesión y te sugiere ir al médico si persiste', () => {
    const p = plan([ev('coach.readiness', TODAY, { energy: 4, soreness: 0, pain: ['rodilla'] })], { ...ON, level: 'intermedio' });
    for (const e of p.today.session.exercises) expect(JOINT_STRESS.rodilla).not.toContain(e.exerciseId);
    expect(p.today.session.adjustments.join(' ')).toMatch(/médico|fisio/);
  });

  it('músculos clave aún recuperándose: cardio hoy y la sesión mañana', () => {
    // Martes no es día de fuerza, pero vas atrasado (lunes sin entrenar). Ayer (lunes)... se entrenó pierna fuerte el martes temprano.
    const tue = addDays(MONDAY, 1);
    const p = coachPlan(
      run([wk(tue, [['prensa', 4, 10, 80], ['press-mancuernas', 4, 10, 20], ['remo-maquina', 4, 10, 40]], {}, )], TODAY, { entities: entities(ON, PROFILE) }),
      `${TODAY}T12:00:00.000Z`,
    );
    expect(p.today.session.kind).toBe('cardio');
    expect(p.today.session.adjustments.join(' ')).toMatch(/recuper/);
  });

  it('día de cardio: caminata con minutos y sin impacto si te molesta la rodilla', () => {
    const p = plan([], { ...ON, limitations: ['rodilla'] }, addDays(MONDAY, 1));
    // Martes: ya entrenaste el lunes no, así que vas atrasado → fuerza; marca el lunes hecho.
    const q = plan([wk(MONDAY, [['prensa', 2, 12, 40]])], { ...ON, limitations: ['rodilla'] }, addDays(MONDAY, 1));
    expect(q.today.session.kind).toBe('cardio');
    expect(q.today.session.cardio!.exerciseId).not.toBe('correr');
    expect(p.today.session.kind).toBe('fuerza');
  });

  it('metas de la semana: cardio, pasos, sueño y nutrición', () => {
    const p = plan([walk(MONDAY, 30), ev('steps.logged', MONDAY, { steps: 6000 }), ev('checkin.morning', TODAY, { sleepHours: 7.5 }), weight('2026-11-10', 92)]);
    expect(p.targets.cardio.done).toBe(30);
    expect(p.targets.cardio.target).toBe(GAME_CONFIG.coach.phases.adaptacion.cardioMinutes);
    expect(p.targets.steps.avg).toBe(6000);
    expect(p.targets.sleep.lastNight).toBe(7.5);
    expect(p.nutrition.targets.proteinG).toBeGreaterThan(0);
  });

  it('pide check-in el fin de semana y medidas si no te has pesado en una semana', () => {
    const sat = addDays(MONDAY, 5);
    const p = plan([weight('2026-11-01', 90)], ON, sat);
    expect(p.checkinWeek).toBe(MONDAY);
    expect(p.brief.actions.map((a) => a.kind)).toEqual(expect.arrayContaining(['checkin', 'medidas']));
    const q = plan([weight(sat, 90), ev('coach.checkin', sat, { weekStart: MONDAY, effort: 3, energy: 3, mood: 3 })], ON, sat);
    expect(q.checkinWeek).toBeNull();
    expect(q.weight.measureDue).toBe(false);
  });
});

describe('entrenador: nutrición', () => {
  const prof = (w: number, h = 175, goal: CoachSettings['goal'] = 'salud') =>
    coachProfile(run([weight(TODAY, w)], TODAY, { entities: entities({ ...ON, goal }, { heightCm: h, birthDate: '1990-05-10' }) }));

  it('calorías con Mifflin-St Jeor y déficit moderado al bajar grasa', () => {
    const t = nutritionTargets(prof(80), 3);
    const bmr = Math.round(10 * 80 + 6.25 * 175 - 5 * 36 + 5);
    expect(t.bmr).toBe(bmr);
    expect(t.tdee).toBe(Math.round(bmr * GAME_CONFIG.coach.nutrition.activity[1]));
    const lose = nutritionTargets(prof(80, 175, 'perder_grasa'), 3);
    expect(lose.kcal!).toBeLessThan(t.kcal!);
    expect(t.kcal! - lose.kcal!).toBeLessThanOrEqual(GAME_CONFIG.coach.nutrition.maxDeficit + 50);
  });

  it('proteína 1.6 g/kg y, con sobrepeso, sobre el peso de referencia (IMC 25)', () => {
    expect(nutritionTargets(prof(70), 3).proteinG).toBe(Math.round((70 * 1.6) / 5) * 5);
    const heavy = nutritionTargets(prof(120), 3);
    expect(heavy.proteinG).toBe(Math.round((25 * 1.75 ** 2 * 1.6) / 5) * 5);
    expect(heavy.notes.join(' ')).toMatch(/referencia/);
  });

  it('el día de comida se califica por hábitos y te dice qué falta', () => {
    const s = run(
      [
        ev('meal.logged', TODAY, { meal: 'desayuno', tags: ['proteina', 'fruta'] }),
        ev('meal.logged', TODAY, { meal: 'comida', tags: ['proteina', 'verduras', 'integrales'] }),
        ev('water.logged', TODAY, { glasses: 4 }),
      ],
      TODAY,
    );
    const t = nutritionTargets(coachProfile(s), 3);
    const d = nutritionDay(s.coach, TODAY, t);
    expect(d.proteinMeals).toBe(2);
    expect(d.score!).toBeGreaterThan(40);
    expect(d.score!).toBeLessThan(100);
    expect(d.tip).toMatch(/proteína/);
    expect(nutritionDay(s.coach, addDays(TODAY, -1), t).score).toBeNull();
    const junk = run([ev('meal.logged', TODAY, { meal: 'cena', tags: ['refresco', 'frito', 'ultraprocesado'] })], TODAY);
    expect(nutritionDay(junk.coach, TODAY, t).checks.find((c) => c.key === 'limitar')!.done).toBe(false);
  });

  it('pasos: tu promedio + 1,000 dentro de los límites; sin datos, el de base', () => {
    const s = run([1, 2, 3, 4].map((i) => ev('steps.logged', addDays(TODAY, -i), { steps: 4000 })), TODAY);
    expect(stepsTarget(s.coach, TODAY, {}, 'salud')).toBe(GAME_CONFIG.coach.steps.min);
    const t = run([1, 2, 3].map((i) => ev('steps.logged', addDays(TODAY, -i), { steps: 6800 })), TODAY);
    expect(stepsTarget(t.coach, TODAY, {}, 'salud')).toBe(8000);
    expect(stepsTarget(run([], TODAY).coach, TODAY, {}, 'salud')).toBe(GAME_CONFIG.coach.steps.default);
    expect(stepsTarget(run([], TODAY).coach, TODAY, { stepsGoal: 12000 }, 'salud')).toBe(12000);
  });
});

describe('entrenador: semana pasada y reglas de oro', () => {
  it('la revisión de la semana dice si subir, mantener o bajar', () => {
    const prev = addDays(MONDAY, -7);
    const good = [wk(prev, [['prensa', 2, 12, 40]]), wk(addDays(prev, 2), [['prensa', 2, 12, 40]]), wk(addDays(prev, 4), [['prensa', 2, 12, 40]]), walk(addDays(prev, 1), 45), walk(addDays(prev, 3), 45)];
    const s = run(good, TODAY, { entities: entities({ ...ON, startDate: prev }, PROFILE) });
    const r = weekReview(s, prev);
    expect(r.strength).toEqual({ done: 3, target: 3 });
    expect(r.verdict).toBe('subir');
    const none = weekReview(run([], TODAY, { entities: entities({ ...ON, startDate: prev }, PROFILE) }), prev);
    expect(none.verdict).toBe('mantener');
    const hurt = weekReview(run([...good, ev('coach.checkin', addDays(prev, 6), { weekStart: prev, effort: 3, energy: 3, mood: 3, pain: ['hombro'] })], TODAY, { entities: entities({ ...ON, startDate: prev }, PROFILE) }), prev);
    expect(hurt.verdict).toBe('bajar');
  });

  it('registrar comida, agua, pasos, cómo te sientes o check-ins nunca cambia la XP ni los atributos', () => {
    let seedN = 7;
    const rnd = () => ((seedN = (seedN * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const base: GameEvent[] = [wk(MONDAY, [['prensa', 3, 10, 60]]), ev('mission.completed', MONDAY, { missionId: 'daily-entrenar', title: 'Entrenar', size: 'media', attribute: 'fuerza', kind: 'daily' })];
    const before = run(base, TODAY);
    for (let i = 0; i < 40; i++) {
      const d = addDays(TODAY, -Math.floor(rnd() * 20));
      const pick = Math.floor(rnd() * 5);
      const extra =
        pick === 0
          ? ev('meal.logged', d, { meal: 'comida', tags: [MEAL_TAGS[Math.floor(rnd() * MEAL_TAGS.length)]], proteinG: Math.round(rnd() * 60) })
          : pick === 1
            ? ev('water.logged', d, { glasses: 1 + Math.floor(rnd() * 5) })
            : pick === 2
              ? ev('steps.logged', d, { steps: Math.floor(rnd() * 20000) })
              : pick === 3
                ? ev('coach.readiness', d, { energy: 1 + Math.floor(rnd() * 5), soreness: Math.floor(rnd() * 4), pain: [] })
                : ev('coach.checkin', d, { weekStart: MONDAY, effort: 1 + Math.floor(rnd() * 5), energy: 3, mood: 3 });
      base.push(extra);
      const after = run(base, TODAY);
      expect(after.xp.total).toBe(before.xp.total);
      for (const a of Object.keys(before.attributes.values) as (keyof typeof before.attributes.values)[]) expect(after.attributes.values[a]).toEqual(before.attributes.values[a]);
    }
    expect(coachPlan(run(base, TODAY, { entities: entities(ON, PROFILE) }), NOON(TODAY)).brief.message.length).toBeGreaterThan(10);
  });
});

describe('entrenador: herramientas de IA', () => {
  const mk = (events: GameEvent[] = [], ents: Entity[] = entities(null, PROFILE)) => memoryAssistantStore({ events, entities: ents, today: TODAY });
  const runTool = (store: ReturnType<typeof mk>, name: string, input: unknown = {}, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });

  it('ajustar_entrenador arma el plan (objetivo, días, molestias, cambio de ejercicio) y se puede deshacer', async () => {
    const store = mk();
    const r = await runTool(store, 'ajustar_entrenador', { objetivo: 'perder_grasa', nivel: 'sedentario', dias: ['lunes', 'miercoles', 'viernes'], minutos: 40, molestias: ['rodilla'], cambiar_ejercicio: { patron: 'press_horizontal', ejercicio: 'lagartijas' } });
    expect(r.isError).toBeFalsy();
    expect(r.text).toMatch(/plan activado/);
    const ts = (await store.catalog()).find((e) => e.id === TRAINING_SETTINGS_ID)!;
    expect((ts.data as { coach: CoachSettings }).coach).toMatchObject({ on: true, goal: 'perder_grasa', days: [0, 2, 4], sessionMinutes: 40, limitations: ['rodilla'], swaps: { press_horizontal: 'lagartijas' }, startDate: TODAY });
    expect((r.refs!.entities[0].prev!.data as { coach?: unknown }).coach).toBeUndefined();
    const bad = await runTool(store, 'ajustar_entrenador', { cambiar_ejercicio: { patron: 'volar', ejercicio: 'sentadilla' } });
    expect(bad.isError).toBe(true);
    const ro = await runTool(store, 'ajustar_entrenador', { minutos: 30 }, false);
    expect(ro.isError).toBe(true);
  });

  it('ver_plan_entrenador da la sesión de hoy con series, reps, reserva y descanso', async () => {
    const store = mk([weight('2026-11-15', 95)], entities(ON, PROFILE));
    const r = await runTool(store, 'ver_plan_entrenador', {}, false);
    expect(r.text).toMatch(/Cuerpo completo/);
    expect(r.text).toMatch(/reserva/);
    expect(r.text).toMatch(/descanso/);
    expect(r.text).toMatch(/IMC/);
    expect(r.text).toMatch(/Por qué el plan es así/);
  });

  it('registrar_comida, agua, pasos, cómo me siento y check-in crean sus registros sin XP', async () => {
    const store = mk([], entities(ON, PROFILE));
    const before = project({ events: await store.events({}), entities: await store.catalog(), today: TODAY }).xp.total;
    const c = await runTool(store, 'registrar_comida', { tipo: 'comida', descripcion: 'Pechuga con nopales y arroz', etiquetas: ['proteina', 'verduras', 'integrales'], proteina_g: 40 });
    expect(c.isError).toBeFalsy();
    expect(c.text).toMatch(/\/100/);
    expect((await runTool(store, 'registrar_agua', { vasos: 3 })).text).toMatch(/llevas 3/);
    expect((await runTool(store, 'registrar_pasos', { pasos: 8500 })).text).toMatch(/8,500/);
    const s = await runTool(store, 'registrar_como_me_siento', { energia: 1 });
    expect(s.text).toMatch(/Recuperación/);
    const ci = await runTool(store, 'registrar_checkin_semanal', { pesado: 3, energia: 4, animo: 4, logros: 'Fui 3 veces' });
    expect(ci.isError).toBeFalsy();
    const evs = await store.events({});
    expect(evs.map((e) => e.type)).toEqual(expect.arrayContaining(['meal.logged', 'water.logged', 'steps.logged', 'coach.readiness', 'coach.checkin']));
    expect(project({ events: evs, entities: await store.catalog(), today: TODAY }).xp.total).toBe(before);
    const n = await runTool(store, 'ver_nutricion', { dias: 2 }, false);
    expect(n.text).toMatch(/Pechuga con nopales/);
    expect(n.text).toMatch(/proteína/);
  });

  it('el panorama del Coach incluye la sección del entrenador', async () => {
    const store = mk([], entities(ON, PROFILE));
    const r = await runTool(store, 'ver_resumen', {}, false);
    expect(r.text).toContain('## Entrenador personal');
  });
});

describe('entrenador: revisión del motor', () => {
  const rec = (id: string, sets: { reps?: number; kg?: number; sec?: number }[], lastDate = '2026-11-14') => ({
    exerciseId: id,
    name: id,
    measure: EXERCISE_BY_ID.get(id)!.measure,
    sessions: 3,
    firstDate: '2026-10-01',
    lastDate,
    best: {},
    history: [],
    lastSets: sets,
  });
  const phase = (over: Partial<ReturnType<typeof planPhase>> = {}) => ({ ...planPhase(run([], TODAY, { entities: entities(ON, PROFILE) })), ...over });
  const ctx = (over: Partial<Parameters<typeof prescribeSession>[1]> = {}): Parameters<typeof prescribeSession>[1] => ({
    phase: phase(),
    goal: 'salud',
    level: 'intermedio',
    where: 'gym',
    avoid: [],
    sessionMinutes: 120,
    favorites: [],
    swaps: {},
    records: {},
    today: TODAY,
    ...over,
  });
  const plan = (events: GameEvent[], coach: CoachSettings = ON, today = TODAY, at = `${today}T18:00:00.000Z`) => coachPlan(run(events, today, { entities: entities(coach, PROFILE) }), at);
  const exOf = (s: ReturnType<typeof prescribeSession>, id: string) => s.exercises.find((e) => e.exerciseId === id)!;

  it('semana ligera: la fase actual con una serie menos y una rep más de reserva (mismo cardio, rangos y días)', () => {
    const prev = addDays(MONDAY, -7);
    const week = [wk(prev, [['prensa', 2, 12, 40]]), wk(addDays(prev, 2), [['prensa', 2, 12, 40]])];
    const ci = (effort: number) => ev('coach.checkin', addDays(prev, 6), { weekStart: prev, effort, energy: 3, mood: 3 });
    const normal = plan([...week, ci(3)], { ...ON, startDate: prev });
    const light = plan([...week, ci(5)], { ...ON, startDate: prev });
    expect(normal.phase.key).toBe('adaptacion');
    expect(light.phase).toMatchObject({ key: 'adaptacion', light: true });
    expect(light.targets.cardio.target).toBe(normal.targets.cardio.target);
    expect(light.strengthDays).toEqual(normal.strengthDays);
    expect(light.why.join(' ')).toMatch(/no subes/);
    const n = normal.today.session.exercises;
    const l = light.today.session.exercises;
    expect(l.map((e) => e.exerciseId)).toEqual(n.map((e) => e.exerciseId));
    l.forEach((e, i) => {
      expect(e.sets).toBe(Math.max(1, n[i].sets - 1));
      expect(e.rir).toEqual([n[i].rir[0] + 1, n[i].rir[1] + 1]);
      expect(e.reps).toEqual(n[i].reps);
    });
    // Intermedio en progreso con 4 días: la semana ligera conserva los 4 días.
    const four = { ...ON, level: 'intermedio' as const, days: [0, 1, 3, 4], startDate: prev };
    const p4 = plan([...week, ci(5)], four);
    expect(p4.phase).toMatchObject({ key: 'progreso', light: true });
    expect(p4.strengthDays).toEqual([0, 1, 3, 4]);
    expect(p4.why.join(' ')).toMatch(new RegExp(`${GAME_CONFIG.coach.phases.progreso.sets - 1} series`));
  });

  it('semana ligera, descarga o día ligero: nunca sube el peso ni pide más reps que la vez pasada', () => {
    const sq = { sentadilla: rec('sentadilla', [{ reps: 10, kg: 60 }, { reps: 10, kg: 60 }, { reps: 10, kg: 60 }]) };
    const sw = { sentadilla: 'sentadilla' };
    const normal = exOf(prescribeSession('full_a', ctx({ phase: phase({ key: 'base' }), records: sq, swaps: sw })), 'sentadilla');
    expect(normal).toMatchObject({ progression: 'repetir', targetKg: 60, targetReps: 11 });
    const cases = [
      prescribeSession('full_a', ctx({ phase: phase({ key: 'base', light: true }), records: sq, swaps: sw })),
      prescribeSession('full_a', ctx({ phase: phase({ key: 'descarga' }), records: sq, swaps: sw })),
      prescribeSession('full_a', ctx({ phase: phase({ key: 'adaptacion', light: true }), records: sq, swaps: sw })),
      prescribeSession('full_a', ctx({ phase: phase({ key: 'base' }), light: true, records: { sentadilla: rec('sentadilla', [{ reps: 12, kg: 60 }, { reps: 12, kg: 60 }]) }, swaps: sw })),
    ];
    for (const s of cases) {
      const e = exOf(s, 'sentadilla');
      expect(e.progression).not.toBe('subir');
      expect(e.targetKg!).toBeLessThanOrEqual(60);
      expect(e.targetReps!).toBeLessThanOrEqual(12);
      expect(e.reps![0]).toBeLessThanOrEqual(e.targetReps!);
      expect(e.note).not.toMatch(/sube/);
    }
    // La descarga baja un poco el peso.
    expect(exOf(cases[1], 'sentadilla').targetKg!).toBeLessThan(60);
    // Objetivo fuerza: tras 3×5 con 100 kg, la descarga no pide 8+ reps con 4–5 en reserva.
    const strong = { sentadilla: rec('sentadilla', [{ reps: 5, kg: 100 }, { reps: 5, kg: 100 }, { reps: 5, kg: 100 }]) };
    const d = exOf(prescribeSession('full_a', ctx({ goal: 'fuerza', phase: phase({ key: 'descarga' }), records: strong, swaps: sw })), 'sentadilla');
    expect(d.progression).not.toBe('subir');
    expect(d.targetKg!).toBeLessThan(100);
    expect(d.targetReps!).toBeLessThanOrEqual(5);
    expect(d.reps![0]).toBeLessThanOrEqual(d.targetReps!);
    // Corporales: en semana ligera no sube la dificultad.
    const push = { lagartijas: rec('lagartijas', [{ reps: 12 }, { reps: 12 }]) };
    const pl = exOf(prescribeSession('full_a', ctx({ where: 'casa', phase: phase({ key: 'base', light: true }), records: push, swaps: { press_horizontal: 'lagartijas' } })), 'lagartijas');
    expect(pl.progression).not.toBe('subir');
    expect(pl.targetReps!).toBeLessThanOrEqual(12);
  });

  it('con más días de los que pide la fase, los reparte (Lun–Vie con máximo 3 → Lun, Mié, Vie)', () => {
    expect(plan([], { ...ON, days: [0, 1, 2, 3, 4] }).strengthDays).toEqual([0, 2, 4]);
    expect(plan([], { ...ON, days: [0, 1, 2, 4] }).strengthDays).toEqual([0, 2, 4]);
    expect(plan([], { ...ON, days: [1, 2, 3, 4, 5, 6] }).strengthDays).toEqual([1, 3, 5]);
    const four = plan([], { ...ON, days: [0, 1, 2, 3] }).strengthDays;
    expect(four).toHaveLength(3);
    expect(four.some((d, i) => i >= 2 && four[i - 1] === d - 1 && four[i - 2] === d - 2)).toBe(false);
    // En base (máx. 4) con Lun–Vie: torso/pierna sin tres días seguidos.
    const base = plan([], { ...ON, level: 'principiante', startDate: MONDAY, days: [0, 1, 2, 3, 4] });
    expect(base.phase.key).toBe('base');
    expect(base.strengthDays).toEqual([0, 1, 3, 4]);
  });

  it('el día libre sigue libre aunque falte cardio (la caminata es opcional)', () => {
    const sun = addDays(MONDAY, 6);
    const p = plan([wk(MONDAY, [['prensa', 2, 12, 40]]), wk(TODAY, [['prensa', 2, 12, 40]]), wk(addDays(MONDAY, 4), [['prensa', 2, 12, 40]])], ON, sun);
    expect(p.targets.cardio.done).toBe(0);
    expect(p.week[6].kind).toBe('descanso');
    expect(p.today.session.kind).toBe('descanso');
    expect(p.brief.message).not.toMatch(/Hoy toca/);
  });

  it('proteína: anotar los gramos de una comida nunca baja el día', () => {
    const t = nutritionTargets(coachProfile(run([weight(TODAY, 75)], TODAY, { entities: entities(ON, PROFILE) })), 3);
    const meals = (g: number | null) =>
      run(
        [
          ev('meal.logged', TODAY, { meal: 'desayuno', tags: ['proteina', 'verduras'] }),
          ev('meal.logged', TODAY, { meal: 'comida', tags: ['proteina', 'verduras'] }),
          ev('meal.logged', TODAY, { meal: 'cena', tags: ['proteina'], ...(g ? { proteinG: g } : {}) }),
          ev('water.logged', TODAY, { glasses: 5 }),
        ],
        TODAY,
      ).coach;
    const without = nutritionDay(meals(null), TODAY, t);
    const withG = nutritionDay(meals(30), TODAY, t);
    expect(without.checks.find((c) => c.key === 'proteina')!.done).toBe(true);
    expect(withG.checks.find((c) => c.key === 'proteina')!.done).toBe(true);
    expect(withG.score!).toBeGreaterThanOrEqual(without.score!);
    expect(withG.tip ?? '').not.toMatch(/Te falta proteína/);
    // Gramos suficientes cuentan aunque las comidas no traigan la etiqueta.
    const grams = run([ev('meal.logged', TODAY, { meal: 'comida', tags: ['verduras'], proteinG: t.proteinG! })], TODAY).coach;
    expect(nutritionDay(grams, TODAY, t).checks.find((c) => c.key === 'proteina')!.done).toBe(true);
    // Propiedad: agregar gramos a cualquier comida nunca baja el puntaje ni desmarca la proteína.
    let seedN = 11;
    const rnd = () => ((seedN = (seedN * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 60; i++) {
      const n = 1 + Math.floor(rnd() * 4);
      const base = Array.from({ length: n }, () => ({ meal: 'comida', tags: [MEAL_TAGS[Math.floor(rnd() * MEAL_TAGS.length)]] }));
      const k = Math.floor(rnd() * n);
      const g = Math.round(rnd() * 80) + 1;
      const a = nutritionDay(run(base.map((m) => ev('meal.logged', TODAY, m)), TODAY).coach, TODAY, t);
      const b = nutritionDay(run(base.map((m, j) => ev('meal.logged', TODAY, j === k ? { ...m, proteinG: g } : m)), TODAY).coach, TODAY, t);
      expect(b.score!).toBeGreaterThanOrEqual(a.score!);
      if (a.checks[0].done) expect(b.checks[0].done).toBe(true);
      // Y anotar una comida más sin ultraprocesados ni refresco tampoco lo baja.
      const clean = MEAL_TAGS.filter((x) => !MEAL_LIMIT_TAGS.includes(x));
      const c = nutritionDay(run([...base, { meal: 'cena', tags: [clean[Math.floor(rnd() * clean.length)]] }].map((m) => ev('meal.logged', TODAY, m)), TODAY).coach, TODAY, t);
      expect(c.score!).toBeGreaterThanOrEqual(a.score!);
    }
  });

  it('fuerza y caminata el mismo día cuentan como un día de entreno', () => {
    const a = addDays(MONDAY, -14);
    const b = addDays(MONDAY, -7);
    const phaseOf = (events: GameEvent[]) => planPhase(run(events, TODAY, { entities: entities({ ...ON, startDate: a }, PROFILE) }));
    expect(phaseOf([wk(b, [['prensa', 2, 12, 40]]), walk(b, 20)]).trainedWeeks).toBe(0);
    expect(phaseOf([wk(a, [['prensa', 2, 12, 40]]), walk(a, 20), wk(b, [['prensa', 2, 12, 40]]), walk(b, 20)]).key).toBe('adaptacion');
    // Fuerza un día y caminata otro día sí cuentan como dos.
    expect(phaseOf([wk(b, [['prensa', 2, 12, 40]]), walk(addDays(b, 1), 20)]).trainedWeeks).toBe(1);
  });

  it('músculos en recuperación: el texto dice el día real y "siguiente" es ese mismo día', () => {
    const sun = addDays(MONDAY, -1);
    const legs = ev(
      'workout.logged',
      sun,
      { kind: 'fuerza', exercises: ([['prensa', 80], ['sentadilla-goblet', 24], ['hip-thrust', 60]] as const).map(([id, kg]) => ({ exerciseId: id, name: id, sets: Array.from({ length: 4 }, () => ({ reps: 10, kg })) })) },
      { occurredAt: `${sun}T23:00:00.000Z` },
    );
    const mon = plan([legs], ON, MONDAY, `${MONDAY}T15:00:00.000Z`);
    expect(mon.today.session.kind).toBe('cardio');
    const msg = mon.today.session.adjustments.join(' ');
    expect(msg).not.toMatch(/mañana/);
    expect(msg).toMatch(/miércoles/);
    expect(mon.today.next).toMatchObject({ date: TODAY, key: 'full_a' });
    const tue = addDays(MONDAY, 1);
    const t = plan([legs], ON, tue, `${tue}T15:00:00.000Z`);
    expect(t.today.session.kind).toBe('cardio');
    expect(t.today.session.adjustments.join(' ')).toMatch(/mañana/);
    expect(t.today.next).toMatchObject({ date: TODAY, key: 'full_a' });
    // Listos más tarde hoy: la sesión es hoy mismo.
    const early = plan([legs], ON, TODAY, `${TODAY}T10:00:00.000Z`);
    expect(early.today.session.kind).toBe('cardio');
    expect(early.today.session.adjustments.join(' ')).toMatch(/a partir de las/);
    expect(early.today.next).toMatchObject({ date: TODAY, key: 'full_a' });
    // La semana dice lo mismo: el lunes se recorrió y la sesión queda el miércoles.
    expect(mon.week[2].sessionKey).toBe('full_a');
    expect(mon.week[4].sessionKey).toBe('full_b');
  });

  it('la semana sigue el orden real: si faltas, hoy y lo que viene se recorren', () => {
    const p = plan([]);
    expect(p.week[2].sessionKey).toBe(p.today.session.key);
    expect(p.week[4].sessionKey).toBe(p.today.next!.key);
    expect(p.week[0].sessionKey).toBe('full_a'); // los días pasados quedan fijos
    // Solo entrenaste el miércoles y hoy es viernes.
    const fri = addDays(MONDAY, 4);
    const q = plan([wk(TODAY, [['prensa', 2, 12, 40]])], ON, fri);
    expect(q.today.session.kind).toBe('fuerza');
    expect(q.week[4].sessionKey).toBe(q.today.session.key);
  });

  it('un día con solo agua no suma "sin ultraprocesados"', () => {
    const t = nutritionTargets(coachProfile(run([weight(TODAY, 75)], TODAY, { entities: entities(ON, PROFILE) })), 3);
    const d = nutritionDay(run([ev('water.logged', TODAY, { glasses: 4 })], TODAY).coach, TODAY, t);
    expect(d.score).toBe(Math.round(Math.min(1, 4 / t.waterGlasses) * 20));
    expect(d.checks.find((c) => c.key === 'limitar')!.done).toBe(false);
    expect(nutritionDay(run([], TODAY).coach, TODAY, t).checks.find((c) => c.key === 'limitar')!.done).toBe(false);
  });

  it('el ejercicio cambiado respeta el lugar: en casa no receta máquinas', () => {
    const home = ['corporal', 'mancuerna', 'banda', 'kettlebell'];
    const s = prescribeSession('full_a', ctx({ where: 'casa', swaps: { sentadilla: 'prensa', press_horizontal: 'press-banca', remo: 'remo-polea' } }));
    for (const e of s.exercises) expect(home, e.exerciseId).toContain(e.equipment);
    // En el gym el cambio sigue guardado y se aplica.
    expect(prescribeSession('full_a', ctx({ swaps: { sentadilla: 'prensa' } })).exercises[0].exerciseId).toBe('prensa');
  });

  it('las alternativas que ofrece cada ejercicio sí se aplican al elegirlas', () => {
    const pa = prescribeSession('pierna_a', ctx());
    expect(pa.exercises.find((e) => e.slot === 'femoral')!.alternatives.map((a) => a.id)).not.toContain('peso-muerto-rumano');
    const keys = Object.keys(SESSION_TEMPLATES) as (keyof typeof SESSION_TEMPLATES)[];
    for (const key of keys)
      for (const level of ['sedentario', 'intermedio'] as const)
        for (const where of ['gym', 'casa', null] as const)
          for (const k of ['adaptacion', 'progreso'] as const) {
            const c = ctx({ level, where, phase: phase({ key: k }) });
            const session = prescribeSession(key, c).exercises;
            const inSession = session.map((e) => e.exerciseId);
            for (const e of session)
              for (const a of e.alternatives) {
                // Nunca ofrece algo que ya está en la sesión (en este patrón o en cualquier otro, antes o después).
                expect(inSession, `${key} ${e.slot} ofrece ${a.id}`).not.toContain(a.id);
                const s = prescribeSession(key, { ...c, swaps: { [e.slot]: a.id } });
                expect(s.exercises.find((o) => o.slot === e.slot)?.exerciseId, `${key} ${level} ${where} ${e.slot} → ${a.id}`).toBe(a.id);
              }
          }
  });

  it('una zona de molestia desconocida (de una versión futura) no rompe el plan', () => {
    const prev = addDays(MONDAY, -7);
    const events = [
      ev('coach.readiness', TODAY, { energy: 3, soreness: 0, pain: ['pie', 'rodilla'] }),
      ev('coach.checkin', addDays(prev, 6), { weekStart: prev, effort: 3, energy: 3, mood: 3, pain: ['pie'] }),
    ];
    const ents = entities({ ...ON, limitations: ['pie' as never, 'rodilla'] }, PROFILE);
    const s = run(events, TODAY, { entities: ents });
    expect(coachProfile(s).limitations).toEqual(['rodilla']);
    const p = coachPlan(s, NOON(TODAY));
    expect(p.today.session.exercises.length).toBeGreaterThan(0);
    // La zona desconocida del check-in se descarta al leerlo (reduceCoach): ni aligera la semana ni se nombra.
    expect(p.phase.light).toBe(false);
    expect(p.phase.reason).not.toMatch(/pie/);
    // Lo de hoy solo trae zonas conocidas: el panorama para la IA (y la app) no truena con una zona nueva.
    expect(p.today.readiness!.pain).toEqual(['rodilla']);
    expect(() => buildSnapshot(s, ents, { version: 1, computedBy: 'app', now: new Date(NOON(TODAY)) })).not.toThrow();
    // Solo la zona desconocida hoy: no dice "quité lo que la carga" (no hay nada que quitar).
    const only = run([ev('coach.readiness', TODAY, { energy: 3, soreness: 0, pain: ['pie'] })], TODAY, { entities: entities(ON, PROFILE) });
    expect(coachPlan(only, NOON(TODAY)).today.session.adjustments.join(' ')).not.toMatch(/Te molesta/);
    expect(() => buildSnapshot(only, entities(ON, PROFILE), { version: 1, computedBy: 'app', now: new Date(NOON(TODAY)) })).not.toThrow();
  });

  it('semana ligera con 1 serie: el "por qué" lo dice en singular', () => {
    const prev = addDays(MONDAY, -7);
    const week = [wk(prev, [['prensa', 2, 12, 40]]), wk(addDays(prev, 2), [['prensa', 2, 12, 40]]), ev('coach.checkin', addDays(prev, 6), { weekStart: prev, effort: 5, energy: 3, mood: 3 })];
    const p = plan(week, { ...ON, startDate: prev });
    expect(p.phase).toMatchObject({ key: 'adaptacion', light: true });
    expect(p.why.join(' ')).toMatch(/\b1 serie en los ejercicios principales/);
    expect(p.why.join(' ')).not.toMatch(/\b1 series/);
  });
});

describe('entrenador: sesión recorrida por recuperación', () => {
  /** Hora local de CDMX (UTC−6) → ISO. */
  const cdmx = (date: string, h: number, m = 0) => new Date(Date.parse(`${date}T00:00:00.000Z`) + (h + 6) * 3_600_000 + m * 60_000).toISOString();
  const legs = (date: string, h: number, m = 0) =>
    ev(
      'workout.logged',
      date,
      { kind: 'fuerza', exercises: ([['prensa', 80], ['sentadilla-goblet', 24], ['hip-thrust', 60]] as const).map(([id, kg]) => ({ exerciseId: id, name: id, sets: Array.from({ length: 4 }, () => ({ reps: 10, kg })) })) },
      { occurredAt: cdmx(date, h, m) },
    );
  const laterals = (date: string, h: number) =>
    ev('workout.logged', date, { kind: 'fuerza', exercises: [{ exerciseId: 'elevaciones-laterales', name: 'Elevaciones laterales', sets: [{ reps: 12, kg: 6 }, { reps: 12, kg: 6 }] }] }, { occurredAt: cdmx(date, h) });
  const torso = (date: string, h: number, m = 0) =>
    ev(
      'workout.logged',
      date,
      { kind: 'fuerza', exercises: ([['press-banca', 60], ['remo-maquina', 50], ['jalon-pecho', 50]] as const).map(([id, kg]) => ({ exerciseId: id, name: id, sets: Array.from({ length: 4 }, () => ({ reps: 10, kg })) })) },
      { occurredAt: cdmx(date, h, m) },
    );
  const at = (events: GameEvent[], coach: CoachSettings, date: string, h: number, m = 0) => coachPlan(run(events, date, { entities: entities(coach, PROFILE) }), cdmx(date, h, m));
  /** Lo que se le dijo (siguiente, texto y la fila de la semana) coincide con lo que el motor receta ese día. */
  const keepsPromise = (events: GameEvent[], coach: CoachSettings, p: ReturnType<typeof coachPlan>, said: string) => {
    const nx = p.today.next!;
    expect(p.today.session.adjustments.join(' ')).toMatch(said);
    const row = p.week.find((d) => d.date === nx.date)!;
    expect(row).toMatchObject({ kind: 'fuerza', sessionKey: nx.key });
    // Entre hoy y ese día no hay otra sesión de fuerza en la semana.
    for (const d of p.week) if (!d.past && d.date < nx.date) expect(d.kind, d.label).not.toBe('fuerza');
    const then = at(events, coach, nx.date, 12);
    expect(then.today.session).toMatchObject({ kind: 'fuerza', key: nx.key });
    return nx;
  };

  it('listos un día fuera del plan sin ir atrasado: la sesión va al siguiente día del plan (Lun/Mié/Vie)', () => {
    const tue = addDays(MONDAY, 1);
    const thu = addDays(MONDAY, 3);
    const fri = addDays(MONDAY, 4);
    // Lunes 19:00 pierna pesada y martes 19:00 un extra: el miércoles va 2 de 2, así que el jueves no toca fuerza.
    const events = [legs(MONDAY, 19), laterals(tue, 19)];
    const wed = at(events, ON, TODAY, 12);
    expect(wed.today.session.kind).toBe('cardio');
    expect(wed.today.next).toMatchObject({ date: fri });
    keepsPromise(events, ON, wed, 'el viernes');
    expect(wed.week[3].kind).not.toBe('fuerza');
    const t = at(events, ON, thu, 12);
    expect(t.today.session.kind).toBe('cardio');
    expect(t.today.next).toMatchObject({ date: fri, key: wed.today.next!.key });
  });

  it('listos el día libre sin ir atrasado: la sesión va al siguiente día del plan (Mié/Vie/Dom)', () => {
    const coach = { ...ON, days: [2, 4, 6] };
    const fri = addDays(MONDAY, 4);
    const sat = addDays(MONDAY, 5);
    const sun = addDays(MONDAY, 6);
    const events = [laterals(MONDAY, 12), legs(TODAY, 19)];
    const p = at(events, coach, fri, 12);
    expect(p.today.session.kind).toBe('cardio');
    expect(p.today.next).toMatchObject({ date: sun });
    keepsPromise(events, coach, p, 'el domingo');
    expect(p.week[5].kind).toBe('descanso');
    expect(at(events, coach, sat, 12).today.session.kind).toBe('descanso');
  });

  it('listos más tarde hoy: la hora del texto nunca se adelanta', () => {
    // Pierna pesada el domingo 17:20: el miércoles se puede desde las 5:20 (72 h de recuperación − 12 h de margen).
    const events = [legs(addDays(MONDAY, -1), 17, 20)];
    for (const [h, m] of [[4, 30], [5, 0], [5, 19]]) {
      const p = at(events, ON, TODAY, h, m);
      expect(p.today.session.kind).toBe('cardio');
      expect(p.today.session.adjustments.join(' ')).toMatch(/a partir de las 5:20\./);
      expect(p.today.next).toMatchObject({ date: TODAY });
    }
    expect(at(events, ON, TODAY, 5, 20).today.session.kind).toBe('fuerza');
  });

  it('propiedad: a donde se recorre la sesión, ahí la receta el motor (texto, siguiente y semana)', () => {
    // mulberry32: generador entero (uno con flotantes pierde precisión y repite el mismo ciclo con cualquier semilla).
    let seedN = 5;
    const rnd = () => {
      seedN = (seedN + 0x6d2b79f5) | 0;
      let t = Math.imul(seedN ^ (seedN >>> 15), 1 | seedN);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const combos = [[0, 2, 4], [1, 3, 5], [2, 4, 6], [0, 3], [0, 1, 3, 4], [0, 2, 4, 6], [0, 1, 2, 3, 4, 5, 6]];
    const DAY = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    let moved = 0;
    for (let i = 0; i < 1500; i++) {
      const coach: CoachSettings = { ...ON, days: combos[Math.floor(rnd() * combos.length)], level: rnd() < 0.5 ? 'sedentario' : 'intermedio' };
      const qd = Math.floor(rnd() * 7);
      const date = addDays(MONDAY, qd);
      const qh = Math.floor(rnd() * 24);
      const qm = Math.floor(rnd() * 60);
      const events: GameEvent[] = [];
      for (let k = 1 + Math.floor(rnd() * 3); k > 0; k--) {
        const back = Math.floor(rnd() * 4);
        const d = addDays(date, -back);
        const h = back === 0 ? Math.floor(rnd() * Math.max(1, qh)) : Math.floor(rnd() * 24);
        const m = Math.floor(rnd() * 60);
        const r = rnd();
        events.push(r < 0.5 ? legs(d, h, m) : r < 0.75 ? torso(d, h, m) : laterals(d, h));
      }
      const p = at(events, coach, date, qh, qm);
      const adj = p.today.session.adjustments.join(' ');
      if (!/recuperándose/.test(adj)) continue;
      moved++;
      const nx = p.today.next!;
      if (nx.date === date) {
        // Hoy más tarde: un minuto antes de la hora dicha sigue el cardio; a esa hora, la sesión.
        const [, hh, mm] = adj.match(/a partir de las (\d+):(\d\d)\./)!.map(Number);
        expect(at(events, coach, date, hh, mm - 1).today.session.kind).toBe('cardio');
        expect(at(events, coach, date, hh, mm).today.session).toMatchObject({ kind: 'fuerza', key: nx.key });
        continue;
      }
      const wdN = qd + Math.round((Date.parse(nx.date) - Date.parse(date)) / 86_400_000);
      expect(adj).toContain(nx.date === addDays(date, 1) ? 'mañana' : `el ${DAY[wdN % 7]}`);
      if (nx.date <= addDays(MONDAY, 6)) expect(p.week.find((d) => d.date === nx.date)).toMatchObject({ kind: 'fuerza', sessionKey: nx.key });
      // Ese día, antes de que sea tarde, el motor receta esa misma sesión (también si cae en la semana que entra).
      let ok = false;
      for (let h = 0; h <= GAME_CONFIG.coach.lateHour && !ok; h++) {
        const s = at(events, coach, nx.date, h).today.session;
        ok = s.kind === 'fuerza' && s.key === nx.key;
      }
      expect(ok, JSON.stringify({ coach: coach.days, date, qh, qm, adj, nx })).toBe(true);
    }
    expect(moved).toBeGreaterThan(40);
  });

  it('si la pendiente pasa a la semana que entra, solo la retrasan los músculos de la sesión que sigue', () => {
    // Intermedio, Lun/Jue/Vie/Dom: torso el lunes, pierna el jueves y pierna pesada el sábado 18:00. El domingo los
    // glúteos siguen recuperándose, pero la siguiente (torso A, el lunes) no los usa: va el lunes, no el martes.
    const coach: CoachSettings = { ...ON, level: 'intermedio', days: [0, 3, 4, 6], startDate: MONDAY };
    const events = [torso(MONDAY, 12), legs(addDays(MONDAY, 3), 12), legs(addDays(MONDAY, 5), 18)];
    const sun = at(events, coach, addDays(MONDAY, 6), 12);
    expect(sun.today.session.kind).toBe('cardio');
    const nextMonday = addDays(MONDAY, 7);
    const mon = at(events, coach, nextMonday, 7);
    expect(mon.today.session.kind).toBe('fuerza');
    expect(sun.today.next).toMatchObject({ date: nextMonday, key: mon.today.session.key });
    expect(sun.today.session.adjustments.join(' ')).toMatch(/mañana\./);
  });

  it('semana completa: la siguiente es la primera de la semana que entra, con su fase (de cuerpo completo a torso/pierna)', () => {
    const prev = addDays(MONDAY, -7);
    const coach: CoachSettings = { ...ON, days: [0, 1, 3, 4], startDate: prev };
    const nextMonday = addDays(MONDAY, 7);
    const events = [wk(prev, [['prensa', 2, 12, 40]]), wk(addDays(prev, 2), [['prensa', 2, 12, 40]]), wk(MONDAY, [['prensa', 2, 12, 40]]), wk(addDays(MONDAY, 1), [['prensa', 2, 12, 40]]), wk(addDays(MONDAY, 3), [['prensa', 2, 12, 40]])];
    const sat = at(events, coach, addDays(MONDAY, 5), 12);
    expect(sat.phase.key).toBe('adaptacion');
    expect(sat.strengthDays).toHaveLength(3);
    const mon = at(events, coach, nextMonday, 12);
    expect(mon.phase.key).toBe('base');
    expect(sat.today.next).toMatchObject({ date: nextMonday, key: mon.today.session.key });
    expect(mon.today.session.key).toBe('torso_a');
  });
});
