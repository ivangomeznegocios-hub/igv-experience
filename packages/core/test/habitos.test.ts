import { describe, expect, it } from 'vitest';
import {
  DAY_CHECKS,
  addDays,
  dayReviewInputFromState,
  eventCheck,
  isDailyDone,
  memoryAssistantStore,
  reviewDay,
  runAssistantTool,
  type Entity,
  type GameEvent,
  type MissionData,
  type ViceData,
} from '../src';
import { done, ev, run, seed } from './helpers';

const TODAY = '2026-11-19'; // jueves

/** Mediodía en CDMX de ese día (para `createdAt`). */
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 18);
const daily = (id: string, data: Partial<MissionData> = {}, created?: string): Entity<MissionData> => ({
  id,
  module: 'missions',
  kind: 'daily',
  data: { title: id, size: 'chica', attribute: 'disciplina', ...data },
  sort: 0,
  createdAt: created ? ms(created) : 0,
  updatedAt: 0,
  deletedAt: null,
});
const vice = (id: string, name: string, startDate: string): Entity<ViceData> => ({ id, module: 'habits', kind: 'vice', data: { name, startDate }, sort: 0, createdAt: 0, updatedAt: 0, deletedAt: null });
/** Catálogo inicial sin las diarias de ejemplo (para controlar la rutina en cada prueba). */
const base = seed.filter((e) => !(e.module === 'missions' && e.kind === 'daily'));
const quick = (date: string, title: string, extra: Partial<{ size: string; attribute: string }> = {}) =>
  ev('mission.completed', date, { missionId: `quick-${title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`, title, size: 'media', attribute: 'fuerza', kind: 'quick', ...extra });
/** Fechas de `from` a `to` (inclusive). */
const range = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const wd = (d: string) => ((Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5) + 3) % 7 + 7) % 7;

