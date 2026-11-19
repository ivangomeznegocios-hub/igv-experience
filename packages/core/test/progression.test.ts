import { describe, expect, it } from 'vitest';
import { addDays, weekStart } from '../src';
import { bySource, done, ev, run, seed } from './helpers';

describe('lecciones', () => {
  it('una lección escrita da 30 XP al atributo de la misión fallida', () => {
    const s = run([ev('lesson.written', '2026-11-23', { text: 'No pedí la venta', missionId: 'daily-prospectos', attribute: 'carisma' })], '2026-11-23');
    expect(s.xp.total).toBe(30);
    expect(s.attributes.values.carisma.xp).toBe(30);
  });
  it('sin misión ligada va a Inteligencia', () => {
    const s = run([ev('lesson.written', '2026-11-23', { text: 'Aprendí algo', attribute: 'inteligencia' })], '2026-11-23');
    expect(s.attributes.values.inteligencia.xp).toBe(30);
  });
});

describe('dinero y XP son sistemas separados', () => {
  it('registrar ingresos y gastos no da XP', () => {
    const s = run([ev('income.recorded', '2026-11-23', { amount: 40000, concept: 'Cliente' }), ev('expense.recorded', '2026-11-23', { amount: 5000, concept: 'Renta' })], '2026-11-23');
    expect(s.xp.total).toBe(0);
    expect(s.money.monthIncome).toBe(40000);
    expect(s.money.monthExpense).toBe(5000);
  });
});

describe('atributos', () => {
  it('valor inicial + 1 punto por cada 100 XP del atributo', () => {
    const rate = ev('profile.attributes_rated', '2026-11-20', { values: { fuerza: 30, inteligencia: 50, carisma: 40, finanzas: 20, disciplina: 35, relaciones: 45, creatividad: 25 } });
    const events = [rate];
    for (let i = 0; i < 25; i++) events.push(done(addDays('2026-11-21', i), 'daily-entrenar', 'chica', 'fuerza'));
    const s = run(events, addDays('2026-11-21', 24));
    expect(s.attributes.rated).toBe(true);
    expect(s.attributes.values.fuerza.xp).toBe(250);
    expect(s.attributes.values.fuerza.value).toBe(32);
    expect(s.attributes.values.fuerza.progressToNext).toBeCloseTo(0.5);
    expect(s.attributes.values.inteligencia.value).toBe(50);
  });
  it('tope de 100', () => {
    const rate = ev('profile.attributes_rated', '2026-11-20', { values: { fuerza: 99 } });
    const events = [rate, ...Array.from({ length: 5 }, (_, i) => done('2026-11-21', `c${i}`, 'epica', 'fuerza', 'chapter'))];
    const s = run(events, '2026-11-21');
    expect(s.attributes.values.fuerza.value).toBe(100);
  });
  it('la calificación inicial cuenta solo la primera vez', () => {
    const s = run([ev('profile.attributes_rated', '2026-11-20', { values: { fuerza: 30 } }), ev('profile.attributes_rated', '2026-11-21', { values: { fuerza: 90 } })], '2026-11-21');
    expect(s.attributes.values.fuerza.base).toBe(30);
  });
});

