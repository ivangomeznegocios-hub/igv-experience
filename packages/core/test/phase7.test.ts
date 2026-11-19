import { describe, expect, it } from 'vitest';
import { addDays, dayCloseBonus, GAME_CONFIG, goalPace, insights, monthPace, personalRecords, validateEvent, weekPace, type Entity } from '../src';
import { bySource, done, ev, run, seed } from './helpers';

const challenge = (id = 'ch-leer', days = 3): Entity => ({ id, module: 'challenges', kind: 'challenge', sort: 0, data: { title: 'Leer', days, attribute: 'inteligencia', size: 'grande' } });
const withCh = (...c: Entity[]) => ({ entities: [...seed, ...c] });

describe('retos de N días', () => {
  it('completar todos los días da la XP de su tamaño, una vez por intento', () => {
    const d = '2026-11-23';
    const events = [ev('challenge.started', d, { challengeId: 'ch-leer' }), ...[0, 1, 2].map((i) => ev('challenge.checked', addDays(d, i), { challengeId: 'ch-leer' }))];
    const s = run(events, addDays(d, 5), withCh(challenge()));
    expect(s.challenges['ch-leer'].completions).toBe(1);
    expect(s.challenges['ch-leer'].last?.status).toBe('completed');
    expect(bySource(s, 'challenge')).toBe(GAME_CONFIG.missionXp.grande);
    expect(s.attributes.values.inteligencia.xp).toBeGreaterThanOrEqual(100);
  });

  it('saltarse un día ya terminado lo hace fallar; hoy sin marcar no', () => {
    const d = '2026-11-23';
    const base = [ev('challenge.started', d, { challengeId: 'ch-leer' }), ev('challenge.checked', d, { challengeId: 'ch-leer' })];
    expect(run(base, addDays(d, 1), withCh(challenge())).challenges['ch-leer'].current?.status).toBe('active');
    const s = run(base, addDays(d, 2), withCh(challenge()));
    expect(s.challenges['ch-leer'].current).toBeNull();
    expect(s.challenges['ch-leer'].last?.status).toBe('failed');
    expect(s.challenges['ch-leer'].last?.closedOn).toBe(addDays(d, 1));
    expect(bySource(s, 'challenge')).toBe(0);
  });

  it('reiniciar mientras hay uno en curso no hace nada; después de fallar sí abre otro', () => {
    const d = '2026-11-23';
    const events = [
      ev('challenge.started', d, { challengeId: 'ch-leer' }),
      ev('challenge.checked', d, { challengeId: 'ch-leer' }),
      ev('challenge.started', addDays(d, 1), { challengeId: 'ch-leer' }),
      ev('challenge.started', addDays(d, 4), { challengeId: 'ch-leer' }),
      ...[4, 5, 6].map((i) => ev('challenge.checked', addDays(d, i), { challengeId: 'ch-leer' })),
    ];
    const s = run(events, addDays(d, 8), withCh(challenge()));
    expect(s.challenges['ch-leer'].attempts.map((a) => a.status)).toEqual(['failed', 'completed']);
  });
});

describe('planear el día', () => {
  const item = (missionId: string) => ({ missionId, title: missionId, size: 'chica', attribute: 'fuerza', kind: 'daily' });
  it('marca lo hecho y da bono de oro (no XP) si cumples todo', () => {
    const d = '2026-11-24';
    const plan = ev('plan.set', '2026-11-23', { forDate: d, items: [item('daily-a'), item('daily-b')] });
    const half = run([plan, done(d, 'daily-a')], d);
    expect(half.plans[d].items.map((i) => i.done)).toEqual([true, false]);
    expect(half.plans[d].completed).toBe(false);
    const full = run([plan, done(d, 'daily-a'), done(d, 'daily-b')], d);
    expect(full.plans[d].completed).toBe(true);
    expect(full.xp.total).toBe(run([done(d, 'daily-a'), done(d, 'daily-b')], d).xp.total); // el plan no da XP
    expect(full.gold.bonuses.some((b) => b.source === 'plan' && b.amount === GAME_CONFIG.goldBonus.planCompleted)).toBe(true);
  });
  it('la última versión del plan gana', () => {
    const d = '2026-11-24';
    const s = run([ev('plan.set', '2026-11-23', { forDate: d, items: [item('x')] }), ev('plan.set', '2026-11-23', { forDate: d, items: [item('y'), item('z')] })], d);
    expect(s.plans[d].items.map((i) => i.missionId)).toEqual(['y', 'z']);
  });
});

describe('bono sorpresa al cerrar el día', () => {
  it('solo en días con misión, determinista por fecha, y nunca toca la XP', () => {
    const d = '2026-11-23';
    const a = run([done(d), ev('day.closed', d, { note: 'ok' })], d);
    const b = run([done(d)], d);
    expect(a.xp.total).toBe(b.xp.total);
    expect(a.gold.balance - b.gold.balance).toBe(dayCloseBonus(d, GAME_CONFIG.goldBonus.dayCloseOptions));
    const empty = run([ev('day.closed', d, { note: 'ok' })], d);
    expect(empty.gold.bonuses).toHaveLength(0);
  });
});

