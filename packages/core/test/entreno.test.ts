import { describe, expect, it } from 'vitest';
import {
  EVENT_SCHEMAS,
  EXERCISE_LIBRARY,
  GAME_CONFIG,
  MUSCLE_IDS,
  MUSCLES,
  SPLITS,
  WORKOUT_KINDS,
  WORKOUT_PLACES,
  addDays,
  buildSnapshot,
  capExerciseMuscles,
  epley1rm,
  matchExercise,
  memoryAssistantStore,
  muscleStatus,
  progressSeries,
  project,
  quickMissionId,
  renderOverview,
  reviewDay,
  runAssistantTool,
  suggestSession,
  trainingAnalysis,
  linkedTrainingDailyId,
  MAX_EXERCISE_MUSCLES,
  trainingMission,
  validateEvent,
  wouldBeRecords,
  type Entity,
  type GameEvent,
  type WorkoutExercise,
} from '../src';
import { bySource, done, ev, run, seed } from './helpers';

const TODAY = '2026-11-19'; // jueves
const MONDAY = '2026-11-16';

/** Entrenamiento con ejercicios cortos: [id, series, reps, kg]. */
function wk(date: string, exercises: [string, number, number, number?][], extra: Record<string, unknown> = {}, env: Partial<GameEvent> = {}): GameEvent {
  const ex: WorkoutExercise[] = exercises.map(([exerciseId, n, reps, kg]) => ({
    exerciseId,
    name: EXERCISE_LIBRARY.find((e) => e.id === exerciseId)?.name ?? exerciseId,
    sets: Array.from({ length: n }, () => (kg ? { reps, kg } : { reps })),
  }));
  return ev('workout.logged', date, { kind: 'fuerza', exercises: ex, ...extra }, env);
}

const at = (date: string, hhmmZ: string) => `${date}T${hhmmZ}:00.000Z`;

describe('entrenamiento: datos y biblioteca', () => {
  it('el esquema acepta los mismos tipos y lugares que types.ts y valida las series', () => {
    const base = { exercises: [{ exerciseId: 'press-banca', name: 'Press de banca', sets: [{ reps: 8, kg: 60 }] }] };
    for (const kind of WORKOUT_KINDS) expect(EVENT_SCHEMAS['workout.logged'].safeParse({ ...base, kind }).success).toBe(true);
    for (const where of WORKOUT_PLACES) expect(EVENT_SCHEMAS['workout.logged'].safeParse({ ...base, kind: 'fuerza', where }).success).toBe(true);
    expect(EVENT_SCHEMAS['workout.logged'].safeParse({ ...base, kind: 'pesas' }).success).toBe(false);
    expect(EVENT_SCHEMAS['workout.logged'].safeParse({ kind: 'fuerza', exercises: [{ exerciseId: 'x', name: 'x', sets: [{}] }] }).success).toBe(false);
    expect(EVENT_SCHEMAS['workout.logged'].safeParse({ kind: 'deporte' }).success).toBe(false);
    expect(EVENT_SCHEMAS['workout.logged'].safeParse({ kind: 'deporte', minutes: 90 }).success).toBe(true);
    const v = validateEvent({ id: 'abcdefgh1', type: 'workout.logged', occurredAt: at(TODAY, '18:00'), localDate: TODAY, payload: { kind: 'cardio', minutes: 30 } });
    expect(v.ok).toBe(true);
  });

  it('la biblioteca tiene ~80 ejercicios con ids únicos y cubre todos los músculos', () => {
    expect(EXERCISE_LIBRARY.length).toBeGreaterThanOrEqual(60);
    expect(new Set(EXERCISE_LIBRARY.map((e) => e.id)).size).toBe(EXERCISE_LIBRARY.length);
    for (const e of EXERCISE_LIBRARY) {
      expect(e.primary.length).toBeGreaterThan(0);
      for (const m of [...e.primary, ...e.secondary]) expect(MUSCLE_IDS).toContain(m);
      for (const m of e.primary) expect(e.secondary).not.toContain(m);
    }
    for (const m of MUSCLE_IDS) expect(EXERCISE_LIBRARY.some((e) => e.measure !== 'distancia' && e.primary.includes(m))).toBe(true);
    expect(Object.keys(MUSCLES).sort()).toEqual([...MUSCLE_IDS].sort());
  });

  it('reconoce nombres aproximados, alias y errores de dedo', () => {
    const id = (q: string) => matchExercise(q)?.exercise.id ?? null;
    expect(id('press banca')).toBe('press-banca');
    expect(id('Press de Banca')).toBe('press-banca');
    expect(id('sentadillas')).toBe('sentadilla');
    expect(id('peso muerto rumano')).toBe('peso-muerto-rumano');
    expect(id('peso muerto')).toBe('peso-muerto');
    expect(id('jalon al pecho')).toBe('jalon-pecho');
    expect(id('dominadas')).toBe('dominadas');
    expect(id('flexiones')).toBe('lagartijas');
    expect(id('hip trust')).toBe('hip-thrust');
    expect(id('curl martillo')).toBe('curl-martillo');
    expect(id('trotar')).toBe('correr');
    expect(id('elevaciones laterales')).toBe('elevaciones-laterales');
    expect(id('zxqv lorem')).toBeNull();
  });
});

