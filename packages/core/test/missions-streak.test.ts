import { describe, expect, it } from 'vitest';
import { addDays } from '../src';
import { bySource, cfgWith, done, ev, run, seed } from './helpers';

describe('XP de misiones', () => {
  it('chica 10, media 30, grande 100, épica 300', () => {
    const s = run(
      [done('2026-11-23', 'a', 'chica'), done('2026-11-23', 'b', 'media'), done('2026-11-23', 'c', 'grande', 'finanzas', 'side'), done('2026-11-23', 'd', 'epica', 'finanzas', 'chapter')],
      '2026-11-23',
    );
    expect(bySource(s, 'mission')).toBe(440);
  });

  it('una diaria cuenta una vez por día; una secundaria, una sola vez', () => {
    const s = run(
      [
        done('2026-11-23', 'daily-leer'),
        done('2026-11-23', 'daily-leer'),
        done('2026-11-24', 'daily-leer'),
        done('2026-11-23', 'side-x', 'grande', 'finanzas', 'side'),
        done('2026-11-25', 'side-x', 'grande', 'finanzas', 'side'),
      ],
      '2026-11-25',
    );
    expect(bySource(s, 'mission')).toBe(10 + 10 + 100);
    expect(s.missions.completions['daily-leer'].count).toBe(2);
  });

  it('el historial conserva el tamaño de la misión cuando se hizo', () => {
    // el evento guarda 'chica'; aunque luego el catálogo la cambie a 'grande', cuenta 10
    const entities = seed.map((e) => (e.id === 'daily-entrenar' ? { ...e, data: { ...e.data, size: 'grande' } } : e));
    const s = run([done('2026-11-23', 'daily-entrenar', 'chica', 'fuerza')], '2026-11-23', { entities });
    expect(bySource(s, 'mission')).toBe(10);
  });

  it('cambiar la configuración recalcula todo el historial', () => {
    const events = [done('2026-11-23', 'a', 'chica'), done('2026-11-23', 'b', 'media')];
    const base = run(events, '2026-11-23');
    const changed = run(events, '2026-11-23', { config: cfgWith((c) => { c.missionXp.chica = 20; c.missionXp.media = 50; }) });
    expect(bySource(base, 'mission')).toBe(40);
    expect(bySource(changed, 'mission')).toBe(70);
  });

  it('eventos anulados no cuentan', () => {
    const s = run([done('2026-11-23', 'a', 'media'), { ...done('2026-11-23', 'b', 'grande', 'finanzas', 'side'), voidedAt: '2026-11-23T13:00:00Z' }], '2026-11-23');
    expect(bySource(s, 'mission')).toBe(30);
  });

  it('eventos futuros (después de hoy) no cuentan', () => {
    const s = run([done('2026-11-23'), done('2026-11-25', 'x')], '2026-11-24');
    expect(bySource(s, 'mission')).toBe(10);
  });
});