describe('hábitos: cumplimiento respetando el horario', () => {
  // Gym lunes, miércoles y viernes; creado el lunes 2 de noviembre. La app se usa desde octubre.
  const gym = daily('daily-gym', { title: 'Gym', days: [0, 2, 4] }, '2026-11-02');
  const events = [
    ev('checkin.morning', '2026-10-01', { sleepHours: 7 }),
    ...['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11', '2026-11-16'].map((d) => done(d, 'daily-gym')),
    done('2026-11-17', 'daily-gym'), // martes: no le tocaba (extra)
    ev('rest_day.marked', '2026-11-18'), // miércoles de descanso: no cuenta en contra
  ];
  const state = run(events, TODAY, { entities: [...base, gym] });
  const h = state.habits.routine.find((x) => x.id === 'daily-gym')!;

  it('solo cuentan los días que le tocaban, desde que existe y sin descansos', () => {
    expect(h.since).toBe('2026-11-02');
    // Le tocaban 8 días; el 18 fue descanso y el 13 se falló.
    expect(h.last30).toEqual({ done: 6, due: 7, rate: 6 / 7 });
    expect(h.last7).toEqual({ done: 1, due: 2, rate: 0.5 });
    expect(h.verdict).toBe('bien');
  });

  it('la tira de 30 días marca hecho, fallado, descanso, extra y antes de existir', () => {
    expect(h.strip).toHaveLength(30);
    const at = (d: string) => h.strip[29 - (Math.floor((ms(TODAY) - ms(d)) / 864e5))];
    expect(at(TODAY)).toBe('off');
    expect(at('2026-11-18')).toBe('rest');
    expect(at('2026-11-17')).toBe('extra');
    expect(at('2026-11-16')).toBe('done');
    expect(at('2026-11-13')).toBe('missed');
    expect(at('2026-11-01')).toBe('before');
    expect(h.lastDone).toBe('2026-11-17');
  });

  it('racha actual y mejor racha del hábito', () => {
    expect(h.streak).toBe(1); // el 16; el 13 se falló
    expect(h.best).toBe(5); // del 2 al 11
    expect(h.dueToday).toBe(false);
  });

  it('hoy pendiente no cuenta en contra', () => {
    const lee = daily('daily-leer', { title: 'Leer' }, '2026-11-12');
    const s = run([ev('checkin.morning', '2026-10-01', { sleepHours: 7 }), ...range('2026-11-12', '2026-11-18').map((d) => done(d, 'daily-leer'))], TODAY, { entities: [...base, lee] });
    const x = s.habits.routine[0];
    expect(x.last7).toEqual({ done: 6, due: 6, rate: 1 }); // del 13 al 18; hoy (19) sigue pendiente
    expect(x.streak).toBe(7);
    expect(x.dueToday).toBe(true);
    expect(x.doneToday).toBe(false);
    expect(x.strip[29]).toBe('pending');
    expect(x.verdict).toBe('bien');
  });

  it('las diarias fuera de la rutina no se miden; una recién creada es "nuevo"', () => {
    const s = run([ev('checkin.morning', '2026-10-01', { sleepHours: 7 })], TODAY, {
      entities: [...base, daily('daily-off', { routine: false }), daily('daily-nueva', {}, '2026-11-18')],
    });
    expect(s.habits.routine.map((x) => x.id)).toEqual(['daily-nueva']);
    expect(s.habits.routine[0].verdict).toBe('nuevo');
    expect(s.habits.summary.nuevo).toBe(1);
  });

  it('un día marcado de descanso sigue siendo descanso aunque ese día registres otra cosa', () => {
    const gym2 = daily('daily-gym', { title: 'Gym' }, '2026-11-01');
    const evs = [ev('checkin.morning', '2026-10-01', { sleepHours: 7 }), ...range('2026-11-11', '2026-11-17').map((d) => done(d, 'daily-gym')), ev('rest_day.marked', '2026-11-18')];
    const ents = [...base, gym2];
    const before = run(evs, TODAY, { entities: ents });
    const withQuick = [...evs, quick('2026-11-18', 'Cociné')];
    const after = run(withQuick, TODAY, { entities: ents });
    const a = before.habits.routine[0];
    const b = after.habits.routine[0];
    // La racha general sí suma ese día (tuvo misión) y ya no lo cuenta como descanso…
    expect(after.streak.restDays.has('2026-11-18')).toBe(false);
    // …pero para los hábitos sigue siendo el descanso que marcaste: nada baja.
    expect(after.habits.restDays.has('2026-11-18')).toBe(true);
    expect(b.strip[28]).toBe('rest');
    expect(b.streak).toBe(a.streak);
    expect(b.streak).toBe(7);
    expect(b.last7).toEqual(a.last7);
    // Y "¿Cómo fue tu día?" no te pide la rutina ni el trabajo ese día.
    const r = reviewDay(dayReviewInputFromState(after, withQuick, ents, '2026-11-18'));
    expect(r.restDay).toBe(true);
    expect(r.checks.map((c) => c.id)).not.toContain('rutina');
    expect(r.checks.map((c) => c.id)).not.toContain('tiempo');
    // Si ese día sí hiciste la diaria, cuenta como hecha.
    const did = run([...evs, done('2026-11-18', 'daily-gym')], TODAY, { entities: ents }).habits.routine[0];
    expect(did.strip[28]).toBe('done');
    expect(did.streak).toBe(8);
  });

  it('completarla antes de crearla (registro de días pasados) adelanta su inicio', () => {
    const late = daily('daily-late', { title: 'Late' }, '2026-11-15');
    const s = run([ev('checkin.morning', '2026-10-01', { sleepHours: 7 }), done('2026-11-10', 'daily-late')], TODAY, { entities: [...base, late] });
    expect(s.habits.routine[0].since).toBe('2026-11-10');
  });
});