describe('entrenamiento: series por músculo y semana', () => {
  it('una serie cuenta completa para los principales y media para los secundarios; solo cuenta la semana en curso', () => {
    const s = run([wk(addDays(MONDAY, -1), [['press-banca', 5, 8, 60]]), wk(MONDAY, [['press-banca', 4, 8, 60]]), wk(TODAY, [['dominadas', 3, 8]])], TODAY);
    const m = s.training.summary.muscles;
    expect(m.pecho.weekSets).toBe(4);
    expect(m.triceps.weekSets).toBe(2);
    expect(m.hombro_frontal.weekSets).toBe(2);
    expect(m.espalda.weekSets).toBe(3);
    expect(m.biceps.weekSets).toBe(1.5);
    expect(m.pecho.last7Sets).toBe(9); // el domingo anterior está dentro de los últimos 7 días
    expect(m.pecho.last14Sets).toBe(9);
    expect(m.pecho.weekDays).toBe(1);
    expect(s.training.summary.sessionsThisWeek).toBe(2);
    expect(s.training.summary.hardSetsThisWeek).toBe(7);
    expect(s.training.workouts).toHaveLength(3);
  });

  it('el cardio de la semana suma minutos de ejercicios de distancia o la duración de un entreno aeróbico', () => {
    const s = run(
      [
        ev('workout.logged', TODAY, { kind: 'cardio', exercises: [{ exerciseId: 'correr', name: 'Correr', sets: [{ min: 30, km: 5 }] }] }),
        ev('workout.logged', MONDAY, { kind: 'deporte', title: 'Fútbol', minutes: 60 }),
        ev('workout.logged', MONDAY, { kind: 'movilidad', minutes: 20 }),
      ],
      TODAY,
    );
    expect(s.training.summary.cardioMinutesThisWeek).toBe(90);
    expect(s.training.summary.hardSetsThisWeek).toBe(0);
    expect(s.training.records.correr.best.km?.value).toBe(5);
    expect(s.training.records.correr.best.pace?.value).toBe(6);
  });

  it('los entrenamientos de texto libre de Cuerpo cuentan como sesión sin músculos', () => {
    const s = run([ev('body.logged', TODAY, { workout: 'Correr 5 km 30 min' }), ev('body.logged', MONDAY, { workout: 'Pierna' }), ev('body.logged', MONDAY, { weightKg: 80 })], TODAY);
    expect(s.training.workouts.map((w) => [w.source, w.kind])).toEqual([
      ['cuerpo', 'fuerza'],
      ['cuerpo', 'cardio'],
    ]);
    expect(s.training.summary.sessionsThisWeek).toBe(2);
    expect(s.training.summary.cardioMinutesThisWeek).toBe(30);
    expect(MUSCLE_IDS.every((m) => s.training.summary.muscles[m].weekSets === 0)).toBe(true);
  });

  it('en el texto libre una "m" sola son metros, no minutos', () => {
    const s = run([ev('body.logged', TODAY, { workout: 'Nadé 800 m' }), ev('body.logged', MONDAY, { workout: 'Corrí 400 m y 20 minutos de bici' })], TODAY);
    expect(s.training.workouts.map((w) => w.minutes)).toEqual([20, null]);
    expect(s.training.summary.cardioMinutesThisWeek).toBe(20);
  });

  it('los músculos de un ejercicio propio se recortan a lo que acepta el registro (si no, el servidor rechaza el entreno y su misión)', () => {
    const all = [...MUSCLE_IDS];
    const payload = (primary: string[], secondary: string[]) => ({
      id: 'abcdefgh2',
      type: 'workout.logged',
      occurredAt: at(TODAY, '18:00'),
      localDate: TODAY,
      payload: { kind: 'fuerza', exercises: [{ exerciseId: 'ex-burpees', name: 'Burpees', primary, secondary, sets: [{ reps: 10 }] }] },
    });
    // Sin recortar: 7 principales o 9 secundarios no pasan la validación.
    expect(validateEvent(payload(all.slice(0, 7), [])).ok).toBe(false);
    expect(validateEvent(payload(all.slice(0, 1), all.slice(1, 10))).ok).toBe(false);
    const capped = capExerciseMuscles(all.slice(0, 7), [...all, 'pecho']);
    expect(capped.primary).toEqual(all.slice(0, MAX_EXERCISE_MUSCLES.primary));
    expect(capped.secondary).toHaveLength(MAX_EXERCISE_MUSCLES.secondary);
    expect(capped.secondary.some((m) => capped.primary.includes(m))).toBe(false);
    expect(validateEvent(payload(capped.primary, capped.secondary)).ok).toBe(true);
    expect(capExerciseMuscles(['pecho', 'pecho', 'triceps'], ['triceps', 'hombro_frontal'])).toEqual({ primary: ['pecho', 'triceps'], secondary: ['hombro_frontal'] });
  });

  it('un ejercicio propio usa sus músculos; si se borra, los que guardó el registro', () => {
    const custom: Entity = { id: 'ex-remo-liga', module: 'training', kind: 'exercise', sort: 0, data: { name: 'Remo con liga', primary: ['espalda'], secondary: ['biceps'], measure: 'corporal' } };
    const w = ev('workout.logged', TODAY, { kind: 'fuerza', exercises: [{ exerciseId: 'ex-remo-liga', name: 'Remo con liga', primary: ['espalda'], sets: [{ reps: 12 }, { reps: 12 }] }] });
    const a = run([w], TODAY, { entities: [...seed, custom] });
    expect(a.training.summary.muscles.espalda.weekSets).toBe(2);
    expect(a.training.summary.muscles.biceps.weekSets).toBe(1);
    const b = run([w], TODAY, { entities: [...seed, { ...custom, deletedAt: 1 }] });
    expect(b.training.summary.muscles.espalda.weekSets).toBe(2);
    expect(b.training.summary.muscles.biceps.weekSets).toBe(0);
  });

  it('semanas seguidas con 2+ sesiones: la semana en curso no rompe la cuenta', () => {
    const events = [wk(addDays(MONDAY, -14), [['sentadilla', 3, 5, 100]]), wk(addDays(MONDAY, -13), [['sentadilla', 3, 5, 100]]), wk(addDays(MONDAY, -7), [['sentadilla', 3, 5, 100]]), wk(addDays(MONDAY, -6), [['sentadilla', 3, 5, 100]])];
    expect(run(events, TODAY).training.summary.weekStreak).toBe(2);
    expect(run([...events, wk(MONDAY, [['dominadas', 3, 8]]), wk(TODAY, [['dominadas', 3, 8]])], TODAY).training.summary.weekStreak).toBe(3);
  });
});

