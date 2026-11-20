import { describe, expect, it } from 'vitest';
import { addDays, nextPlay, type Entity, type GameEvent } from '../src';
import { done, ev, run, seed } from './helpers';

const START = '2026-11-23'; // lunes
const ROUTINE: [string, any, any][] = [
  ['daily-prospectos', 'media', 'carisma'],
  ['daily-foco', 'media', 'disciplina'],
  ['daily-entrenar', 'chica', 'fuerza'],
  ['daily-caminar', 'chica', 'fuerza'],
  ['daily-ingles', 'chica', 'inteligencia'],
  ['daily-hijo', 'media', 'relaciones'],
  ['daily-leer', 'chica', 'inteligencia'],
];

const withSettings = (patch: Record<string, unknown>): Entity[] =>
  seed.map((e) => (e.id === 'settings' ? { ...e, data: { ...(e.data as object), ...patch } } : e));
const ents = withSettings({ scoreStart: START });

/** Toda la rutina + cierre: 50 + 10 de 75 posibles = 80 → ganado. */
const winDay = (d: string): GameEvent[] => [...ROUTINE.map(([id, s, a]) => done(d, id, s, a)), ev('day.closed', d, { note: '' })];
/** Solo una diaria chica: salva el día pero no lo gana. */
const saveDay = (d: string): GameEvent[] => [done(d, 'daily-leer', 'chica', 'inteligencia')];
/** Algo registrado pero sin misiones: no ganado. */
const loseDay = (d: string): GameEvent[] => [ev('checkin.morning', d, { sleepHours: 7 })];

const play = (events: GameEvent[], today: string, entities = ents) => run(events, today, { entities });

describe('marcador: puntaje del día', () => {
  it('sin scoreStart no se juzga nada y el oro queda igual', () => {
    const events = [...winDay(START), ...loseDay(addDays(START, 1))];
    const a = run(events, addDays(START, 2));
    const b = play(events, addDays(START, 2));
    expect(a.days.start).toBeNull();
    expect(a.days.today).toBeNull();
    expect(a.gold).toEqual(b.gold);
    expect(a.xp.total).toBe(b.xp.total);
  });

  it('rutina completa + cierre gana (80); los pesos de lo que no aplica se reparten', () => {
    const s = play(winDay(START), addDays(START, 1));
    const r = s.days.byDate[START];
    expect(r.score).toBe(80);
    expect(r.status).toBe('won');
    expect(r.parts.map((p) => p.id)).toEqual(['routine', 'log', 'close']);
  });

  it('con plan, "tus 3" pesan 25', () => {
    const items = ROUTINE.slice(0, 3).map(([id, size, attribute]) => ({ missionId: id, title: id, size, attribute, kind: 'daily' }));
    const s = play([ev('plan.set', addDays(START, -1), { forDate: START, items }), ...saveDay(START)], START);
    const t = s.days.today!;
    expect(t.parts.map((p) => p.id)).toEqual(['routine', 'plan', 'log', 'close']);
    // Lo que más suma va primero: lo que está en tu plan y en tu rutina.
    expect(t.pending[0].inPlan && t.pending[0].inRoutine).toBe(true);
    expect(t.pending[0].points).toBeGreaterThan(t.pending.at(-1)!.points);
  });

  it('hoy nunca cuenta como no ganado', () => {
    const s = play(loseDay(START), START);
    expect(s.days.today!.status).toBe('pending');
    const next = play(loseDay(START), addDays(START, 1));
    expect(next.days.byDate[START].status).toBe('lost');
  });

  it('día de descanso es neutro; día salvado también', () => {
    const d1 = addDays(START, 1);
    const s = play([...saveDay(START), ev('rest_day.marked', d1, {})], addDays(START, 2));
    expect(s.days.byDate[START].status).toBe('saved');
    expect(s.days.byDate[d1].status).toBe('rest');
  });

  it('con un mínimo definido, solo ese salva el día', () => {
    const e = withSettings({ scoreStart: START, dayMinimum: { missionId: 'daily-caminar', title: 'Caminar o estirar 20 min' } });
    const s = play([...saveDay(START), done(addDays(START, 1), 'daily-caminar', 'chica', 'fuerza')], addDays(START, 2), e);
    expect(s.days.byDate[START].status).toBe('lost');
    expect(s.days.byDate[addDays(START, 1)].status).toBe('saved');
  });

  it('la rutina se congela al cerrar: editarla después no cambia el día', () => {
    const d = START;
    const events = [done(d, 'daily-leer', 'chica', 'inteligencia'), ev('day.closed', d, { note: '', routine: ['daily-leer'] })];
    const s = play(events, addDays(d, 1));
    // Solo tocaba "Leer" y lo hiciste: 50 + 10 de 75 = 80.
    expect(s.days.byDate[d].score).toBe(80);
    expect(s.days.byDate[d].status).toBe('won');
  });

  it('nada que registrar cuenta como registrado', () => {
    const d = START;
    const base = winDay(d);
    const a = play(base, addDays(d, 1)).days.byDate[d].score;
    const b = play(
      [...base, ev('checkin.morning', d, { sleepHours: 7 }), ...['gastos', 'gente', 'tiempo'].map((checkId) => ev('day.check_skipped', d, { checkId }))],
      addDays(d, 1),
    ).days.byDate[d].score;
    expect(a).toBe(80);
    expect(b).toBe(100);
  });
});