describe('hábitos: tendencia, veredicto y días flojos', () => {
  it('empeorando contra los 30 días anteriores y "a medias"', () => {
    const ing = daily('daily-ingles', { title: 'Inglés' }, '2026-09-01');
    const prev = range('2026-09-21', '2026-10-20');
    const last = range('2026-10-21', '2026-11-18').filter((d) => wd(d) <= 3); // solo lunes a jueves
    const s = run([...prev, ...last].map((d) => done(d, 'daily-ingles')), TODAY, { entities: [...base, ing] });
    const h = s.habits.routine[0];
    expect(h.prev30.rate).toBe(1);
    expect(h.last30.rate!).toBeLessThan(0.8);
    expect(h.trend).toBe('empeorando');
    expect(h.trendPoints!).toBeLessThan(-10);
    expect(h.verdict).toBe('medias');
  });

  it('mejorando y "flojo"', () => {
    const x = daily('daily-x', { title: 'X' }, '2026-09-01');
    // 30 días anteriores: nada. Últimos 30: uno de cada tres días.
    const last = range('2026-10-21', '2026-11-18').filter((_, i) => i % 3 === 0);
    const s = run([ev('checkin.morning', '2026-09-01', { sleepHours: 7 }), ...last.map((d) => done(d, 'daily-x'))], TODAY, { entities: [...base, x] });
    const h = s.habits.routine[0];
    expect(h.trend).toBe('mejorando');
    expect(h.verdict).toBe('flojo');
    expect(s.habits.summary.flojo).toBe(1);
  });

  it('detecta el día de la semana en que más fallas', () => {
    const x = daily('daily-x', { title: 'X' }, '2026-08-01');
    const days = range('2026-09-01', '2026-11-18').filter((d) => wd(d) !== 0); // nunca los lunes
    const s = run(days.map((d) => done(d, 'daily-x')), TODAY, { entities: [...base, x] });
    const h = s.habits.routine[0];
    expect(h.weakDays).toEqual([0]);
    expect(h.byWeekday[0].rate).toBe(0);
    expect(h.byWeekday[2].rate).toBe(1);
  });
});

describe('hábitos que se arman solos ("Hazlo hábito")', () => {
  const start = ev('checkin.morning', '2026-10-01', { sleepHours: 7 });

  it('algo registrado 3 días en 2 semanas fuera de la rutina se sugiere, con los días en que sueles hacerlo', () => {
    const s = run([start, quick('2026-11-10', 'Fui al gym'), quick('2026-11-12', 'Fui al gym'), quick('2026-11-17', 'Fui al gym'), quick('2026-11-11', 'Meditar'), quick('2026-11-12', 'Meditar')], TODAY, {
      entities: base,
    });
    expect(s.habits.suggestions).toHaveLength(1);
    const g = s.habits.suggestions[0];
    expect(g).toMatchObject({ key: 'quick-fui-al-gym', title: 'Fui al gym', size: 'media', attribute: 'fuerza', times: 3, windowDays: 14, dailyId: null, lastDate: '2026-11-17' });
    expect(g.days).toEqual([1]); // dos martes
  });

  it('lo viejo no cuenta y lo que ya está en la rutina no se sugiere; su historial cuenta para la diaria', () => {
    const evs = [start, quick('2026-10-20', 'Fui al gym'), quick('2026-11-10', 'Fui al gym'), quick('2026-11-12', 'Fui al gym'), quick('2026-11-17', 'Fui al gym')];
    expect(run(evs.slice(0, 3), TODAY, { entities: base }).habits.suggestions).toHaveLength(0);
    const s = run(evs, TODAY, { entities: [...base, daily('daily-gym', { title: 'Fui al gym' }, TODAY)] });
    expect(s.habits.suggestions).toHaveLength(0);
    const h = s.habits.routine[0];
    expect(h.since).toBe(TODAY);
    expect(h.lastDone).toBe('2026-11-17');
    expect(h.strip[29 - 2]).toBe('extra'); // el 17, antes de existir como hábito
  });

  it('una diaria fuera de la rutina que haces seguido sugiere meterla a la rutina', () => {
    const off = daily('daily-off', { title: 'Caminar', routine: false });
    const s = run([start, ...['2026-11-14', '2026-11-16', '2026-11-18'].map((d) => done(d, 'daily-off', 'chica', 'fuerza'))], TODAY, { entities: [...base, off] });
    expect(s.habits.suggestions[0]).toMatchObject({ title: 'daily-off', dailyId: 'daily-off', times: 3 });
  });

  it('si esa diaria fuera de la rutina la registraste como "Hice algo", sugiere meter la misma (no crear otra)', () => {
    const off = daily('daily-leer', { title: 'Leer', routine: false });
    const s = run([start, quick('2026-11-10', 'Leer'), quick('2026-11-13', 'Leer'), quick('2026-11-17', 'Leer')], TODAY, { entities: [...base, off] });
    expect(s.habits.suggestions[0]).toMatchObject({ key: 'quick-leer', dailyId: 'daily-leer', times: 3 });
  });

  it('tras "Hazlo hábito", Hoy (isDailyDone con lo completado hoy) y Hábitos coinciden: lo de hoy como "Hice algo" ya cuenta', () => {
    const correr = daily('daily-correr', { title: 'Correr' }, TODAY);
    const evs = [start, quick('2026-11-12', 'Correr'), quick('2026-11-17', 'Correr'), quick(TODAY, 'Correr')];
    const s = run(evs, TODAY, { entities: [...base, correr] });
    const h = s.habits.routine.find((x) => x.id === 'daily-correr')!;
    expect(h.doneToday).toBe(true);
    // La tarjeta "Rutina de hoy" usa este mismo criterio: no ofrece marcarla otra vez (contaría doble).
    expect(isDailyDone({ doneOn: new Set(s.missions.completedToday) }, correr)).toBe(true);
    expect(s.missions.completedToday).not.toContain('daily-correr');
    const r = reviewDay(dayReviewInputFromState(s, evs, [...base, correr], TODAY));
    expect(r.checks.find((c) => c.id === 'rutina')).toMatchObject({ status: 'done', detail: '1/1' });
  });
});