describe('entrenamiento: recuperación, lo que falta y equilibrio', () => {
  it('músculos grandes se recuperan en 72 h y chicos en 48 h; una serie suelta no pide recuperación', () => {
    const s = run([wk(TODAY, [['press-banca', 4, 8, 60], ['curl-barra', 3, 10, 30], ['elevaciones-laterales', 1, 12, 8]], {}, { occurredAt: at(TODAY, '14:00') })], TODAY);
    const st = muscleStatus(s.training.summary, at(TODAY, '20:00'));
    expect(st.pecho.state).toBe('recuperando');
    expect(st.pecho.hoursToReady).toBe(66);
    expect(st.pecho.readyAt).toBe(at(addDays(TODAY, 3), '14:00'));
    expect(st.biceps.readyAt).toBe(at(addDays(TODAY, 2), '14:00'));
    expect(st.hombro_lateral.state).toBe('listo');
    expect(st.pecho.fatigue).toBeGreaterThan(0.9);
    const later = muscleStatus(s.training.summary, at(addDays(TODAY, 2), '15:00'));
    expect(later.biceps.state).toBe('listo');
    expect(later.pecho.state).toBe('recuperando');
    expect(muscleStatus(s.training.summary, at(addDays(TODAY, 3), '15:00')).pecho.state).toBe('listo');
  });

  it('un registro de un día anterior se ubica a las 18:00 de ese día', () => {
    const s = run([wk(addDays(TODAY, -1), [['sentadilla', 4, 5, 100]], {}, { occurredAt: at(TODAY, '15:00') })], TODAY);
    // 18:00 en CDMX (UTC−6) del día anterior = 00:00 UTC de hoy.
    expect(s.training.workouts[0].at).toBe(`${TODAY}T00:00:00.000Z`);
  });

  it('olvidado: sin trabajar 8+ días o nunca', () => {
    const s = run([wk(addDays(TODAY, -10), [['press-banca', 3, 8, 60]]), wk(addDays(TODAY, -2), [['sentadilla', 3, 5, 100]])], TODAY);
    const st = muscleStatus(s.training.summary, at(TODAY, '18:00'));
    expect(st.pecho.state).toBe('olvidado');
    expect(st.pecho.daysSince).toBe(10);
    expect(st.biceps.state).toBe('olvidado');
    expect(st.biceps.lastDate).toBeNull();
    expect(st.cuadriceps.state).toBe('recuperando');
    expect(st.gluteos.daysSince).toBe(2);
  });

  it('"te falta" lista los principales bajo el mínimo; los accesorios van aparte; volumen por nivel', () => {
    const s = run([wk(MONDAY, [['press-banca', 2, 8, 60], ['jalon-pecho', 10, 10, 50], ['remo-polea', 12, 10, 50]])], TODAY);
    const a = trainingAnalysis(s.training.summary, at(TODAY, '18:00'));
    const missing = a.missing.map((m) => m.id);
    expect(missing).toContain('pecho');
    expect(missing).toContain('cuadriceps');
    expect(missing).not.toContain('espalda');
    expect(missing.some((m) => MUSCLES[m].accessory)).toBe(false);
    expect(a.missingAccessory.map((m) => m.id)).toContain('antebrazo');
    expect(a.muscles.espalda.volumeLevel).toBe(4); // 22 series > 20
    expect(a.muscles.pecho.volumeLevel).toBe(1);
    expect(a.muscles.biceps.volumeLevel).toBe(3); // 11 series
    expect(a.daysLeft).toBe(4);
    expect(a.balance.notes.some((n) => n.includes('más jalón que empuje'))).toBe(true);
  });

  it('desequilibrio torso/pierna', () => {
    const s = run([wk(MONDAY, [['press-banca', 6, 8, 60], ['remo-barra', 6, 8, 60], ['press-militar', 4, 8, 40], ['curl-barra', 4, 10, 30], ['extension-polea', 4, 12, 25]])], TODAY);
    const a = trainingAnalysis(s.training.summary, at(addDays(TODAY, 3), '18:00'));
    expect(a.balance.notes.some((n) => n.includes('no te saltes pierna'))).toBe(true);
  });
});