describe('jefes', () => {
  it('Dragón Financiero: fases por ingresos del mes', () => {
    const s = run(
      [
        ev('income.recorded', '2026-12-05', { amount: 30000 }),
        ev('income.recorded', '2026-12-20', { amount: 25000 }), // dic: 55,000 → fase 1
        ev('income.recorded', '2027-01-10', { amount: 100000 }), // ene: 100,000 → fase 2
      ],
      '2027-01-15',
    );
    const d = s.bosses.bosses['boss-dragon'];
    expect(d.phases.map((p) => p.date)).toEqual(['2026-12-20', '2027-01-10', null]);
    expect(d.phases[2].progress).toEqual({ current: 1, target: 3, unit: 'meses' });
    expect(bySource(s, 'boss_phase')).toBe(600);
    // La XP de la fase va al atributo de su misión principal (Finanzas)
    expect(s.attributes.values.finanzas.xp).toBe(600);
  });

  it('Dragón: tres meses seguidos con 100,000 o más vencen al jefe y desbloquean al Imperio', () => {
    const inc = (d: string, a: number) => ev('income.recorded', d, { amount: a });
    const s = run([inc('2027-01-31', 100000), inc('2027-02-15', 120000), inc('2027-03-03', 100000)], '2027-03-10');
    const d = s.bosses.bosses['boss-dragon'];
    expect(d.defeated).toBe(true);
    expect(d.defeatedOn).toBe('2027-03-03');
    expect(s.bosses.bosses['boss-imperio'].locked).toBe(false);
  });

  it('Dragón: un mes fallido reinicia la cuenta de meses seguidos', () => {
    const inc = (d: string, a: number) => ev('income.recorded', d, { amount: a });
    const s = run([inc('2027-01-31', 100000), inc('2027-02-15', 120000), inc('2027-03-03', 20000), inc('2027-04-03', 100000)], '2027-04-10');
    expect(s.bosses.bosses['boss-dragon'].defeated).toBe(false);
    expect(s.bosses.bosses['boss-dragon'].phases[2].progress?.current).toBe(1);
  });

  it('El Imperio está bloqueado hasta vencer al Dragón (aunque marques la fase)', () => {
    const s = run([ev('boss.phase_completed', '2026-11-23', { bossId: 'boss-imperio', phaseIndex: 0 })], '2026-11-23');
    expect(s.bosses.bosses['boss-imperio'].locked).toBe(true);
    expect(s.bosses.bosses['boss-imperio'].phasesDone).toBe(0);
  });

  it('El Sedentario: 3 entrenamientos por semana, 4 semanas seguidas', () => {
    const events = [];
    const start = '2026-11-23';
    for (let w = 0; w < 4; w++) for (const d of [0, 2, 4]) events.push(done(addDays(start, w * 7 + d), 'daily-entrenar', 'chica', 'fuerza'));
    const s = run(events, addDays(start, 27));
    const b = s.bosses.bosses['boss-sedentario'];
    expect(b.phases[0].done).toBe(true);
    expect(b.phases[0].date).toBe(addDays(start, 3 * 7 + 4));
    expect(b.phases[1].progress).toEqual({ current: 4, target: 8, unit: 'semanas' });
  });

  it('El Ausente: una semana sin tiempo con mi hijo reinicia la cuenta', () => {
    const events = [];
    const start = '2026-11-23';
    for (const w of [0, 1, 2, 4]) events.push(done(addDays(start, w * 7 + 5), 'daily-hijo', 'media', 'relaciones'));
    const s = run(events, addDays(start, 34));
    expect(s.bosses.bosses['boss-ausente'].phases[0].progress?.current).toBe(1);
  });

  it('la semana en curso no rompe la cuenta', () => {
    const start = '2026-11-23';
    const events = [0, 1].map((w) => done(addDays(start, w * 7), 'daily-hijo', 'media', 'relaciones'));
    const s = run(events, addDays(start, 14)); // lunes de la 3a semana, sin nada aún
    expect(s.bosses.bosses['boss-ausente'].phases[0].progress?.current).toBe(2);
  });

  it('fases manuales en orden (La Torre del Inglés)', () => {
    const s = run(
      [ev('boss.phase_completed', '2026-11-25', { bossId: 'boss-torre', phaseIndex: 1 }), ev('boss.phase_completed', '2026-11-24', { bossId: 'boss-torre', phaseIndex: 0 })],
      '2026-11-26',
    );
    const t = s.bosses.bosses['boss-torre'];
    expect(t.phases.map((p) => p.done)).toEqual([true, true, false]);
    expect(bySource(s, 'boss_phase')).toBe(600);
    const onlySecond = run([ev('boss.phase_completed', '2026-11-25', { bossId: 'boss-torre', phaseIndex: 1 })], '2026-11-26');
    expect(onlySecond.bosses.bosses['boss-torre'].phasesDone).toBe(0);
  });

  it('jefe recurrente vencido: 30 XP', () => {
    const s = run([ev('boss.recurring_defeated', '2026-11-23', { bossId: 'rb-paralisis', note: 'Decidí X' })], '2026-11-23');
    expect(s.xp.total).toBe(30);
    expect(s.attributes.values.disciplina.xp).toBe(30);
    expect(s.bosses.recurring['rb-paralisis'].defeats).toBe(1);
  });
});