describe('hábitos a dejar: recaídas por mes y tendencia', () => {
  it('cuenta recaídas en 30 días, tendencia, patrón y frecuencia', () => {
    const v = vice('vice-redes', 'Redes de noche', '2026-08-01');
    const relapses = ['2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16', '2026-11-06'].map((d) => ev('vice.relapse', d, { viceId: 'vice-redes' }));
    const s = run(relapses, TODAY, { entities: [...base, v] });
    const st = s.vices['vice-redes'];
    expect(st.relapses30).toBe(1);
    expect(st.relapsesPrev30).toBe(4);
    expect(st.trend).toBe('mejorando');
    expect(st.verdict).toBe('medias');
    expect(st.worstWeekday).toBe(4); // viernes
    expect(st.everyDays).toBe(18);
    expect(st.byMonth.map((m) => m.count)).toEqual([0, 1, 3, 1]); // desde agosto, cuando empezó a contarse
    expect(st.byMonth.at(-1)!.month).toBe('2026-11');
    expect(st.current).toBe(13);
  });

  it('sin recaídas recientes = vas muy bien; recién agregado = nuevo', () => {
    const s = run([], TODAY, { entities: [...base, vice('vice-a', 'A', '2026-09-01'), vice('vice-b', 'B', '2026-11-18')] });
    expect(s.vices['vice-a'].verdict).toBe('bien');
    expect(s.vices['vice-a'].trend).toBe('estable');
    expect(s.vices['vice-b'].verdict).toBe('nuevo');
    expect(s.vices['vice-b'].trend).toBeNull();
    expect(s.vices['vice-b'].byMonth).toEqual([{ month: '2026-11', count: 0 }]);
  });
});