describe('compromisos', () => {
  const big = (d: string) => done(d, 'side-x', 'epica', 'finanzas', 'side'); // 300 XP = 30 oro
  it('cumplir duplica lo apostado; fallar lo pierde; abierto queda apartado', () => {
    const d = '2026-11-23';
    const mk = (kept?: boolean) => [
      big(d),
      ev('pledge.made', d, { pledgeId: 'p1', title: 'Gym 4 veces', stake: 10, deadline: addDays(d, 6) }),
      ...(kept === undefined ? [] : [ev('pledge.resolved', addDays(d, 6), { pledgeId: 'p1', kept })]),
    ];
    const base = run([big(d)], addDays(d, 7)).gold.balance;
    const open = run(mk(), addDays(d, 7)).gold;
    expect(open.balance).toBe(base - 10);
    expect(open.locked).toBe(10);
    expect(run(mk(true), addDays(d, 7)).gold.balance).toBe(base + 10);
    expect(run(mk(false), addDays(d, 7)).gold.balance).toBe(base - 10);
    expect(run(mk(true), addDays(d, 7)).xp.total).toBe(run([big(d)], addDays(d, 7)).xp.total);
  });
  it('no cuenta si no alcanzaba el oro; cuenta solo el primer resultado', () => {
    const d = '2026-11-23';
    const s = run([ev('pledge.made', d, { pledgeId: 'p1', title: 'x', stake: 50, deadline: d })], d);
    expect(s.gold.pledges[0].valid).toBe(false);
    expect(s.gold.balance).toBe(0);
    const t = run(
      [big(d), ev('pledge.made', d, { pledgeId: 'p2', title: 'x', stake: 10, deadline: d }), ev('pledge.resolved', d, { pledgeId: 'p2', kept: false }), ev('pledge.resolved', d, { pledgeId: 'p2', kept: true })],
      d,
    );
    expect(t.gold.pledges[0].status).toBe('missed');
  });
  it('valida los eventos', () => {
    const base = { id: 'abcdefgh-1', occurredAt: '2026-11-23T10:00:00.000Z', localDate: '2026-11-23' };
    expect(validateEvent({ ...base, type: 'pledge.made', payload: { pledgeId: 'p', title: 'x', stake: 0, deadline: '2026-11-30' } }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'plan.set', payload: { forDate: '2026-11-24', items: [] } }).ok).toBe(true);
  });
});

describe('tú vs. tú de la semana pasada', () => {
  it('compara contra la semana pasada hasta este mismo momento', () => {
    const today = '2026-11-25'; // miércoles
    const lw = addDays(today, -7);
    const events = [
      done(addDays(lw, -2), 'a', 'media'), // lunes pasado
      ev('mission.completed', lw, { missionId: 'b', title: 'b', size: 'grande', attribute: 'fuerza', kind: 'side' }, { occurredAt: `${lw}T10:00:00.000Z` }),
      ev('mission.completed', lw, { missionId: 'c', title: 'c', size: 'epica', attribute: 'fuerza', kind: 'side' }, { occurredAt: `${lw}T23:00:00.000Z` }),
      done(today, 'd', 'media'),
    ];
    const s = run(events, today);
    const p = weekPace(s, events, `${today}T15:00:00.000Z`);
    expect(p.missionsLastWeek).toBe(2); // la de las 23:00 aún no "pasaba" a esta hora
    expect(p.missions).toBe(1);
    expect(p.xpLastWeekTotal).toBeGreaterThan(p.xpLastWeek);
  });
});

describe('récords personales', () => {
  it('detecta mejor día y nuevo récord hoy', () => {
    const d = '2026-11-23';
    const s = run([done(d, 'a', 'media'), done(addDays(d, 1), 'a', 'grande')], addDays(d, 1));
    const bestDay = personalRecords(s).find((r) => r.id === 'best_day')!;
    expect(bestDay.brokenNow).toBe(true);
    expect(bestDay.when).toBe(addDays(d, 1));
    expect(bestDay.previous).toBeGreaterThan(0);
    expect(bestDay.previous!).toBeLessThan(bestDay.value);
  });
});

describe('ritmo de metas', () => {
  it('calcula lo que falta por semana y el estado', () => {
    const p = goalPace({ title: 'Leer', target: 100, unit: 'pág', attribute: 'inteligencia', size: 'media', deadline: '2026-12-31' }, { current: 10, target: 100, progress: 0.1, completedOn: null, entries: [] }, '2026-11-01', '2026-11-30');
    expect(p?.status).toBe('behind');
    expect(p!.neededPerWeek).toBeGreaterThan(p!.actualPerWeek);
    const s = run([ev('income.recorded', '2026-11-15', { amount: 60000 })], '2026-11-15');
    expect(monthPace(s)?.status).toBe('ahead');
  });
});

describe('datos sobre ti', () => {
  it('encuentra el efecto del sueño con suficientes datos', () => {
    const start = '2026-08-01';
    const events = [];
    for (let i = 0; i < 40; i++) {
      const d = addDays(start, i);
      const good = i % 2 === 0;
      events.push(ev('checkin.morning', d, { sleepHours: good ? 8 : 5 }));
      events.push(done(d, good ? 'side-' + i : 'daily-leer', good ? 'grande' : 'chica', 'fuerza', good ? 'side' : 'daily'));
    }
    const s = run(events, addDays(start, 41));
    const ids = insights(s, events).map((x) => x.id);
    expect(ids).toContain('sleep');
    expect(ids).toContain('weekday');
    expect(ids).toContain('consistency');
  });
});
