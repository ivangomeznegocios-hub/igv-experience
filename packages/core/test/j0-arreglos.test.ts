import { describe, expect, it } from 'vitest';
import { addDays, endReviewOpensOn, quickMissionId, seasonCompleted, type Entity, type SeasonData } from '../src';
import { done, ev, run, seed } from './helpers';

const big = (d: string, id = 'side-x') => done(d, id, 'grande', 'finanzas', 'side');

describe('oro: canjes y compromisos en orden (barrido cronológico)', () => {
  it('un canje cuenta solo si alcanzaba el oro en su fecha, aunque después ganes más', () => {
    const d = '2026-11-23';
    const s = run(
      [
        big(d, 'a'), // 10 de oro + 5 del logro "Primer paso"
        ev('reward.redeemed', d, { rewardId: 'r1', name: 'Café', cost: 8 }),
        ev('reward.redeemed', addDays(d, 1), { rewardId: 'r2', name: 'Cine', cost: 10 }), // solo quedan 7
        big(addDays(d, 2), 'b'),
        ev('reward.redeemed', addDays(d, 2), { rewardId: 'r3', name: 'Libro', cost: 5 }),
      ],
      addDays(d, 3),
    );
    expect(s.gold.redemptions.map((r) => r.valid)).toEqual([true, false, true]);
    expect(s.gold.balance).toBe(s.gold.earned - s.gold.spent);
    expect(s.gold.spent).toBe(13);
  });

  it('el pago de un compromiso cumplido alcanza para un canje posterior', () => {
    const d = '2026-11-23';
    const s = run(
      [
        big(d, 'a'), // 15 (misión + logro)
        ev('pledge.made', d, { pledgeId: 'p1', title: 'x', stake: 10, deadline: addDays(d, 2) }),
        ev('pledge.resolved', addDays(d, 2), { pledgeId: 'p1', kept: true }), // regresa 20
        ev('reward.redeemed', addDays(d, 3), { rewardId: 'r', name: 'Cena', cost: 25 }), // 5 + 20 = 25
      ],
      addDays(d, 4),
    );
    expect(s.gold.pledges[0].payout).toBe(20);
    expect(s.gold.redemptions[0].valid).toBe(true);
    expect(s.gold.balance).toBe(0);
  });

  it('miles de canjes no tardan (antes era cuadrático)', () => {
    const events = [];
    const start = '2024-01-01';
    for (let i = 0; i < 1500; i++) {
      const d = addDays(start, i);
      events.push(big(d, `m${i}`), ev('reward.redeemed', d, { rewardId: `r${i}`, name: 'x', cost: 5 }));
    }
    const t0 = Date.now();
    const s = run(events, addDays(start, 1500));
    expect(s.gold.redemptions.every((r) => r.valid)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('temporada: la revisión de fin solo cuenta en su última semana', () => {
  const season = seed.find((e) => e.id === 'season-1') as Entity<SeasonData>;

  it('escribirla al principio no completa la temporada ni da el logro', () => {
    const start = season.data.startDate;
    const s = run([ev('season.review', addDays(start, 1), { seasonId: 'season-1', phase: 'end', text: 'Ya' })], addDays(start, 2));
    expect(s.seasons.completedDates).toEqual([]);
    expect(s.achievements['ach-temporada-completa'].unlocked).toBe(false);
    expect(seasonCompleted(s.seasons, season, 7)).toBe(false);
  });

  it('reescribirla dentro de la ventana sí la completa', () => {
    const start = season.data.startDate;
    const opens = endReviewOpensOn(season, 7);
    expect(opens).toBe(addDays(season.data.endDate, -6));
    const s = run(
      [
        ev('season.review', addDays(start, 1), { seasonId: 'season-1', phase: 'end', text: 'Antes' }),
        ev('season.review', opens, { seasonId: 'season-1', phase: 'end', text: 'Fin' }),
      ],
      opens,
    );
    expect(s.seasons.completedDates).toEqual([opens]);
    expect(s.achievements['ach-temporada-completa'].date).toBe(opens);
    expect(seasonCompleted(s.seasons, season, 7)).toBe(true);
  });
});

describe('reto del día: id de misión rápida con acentos', () => {
  it('quita acentos igual que "Hice algo"', () => {
    expect(quickMissionId('Prueba relámpago de Fuerza física')).toBe('quick-prueba-relampago-de-fuerza-fisica');
  });
});