describe('entrenamiento: sesión sugerida', () => {
  const sumSets = (x: { exercises: { sets: number }[] }) => x.exercises.reduce((t, e) => t + e.sets, 0);

  it('sin nada esta semana y todo recuperado → cuerpo completo con ejercicios que cubren lo principal', () => {
    const s = run([], TODAY);
    const a = trainingAnalysis(s.training.summary, at(TODAY, '18:00'));
    expect(a.suggestion.split).toBe('cuerpo_completo');
    expect(a.suggestion.exercises.length).toBeGreaterThanOrEqual(4);
    expect(a.suggestion.exercises.length).toBeLessThanOrEqual(GAME_CONFIG.training.suggestion.maxExercises);
    expect(sumSets(a.suggestion)).toBeLessThanOrEqual(GAME_CONFIG.training.suggestion.sessionSets);
    const covered = new Set(a.suggestion.exercises.flatMap((e) => e.muscles));
    expect(covered.has('pecho') || covered.has('espalda')).toBe(true);
    expect(covered.has('cuadriceps') || covered.has('gluteos')).toBe(true);
  });

  it('torso ayer → pierna; pierna ayer → torso; nunca propone un ejercicio de un músculo en recuperación', () => {
    const torso = run([wk(addDays(TODAY, -1), [['press-banca', 4, 8, 60], ['remo-barra', 4, 8, 60]])], TODAY);
    const a = trainingAnalysis(torso.training.summary, at(TODAY, '18:00'));
    expect(a.suggestion.split).toBe('pierna');
    const legs = run([wk(addDays(TODAY, -1), [['sentadilla', 4, 5, 100], ['peso-muerto-rumano', 3, 8, 80]])], TODAY);
    const b = trainingAnalysis(legs.training.summary, at(TODAY, '18:00'));
    expect(b.suggestion.split).toBe('torso');
    for (const x of [a, b]) for (const e of x.suggestion.exercises) for (const m of e.muscles) expect(x.muscles[m].state).not.toBe('recuperando');
  });

  it('empuje ayer → no propone empuje ni torso', () => {
    const s = run([wk(addDays(TODAY, -1), [['press-banca', 4, 8, 60], ['press-militar', 3, 8, 40], ['extension-polea', 3, 12, 25]])], TODAY);
    const a = trainingAnalysis(s.training.summary, at(TODAY, '18:00'));
    expect(['jalon', 'pierna']).toContain(a.suggestion.split);
  });

  it('volumen de la semana cumplido → cardio si falta, si no descanso', () => {
    const full = Object.fromEntries(MUSCLE_IDS.map((m) => [m, { lastDate: MONDAY, lastAt: at(MONDAY, '18:00'), hardAt: null, readyAt: null, weekSets: 12, weekDays: 2, last7Sets: 12, last14Sets: 20 }]));
    const st = muscleStatus({ today: TODAY, muscles: full as never }, at(TODAY, '18:00'));
    expect(suggestSession(st, { cardioMinutesThisWeek: 40 }).split).toBe('cardio');
    expect(suggestSession(st, { cardioMinutesThisWeek: 200 }).split).toBe('descanso');
  });

  it('entrenando en casa solo propone peso corporal, mancuernas, bandas o kettlebell', () => {
    const s = run([wk(addDays(TODAY, -9), [['lagartijas', 3, 15]], { where: 'casa' })], TODAY);
    expect(s.training.summary.usualWhere).toBe('casa');
    const a = trainingAnalysis(s.training.summary, at(TODAY, '18:00'));
    const lib = new Map(EXERCISE_LIBRARY.map((e) => [e.id, e]));
    for (const e of a.suggestion.exercises) expect(['corporal', 'mancuerna', 'banda', 'kettlebell']).toContain(lib.get(e.exerciseId)!.equipment);
  });

  it('las plantillas de sesión solo usan músculos válidos', () => {
    for (const s of Object.values(SPLITS)) for (const m of [...s.key, ...s.muscles]) expect(MUSCLE_IDS).toContain(m);
  });
});