describe('racha', () => {
  const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

  it('+5 por cada día seguido, hasta +35 al día', () => {
    const ds = days('2026-11-23', 10);
    const s = run(ds.map((d) => done(d)), ds[9]);
    const bonuses = s.xp.ledger.filter((e) => e.source === 'streak').map((e) => e.amount);
    expect(bonuses).toEqual([5, 10, 15, 20, 25, 30, 35, 35, 35, 35]);
    expect(s.streak.current).toBe(10);
    expect(s.streak.best).toBe(10);
  });

  it('el bono de racha suma a Disciplina', () => {
    const ds = days('2026-11-23', 3);
    const s = run(ds.map((d) => done(d)), ds[2]);
    expect(s.xp.ledger.filter((e) => e.source === 'streak').every((e) => e.attribute === 'disciplina')).toBe(true);
    expect(s.attributes.values.disciplina.xp).toBe(30);
  });

  it('un día sin misiones (ya terminado) rompe la racha, pero no quita XP', () => {
    const s1 = run([done('2026-11-23'), done('2026-11-24')], '2026-11-24');
    const s2 = run([done('2026-11-23'), done('2026-11-24'), done('2026-11-26')], '2026-11-26');
    expect(s2.streak.current).toBe(1);
    expect(s2.streak.best).toBe(2);
    expect(s2.xp.total).toBeGreaterThan(s1.xp.total);
  });

  it('hoy, mientras no termina, no rompe la racha', () => {
    const s = run([done('2026-11-23'), done('2026-11-24')], '2026-11-25');
    expect(s.streak.current).toBe(2);
    expect(s.streak.todayActive).toBe(false);
    expect(s.streak.bonusToday).toBe(15);
  });

  it('un día de descanso mantiene la racha, no suma día ni da bono', () => {
    const s = run([done('2026-11-23'), done('2026-11-24'), ev('rest_day.marked', '2026-11-25'), done('2026-11-26')], '2026-11-26');
    expect(s.streak.current).toBe(3);
    expect(s.xp.ledger.filter((e) => e.source === 'streak').map((e) => e.amount)).toEqual([5, 10, 15]);
    expect(s.xp.ledger.some((e) => e.date === '2026-11-25')).toBe(false);
  });

  it('máximo 2 días de descanso por semana; el tercero no protege la racha', () => {
    // semana del 23 al 29 de noviembre de 2026
    const events = [
      done('2026-11-23'),
      ev('rest_day.marked', '2026-11-24'),
      ev('rest_day.marked', '2026-11-25'),
      ev('rest_day.marked', '2026-11-26'),
      done('2026-11-27'),
    ];
    const s = run(events, '2026-11-27');
    expect(s.streak.current).toBe(1);
    expect(s.streak.restDays.size).toBe(2);
  });

  it('el límite de descanso se reinicia cada lunes', () => {
    const events = [
      done('2026-11-28'),
      ev('rest_day.marked', '2026-11-29'),
      ev('rest_day.marked', '2026-11-30'),
      ev('rest_day.marked', '2026-12-01'),
      done('2026-12-02'),
    ];
    const s = run(events, '2026-12-02');
    expect(s.streak.current).toBe(2);
    expect(s.streak.restDaysThisWeek).toBe(2);
    expect(s.streak.restDaysLeftThisWeek).toBe(0);
  });

  it('descansar nunca quita XP', () => {
    const base = [done('2026-11-23'), done('2026-11-24')];
    const a = run(base, '2026-11-25');
    const b = run([...base, ev('rest_day.marked', '2026-11-25')], '2026-11-25');
    expect(b.xp.total).toBe(a.xp.total);
  });

  it('el bono máximo es configurable y se recalcula', () => {
    const ds = days('2026-11-23', 3);
    const s = run(ds.map((d) => done(d)), ds[2], { config: cfgWith((c) => { c.streak.perDay = 10; c.streak.maxPerDay = 15; }) });
    expect(s.xp.ledger.filter((e) => e.source === 'streak').map((e) => e.amount)).toEqual([10, 15, 15]);
  });
});

describe('selecciones del día', () => {
  it('diarias por espacio y misión de la semana', () => {
    const s = run(
      [
        ev('daily.selected', '2026-11-23', { slot: 'trabajo', missionId: 'daily-prospectos' }),
        ev('daily.selected', '2026-11-23', { slot: 'trabajo', missionId: 'daily-foco' }),
        ev('daily.selected', '2026-11-23', { slot: 'cuerpo', missionId: 'daily-entrenar' }),
        ev('daily.selected', '2026-11-22', { slot: 'libre', missionId: 'daily-leer' }),
        ev('weekly.selected', '2026-11-23', { missionId: 'side-bot-whatsapp' }),
      ],
      '2026-11-24',
    );
    expect(s.missions.dailySelections).toEqual({});
    const t = run(
      [ev('daily.selected', '2026-11-24', { slot: 'trabajo', missionId: 'daily-prospectos' }), ev('daily.selected', '2026-11-24', { slot: 'trabajo', missionId: 'daily-foco' }), ev('weekly.selected', '2026-11-23', { missionId: 'side-bot-whatsapp' })],
      '2026-11-24',
    );
    expect(t.missions.dailySelections).toEqual({ trabajo: 'daily-foco' });
    expect(t.missions.weeklyMissionId).toBe('side-bot-whatsapp');
    const nextWeek = run([ev('weekly.selected', '2026-11-23', { missionId: 'side-bot-whatsapp' })], '2026-11-30');
    expect(nextWeek.missions.weeklyMissionId).toBeNull();
  });

  it('energía del check-in de hoy', () => {
    const s = run([ev('checkin.morning', '2026-11-23', { sleepHours: 5 })], '2026-11-23');
    expect(s.energy).toEqual({ sleepHours: 5, value: 50, low: true });
    const t = run([ev('checkin.morning', '2026-11-23', { sleepHours: 5 })], '2026-11-24');
    expect(t.energy.value).toBeNull();
  });
});