describe('"¿Cómo fue tu día?": revisiones del día', () => {
  const review = (events: GameEvent[], date = TODAY, entities: Entity[] = base) => {
    const state = run(events, TODAY, { entities });
    return reviewDay(dayReviewInputFromState(state, events, entities, date));
  };

  it('agrupa lo registrado por área y dice qué falta con un % del día', () => {
    const r = review([
      ev('checkin.morning', TODAY, { sleepHours: 7.5 }),
      ev('expense.recorded', TODAY, { amount: 450, concept: 'tacos' }),
      quick(TODAY, 'Llamada con cliente'),
      ev('bounty.drawn', TODAY, { missionId: 'x', title: 'x', size: 'chica', attribute: 'fuerza' }),
    ]);
    // TODAY es jueves: también aplica "tiempo" (días hábiles sin descanso).
    expect(r.checks.map((c) => c.id)).toEqual(['sueno', 'actividad', 'tiempo', 'gastos', 'gente', 'cierre']);
    expect(r.score).toBe(50);
    expect(r.missing.map((c) => c.id)).toEqual(['tiempo', 'gente', 'cierre']);
    expect(r.checks.find((c) => c.id === 'sueno')!.detail).toBe('7.5 h');
    expect(r.checks.find((c) => c.id === 'gastos')!.detail).toContain('450');
    expect(r.logged.map((g) => g.area.id)).toEqual(['misiones', 'dinero', 'cuerpo']);
    expect(r.logged.find((g) => g.area.id === 'dinero')!.items[0]).toMatchObject({ label: 'Gasto', type: 'expense.recorded' });
    expect(r.numbers).toMatchObject({ missions: 1, expense: 450, sleepHours: 7.5, records: 3 });
    expect(r.numbers.xp).toBeGreaterThan(0);
  });

  it('"nada que registrar" cuenta como respondido y no aparece en la lista', () => {
    const r = review([ev('checkin.morning', TODAY, { sleepHours: 7 }), ev('day.check_skipped', TODAY, { checkId: 'gastos', label: 'No gasté nada' })]);
    const g = r.checks.find((c) => c.id === 'gastos')!;
    expect(g.status).toBe('skipped');
    expect(g.progress).toBe(1);
    expect(r.logged.flatMap((x) => x.items).some((i) => i.type === 'day.check_skipped')).toBe(false);
    // Un "nada que registrar" anulado ya no cuenta.
    const voided = review([ev('day.check_skipped', TODAY, { checkId: 'gastos' }, { voidedAt: '2026-11-19T20:00:00Z' })]);
    expect(voided.checks.find((c) => c.id === 'gastos')!.status).toBe('missing');
  });

  it('rutina pendiente con títulos, respetando el día de la semana y cuándo se creó', () => {
    const ents = [...base, daily('daily-a', { title: 'Leer' }, '2026-11-01'), daily('daily-b', { title: 'Inglés', days: [3] }, '2026-11-01'), daily('daily-c', { title: 'Nueva' }, TODAY)];
    const r = review([ev('checkin.morning', '2026-10-01', { sleepHours: 7 }), done(TODAY, 'daily-a')], TODAY, ents);
    const rut = r.checks.find((c) => c.id === 'rutina')!;
    expect(rut.progress).toBeCloseTo(1 / 3);
    expect(rut.pending).toEqual(['Inglés', 'Nueva']);
    expect(rut.detail).toBe('1/3');
    // Ayer (miércoles) no tocaba Inglés y "Nueva" no existía.
    const y = review([ev('checkin.morning', '2026-10-01', { sleepHours: 7 })], '2026-11-18', ents);
    expect(y.isToday).toBe(false);
    expect(y.checks.find((c) => c.id === 'rutina')!.pending).toEqual(['Leer']);
  });

  it('"Tiempo" pregunta cuánto trabajaste: el tiempo con tu gente o de ocio no lo responde', () => {
    // TODAY es jueves (día hábil).
    const fam = [ev('time.logged', TODAY, { minutes: 120, area: 'familia' }), ev('time.logged', TODAY, { minutes: 30, area: 'ocio' })];
    const r = review(fam);
    const t = r.checks.find((c) => c.id === 'tiempo')!;
    expect(t.status).toBe('missing');
    expect(t.detail).toBeNull();
    expect(t.skipLabel).toBe('No trabajé');
    // Solo suma los minutos de trabajo (oficina o proyecto propio).
    const work = review([...fam, ev('time.logged', TODAY, { minutes: 90, area: 'trabajo' }), ev('time.logged', TODAY, { minutes: 45, area: 'proyecto' })]);
    expect(work.checks.find((c) => c.id === 'tiempo')).toMatchObject({ status: 'done', detail: '2 h 15 min' });
  });

  it('un día de descanso no pide misiones ni rutina', () => {
    const r = review([ev('rest_day.marked', TODAY)], TODAY, [...base, daily('daily-a', {}, '2026-11-01')]);
    expect(r.restDay).toBe(true);
    expect(r.checks.map((c) => c.id)).not.toContain('actividad');
    expect(r.checks.map((c) => c.id)).not.toContain('rutina');
  });

  it('gente, agenda, plan, hábitos a dejar y cierre', () => {
    const npc: Entity = { id: 'npc-ana', module: 'npcs', kind: 'npc', data: { name: 'Ana', npcType: 'aliado', relation: 50, key: false }, sort: 0 };
    const todo: Entity = { id: 'todo-1', module: 'planner', kind: 'todo', data: { title: 'Pagar luz', size: 'chica', attribute: 'finanzas', date: TODAY }, sort: 0 };
    const ents = [...base, npc, todo, vice('vice-a', 'Redes', '2026-10-01')];
    const evs = [
      ev('plan.set', '2026-11-18', { forDate: TODAY, items: [{ missionId: 'todo-1', title: 'Pagar luz', size: 'chica', attribute: 'finanzas', kind: 'todo' }] }),
      ev('npc.interaction', TODAY, { npcId: 'npc-ana', note: 'café' }),
      ev('day.closed', TODAY, { note: 'Buen día', mood: 4 }),
    ];
    const r = review(evs, TODAY, ents);
    const by = (id: string) => r.checks.find((c) => c.id === id)!;
    expect(by('gente')).toMatchObject({ status: 'done', detail: 'Ana' });
    expect(by('agenda')).toMatchObject({ status: 'missing', pending: ['Pagar luz'] });
    expect(by('plan')).toMatchObject({ status: 'missing', pending: ['Pagar luz'] });
    expect(by('habitos-dejar').status).toBe('missing');
    expect(by('cierre').detail).toContain('bien');
    expect(r.closure).toEqual({ mood: 4, note: 'Buen día' });
    const r2 = review([...evs, ev('mission.completed', TODAY, { missionId: 'todo-1', title: 'Pagar luz', size: 'chica', attribute: 'finanzas', kind: 'todo' })], TODAY, ents);
    expect(r2.checks.find((c) => c.id === 'agenda')!.status).toBe('done');
    expect(r2.checks.find((c) => c.id === 'plan')!.status).toBe('done');
  });

  it('los días futuros no tienen revisiones', () => {
    const r = review([], addDays(TODAY, 1));
    expect(r.future).toBe(true);
    expect(r.score).toBeNull();
  });

  it('otro sistema agrega su revisión con una entrada', () => {
    const tiempo = eventCheck({ id: 'tiempo', area: 'trabajo', label: 'Tiempo', short: 'cuánto tiempo trabajaste', question: '¿Cuánto tiempo?', types: ['time.logged'], applies: (c) => c.weekday < 5 });
    const evs = [ev('checkin.morning', TODAY, { sleepHours: 7 })];
    const state = run(evs, TODAY, { entities: base });
    const r = reviewDay({ ...dayReviewInputFromState(state, evs, base, TODAY), checks: [...DAY_CHECKS, tiempo] });
    expect(r.missing.map((c) => c.id)).toContain('tiempo');
    const sat = reviewDay({ ...dayReviewInputFromState(state, evs, base, '2026-11-14'), checks: [...DAY_CHECKS, tiempo] });
    expect(sat.checks.map((c) => c.id)).not.toContain('tiempo');
  });

  it('nada de esto da XP', () => {
    const evs = [quick(TODAY, 'Algo'), ev('checkin.morning', TODAY, { sleepHours: 7 })];
    const a = run(evs, TODAY, { entities: base });
    const b = run([...evs, ev('day.check_skipped', TODAY, { checkId: 'gastos' }), ev('day.check_skipped', TODAY, { checkId: 'gente' })], TODAY, { entities: base });
    expect(b.xp.total).toBe(a.xp.total);
    expect(b.gold.balance).toBe(a.gold.balance);
  });
});