describe('entrenamiento: récords y XP', () => {
  it('1RM estimado con Epley', () => {
    expect(epley1rm(100, 1)).toBe(100);
    expect(epley1rm(100, 10)).toBeCloseTo(133.33, 1);
    expect(epley1rm(0, 5)).toBe(0);
  });

  it('récords por ejercicio y serie de progreso', () => {
    const s = run([wk('2026-11-02', [['press-banca', 3, 8, 60]]), wk('2026-11-09', [['press-banca', 3, 5, 70]]), wk(MONDAY, [['press-banca', 3, 10, 62.5]])], TODAY);
    const r = s.training.records['press-banca'];
    expect(r.sessions).toBe(3);
    expect(r.best.kg?.value).toBe(70);
    expect(r.best.e1rm?.value).toBeCloseTo(83.33, 1);
    expect(r.best.e1rm?.date).toBe(MONDAY);
    expect(r.best.volume?.value).toBe(1875);
    expect(progressSeries(r).map((p) => p.date)).toEqual(['2026-11-02', '2026-11-09', MONDAY]);
    expect(wouldBeRecords(s.training.records, [{ exerciseId: 'press-banca', measure: 'peso', sets: [{ reps: 3, kg: 80 }] }])).toEqual(['press-banca']);
    expect(wouldBeRecords(s.training.records, [{ exerciseId: 'press-banca', measure: 'peso', sets: [{ reps: 5, kg: 60 }] }])).toEqual([]);
  });

  it('un récord nuevo sobre uno anterior da XP de misión chica (Fuerza); el primero no', () => {
    const recXp = GAME_CONFIG.missionXp[GAME_CONFIG.training.record.size];
    const first = run([wk('2026-11-10', [['press-banca', 3, 8, 60]])], TODAY);
    expect(bySource(first, 'training_record')).toBe(0);
    const better = run([wk('2026-11-10', [['press-banca', 3, 8, 60]]), wk(TODAY, [['press-banca', 3, 8, 62.5]])], TODAY);
    expect(bySource(better, 'training_record')).toBe(recXp);
    expect(better.xp.ledger.find((e) => e.source === 'training_record')).toMatchObject({ date: TODAY, attribute: 'fuerza', refId: 'press-banca' });
    expect(better.training.workouts.at(-1)!.records).toEqual(['press-banca']);
    const same = run([wk('2026-11-10', [['press-banca', 3, 8, 60]]), wk(TODAY, [['press-banca', 3, 8, 60]])], TODAY);
    expect(bySource(same, 'training_record')).toBe(0);
  });

  it('máximo un récord por ejercicio por día y tres por día', () => {
    const base = wk('2026-11-10', [['press-banca', 1, 5, 60], ['sentadilla', 1, 5, 80], ['remo-barra', 1, 5, 60], ['press-militar', 1, 5, 40]]);
    const a = wk(TODAY, [['press-banca', 1, 5, 65], ['sentadilla', 1, 5, 85], ['remo-barra', 1, 5, 65], ['press-militar', 1, 5, 45]]);
    const b = wk(TODAY, [['press-banca', 1, 5, 70]]);
    const s = run([base, a, b], TODAY);
    expect(bySource(s, 'training_record')).toBe(GAME_CONFIG.training.record.maxPerDay * GAME_CONFIG.missionXp.chica);
  });

  it('la vista previa de récords (aviso al guardar) respeta uno por ejercicio por día y el máximo por día', () => {
    const base = wk('2026-11-10', [['press-banca', 1, 5, 60], ['sentadilla', 1, 5, 80], ['remo-barra', 1, 5, 60], ['press-militar', 1, 5, 40]]);
    const morning = wk(TODAY, [['press-banca', 1, 5, 65]]);
    const s = run([base, morning], TODAY);
    const next = [
      { exerciseId: 'press-banca', measure: 'peso' as const, sets: [{ reps: 5, kg: 70 }] },
      { exerciseId: 'sentadilla', measure: 'peso' as const, sets: [{ reps: 5, kg: 90 }] },
      { exerciseId: 'remo-barra', measure: 'peso' as const, sets: [{ reps: 5, kg: 70 }] },
      { exerciseId: 'press-militar', measure: 'peso' as const, sets: [{ reps: 5, kg: 50 }] },
    ];
    // Sin el día, compara solo contra la mejor marca.
    expect(wouldBeRecords(s.training.records, next)).toEqual(['press-banca', 'sentadilla', 'remo-barra', 'press-militar']);
    // Con el día: press de banca ya dio récord hoy y solo quedan 2 de 3.
    const preview = wouldBeRecords(s.training.records, next, { date: TODAY, ledger: s.xp.ledger });
    expect(preview).toEqual(['sentadilla', 'remo-barra']);
    // Lo mismo que da el motor al guardarlo.
    const evening = wk(TODAY, [['press-banca', 1, 5, 70], ['sentadilla', 1, 5, 90], ['remo-barra', 1, 5, 70], ['press-militar', 1, 5, 50]]);
    expect(run([base, morning, evening], TODAY).training.workouts.at(-1)!.records).toEqual(preview);
    // Lo de hoy no cuenta para otro día.
    expect(wouldBeRecords(s.training.records, next, { date: addDays(TODAY, -1), ledger: s.xp.ledger })).toHaveLength(GAME_CONFIG.training.record.maxPerDay);
  });

  it('un registro atrasado no le quita el récord a otro ni gana uno sin superar lo de su fecha', () => {
    const a = wk('2026-11-01', [['sentadilla', 3, 5, 80]]);
    const b = wk('2026-11-10', [['sentadilla', 3, 5, 90]]);
    const before = run([a, b], TODAY);
    expect(bySource(before, 'training_record')).toBe(10);
    // Registrado después pero con fecha anterior y más peso: b sigue con su récord; c no supera nada de su fecha previa → sí (80 < 100) es récord en su fecha.
    const c = wk('2026-11-05', [['sentadilla', 3, 5, 100]]);
    const after = run([a, b, c], TODAY);
    expect(bySource(after, 'training_record')).toBe(20);
    // Uno peor registrado después no gana nada.
    const d = wk('2026-11-12', [['sentadilla', 3, 5, 85]]);
    expect(bySource(run([a, b, c, d], TODAY), 'training_record')).toBe(20);
  });

  it('la foto de una fecha pasada no depende de registros posteriores', () => {
    const a = wk('2026-11-01', [['sentadilla', 3, 5, 80]]);
    const b = wk('2026-11-20', [['sentadilla', 3, 5, 100]]); // futuro respecto a la foto
    const c = wk('2026-11-05', [['sentadilla', 3, 5, 90]]);
    expect(bySource(run([a, b, c], '2026-11-10'), 'training_record')).toBe(10);
    expect(bySource(run([a, b, c], '2026-11-25'), 'training_record')).toBe(20);
  });
});

