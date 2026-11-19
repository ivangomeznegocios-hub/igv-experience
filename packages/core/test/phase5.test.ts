import { describe, expect, it } from 'vitest';
import {
  calendarCellState,
  calendarYearWeeks,
  frequentMissions,
  isInRoutine,
  lifeEndDate,
  pickForDate,
  quickMissionId,
  validateEvent,
  weekDays,
  weekReport,
  yearReview,
  zonedTimeToUtc,
  GAME_CONFIG,
  type Entity,
} from '../src';
import { bySource, done, ev, run, seed } from './helpers';

const ent = (id: string, module: string, kind: string, data: any): Entity => ({ id, module, kind, data, sort: 0 });

describe('misiones rápidas y agenda', () => {
  it('una misión rápida da la XP de su tamaño y se repite una vez por día', () => {
    const s = run([done('2026-11-23', 'quick-gym', 'media', 'fuerza', 'quick'), done('2026-11-23', 'quick-gym', 'media', 'fuerza', 'quick'), done('2026-11-24', 'quick-gym', 'media', 'fuerza', 'quick')], '2026-11-24');
    expect(bySource(s, 'mission')).toBe(60);
    expect(s.attributes.values.fuerza.xp).toBeGreaterThanOrEqual(60);
  });

  it('un pendiente de la agenda cuenta una sola vez', () => {
    const s = run([done('2026-11-23', 'todo-1', 'grande', 'finanzas', 'todo'), done('2026-11-24', 'todo-1', 'grande', 'finanzas', 'todo')], '2026-11-24');
    expect(bySource(s, 'mission')).toBe(100);
  });

  it('registrar en un día pasado cuenta para la racha de ese día', () => {
    const s = run([done('2026-11-23'), done('2026-11-25'), done('2026-11-24')], '2026-11-25');
    expect(s.streak.current).toBe(3);
  });

  it('quickMissionId normaliza acentos y espacios', () => {
    expect(quickMissionId('  Fui al Gimnasio — pierna!  ')).toBe('quick-fui-al-gimnasio-pierna');
    expect(quickMissionId('Llamé a mamá')).toBe('quick-llame-a-mama');
  });

  it('las diarias de la rutina aparecen según el día de la semana', () => {
    expect(isInRoutine({}, 3)).toBe(true);
    expect(isInRoutine({ routine: false }, 3)).toBe(false);
    expect(isInRoutine({ days: [0, 2, 4] }, 2)).toBe(true);
    expect(isInRoutine({ days: [0, 2, 4] }, 5)).toBe(false);
  });

  it('frequentMissions ordena por frecuencia', () => {
    const events = [done('2026-11-20', 'daily-leer'), done('2026-11-21', 'daily-leer'), done('2026-11-21', 'quick-x', 'chica', 'fuerza', 'quick'), done('2026-11-21', 'side-1', 'grande', 'fuerza', 'side')];
    const f = frequentMissions(events, '2026-11-22');
    expect(f.map((x) => x.missionId)).toEqual(['daily-leer', 'quick-x']);
    expect(f[0].count).toBe(2);
  });
});

describe('misión sorpresa', () => {
  const drawn = (date: string, missionId = 'daily-leer') => ev('bounty.drawn', date, { missionId, title: 'Leer', size: 'media', attribute: 'inteligencia' });

  it('da el bono solo si se completa ese mismo día', () => {
    const bonus = Math.round((GAME_CONFIG.missionXp.media * GAME_CONFIG.bounty.bonusPercent) / 100);
    const s = run([drawn('2026-11-23'), done('2026-11-23', 'daily-leer', 'media')], '2026-11-23');
    expect(bySource(s, 'bounty')).toBe(bonus);
    expect(s.bounty.today?.completed).toBe(true);
    const s2 = run([drawn('2026-11-23'), done('2026-11-24', 'daily-leer', 'media')], '2026-11-24');
    expect(bySource(s2, 'bounty')).toBe(0);
  });

  it('solo cuenta el primer sorteo del día', () => {
    const s = run([drawn('2026-11-23', 'daily-leer'), drawn('2026-11-23', 'daily-hijo'), done('2026-11-23', 'daily-hijo')], '2026-11-23');
    expect(bySource(s, 'bounty')).toBe(0);
    expect(s.bounty.today?.missionId).toBe('daily-leer');
  });

  it('pickForDate es determinista', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(pickForDate(items, '2026-11-23')).toBe(pickForDate(items, '2026-11-23'));
    expect(pickForDate([], '2026-11-23')).toBeNull();
  });
});