describe('marcador: impulso', () => {
  it('sube por escalones con días ganados seguidos', () => {
    const events = [0, 1, 2, 3].flatMap((i) => winDay(addDays(START, i)));
    const s = play(events, addDays(START, 4));
    expect([0, 1, 2, 3, 4].map((i) => s.days.byDate[addDays(START, i)].pct)).toEqual([100, 100, 125, 125, 150]);
    expect(s.days.momentum.pct).toBe(150);
    expect(s.days.momentum.next).toEqual({ wins: 7, pct: 175, missing: 3 });
    expect(s.days.totals).toMatchObject({ won: 4, currentRun: 4, bestRun: 4 });
  });

  it('un día no ganado baja un escalón (no a cero); salvar o descansar lo mantiene', () => {
    const events = [0, 1, 2, 3].flatMap((i) => winDay(addDays(START, i)));
    const lost = play([...events, ...loseDay(addDays(START, 4))], addDays(START, 5));
    expect(lost.days.momentum.pct).toBe(125);
    const saved = play([...events, ...saveDay(addDays(START, 4))], addDays(START, 5));
    expect(saved.days.momentum.pct).toBe(150);
    const rest = play([...events, ev('rest_day.marked', addDays(START, 4), {})], addDays(START, 5));
    expect(rest.days.momentum.pct).toBe(150);
  });

  it('el impulso de un día sale solo de los días anteriores', () => {
    const events = [0, 1].flatMap((i) => winDay(addDays(START, i)));
    const before = play(events, addDays(START, 2));
    const after = play([...events, ...winDay(addDays(START, 2))], addDays(START, 2));
    expect(before.days.byDate[addDays(START, 2)].pct).toBe(after.days.byDate[addDays(START, 2)].pct);
  });

  it('una pausa de varios días es neutra y baja un solo escalón; regresar con una misión lo recupera', () => {
    const won = [0, 1, 2, 3].flatMap((i) => winDay(addDays(START, i))); // impulso 150
    const back = addDays(START, 9); // 5 días sin nada
    const s = play(won, back);
    for (let i = 4; i < 9; i++) expect(s.days.byDate[addDays(START, i)].status).toBe('pause');
    expect(s.days.momentum.pct).toBe(125);
    expect(s.days.comeback).toEqual({ pausedDays: 5, done: false, restoresPct: 150 });
    expect(nextPlay(s, { hour: 10 }).action.kind).toBe('comeback');

    const s2 = play([...won, ...saveDay(back)], back);
    expect(s2.days.comeback?.done).toBe(true);
    const s3 = play([...won, ...saveDay(back)], addDays(back, 1));
    expect(s3.days.byDate[back].status).toBe('saved');
    expect(s3.days.momentum.pct).toBe(150);
  });

  it('un solo día vacío no es pausa', () => {
    const won = [0, 1].flatMap((i) => winDay(addDays(START, i)));
    const s = play([...won, ...winDay(addDays(START, 3))], addDays(START, 4));
    expect(s.days.byDate[addDays(START, 2)].status).toBe('lost');
  });

  it('el marcador y el impulso nunca tocan la XP', () => {
    const events = [0, 1, 2, 3].flatMap((i) => winDay(addDays(START, i)));
    const a = run(events, addDays(START, 6));
    const b = play(events, addDays(START, 6));
    expect(b.xp.total).toBe(a.xp.total);
    expect(b.attributes).toEqual(a.attributes);
  });
});