/** Generador pseudoaleatorio determinista. */
function rng(seedN: number) {
  return () => ((seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe('entrenamiento: reglas de oro', () => {
  it('agregar cualquier entrenamiento (con o sin su misión) nunca baja la XP ni los atributos', () => {
    const ids = ['press-banca', 'sentadilla', 'dominadas', 'plancha', 'correr', 'curl-barra', 'peso-muerto'];
    for (let seedN = 1; seedN <= 12; seedN++) {
      const r = rng(seedN);
      const events: GameEvent[] = [];
      let prev = run([], TODAY);
      for (let i = 0; i < 40; i++) {
        const date = addDays('2026-09-01', Math.floor(r() * 80));
        const n = 1 + Math.floor(r() * 3);
        const exercises = Array.from({ length: n }, () => {
          const id = ids[Math.floor(r() * ids.length)];
          const lib = EXERCISE_LIBRARY.find((e) => e.id === id)!;
          const sets = Array.from({ length: 1 + Math.floor(r() * 4) }, () =>
            lib.measure === 'distancia' ? { min: 10 + Math.floor(r() * 50), km: Math.round(r() * 100) / 10 + 0.1 } : lib.measure === 'tiempo' ? { sec: 10 + Math.floor(r() * 90) } : { reps: 1 + Math.floor(r() * 15), kg: Math.floor(r() * 120) },
          );
          return { exerciseId: id, name: lib.name, sets };
        });
        if (r() < 0.5) events.push(done(date, quickMissionId('Entrenar'), 'media', 'fuerza', 'quick'));
        events.push(ev('workout.logged', date, { kind: 'fuerza', exercises }));
        const s = run(events, TODAY);
        expect(s.xp.total).toBeGreaterThanOrEqual(prev.xp.total);
        for (const a of Object.keys(s.attributes.values) as (keyof typeof s.attributes.values)[]) expect(s.attributes.values[a].value).toBeGreaterThanOrEqual(prev.attributes.values[a].value);
        expect(s.xp.ledger.every((e) => e.amount > 0)).toBe(true);
        prev = s;
      }
    }
  });
});

describe('entrenamiento: misión que da la XP', () => {
  const quick = { missionId: 'quick-entrenar', title: 'Entrenar', size: 'media', attribute: 'fuerza', kind: 'quick', mainQuestId: null };

  it('por defecto la diaria "Entrenar 30 min" del catálogo (la que cuenta El Sedentario); o la ligada en ajustes', () => {
    for (const settings of [null, undefined, {}, { where: 'gym' as const }]) {
      expect(trainingMission(settings, seed)).toEqual({ missionId: 'daily-entrenar', title: 'Entrenar 30 min', size: 'chica', attribute: 'fuerza', kind: 'daily', mainQuestId: 'mq-04' });
      expect(linkedTrainingDailyId(settings, seed)).toBe('daily-entrenar');
    }
    const otra: Entity = { id: 'daily-correr', module: 'missions', kind: 'daily', sort: 99, data: { title: 'Correr', size: 'media', attribute: 'fuerza' } };
    expect(trainingMission({ missionId: 'daily-correr' }, [...seed, otra])).toMatchObject({ missionId: 'daily-correr', kind: 'daily', size: 'media' });
  });

  it('la misión rápida "Entrenar" si la eligió (null), si la diaria ya no existe o si no hay diaria de entrenar', () => {
    expect(trainingMission({ missionId: null }, seed)).toEqual(quick);
    expect(linkedTrainingDailyId({ missionId: null }, seed)).toBeNull();
    expect(trainingMission({ missionId: 'no-existe' }, seed)).toEqual(quick);
    expect(trainingMission(null, seed.filter((e) => e.id !== 'daily-entrenar'))).toEqual(quick);
    expect(trainingMission(null, seed.map((e) => (e.id === 'daily-entrenar' ? { ...e, deletedAt: 1 } : e)))).toEqual(quick);
  });

  it('la revisión del día pregunta qué entrenaste al marcar la diaria de entrenar (también sin ajustes)', () => {
    const entreno = (events: GameEvent[], entities: Entity[] = seed) => reviewDay({ date: TODAY, today: TODAY, events, entities }).checks.find((c) => c.id === 'entreno');
    expect(entreno([done(TODAY, 'daily-entrenar', 'chica', 'fuerza')])?.status).toBe('missing');
    expect(entreno([done(TODAY, 'daily-entrenar', 'chica', 'fuerza'), wk(TODAY, [['sentadilla', 3, 5, 100]])])?.status).toBe('done');
    expect(entreno([])).toBeUndefined();
    const optOut: Entity = { id: 'training-settings', module: 'training', kind: 'settings', sort: 0, data: { missionId: null } };
    expect(entreno([done(TODAY, 'daily-entrenar', 'chica', 'fuerza')], [...seed, optOut])).toBeUndefined();
  });
});

describe('entrenamiento: herramientas de IA', () => {
  const runTool = (store: ReturnType<typeof memoryAssistantStore>, name: string, input: unknown = {}, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });
  const mk = (events: GameEvent[] = [], entities: Entity[] = seed) => memoryAssistantStore({ events, entities, today: TODAY });

  it('registrar_entrenamiento reconoce ejercicios, crea el entreno y la misión "Entrenar" (+30 XP); deshacer = ambos registros', async () => {
    const quickSettings: Entity = { id: 'training-settings', module: 'training', kind: 'settings', sort: 0, data: { missionId: null } };
    const store = mk([], [...seed, quickSettings]);
    const r = await runTool(store, 'registrar_entrenamiento', {
      titulo: 'Pecho y tríceps',
      donde: 'gym',
      minutos: 60,
      ejercicios: [
        { nombre: 'press banca', n_series: 4, reps: 8, kg: 60 },
        { nombre: 'fondos', series: [{ reps: 12 }, { reps: 10 }] },
        { nombre: 'triceps en polea', n_series: 3, reps: 12, kg: 25 },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('+30 XP');
    expect(r.refs?.events).toHaveLength(2);
    const evs = store.allEvents();
    const mission = evs.find((e) => e.type === 'mission.completed')!;
    const workout = evs.find((e) => e.type === 'workout.logged')!;
    expect(mission.payload).toMatchObject({ missionId: 'quick-entrenar', size: 'media', attribute: 'fuerza', kind: 'quick' });
    expect(workout.payload.missionEventId).toBe(mission.id);
    expect(workout.payload.exercises.map((x: WorkoutExercise) => x.exerciseId)).toEqual(['press-banca', 'fondos', 'extension-polea']);
    expect(workout.payload.exercises[0].sets).toHaveLength(4);
    const state = project({ events: evs, entities: [...seed, quickSettings], today: TODAY });
    expect(bySource(state, 'mission')).toBe(30);
    expect(state.streak.current).toBe(1);
    expect(state.training.summary.muscles.pecho.weekSets).toBe(6);

    const again = await runTool(store, 'registrar_entrenamiento', { tipo: 'cardio', ejercicios: [{ nombre: 'correr', minutos: 20, km: 3.5 }] });
    expect(again.isError).toBeFalsy();
    expect(again.text).toContain('ya estaba registrada');
    expect(again.refs?.events).toHaveLength(1);
  });

  it('sin ajustes completa la diaria "Entrenar 30 min" (avanza El Sedentario) y no duplica si ya la marcaste', async () => {
    const store = mk();
    const r = await runTool(store, 'registrar_entrenamiento', { ejercicios: [{ nombre: 'sentadilla', n_series: 3, reps: 5, kg: 100 }] });
    expect(r.text).toContain(`+${GAME_CONFIG.missionXp.chica} XP por "Entrenar 30 min"`);
    expect(store.allEvents().find((e) => e.type === 'mission.completed')!.payload).toMatchObject({ missionId: 'daily-entrenar', kind: 'daily', size: 'chica' });
    const state = project({ events: store.allEvents(), entities: seed, today: TODAY });
    expect(state.missions.completions['daily-entrenar']?.dates).toContain(TODAY);
    expect(state.missions.completions['quick-entrenar']).toBeUndefined();

    // Ya marcó "Entrenar 30 min" en Hoy: anotar el entreno no crea otra misión.
    const marked = mk([done(TODAY, 'daily-entrenar', 'chica', 'fuerza')]);
    const again = await runTool(marked, 'registrar_entrenamiento', { ejercicios: [{ nombre: 'sentadilla', n_series: 3, reps: 5, kg: 100 }] });
    expect(again.text).toContain('ya estaba registrada');
    expect(marked.allEvents().filter((e) => e.type === 'mission.completed')).toHaveLength(1);
  });

  it('usa la diaria ligada en ajustes de entrenamiento', async () => {
    const settings: Entity = { id: 'training-settings', module: 'training', kind: 'settings', sort: 0, data: { missionId: 'daily-entrenar' } };
    const store = mk([], [...seed, settings]);
    await runTool(store, 'registrar_entrenamiento', { ejercicios: [{ nombre: 'sentadilla', n_series: 3, reps: 5, kg: 100 }] });
    expect(store.allEvents().find((e) => e.type === 'mission.completed')!.payload.missionId).toBe('daily-entrenar');
  });

  it('un ejercicio desconocido se rechaza con sugerencias; con músculos se crea como propio', async () => {
    const store = mk();
    const bad = await runTool(store, 'registrar_entrenamiento', { ejercicios: [{ nombre: 'remo con liga elástica', n_series: 3, reps: 15 }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('musculos');
    expect(store.allEvents()).toHaveLength(0);
    const good = await runTool(store, 'registrar_entrenamiento', { ejercicios: [{ nombre: 'remo con liga elástica', n_series: 3, reps: 15, musculos: ['espalda'] }] });
    expect(good.isError).toBeFalsy();
    expect(good.refs?.entities).toHaveLength(1);
    const ent = store.allEntities().find((e) => e.module === 'training' && e.kind === 'exercise')!;
    expect(ent.data).toMatchObject({ name: 'remo con liga elástica', primary: ['espalda'], measure: 'corporal' });
    const state = project({ events: store.allEvents(), entities: store.allEntities(), today: TODAY });
    expect(state.training.summary.muscles.espalda.weekSets).toBe(3);
  });

  it('avisa del récord personal y lo cuenta en la XP', async () => {
    const store = mk([wk('2026-11-10', [['press-banca', 3, 8, 60]])]);
    const r = await runTool(store, 'registrar_entrenamiento', { ejercicios: [{ nombre: 'press de banca', n_series: 3, reps: 8, kg: 65 }] });
    expect(r.text).toContain('Récord personal en Press de banca');
    const state = project({ events: store.allEvents(), entities: seed, today: TODAY });
    expect(bySource(state, 'training_record')).toBe(10);
  });

  it('no registra en el futuro y respeta el modo solo lectura', async () => {
    const store = mk();
    expect((await runTool(store, 'registrar_entrenamiento', { minutos: 30, tipo: 'cardio', fecha: '2026-11-25' })).isError).toBe(true);
    expect((await runTool(store, 'registrar_entrenamiento', { minutos: 30, tipo: 'cardio' }, false)).isError).toBe(true);
    expect(store.allEvents()).toHaveLength(0);
  });

  it('ver_entrenamiento muestra músculos, lo que falta y la sesión sugerida; con ejercicio, récords', async () => {
    const store = mk([wk(addDays(TODAY, -1), [['press-banca', 4, 8, 60], ['remo-barra', 4, 8, 60]]), wk('2026-11-10', [['press-banca', 3, 8, 55]])]);
    const r = await runTool(store, 'ver_entrenamiento');
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Pecho: 4/10');
    expect(r.text).toContain('recuperando');
    expect(r.text).toContain('Siguiente sesión sugerida: Pierna');
    const e = await runTool(store, 'ver_entrenamiento', { ejercicio: 'banca' });
    expect(e.text).toContain('# Press de banca');
    expect(e.text).toContain('1RM estimado');
  });

  it('la foto para la IA trae el resumen de entrenamiento y el panorama lo muestra', async () => {
    const events = [wk(addDays(TODAY, -1), [['sentadilla', 4, 5, 100]])];
    const state = project({ events, entities: seed, today: TODAY });
    const snap = buildSnapshot(state, seed, { version: 1, computedBy: 'app', now: new Date(at(TODAY, '18:00')) });
    expect(snap.training.sessionsThisWeek).toBe(1);
    expect(snap.training.muscles.cuadriceps.weekSets).toBe(4);
    const text = renderOverview(snap);
    expect(text).toContain('## Entrenamiento');
    expect(text).toContain('cuádriceps (lista en');
    expect(text).toContain('Siguiente sesión sugerida: Torso');
  });

  it('el panorama calcula la recuperación a la hora actual, no a la de la foto en caché', async () => {
    // Sentadilla el lunes a las 19:00 (CDMX) → cuádriceps listos el jueves a la misma hora (72 h).
    const events = [wk(MONDAY, [['sentadilla', 4, 5, 100]], {}, { occurredAt: '2026-11-17T01:00:00.000Z' })];
    const state = project({ events, entities: seed, today: TODAY });
    const readyAt = Date.parse(state.training.summary.muscles.cuadriceps.readyAt!);
    const before = new Date(readyAt - 12 * 3_600_000); // jueves 07:00: se sube la foto
    const after = new Date(readyAt + 2 * 3_600_000); // jueves 21:00: pregunta al Coach
    const snap = buildSnapshot(state, seed, { version: 1, computedBy: 'app', now: before });
    expect(renderOverview(snap)).toContain('cuádriceps (lista en 12 h)');
    expect(renderOverview(snap, after.toISOString())).not.toContain('cuádriceps (lista en');
    // ver_resumen usa la hora del servidor (store.now()), aunque la foto sea de la mañana.
    const store = memoryAssistantStore({ events, entities: seed, today: TODAY, now: () => after });
    store.snapshot = async () => snap;
    const r = await runAssistantTool('ver_resumen', {}, store, { allowWrites: false });
    expect(r.text).toContain('## Entrenamiento');
    expect(r.text).not.toContain('cuádriceps (lista en');
  });
});