describe('logros', () => {
  it('Primer paso: 50 XP al completar la primera misión', () => {
    const s = run([done('2026-11-23', 'daily-leer')], '2026-11-23');
    expect(s.achievements['ach-primer-paso']).toMatchObject({ unlocked: true, date: '2026-11-23' });
    expect(bySource(s, 'achievement')).toBe(50);
    expect(s.xp.total).toBe(10 + 5 + 50);
  });

  it('Constante a los 7 días de racha (desbloqueo en el día 7)', () => {
    const events = Array.from({ length: 7 }, (_, i) => done(addDays('2026-11-23', i)));
    const s6 = run(events.slice(0, 6), '2026-11-28');
    const s7 = run(events, '2026-11-29');
    expect(s6.achievements['ach-constante'].unlocked).toBe(false);
    expect(s7.achievements['ach-constante']).toMatchObject({ unlocked: true, date: '2026-11-29' });
  });

  it('el logro se conserva aunque luego se rompa la racha', () => {
    const events = Array.from({ length: 7 }, (_, i) => done(addDays('2026-11-23', i)));
    const s = run(events, '2026-12-20');
    expect(s.achievements['ach-constante'].unlocked).toBe(true);
    expect(s.streak.current).toBe(0);
  });

  it('Fracaso útil: 5 lecciones', () => {
    const events = Array.from({ length: 5 }, (_, i) => ev('lesson.written', addDays('2026-11-23', i), { text: 'lección', attribute: 'inteligencia' }));
    const s = run(events, '2026-11-30');
    expect(s.achievements['ach-fracaso-util'].date).toBe('2026-11-27');
  });

  it('manual: Primer cliente', () => {
    const s = run([ev('achievement.unlocked', '2026-11-23', { achievementId: 'ach-primer-cliente' })], '2026-11-23');
    expect(s.achievements['ach-primer-cliente'].unlocked).toBe(true);
    expect(s.xp.total).toBe(50);
  });

  it('Mes cubierto: ingreso del mes ≥ meta (la meta es editable)', () => {
    const settings = seed.map((e) => (e.id === 'settings' ? { ...e, data: { ...e.data, monthlyGoal: 60000 } } : e));
    const s = run([ev('income.recorded', '2026-12-01', { amount: 60000 })], '2026-12-02', { entities: settings });
    expect(s.achievements['ach-mes-cubierto'].unlocked).toBe(true);
  });

  it('Explorador: 5 descubrimientos; Temporada completa', () => {
    const places = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, module: 'map', kind: 'place', data: { name: `L${i}`, placeType: 'lugar' }, sort: i }));
    const events = places.map((p, i) => ev('map.status_changed', addDays('2026-11-23', i), { placeId: p.id, status: 'descubierto' }));
    events.push(ev('season.review', '2027-02-21', { seasonId: 'season-1', phase: 'end', text: 'Fin' }));
    const s = run(events, '2027-02-21', { entities: [...seed, ...places] });
    expect(s.achievements['ach-explorador'].date).toBe('2026-11-27');
    expect(s.achievements['ach-temporada-completa'].date).toBe('2027-02-21');
  });

  it('Padre presente y Hablo inglés dependen de las fases de jefe', () => {
    const events = [0, 1, 2, 3].map((w) => done(addDays('2026-11-23', w * 7), 'daily-hijo', 'media', 'relaciones'));
    events.push(ev('boss.phase_completed', '2026-11-30', { bossId: 'boss-torre', phaseIndex: 0 }));
    const s = run(events, '2026-12-20');
    expect(s.achievements['ach-padre-presente'].unlocked).toBe(true);
    expect(s.achievements['ach-hablo-ingles'].date).toBe('2026-11-30');
  });
});