describe('siguiente jugada', () => {
  it('sin marcador propone arrancarlo; en la mañana, el sueño; luego lo que más suma; de noche, cerrar', () => {
    expect(nextPlay(run([], START), { hour: 9 }).action.kind).toBe('start');
    expect(nextPlay(play([], START), { hour: 9 }).action.kind).toBe('sleep');
    const s = play([ev('checkin.morning', START, { sleepHours: 7 }), ev('plan.set', START, { forDate: START, items: [] })], START);
    const p = nextPlay(s, { hour: 16 });
    expect(p.action.kind).toBe('mission');
    const all = play([ev('checkin.morning', START, { sleepHours: 7 }), ...ROUTINE.map(([id, sz, a]) => done(START, id, sz, a))], START);
    expect(nextPlay(all, { hour: 21 }).action.kind).toBe('close');
  });

  it('cerrado y sin plan para mañana: planear mañana', () => {
    const s = play(winDay(START), START);
    expect(nextPlay(s, { hour: 22 }).action).toEqual({ kind: 'plan-tomorrow', date: addDays(START, 1) });
  });
});

describe('rendimiento', () => {
  it('3 años de días se calculan rápido', () => {
    const events: GameEvent[] = [];
    for (let i = 0; i < 365 * 3; i++) {
      const d = addDays(START, i);
      if (i % 9 === 0) continue;
      events.push(...(i % 3 ? winDay(d) : saveDay(d)));
    }
    const t0 = Date.now();
    const s = play(events, addDays(START, 365 * 3));
    expect(Object.keys(s.days.byDate).length).toBe(365 * 3 + 1);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

describe('marcador: arreglos de la revisión', () => {
  // Rutina de lunes a viernes: sábado y domingo vacíos son días libres.
  const weekdays = ents.map((e) => (e.module === 'missions' && e.kind === 'daily' ? { ...e, data: { ...(e.data as object), days: [0, 1, 2, 3, 4] } } : e));

  it('una pausa con días libres en medio baja un solo escalón y se recupera al regresar', () => {
    const won = [0, 1, 2, 3].flatMap((i) => winDay(addDays(START, i))); // lun–jue: impulso 150
    // vie vacío, sáb y dom libres vacíos, lun vacío: todo es la misma pausa.
    const back = addDays(START, 8); // martes
    const s = play(won, back, weekdays);
    expect(s.days.momentum.pct).toBe(125);
    expect(s.days.comeback).toEqual({ pausedDays: 4, done: false, restoresPct: 150 });
    const s2 = play([...won, ...saveDay(back)], addDays(back, 1), weekdays);
    expect(s2.days.momentum.pct).toBe(150);
  });

  it('regresar en fin de semana (día libre) también cuenta como regreso', () => {
    const won = [0, 1, 2].flatMap((i) => winDay(addDays(START, i))); // lun–mié: 125
    const sunday = addDays(START, 6); // jue y vie vacíos (pausa), sáb libre vacío
    const s = play(won, sunday, weekdays);
    expect(s.days.comeback?.restoresPct).toBe(125);
    const s2 = play([...won, ...saveDay(sunday)], addDays(sunday, 1), weekdays);
    expect(s2.days.momentum.pct).toBe(125);
  });

  it('un pendiente de tus 3 que ya hiciste la noche anterior cuenta como hecho (no se queda atorado)', () => {
    const d = addDays(START, 1);
    const item = { missionId: 'todo-x', title: 'Mandar propuesta', size: 'media', attribute: 'finanzas', kind: 'todo' };
    const s = play([ev('plan.set', START, { forDate: d, items: [item] }), done(START, 'todo-x', 'media', 'finanzas', 'todo')], d);
    expect(s.plans[d].items[0].done).toBe(true);
    expect(s.days.today!.pending.some((p) => p.missionId === 'todo-x')).toBe(false);
    expect(s.days.today!.parts.find((p) => p.id === 'plan')).toMatchObject({ done: 1, due: 1 });
  });

  it('editar la nota de un cierre pasado no descongela su rutina', () => {
    const d = START;
    const events = [done(d, 'daily-leer', 'chica', 'inteligencia'), ev('day.closed', d, { note: '', routine: ['daily-leer'] })];
    const edited = [...events, ev('day.closed', d, { note: 'Editada', mood: 4 })];
    const s = play(edited, addDays(d, 1));
    expect(s.days.byDate[d].score).toBe(80);
    expect(s.dayClosures[d].note).toBe('Editada');
  });
});