describe('herramientas de IA de hábitos', () => {
  const ents = [...base, daily('daily-leer', { title: 'Leer 20 páginas' }, '2026-11-01'), vice('vice-a', 'Redes de noche', '2026-10-01')];
  const mk = (events: GameEvent[] = []) => memoryAssistantStore({ events, entities: ents, today: TODAY });
  const call = (store: ReturnType<typeof mk>, name: string, input: unknown = {}, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });

  it('ver_habitos explica cómo va cada hábito y lo que podría volverse hábito', async () => {
    const store = mk([
      ev('checkin.morning', '2026-10-01', { sleepHours: 7 }),
      ...range('2026-11-01', '2026-11-18').map((d) => done(d, 'daily-leer')),
      quick('2026-11-10', 'Fui al gym'),
      quick('2026-11-12', 'Fui al gym'),
      quick('2026-11-17', 'Fui al gym'),
    ]);
    const r = await call(store, 'ver_habitos');
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Leer 20 páginas [daily-leer]: 100%');
    expect(r.text).toContain('Vas muy bien');
    expect(r.text).toContain('"Fui al gym"');
    expect(r.text).toContain('Redes de noche');
    const overview = await call(store, 'ver_resumen');
    expect(overview.text).toContain('## Hábitos (30 días)');
    expect(overview.text).toContain('revisar_dia');
  });

  it('revisar_dia dice lo que falta y cómo llenarlo', async () => {
    const store = mk([ev('checkin.morning', TODAY, { sleepHours: 6 }), done(TODAY, 'daily-leer')]);
    const r = await call(store, 'revisar_dia');
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('(hoy)');
    expect(r.text).toContain('Sueño (6 h)');
    expect(r.text).toContain('Gente [gente]');
    expect(r.text).toContain('registrar_contacto');
    expect(r.text).toContain('marcar_nada_que_registrar revision="gastos"');
    const future = await call(store, 'revisar_dia', { fecha: '2026-11-20' });
    expect(future.isError).toBe(true);
  });

  it('marcar_nada_que_registrar escribe una vez, se puede deshacer y respeta el modo solo lectura', async () => {
    const store = mk([ev('expense.recorded', '2026-11-18', { amount: 100, concept: 'x' })]);
    const ro = await call(store, 'marcar_nada_que_registrar', { revision: 'gastos' }, false);
    expect(ro.isError).toBe(true);
    const a = await call(store, 'marcar_nada_que_registrar', { revision: 'gastos' });
    expect(a.isError).toBeFalsy();
    expect(a.refs?.events).toHaveLength(1);
    const again = await call(store, 'marcar_nada_que_registrar', { revision: 'gastos' });
    expect(again.text).toContain('ya estaba');
    const yesterday = await call(store, 'marcar_nada_que_registrar', { revision: 'gastos', fecha: '2026-11-18' });
    expect(yesterday.text).toContain('ya tiene registros');
    const bad = await call(store, 'marcar_nada_que_registrar', { revision: 'sueno' });
    expect(bad.isError).toBe(true);
    expect(store.allEvents().filter((e) => e.type === 'day.check_skipped')).toHaveLength(1);
    const after = await call(store, 'revisar_dia');
    expect(after.text).toContain('Gastos (nada que registrar)');
  });
});