describe('habilidades', () => {
  it('rangos en orden, con evidencia, 100 XP al atributo de la habilidad', () => {
    const s = run(
      [
        ev('skill.rank_unlocked', '2026-11-23', { skillId: 'skill-ventas', rank: 2, evidence: 'saltando' }),
        ev('skill.rank_unlocked', '2026-11-24', { skillId: 'skill-ventas', rank: 1, evidence: 'Hice 10 llamadas: link' }),
        ev('skill.rank_unlocked', '2026-11-25', { skillId: 'skill-ventas', rank: 1, evidence: 'duplicado' }),
        ev('skill.rank_unlocked', '2026-11-26', { skillId: 'skill-ventas', rank: 2, evidence: '5 clientes' }),
      ],
      '2026-11-26',
    );
    expect(s.skills['skill-ventas'].rank).toBe(2);
    expect(s.skills['skill-ventas'].rankName).toBe('Experto');
    expect(bySource(s, 'skill')).toBe(200);
    expect(s.attributes.values.carisma.xp).toBe(200);
  });
});

describe('mapa y NPCs', () => {
  const place = { id: 'p1', module: 'map', kind: 'place', data: { name: 'Cancún', placeType: 'lugar' }, sort: 0 };
  it('un descubrimiento da 30 XP una sola vez', () => {
    const s = run(
      [
        ev('map.status_changed', '2026-11-23', { placeId: 'p1', status: 'descubierto' }),
        ev('map.status_changed', '2026-11-24', { placeId: 'p1', status: 'dominado' }),
        ev('map.status_changed', '2026-11-25', { placeId: 'p1', status: 'descubierto' }),
      ],
      '2026-11-25',
      { entities: [...seed, place] },
    );
    expect(bySource(s, 'discovery')).toBe(30);
    expect(s.map.places.p1.status).toBe('descubierto');
    expect(s.attributes.values.creatividad.xp).toBe(30);
  });

  it('NPC clave sin contacto por 30 días genera la misión "escribirle"', () => {
    const npc = { id: 'n1', module: 'npcs', kind: 'npc', data: { name: 'Ana', npcType: 'mentor', relation: 4, key: true, lastContact: '2026-10-01' }, sort: 0 };
    const other = { id: 'n2', module: 'npcs', kind: 'npc', data: { name: 'Beto', npcType: 'aliado', relation: 2, key: false, lastContact: '2026-01-01' }, sort: 1 };
    const s = run([], '2026-10-31', { entities: [...seed, npc, other] });
    expect(s.npcs.npcs.n1.daysSince).toBe(30);
    expect(s.npcs.generatedMissions.map((m) => m.title)).toEqual(['Escribirle a Ana']);
    // completar la misión cuenta como interacción
    const t = run([done('2026-10-31', 'npc-n1', 'chica', 'relaciones', 'npc', { npcId: 'n1' })], '2026-11-01', { entities: [...seed, npc] });
    expect(t.npcs.npcs.n1.lastInteraction).toBe('2026-10-31');
    expect(t.npcs.generatedMissions).toHaveLength(0);
  });
});

describe('temporadas', () => {
  it('Temporada 1 "El regreso": semana actual', () => {
    expect(run([], '2026-11-22').seasons.current).toBeNull();
    expect(run([], '2026-11-23').seasons.currentWeek).toBe(1);
    expect(run([], '2027-02-21').seasons.currentWeek).toBe(13);
    expect(run([], '2026-12-01').seasons.current?.data.name).toBe('El regreso');
  });
  it('diario semanal: la última versión de la semana gana', () => {
    const wk = weekStart('2026-11-25');
    const s = run(
      [ev('journal.weekly', '2026-11-25', { weekStart: wk, happened: 'a', learned: 'b', next: 'c' }), ev('journal.weekly', '2026-11-26', { weekStart: wk, happened: 'A', learned: 'B', next: 'C' })],
      '2026-11-27',
    );
    expect(s.seasons.journal[wk].happened).toBe('A');
  });
});
