import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, addDays, nextPlay, type Entity, type GameEvent } from '../src';
import { done, ev, run, seed } from './helpers';

const START = '2026-11-23';
const ents: Entity[] = seed.map((e) => (e.id === 'settings' ? { ...e, data: { ...(e.data as object), scoreStart: START } } : e));
const play = (events: GameEvent[], today: string) => run(events, today, { entities: ents });
/** 100 XP de Fuerza física (misión grande). */
const fuerza = (d: string, id = 'side-gym') => done(d, id, 'grande', 'fuerza', 'side');
const build = (d: string, districtId: string, level: number) => ev('city.build_started', d, { districtId, level });
const inaugurate = (d: string, districtId: string, level: number) => ev('city.inaugurated', d, { districtId, level });

describe('ciudad: materiales y obras', () => {
  it('sin scoreStart la ciudad no ha empezado; con él, el Centro arranca en nivel 1', () => {
    expect(run([], START).city.start).toBeNull();
    const s = play([], START);
    expect(s.city.start).toBe(START);
    expect(s.city.districts.disciplina.level).toBe(1);
    expect(s.city.districts.fuerza.level).toBe(0);
    expect(s.city.size).toBe(1);
  });

  it('1 material por cada XP del atributo; la XP de antes de empezar no cuenta', () => {
    const s = play([fuerza(addDays(START, -3), 'old'), fuerza(START)], START);
    expect(s.city.districts.fuerza.materials).toBe(100);
  });

  it('una obra descuenta materiales, tarda sus días y sube de nivel al inaugurarla', () => {
    const cost = GAME_CONFIG.city.levels[0].cost;
    const s1 = play([fuerza(START), build(START, 'fuerza', 1)], START);
    expect(s1.city.districts.fuerza.materials).toBe(100 - cost);
    expect(s1.city.works[0]).toMatchObject({ districtId: 'fuerza', level: 1, ready: false, daysLeft: 1 });
    expect(s1.city.crews.busy).toBe(1);

    // Inaugurar antes de tiempo no cuenta.
    const early = play([fuerza(START), build(START, 'fuerza', 1), inaugurate(START, 'fuerza', 1)], START);
    expect(early.city.districts.fuerza.level).toBe(0);
    expect(early.city.rejected).toHaveLength(1);

    const d1 = addDays(START, 1);
    const s2 = play([fuerza(START), build(START, 'fuerza', 1)], d1);
    expect(s2.city.ready).toHaveLength(1);
    expect(nextPlay(s2, { hour: 9 }).action).toEqual({ kind: 'inaugurate', districtId: 'fuerza', level: 1 });
    const s3 = play([fuerza(START), build(START, 'fuerza', 1), inaugurate(d1, 'fuerza', 1)], d1);
    expect(s3.city.districts.fuerza.level).toBe(1);
    expect(s3.city.crews.busy).toBe(0);
    expect(s3.city.inaugurations).toEqual([{ date: d1, districtId: 'fuerza', level: 1, eventId: expect.any(String) }]);
  });

  it('no cuenta si no alcanzan los materiales, si el distrito ya tiene obra o si no hay equipo libre', () => {
    const s = play(
      [
        build(START, 'fuerza', 1), // sin materiales
        fuerza(START),
        build(START, 'fuerza', 1), // este sí
        build(START, 'fuerza', 1), // doble toque: ya hay obra
        done(START, 'side-x', 'grande', 'carisma', 'side'),
        build(START, 'carisma', 1), // sin equipo libre
      ],
      START,
    );
    expect(s.city.rejected).toHaveLength(3);
    expect(s.city.works.map((w) => w.districtId)).toEqual(['fuerza']);
    expect(s.city.districts.carisma.blocked).toBe('no_crew');
  });

  it('anular un registro viejo no tumba en cascada los niveles de después', () => {
    const d = (n: number) => addDays(START, n);
    const early = done(d(0), 'side-a', 'media', 'fuerza', 'side'); // 30
    const events = [
      early,
      done(d(0), 'side-b', 'media', 'fuerza', 'side'), // 60 en total
      build(d(0), 'fuerza', 1), // cuesta 50
      inaugurate(d(1), 'fuerza', 1),
      ...[3, 4, 5].map((n) => fuerza(d(n), `side-big-${n}`)), // +300
      build(d(5), 'fuerza', 2), // cuesta 120
      inaugurate(d(6), 'fuerza', 2),
    ];
    expect(play(events, d(7)).city.districts.fuerza.level).toBe(2);
    // Desmarcas una misión del primer día: la primera obra ya no alcanzaba, pero la segunda sí cuenta por sí misma.
    const s = play(events.map((e) => (e.id === early.id ? { ...e, voidedAt: '2026-12-01T00:00:00.000Z' } : e)), d(7));
    expect(s.city.districts.fuerza.level).toBe(1);
    expect(s.city.rejected).toHaveLength(2);
  });

  it('la producción se junta por día, con tope de almacén, y se recoge', () => {
    const per = GAME_CONFIG.city.productionPerLevel;
    const cap = GAME_CONFIG.city.storageDays;
    // El Centro (nivel 1) produce desde el primer día.
    expect(play([], addDays(START, 1)).city.districts.disciplina.stored).toBe(per);
    const later = play([], addDays(START, 10));
    expect(later.city.districts.disciplina.stored).toBe(per * cap);
    expect(later.city.districts.disciplina.storageFull).toBe(true);
    const collected = play([ev('city.collected', addDays(START, 10), {})], addDays(START, 10));
    expect(collected.city.districts.disciplina.stored).toBe(0);
    expect(collected.city.districts.disciplina.materials).toBe(per * cap);
    expect(play([ev('city.collected', addDays(START, 10), {})], addDays(START, 11)).city.districts.disciplina.stored).toBe(per);
  });

  it('la ciudad nunca toca la XP ni el oro', () => {
    const events = [fuerza(START), build(START, 'fuerza', 1), inaugurate(addDays(START, 1), 'fuerza', 1), ev('city.collected', addDays(START, 4), {})];
    const a = run(events.slice(0, 1), addDays(START, 5), { entities: ents });
    const b = play(events, addDays(START, 5));
    expect(b.xp.total).toBe(a.xp.total);
    expect(b.gold).toEqual(a.gold);
    expect(b.attributes).toEqual(a.attributes);
  });

  it('la siguiente jugada propone fundar un distrito cuando te alcanza', () => {
    const s = play([ev('checkin.morning', START, { sleepHours: 7 }), fuerza(START)], START);
    expect(nextPlay(s, { hour: 10 }).action).toEqual({ kind: 'build', districtId: 'fuerza', level: 1 });
  });
});

describe('ciudad: herramientas de IA', () => {
  it('construir, inaugurar y recoger pasan por las mismas reglas', async () => {
    const { memoryAssistantStore, runAssistantTool } = await import('../src');
    const store = memoryAssistantStore({ events: [fuerza(START)], entities: ents, today: START });
    const call = (name: string, input: unknown = {}) => runAssistantTool(name, input, store, { allowWrites: true });

    expect((await call('ver_ciudad')).text).toContain('fuerza: Parque deportivo');
    const built = await call('construir', { distrito: 'fuerza' });
    expect(built.isError).toBeFalsy();
    const again = await call('construir', { distrito: 'carisma' });
    expect(again.isError).toBe(true);
    expect((await call('inaugurar', { distrito: 'fuerza' })).isError).toBe(true); // aún no termina
  });
});