describe('oro y tienda', () => {
  it('se gana 1 de oro por cada 10 XP y canjear no toca la XP', () => {
    const events = [done('2026-11-23', 's1', 'grande', 'fuerza', 'side')];
    const before = run(events, '2026-11-23');
    expect(before.gold.earned).toBe(before.xp.ledger.reduce((t, e) => t + Math.floor(e.amount / GAME_CONFIG.gold.xpPerGold), 0));
    expect(before.gold.earned).toBeGreaterThanOrEqual(10);
    const after = run([...events, ev('reward.redeemed', '2026-11-23', { rewardId: 'r', name: 'Cena', cost: 8 })], '2026-11-23');
    expect(after.xp.total).toBe(before.xp.total);
    expect(after.gold.balance).toBe(before.gold.earned - 8);
  });

  it('un canje sin oro suficiente no cuenta y el saldo nunca es negativo', () => {
    const s = run([ev('reward.redeemed', '2026-11-22', { rewardId: 'r', name: 'Viaje', cost: 5 }), done('2026-11-23', 's1', 'grande', 'fuerza', 'side')], '2026-11-23');
    expect(s.gold.redemptions[0].valid).toBe(false);
    expect(s.gold.balance).toBe(s.gold.earned);
  });
});

describe('metas, enemigos, biblioteca, ahorro y cuerpo', () => {
  const goal = ent('goal-1', 'goals', 'goal', { title: 'Leer 3 libros', target: 3, unit: 'libros', attribute: 'inteligencia', size: 'grande' });
  it('una meta da XP una sola vez al llegar al objetivo', () => {
    const p = (d: string, n = 1) => ev('goal.progress', d, { goalId: 'goal-1', amount: n });
    const s = run([p('2026-11-20'), p('2026-11-21'), p('2026-11-22'), p('2026-11-23')], '2026-11-23', { entities: [...seed, goal] });
    expect(s.goals['goal-1'].current).toBe(4);
    expect(s.goals['goal-1'].completedOn).toBe('2026-11-22');
    expect(bySource(s, 'goal')).toBe(GAME_CONFIG.missionXp.grande);
  });

  it('los enemigos cuentan días sin caer y no tocan la XP', () => {
    const vice = ent('v1', 'habits', 'vice', { name: 'Redes', startDate: '2026-11-01' });
    const s = run([ev('vice.relapse', '2026-11-10', { viceId: 'v1' })], '2026-11-20', { entities: [...seed, vice] });
    expect(s.vices.v1.current).toBe(10);
    expect(s.vices.v1.best).toBe(10);
    expect(s.xp.total).toBe(0);
    const s2 = run([ev('vice.relapse', '2026-11-03', { viceId: 'v1' })], '2026-11-05', { entities: [...seed, vice] });
    expect(s2.vices.v1.best).toBe(2);
    expect(s2.vices.v1.current).toBe(2);
  });

  it('terminar un libro da XP una vez por libro', () => {
    const f = (d: string) => ev('library.finished', d, { bookId: 'b1', title: 'Libro', size: 'media', attribute: 'inteligencia' });
    const s = run([f('2026-11-20'), f('2026-11-21')], '2026-11-21');
    expect(bySource(s, 'library')).toBe(GAME_CONFIG.missionXp.media);
    expect(s.library.byYear['2026']).toBe(1);
  });

  it('el ahorro y el cuerpo no dan XP', () => {
    const sv = ent('sv1', 'finance', 'savings', { name: 'Fondo', target: 1000 });
    const s = run(
      [ev('savings.moved', '2026-11-20', { goalId: 'sv1', amount: 600 }), ev('savings.moved', '2026-11-21', { goalId: 'sv1', amount: -100 }), ev('body.logged', '2026-11-21', { weightKg: 82.5, workout: 'Pierna' })],
      '2026-11-21',
      { entities: [...seed, sv] },
    );
    expect(s.savings.sv1.current).toBe(500);
    expect(s.savings.sv1.progress).toBe(0.5);
    expect(s.body.lastWeight?.kg).toBe(82.5);
    expect(s.xp.total).toBe(0);
  });

  it('valida los eventos nuevos', () => {
    const base = { id: 'abcdefgh-1', occurredAt: '2026-11-21T12:00:00.000Z', localDate: '2026-11-21' };
    expect(validateEvent({ ...base, type: 'body.logged', payload: {} }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'savings.moved', payload: { goalId: 'x', amount: 0 } }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'reward.redeemed', payload: { rewardId: 'x', name: 'y', cost: 0 } }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'mission.completed', payload: { missionId: 'q', title: 'q', size: 'chica', attribute: 'fuerza', kind: 'quick' } }).ok).toBe(true);
  });
});

