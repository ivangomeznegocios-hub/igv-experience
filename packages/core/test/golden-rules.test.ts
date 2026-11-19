import { describe, expect, it } from 'vitest';
import { addDays, levelInfo, GAME_CONFIG, validateEvent } from '../src';
import { done, ev, run } from './helpers';

/** Generador pseudoaleatorio determinista para pruebas de propiedades. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function randomEvent(r: () => number, date: string) {
  const k = Math.floor(r() * 9);
  switch (k) {
    case 0: return done(date, ['daily-leer', 'daily-entrenar', 'daily-hijo'][Math.floor(r() * 3)], 'chica', 'fuerza');
    case 1: return ev('rest_day.marked', date);
    case 2: return ev('lesson.written', date, { text: 'lección', attribute: 'inteligencia' });
    case 3: return ev('income.recorded', date, { amount: Math.floor(r() * 80000) + 1 });
    case 4: return ev('expense.recorded', date, { amount: Math.floor(r() * 80000) + 1 });
    case 5: return ev('boss.recurring_defeated', date, { bossId: 'rb-perfeccionista', note: 'x' });
    case 6: return ev('checkin.morning', date, { sleepHours: Math.floor(r() * 10) });
    case 7: return done(date, `side-${Math.floor(r() * 5)}`, 'grande', 'finanzas', 'side');
    default: return ev('boss.phase_completed', date, { bossId: 'boss-torre', phaseIndex: Math.floor(r() * 3) });
  }
}

describe('reglas de oro', () => {
  it('la XP nunca se resta: agregar cualquier evento nunca baja la XP total ni los atributos', () => {
    for (let seedN = 1; seedN <= 15; seedN++) {
      const r = rng(seedN);
      const events: any[] = [];
      let prev = run([], '2027-03-31');
      for (let i = 0; i < 60; i++) {
        const date = addDays('2026-11-23', Math.floor(r() * 120));
        events.push(randomEvent(r, date));
        const s = run(events, '2027-03-31');
        expect(s.xp.total).toBeGreaterThanOrEqual(prev.xp.total);
        for (const a of Object.keys(s.attributes.values) as (keyof typeof s.attributes.values)[]) {
          expect(s.attributes.values[a].value).toBeGreaterThanOrEqual(prev.attributes.values[a].value);
        }
        expect(s.xp.ledger.every((e) => e.amount > 0)).toBe(true);
        prev = s;
      }
    }
  });

  it('el paso del tiempo sin actividad nunca quita XP ni baja de nivel', () => {
    const events = Array.from({ length: 10 }, (_, i) => done(addDays('2026-11-23', i)));
    const a = run(events, '2026-12-02');
    const b = run(events, '2027-12-02');
    expect(b.xp.total).toBe(a.xp.total);
    expect(b.level.level).toBe(a.level.level);
  });

  it('un día de descanso marcado no rompe la racha', () => {
    const s = run([done('2026-11-23'), ev('rest_day.marked', '2026-11-24'), done('2026-11-25')], '2026-11-25');
    expect(s.streak.current).toBe(2);
  });

  it('XP por acciones y resultados, no por horas: los eventos no aceptan duración', () => {
    // la XP de una misión depende solo de su tamaño
    const a = run([done('2026-11-23', 'x', 'media')], '2026-11-23');
    const b = run([{ ...done('2026-11-23', 'x', 'media'), payload: { missionId: 'x', title: 'x', size: 'media', attribute: 'fuerza', kind: 'daily', hours: 8 } }], '2026-11-23');
    expect(b.xp.total).toBe(a.xp.total);
  });

  it('una lección escrita tras un fracaso da 30 XP', () => {
    expect(GAME_CONFIG.rewards.lesson).toBe(30);
    const s = run([ev('lesson.written', '2026-11-23', { text: 'lección', attribute: 'inteligencia' })], '2026-11-23');
    expect(s.xp.total).toBe(30);
  });

  it('el dinero real y la XP son sistemas separados', () => {
    const s = run([ev('income.recorded', '2026-11-23', { amount: 1_000_000 })], '2026-11-23');
    expect(s.xp.ledger.filter((e) => e.source !== 'boss_phase' && e.source !== 'achievement')).toHaveLength(0);
    // el ingreso en sí no genera XP: solo los resultados (fase del Dragón / logro) que el jugador logra con él
    expect(s.xp.ledger.every((e) => e.source === 'boss_phase' || e.source === 'achievement')).toBe(true);
  });

  it('el nivel siempre corresponde a la XP total', () => {
    const events = Array.from({ length: 40 }, (_, i) => done(addDays('2026-11-23', i), 'c' + i, 'grande', 'finanzas', 'side'));
    const s = run(events, '2027-01-10');
    expect(s.level).toEqual(levelInfo(s.xp.total, GAME_CONFIG));
  });
});

describe('validación de eventos', () => {
  const base = { id: 'abcdefgh-1', occurredAt: '2026-11-23T10:00:00.000Z', localDate: '2026-11-23' };
  it('acepta eventos válidos', () => {
    expect(validateEvent({ ...base, type: 'checkin.morning', payload: { sleepHours: 7 } }).ok).toBe(true);
    expect(validateEvent({ ...base, type: 'rest_day.marked', payload: {} }).ok).toBe(true);
  });
  it('rechaza tipos desconocidos, montos negativos y evidencia vacía', () => {
    expect(validateEvent({ ...base, type: 'xp.subtract', payload: {} }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'income.recorded', payload: { amount: -5 } }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'skill.rank_unlocked', payload: { skillId: 's', rank: 1, evidence: '   ' } }).ok).toBe(false);
    expect(validateEvent({ ...base, localDate: '2026-13-45', type: 'rest_day.marked', payload: {} }).ok).toBe(false);
  });
});