describe('calendario de vida', () => {
  it('las semanas del año van de lunes a domingo y se recortan al año', () => {
    const w = calendarYearWeeks(2026);
    expect(w[0]).toEqual({ monday: '2025-12-29', start: '2026-01-01', end: '2026-01-04' });
    expect(w.at(-1)!.end).toBe('2026-12-31');
    expect(w.length).toBeGreaterThanOrEqual(53);
    expect(w.length).toBeLessThanOrEqual(54);
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i].monday);
  });

  it('estado de cada semana respecto a la vida', () => {
    const end = lifeEndDate('1990-04-15', GAME_CONFIG);
    expect(end).toBe('2080-04-14');
    expect(calendarCellState({ start: '1990-01-01', end: '1990-01-07' }, '1990-04-15', '2026-11-19', end)).toBe('before');
    expect(calendarCellState({ start: '2026-11-16', end: '2026-11-22' }, '1990-04-15', '2026-11-19', end)).toBe('current');
    expect(calendarCellState({ start: '2000-01-03', end: '2000-01-09' }, '1990-04-15', '2026-11-19', end)).toBe('lived');
    expect(calendarCellState({ start: '2080-05-01', end: '2080-05-07' }, '1990-04-15', '2026-11-19', end)).toBe('after');
  });

  it('weekDays da lunes a domingo', () => {
    expect(weekDays('2026-11-19')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  });

  it('zonedTimeToUtc convierte hora de CDMX a UTC', () => {
    expect(zonedTimeToUtc('2026-11-20', '21:00', 'America/Mexico_City')).toBe('2026-11-21T03:00:00.000Z');
  });
});

describe('reportes', () => {
  it('reporte semanal compara con la semana anterior', () => {
    const events = [done('2026-11-09', 's0', 'media', 'fuerza', 'side'), done('2026-11-16', 's1', 'grande', 'fuerza', 'side'), done('2026-11-17'), ev('rest_day.marked', '2026-11-18')];
    const s = run(events, '2026-11-22');
    const r = weekReport(s, events, '2026-11-19');
    expect(r.weekStart).toBe('2026-11-16');
    expect(r.missions).toBe(2);
    expect(r.missionsPrev).toBe(1);
    expect(r.restDays).toBe(1);
    expect(r.bestDay?.date).toBe('2026-11-16');
    expect(r.xp).toBeGreaterThan(r.xpPrev);
  });

  it('resumen del año', () => {
    const events = [done('2026-03-01'), done('2026-03-02'), done('2026-03-03'), done('2026-05-01', 's1', 'grande', 'fuerza', 'side'), done('2025-12-31')];
    const s = run(events, '2026-12-31');
    const s0 = run(events, '2025-12-31');
    const y = yearReview(s, s0, 2026);
    expect(y.missions).toBe(4);
    expect(y.bestStreakInYear).toBe(3);
    expect(y.topMissions[0]).toEqual({ title: 'daily-leer', count: 3 });
    expect(y.byMonth[2]).toBeGreaterThan(0);
  });
});
