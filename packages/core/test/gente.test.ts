import { describe, expect, it } from 'vitest';
import {
  CONTACT_CHANNELS,
  GAME_CONFIG,
  PERSON_ROLES,
  addDays,
  cadenceFor,
  circleOf,
  contactsOf,
  gapsText,
  isValidMetOnAsOf,
  knownForText,
  levelFromCounts,
  memoryAssistantStore,
  mostSeen,
  nextBirthday,
  npcTypeOnSave,
  relationGates,
  relationSummary,
  roleInfo,
  roleOf,
  runAssistantTool,
  startLevelOf,
  temperatureFor,
  trendFor,
  validateEvent,
  type Entity,
  type GameEvent,
  type NpcData,
} from '../src';
import { bySource, cfgWith, done, ev, run, seed } from './helpers';

const TODAY = '2026-11-19';
const person = (id: string, data: Partial<NpcData>, extra: Partial<Entity> = {}): Entity<NpcData> => ({
  id,
  module: 'npcs',
  kind: 'npc',
  sort: 1,
  data: { name: id, npcType: 'aliado', relation: 3, key: false, ...data } as NpcData,
  ...extra,
});
const talk = (date: string, npcId: string, channel?: string, extra: Record<string, unknown> = {}) => ev('npc.interaction', date, { npcId, ...(channel ? { channel } : {}), ...extra });
const visit = (date: string, placeId: string, npcIds: string[]) => ev('place.visited', date, { placeId, company: 'amigos', npcIds });

const ana = person('ana', { name: 'Ana', circle: 'amigos', role: 'Amiga' });
const ents = (...ps: Entity[]) => [...seed, ...ps];

describe('Mi gente: niveles de cercanía con requisitos', () => {
  it('los requisitos de cada nivel crecen y empiezan en el 2', () => {
    const gates = relationGates(GAME_CONFIG);
    expect(gates[0].level).toBe(2);
    for (let i = 1; i < gates.length; i++) {
      expect(gates[i].level).toBe(gates[i - 1].level + 1);
      for (const k of ['days', 'inPerson', 'weeks', 'months'] as const) expect(gates[i][k]).toBeGreaterThanOrEqual(gates[i - 1][k]);
      expect(gates[i].xp).toBeGreaterThan(0);
    }
  });

  it('diez mensajes en un día no hacen a nadie amigo', () => {
    const events = Array.from({ length: 10 }, () => talk('2026-11-02', 'ana', 'mensaje'));
    const s = run(events, TODAY, { entities: ents(ana) });
    expect(s.npcs.npcs.ana.interactions).toBe(10);
    expect(s.npcs.npcs.ana.counts).toEqual({ days: 1, inPerson: 0, weeks: 1, months: 1 });
    expect(s.npcs.npcs.ana.level).toBe(1);
    expect(s.npcs.npcs.ana.levelName).toBe('Conocida');
    expect(bySource(s, 'relationship')).toBe(0);
  });

  it('el nivel 2 se gana el día en que se cumplen todos los requisitos y da XP de Relaciones una vez', () => {
    const events = [talk('2026-11-02', 'ana', 'mensaje'), talk('2026-11-03', 'ana', 'llamada')];
    let s = run(events, TODAY, { entities: ents(ana) });
    expect(s.npcs.npcs.ana.level).toBe(1);
    expect(s.npcs.npcs.ana.next?.hint).toBe('Te faltan 1 día de contacto, 1 convivencia en persona y 1 semana más para Compa');
    events.push(talk('2026-11-10', 'ana', 'persona'));
    s = run(events, TODAY, { entities: ents(ana) });
    expect(s.npcs.npcs.ana.level).toBe(2);
    expect(s.npcs.npcs.ana.levelName).toBe('Compa');
    expect(s.npcs.npcs.ana.levelDates).toEqual({ 2: '2026-11-10' });
    const xp = s.xp.ledger.filter((e) => e.source === 'relationship');
    expect(xp).toEqual([expect.objectContaining({ date: '2026-11-10', amount: 20, attribute: 'relaciones', refId: 'ana', label: 'Cercanía con Ana: Compa' })]);
    // más contactos el mismo día no repiten la XP
    events.push(talk('2026-11-10', 'ana', 'persona'), talk('2026-11-11', 'ana', 'mensaje'));
    expect(bySource(run(events, TODAY, { entities: ents(ana) }), 'relationship')).toBe(20);
    expect(s.attributes.values.relaciones.xp).toBe(20);
  });

  it('un mensaje solo no cuenta como convivencia: el hint dice qué falta', () => {
    // 3 días, 2 semanas, pero sin nada en persona
    const s = run([talk('2026-11-02', 'ana', 'mensaje'), talk('2026-11-03', 'ana', 'mensaje'), talk('2026-11-10', 'ana', 'llamada')], TODAY, { entities: ents(ana) });
    expect(s.npcs.npcs.ana.level).toBe(1);
    expect(s.npcs.npcs.ana.next?.hint).toBe('Te falta 1 convivencia en persona para Compa');
    expect(s.npcs.npcs.ana.next?.progress).toBeCloseTo(0.75);
  });

  it('se pueden ganar varios niveles el mismo día y llegar al máximo; nunca baja con el tiempo', () => {
    const events: GameEvent[] = [];
    // 2 contactos en persona por semana durante 40 semanas
    for (let w = 0; w < 40; w++) {
      events.push(talk(addDays('2025-12-01', w * 7), 'ana', 'persona'), talk(addDays('2025-12-01', w * 7 + 2), 'ana', 'persona'));
    }
    const s = run(events, '2026-09-30', { entities: ents(ana) });
    expect(s.npcs.npcs.ana.level).toBe(5);
    expect(s.npcs.npcs.ana.levelName).toBe('Círculo íntimo');
    expect(s.npcs.npcs.ana.next).toBeNull();
    expect(bySource(s, 'relationship')).toBe(GAME_CONFIG.gente.levels.reduce((n, l) => n + l.xp, 0));
    expect(Object.keys(s.npcs.npcs.ana.levelDates)).toEqual(['2', '3', '4', '5']);
    const later = run(events, '2030-01-01', { entities: ents(ana) });
    expect(later.npcs.npcs.ana.level).toBe(5);
    expect(later.npcs.npcs.ana.temperature).toBe('fria');
    expect(bySource(later, 'relationship')).toBe(bySource(s, 'relationship'));
  });

  it('el nivel se calcula igual con levelFromCounts y con relationSummary', () => {
    expect(levelFromCounts({ days: 2, inPerson: 5, weeks: 5, months: 5 }, GAME_CONFIG)).toBe(1);
    expect(levelFromCounts({ days: 8, inPerson: 3, weeks: 4, months: 2 }, GAME_CONFIG)).toBe(3);
    // si no cumple el 3 no puede tener el 4 aunque le sobren días
    expect(levelFromCounts({ days: 100, inPerson: 100, weeks: 100, months: 1 }, GAME_CONFIG)).toBe(2);
  });

  it('el punto de partida cambia el nivel que se ve, pero no da XP', () => {
    const hija = person('hija', { name: 'Sofía', circle: 'familia', role: 'Hija', startLevel: 4 });
    const s = run([talk('2026-11-02', 'hija', 'persona')], TODAY, { entities: ents(hija) });
    expect(s.npcs.npcs.hija.level).toBe(4);
    expect(s.npcs.npcs.hija.earnedLevel).toBe(1);
    expect(s.npcs.npcs.hija.levelName).toBe('Unida');
    expect(s.npcs.npcs.hija.next?.level).toBe(5);
    expect(bySource(s, 'relationship')).toBe(0);
  });

  it('cambiar el círculo o el rol solo cambia el nombre del nivel, no el nivel ganado', () => {
    const events = [talk('2026-11-02', 'ana', 'persona'), talk('2026-11-03', 'ana', 'persona'), talk('2026-11-10', 'ana', 'persona')];
    const a = run(events, TODAY, { entities: ents(ana) });
    const b = run(events, TODAY, { entities: ents(person('ana', { name: 'Ana', circle: 'trabajo', role: 'Socia' })) });
    const c = run(events, TODAY, { entities: ents(person('ana', { name: 'Ana', circle: 'familia', role: 'Prima' })) });
    expect([a, b, c].map((s) => s.npcs.npcs.ana.level)).toEqual([2, 2, 2]);
    expect([a, b, c].map((s) => s.npcs.npcs.ana.levelName)).toEqual(['Compa', 'Contacto', 'Presente']);
    expect(b.xp.total).toBe(a.xp.total);
  });

  it('nombres de nivel con género según el rol', () => {
    const lvl3 = (d: Partial<NpcData>) => {
      const events = [];
      for (let i = 0; i < 9; i++) events.push(talk(addDays('2026-08-03', i * 9), 'x', 'persona'));
      return run(events, TODAY, { entities: ents(person('x', d)) }).npcs.npcs.x;
    };
    expect(lvl3({ circle: 'amigos', role: 'Amigo' }).levelName).toBe('Amigo');
    expect(lvl3({ circle: 'amigos', role: 'Mejor amiga' }).levelName).toBe('Amiga');
    expect(lvl3({ circle: 'trabajo', role: 'Socia' }).levelName).toBe('Colaboradora');
    expect(lvl3({ circle: 'familia', role: 'Mamá' }).levelName).toBe('Cercana');
    expect(lvl3({ circle: 'familia', role: 'Papá' }).levelName).toBe('Cercano');
  });
});

describe('Mi gente: contactos de otras fuentes', () => {
  it('place.visited cuenta como convivencia en persona con cada persona, en ese lugar', () => {
    const beto = person('beto', { name: 'Beto', circle: 'amigos', role: 'Amigo' });
    const events = [visit('2026-11-02', 'place-cafe', ['ana', 'beto', 'ana']), visit('2026-11-09', 'place-cafe', ['ana']), talk('2026-11-10', 'ana', undefined, { placeId: 'place-gym' })];
    const s = run(events, TODAY, { entities: ents(ana, beto) });
    expect(s.npcs.npcs.ana.counts).toEqual({ days: 3, inPerson: 3, weeks: 2, months: 1 });
    expect(s.npcs.npcs.ana.level).toBe(2);
    expect(s.npcs.npcs.beto.counts.inPerson).toBe(1);
    expect(s.npcs.npcs.ana.places).toEqual([
      { placeId: 'place-cafe', days: 2 },
      { placeId: 'place-gym', days: 1 },
    ]);
    expect(s.npcs.places['place-cafe']).toEqual([
      { npcId: 'ana', days: 2 },
      { npcId: 'beto', days: 1 },
    ]);
    expect(s.npcs.npcs.ana.byChannel.persona).toBe(2);
    expect(s.npcs.npcs.ana.byChannel.otro).toBe(1);
    expect(s.npcs.npcs.ana.lastInteraction).toBe('2026-11-10');
  });

  it('una llamada con lugar no cuenta como en persona; sin canal y con lugar, sí', () => {
    const [a] = contactsOf(talk('2026-11-02', 'ana', 'llamada', { placeId: 'p' }));
    const [b] = contactsOf(talk('2026-11-02', 'ana', undefined, { placeId: 'p' }));
    const [c] = contactsOf(talk('2026-11-02', 'ana'));
    expect([a.inPerson, b.inPerson, c.inPerson]).toEqual([false, true, false]);
  });

  it('la misión "Escribirle a X" cuenta como mensaje (contacto, no convivencia)', () => {
    const s = run([done('2026-11-02', 'npc-ana', 'chica', 'relaciones', 'npc', { npcId: 'ana' })], TODAY, { entities: ents(ana) });
    expect(s.npcs.npcs.ana.counts).toEqual({ days: 1, inPerson: 0, weeks: 1, months: 1 });
    expect(s.npcs.npcs.ana.byChannel.mensaje).toBe(1);
  });

  it('el nivel y la XP se conservan aunque se borre la ficha', () => {
    const events = [talk('2026-11-02', 'ana', 'persona'), talk('2026-11-03', 'ana', 'persona'), talk('2026-11-10', 'ana', 'persona')];
    const withAna = run(events, TODAY, { entities: ents(ana) });
    const deleted = run(events, TODAY, { entities: ents({ ...ana, deletedAt: 1 }) });
    expect(bySource(deleted, 'relationship')).toBe(bySource(withAna, 'relationship'));
    expect(deleted.npcs.npcs.ana).toBeUndefined();
  });
});

describe('Mi gente: temperatura y frecuencia', () => {
  it('la frecuencia sale de la ficha, del rol o del círculo', () => {
    expect(cadenceFor({ circle: 'pareja', role: 'Novia' }, GAME_CONFIG)).toBe(1);
    expect(cadenceFor({ circle: 'familia', role: 'Hija' }, GAME_CONFIG)).toBe(2);
    expect(cadenceFor({ circle: 'familia', role: 'Mamá' }, GAME_CONFIG)).toBe(7);
    expect(cadenceFor({ circle: 'familia', role: 'Tía' }, GAME_CONFIG)).toBe(60);
    expect(cadenceFor({ circle: 'familia', role: 'Madrina' }, GAME_CONFIG)).toBe(14);
    expect(cadenceFor({ circle: 'amigos' }, GAME_CONFIG)).toBe(30);
    expect(cadenceFor({ circle: 'conocidos' }, GAME_CONFIG)).toBe(0);
    expect(cadenceFor({ circle: 'amigos', cadenceDays: 7 }, GAME_CONFIG)).toBe(7);
    expect(cadenceFor({ circle: 'pareja', cadenceDays: 0 }, GAME_CONFIG)).toBe(0);
    // persona clave: al menos cada 30 días (salvo que elijas otra frecuencia)
    expect(cadenceFor({ circle: 'conocidos', key: true }, GAME_CONFIG)).toBe(GAME_CONFIG.npc.keyContactDays);
    expect(cadenceFor({ circle: 'comunidad', key: true }, GAME_CONFIG)).toBe(30);
    expect(cadenceFor({ circle: 'pareja', key: true }, GAME_CONFIG)).toBe(1);
    expect(cadenceFor({ circle: 'conocidos', key: true, cadenceDays: 0 }, GAME_CONFIG)).toBe(0);
  });

  it('cálida, tibia y fría según días sin contacto contra la frecuencia', () => {
    expect(temperatureFor(0, 1, GAME_CONFIG)).toBe('calida');
    expect(temperatureFor(2, 1, GAME_CONFIG)).toBe('calida');
    expect(temperatureFor(3, 1, GAME_CONFIG)).toBe('tibia');
    expect(temperatureFor(4, 1, GAME_CONFIG)).toBe('fria');
    expect(temperatureFor(45, 30, GAME_CONFIG)).toBe('calida');
    expect(temperatureFor(60, 30, GAME_CONFIG)).toBe('tibia');
    expect(temperatureFor(91, 30, GAME_CONFIG)).toBe('fria');
    expect(temperatureFor(500, 0, GAME_CONFIG)).toBeNull();
    expect(temperatureFor(null, 7, GAME_CONFIG)).toBeNull();
  });

  it('la temperatura baja con el tiempo y sin contactos no hay temperatura', () => {
    const novia = person('novia', { name: 'Vale', circle: 'pareja', role: 'Novia' });
    const nuevo = person('nuevo', { name: 'Leo', circle: 'amigos' });
    const events = [talk('2026-11-15', 'novia', 'persona')];
    expect(run(events, '2026-11-16', { entities: ents(novia, nuevo) }).npcs.npcs.novia.temperature).toBe('calida');
    expect(run(events, '2026-11-18', { entities: ents(novia) }).npcs.npcs.novia.temperature).toBe('tibia');
    expect(run(events, TODAY, { entities: ents(novia) }).npcs.npcs.novia.temperature).toBe('fria');
    expect(run(events, TODAY, { entities: ents(novia, nuevo) }).npcs.npcs.nuevo.temperature).toBeNull();
  });

  it('persona clave: la misión "Escribirle" aparece al enfriarse según su frecuencia o a los 30 días', () => {
    const novia = person('novia', { name: 'Vale', circle: 'pareja', role: 'Novia', key: true });
    const amigo = person('amigo', { name: 'Beto', circle: 'amigos', key: true, lastContact: '2026-10-25' });
    const noClave = person('otra', { name: 'Eva', circle: 'pareja', role: 'Novia' });
    const events = [talk('2026-11-14', 'novia', 'persona'), talk('2026-11-14', 'otra', 'persona')];
    const s = run(events, TODAY, { entities: ents(novia, amigo, noClave) });
    expect(s.npcs.generatedMissions.map((m) => m.title)).toEqual(['Escribirle a Vale']);
    expect(s.npcs.npcs.amigo.overdue).toBe(false);
    expect(run(events, '2026-11-24', { entities: ents(amigo) }).npcs.npcs.amigo.overdue).toBe(true);
  });

  it('quién se acerca y quién se aleja (últimos 30 días contra los 30 anteriores)', () => {
    const beto = person('beto', { name: 'Beto', circle: 'amigos' });
    const events = [
      talk('2026-11-01', 'ana', 'persona'),
      talk('2026-11-08', 'ana', 'persona'),
      talk('2026-11-15', 'ana', 'persona'),
      talk('2026-09-25', 'beto', 'persona'),
      talk('2026-10-05', 'beto', 'persona'),
      talk('2026-10-12', 'beto', 'persona'),
      talk('2026-11-10', 'beto', 'persona'),
    ];
    const s = run(events, TODAY, { entities: ents(ana, beto) });
    expect(s.npcs.npcs.ana.trend).toBe('sube');
    expect(s.npcs.npcs.beto).toMatchObject({ recent: 1, previous: 3, trend: 'baja' });
    expect(mostSeen(s.npcs, TODAY, 90, 5)).toEqual([
      { npcId: 'beto', days: 4 },
      { npcId: 'ana', days: 3 },
    ]);
    // una diferencia chica no es tendencia
    expect(trendFor(10, 11, GAME_CONFIG)).toBe('estable');
    expect(trendFor(22, 21, GAME_CONFIG)).toBe('estable');
    expect(trendFor(2, 0, GAME_CONFIG)).toBe('sube');
    expect(trendFor(4, 9, GAME_CONFIG)).toBe('baja');
    // empate en días: primero quien tuvo contacto más reciente
    const tie = run([talk('2026-11-01', 'ana', 'persona'), talk('2026-11-02', 'beto', 'persona')], TODAY, { entities: ents(ana, beto) });
    expect(mostSeen(tie.npcs, TODAY).map((x) => x.npcId)).toEqual(['beto', 'ana']);
  });
});

describe('Mi gente: fichas, roles y compatibilidad', () => {
  it('las fichas viejas (npcType) se acomodan en un círculo sensato', () => {
    expect(circleOf({ npcType: 'party' })).toBe('amigos');
    expect(circleOf({ npcType: 'aliado' })).toBe('amigos');
    expect(circleOf({ npcType: 'mentor' })).toBe('trabajo');
    expect(circleOf({ npcType: 'cliente' })).toBe('clientes');
    expect(circleOf({ npcType: 'rival' })).toBe('conocidos');
    expect(circleOf({ npcType: 'aliado', role: 'Hermana' })).toBe('familia');
    expect(circleOf({ npcType: 'aliado', circle: 'pareja' })).toBe('pareja');
    const old = { id: 'n1', module: 'npcs', kind: 'npc', sort: 0, data: { name: 'Ana', npcType: 'mentor', relation: 4, key: true } };
    const s = run([talk('2026-11-18', 'n1')], TODAY, { entities: ents(old as Entity) });
    expect(s.npcs.npcs.n1).toMatchObject({ circle: 'trabajo', role: 'Mentor', track: 'profesional', level: 1, levelName: 'Conocido', lastInteraction: '2026-11-18' });
  });

  it('al guardar una ficha vieja se conserva su tipo si el círculo y el rol no cambiaron', () => {
    const mentor = { npcType: 'mentor' as const };
    expect(roleOf(mentor)).toBe('Mentor');
    expect(npcTypeOnSave(mentor, 'trabajo', 'Mentor')).toBe('mentor');
    expect(npcTypeOnSave({ npcType: 'rival' }, 'conocidos', 'Rival')).toBe('rival');
    expect(npcTypeOnSave({ npcType: 'party' }, 'amigos', null)).toBe('party');
    // si cambian, se recalcula
    expect(npcTypeOnSave(mentor, 'trabajo', null)).toBe('aliado');
    expect(npcTypeOnSave({ npcType: 'party' }, 'familia', 'Hermana')).toBe('party');
    expect(npcTypeOnSave({ npcType: 'party' }, 'trabajo', 'Colega')).toBe('aliado');
    expect(npcTypeOnSave(null, 'clientes', null)).toBe('cliente');
  });

  it('punto de partida entre 1 y 5', () => {
    expect(startLevelOf({})).toBe(1);
    expect(startLevelOf({ startLevel: 4 })).toBe(4);
    expect(startLevelOf({ startLevel: 9 })).toBe(5);
    expect(startLevelOf({ startLevel: 0 })).toBe(1);
  });

  it('"¿cuándo se conocieron?": año, año y mes o fecha completa, nunca en el futuro', () => {
    for (const ok of ['2015', '2015-06', '2015-06-12', '2026', '2026-11', '2026-11-19']) expect(isValidMetOnAsOf(ok, TODAY)).toBe(true);
    for (const bad of ['2031', '2026-12', '2026-11-20', '2015-13', '1850', '2015-02-30', '20', '2015-6']) expect(isValidMetOnAsOf(bad, TODAY)).toBe(false);
  });

  it('reconoce roles escritos a mano', () => {
    expect(roleInfo('amiga de la prepa')?.label).toBe('Amiga');
    expect(roleInfo('Mejor amigo')?.label).toBe('Mejor amigo');
    expect(roleInfo('MAMA')?.label).toBe('Mamá');
    expect(roleInfo('madre')?.label).toBe('Mamá');
    expect(roleInfo('Compañero de trabajo')?.label).toBe('Colega');
    expect(roleInfo('compañera de la uni')?.label).toBe('Compañera');
    expect(roleInfo('Padrino')).toBeNull();
    expect(new Set(PERSON_ROLES.map((r) => r.label)).size).toBe(PERSON_ROLES.length);
  });

  it('familia primero: pareja, hijos, padres, hermanos', () => {
    const fam = [
      person('p1', { name: 'Hermano', circle: 'familia', role: 'Hermano' }),
      person('p2', { name: 'Mamá', circle: 'familia', role: 'Mamá' }),
      person('p3', { name: 'Novia', circle: 'pareja', role: 'Novia' }),
      person('p4', { name: 'Hija', circle: 'familia', role: 'Hija' }),
      person('p5', { name: 'Amigo', circle: 'amigos', role: 'Amigo' }),
    ];
    const s = run([], TODAY, { entities: ents(...fam) });
    const order = fam.map((f) => f.id).sort((a, b) => s.npcs.npcs[a].priority - s.npcs.npcs[b].priority);
    expect(order).toEqual(['p3', 'p4', 'p2', 'p1', 'p5']);
    expect(s.npcs.byCircle).toMatchObject({ familia: 3, pareja: 1, amigos: 1 });
  });

  it('cumpleaños: próximo, cuántos cumple y ventana de 30 días', () => {
    expect(nextBirthday('a', '12-02', TODAY)).toEqual({ npcId: 'a', date: '2026-12-02', inDays: 13, turns: null });
    expect(nextBirthday('a', '1996-11-19', TODAY)).toEqual({ npcId: 'a', date: '2026-11-19', inDays: 0, turns: 30 });
    expect(nextBirthday('a', '2000-01-05', TODAY)).toMatchObject({ date: '2027-01-05', turns: 27 });
    expect(nextBirthday('a', '02-29', '2027-03-01')?.date).toBe('2028-02-29');
    expect(nextBirthday('a', '13-01', TODAY)).toBeNull();
    const s = run([], TODAY, { entities: ents(person('a', { name: 'A', birthday: '12-02' }), person('b', { name: 'B', birthday: '1996-11-19' }), person('c', { name: 'C', birthday: '05-01' })) });
    expect(s.npcs.birthdays.map((b) => b.npcId)).toEqual(['b', 'a']);
  });

  it('cuánto tiempo llevan de conocerse', () => {
    expect(knownForText('2015', TODAY)).toBe('11 años');
    expect(knownForText('2026-03', TODAY)).toBe('8 meses');
    expect(knownForText('2026-11-01', TODAY)).toBe('18 días');
    expect(knownForText('2030', TODAY)).toBeNull();
    expect(gapsText([])).toBe('');
  });

  it('hoy, semanas y meses de contactos (por persona y día)', () => {
    const beto = person('beto', { name: 'Beto', circle: 'amigos' });
    const s = run([talk(TODAY, 'beto', 'mensaje'), talk(TODAY, 'ana', 'persona'), talk(TODAY, 'ana', 'mensaje'), talk('2026-11-17', 'ana', 'llamada'), talk('2026-10-01', 'ana', 'llamada')], TODAY, {
      entities: ents(ana, beto),
    });
    expect(s.npcs.contactedToday).toEqual(['beto', 'ana']);
    expect(s.npcs.weeks).toHaveLength(12);
    expect(s.npcs.weeks.at(-1)).toEqual({ key: '2026-11-16', contacts: 3, people: 2 });
    expect(s.npcs.months.at(-1)).toEqual({ key: '2026-11', contacts: 3, people: 2 });
    expect(s.npcs.months.at(-2)).toEqual({ key: '2026-10', contacts: 1, people: 1 });
  });

  it('valida npc.interaction: canal y lugar opcionales, registros viejos siguen valiendo', () => {
    const base = { id: 'abcdefgh-1', occurredAt: '2026-11-19T10:00:00.000Z', localDate: TODAY, type: 'npc.interaction' };
    expect(validateEvent({ ...base, payload: { npcId: 'ana' } }).ok).toBe(true);
    expect(validateEvent({ ...base, payload: { npcId: 'ana', note: 'café', channel: 'persona', placeId: 'place-1' } }).ok).toBe(true);
    expect(validateEvent({ ...base, payload: { npcId: 'ana', channel: 'telepatía' } }).ok).toBe(false);
    for (const channel of CONTACT_CHANNELS) expect(validateEvent({ ...base, payload: { npcId: 'ana', channel } }).ok).toBe(true);
  });
});

/** Generador pseudoaleatorio determinista. */
function rng(seedN: number) {
  return () => ((seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe('Mi gente: regla de oro y consistencia', () => {
  const people = [
    ana,
    person('beto', { name: 'Beto', circle: 'trabajo', role: 'Socio', key: true }),
    person('vale', { name: 'Vale', circle: 'pareja', role: 'Novia', key: true, startLevel: 3 }),
    person('sofi', { name: 'Sofía', circle: 'familia', role: 'Hija' }),
  ];
  const ids = ['ana', 'beto', 'vale', 'sofi', 'fantasma'];
  const channels = [undefined, 'persona', 'llamada', 'videollamada', 'mensaje'];
  function randomEvent(r: () => number, date: string): GameEvent {
    const who = ids[Math.floor(r() * ids.length)];
    switch (Math.floor(r() * 6)) {
      case 0:
        return visit(date, `place-${Math.floor(r() * 3)}`, ids.filter(() => r() < 0.4));
      case 1:
        return done(date, `npc-${who}`, 'chica', 'relaciones', 'npc', { npcId: who });
      case 2:
        return done(date, 'daily-leer');
      default:
        return talk(date, who, channels[Math.floor(r() * channels.length)], r() < 0.3 ? { placeId: `place-${Math.floor(r() * 3)}` } : {});
    }
  }

  it('agregar cualquier contacto nunca baja la XP, los atributos ni el nivel de nadie', () => {
    for (let seedN = 1; seedN <= 12; seedN++) {
      const r = rng(seedN);
      const events: GameEvent[] = [];
      let prev = run([], '2027-06-30', { entities: ents(...people) });
      for (let i = 0; i < 120; i++) {
        events.push(randomEvent(r, addDays('2026-06-01', Math.floor(r() * 395))));
        const s = run(events, '2027-06-30', { entities: ents(...people) });
        expect(s.xp.total).toBeGreaterThanOrEqual(prev.xp.total);
        expect(s.attributes.values.relaciones.value).toBeGreaterThanOrEqual(prev.attributes.values.relaciones.value);
        expect(bySource(s, 'relationship')).toBeGreaterThanOrEqual(bySource(prev, 'relationship'));
        for (const p of people) expect(s.npcs.npcs[p.id].level).toBeGreaterThanOrEqual(prev.npcs.npcs[p.id].level);
        expect(s.xp.ledger.every((e) => e.amount > 0)).toBe(true);
        prev = s;
      }
      // y relationSummary (lo que usan las herramientas de IA) coincide con el reductor
      for (const p of people) {
        const mine = prev.npcs.contacts.filter((c) => c.npcId === p.id);
        const sum = relationSummary(mine, GAME_CONFIG);
        expect(sum.earnedLevel).toBe(prev.npcs.npcs[p.id].earnedLevel);
        expect(sum.counts).toEqual(prev.npcs.npcs[p.id].counts);
        expect(sum.levelDates).toEqual(prev.npcs.npcs[p.id].levelDates);
      }
    }
  });

  it('con requisitos más fáciles en la config, todo se recalcula (y la XP no baja)', () => {
    const events = [talk('2026-11-02', 'ana', 'mensaje')];
    const easy = cfgWith((c) => {
      c.gente.levels = [{ level: 2, days: 1, inPerson: 0, weeks: 1, months: 1, xp: 15 }];
    });
    const s = run(events, TODAY, { entities: ents(ana), config: easy });
    expect(s.npcs.npcs.ana.level).toBe(2);
    expect(bySource(s, 'relationship')).toBe(15);
  });
});

describe('Mi gente: herramientas de IA', () => {
  const place: Entity = { id: 'place-cafe', module: 'map', kind: 'place', sort: 1, data: { name: 'Café Avellaneda', placeType: 'lugar' } };
  const vale = person('vale', { name: 'Vale', circle: 'pareja', role: 'Novia', key: true });
  const sofi = person('sofi', { name: 'Sofía', circle: 'familia', role: 'Hija', birthday: '2018-12-01' });
  const mk = (events: GameEvent[] = [], entities: Entity[] = ents(ana, vale, sofi, place)) => memoryAssistantStore({ events, entities, today: TODAY });
  const call = (store: ReturnType<typeof mk>, name: string, input: unknown = {}) => runAssistantTool(name, input, store, { allowWrites: true });

  it('registrar_contacto: varias personas a la vez, con canal y lugar (un registro por persona)', async () => {
    const store = mk();
    const r = await call(store, 'registrar_contacto', { personas: ['vale', 'sofi'], canal: 'persona', lugar_id: 'place-cafe', nota: 'Comida', fecha: '2026-11-18' });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Vale y Sofía');
    expect(r.refs?.events).toHaveLength(2);
    expect(store.allEvents().map((e) => e.payload)).toEqual([
      { npcId: 'vale', note: 'Comida', channel: 'persona', placeId: 'place-cafe' },
      { npcId: 'sofi', note: 'Comida', channel: 'persona', placeId: 'place-cafe' },
    ]);
    // compatibilidad: una sola persona con persona_id
    expect((await call(store, 'registrar_contacto', { persona_id: 'ana' })).isError).toBeFalsy();
    expect(store.allEvents().at(-1)?.payload).toEqual({ npcId: 'ana' });
  });

  it('registrar_contacto valida personas, lugar y fecha', async () => {
    const store = mk();
    expect((await call(store, 'registrar_contacto', {})).isError).toBe(true);
    expect((await call(store, 'registrar_contacto', { personas: ['vale', 'nadie'] })).isError).toBe(true);
    expect((await call(store, 'registrar_contacto', { persona_id: 'vale', lugar_id: 'npc-x' })).isError).toBe(true);
    expect((await call(store, 'registrar_contacto', { persona_id: 'vale', canal: 'fax' })).isError).toBe(true);
    expect((await call(store, 'registrar_contacto', { persona_id: 'vale', fecha: '2026-11-20' })).isError).toBe(true);
    expect(store.allEvents()).toHaveLength(0);
  });

  it('guardar_persona: ficha completa, el rol deduce el círculo y no se inventan fechas inválidas', async () => {
    const store = mk();
    const r = await call(store, 'guardar_persona', { nombre: 'Lucía', rol: 'Mamá', cumpleanos: '1968-04-12', conocio_fecha: '1990', telefono: '5512345678', clave: true });
    expect(r.isError).toBeFalsy();
    const saved = (await store.catalog()).find((e) => e.id === r.refs!.entities[0].id)!;
    expect(saved.data).toMatchObject({ name: 'Lucía', circle: 'familia', role: 'Mamá', npcType: 'party', birthday: '1968-04-12', metOn: '1990', phone: '5512345678', key: true, lastContact: TODAY });
    expect(r.text).toContain('cada semana');
    // editar: cambia el rol a pareja y borra el teléfono
    const e = await call(store, 'guardar_persona', { id: saved.id, rol: 'Esposa', telefono: '', nivel_inicial: 4, frecuencia_dias: 3 });
    expect(e.isError).toBeFalsy();
    const ed = (await store.catalog()).find((x) => x.id === saved.id)!;
    expect(ed.data).toMatchObject({ circle: 'pareja', role: 'Esposa', phone: null, startLevel: 4, cadenceDays: 3, birthday: '1968-04-12' });
    expect((await call(store, 'guardar_persona', { nombre: 'X', cumpleanos: '31-02' })).isError).toBe(true);
    expect((await call(store, 'guardar_persona', { nombre: 'X', conocio_fecha: '2031' })).isError).toBe(true);
    expect((await call(store, 'guardar_persona', { nombre: 'X', conocio_lugar_id: 'no-existe' })).isError).toBe(true);
    // compatibilidad con la versión anterior (tipo)
    const old = await call(store, 'guardar_persona', { nombre: 'Don Pepe', tipo: 'mentor' });
    const op = (await store.catalog()).find((x) => x.id === old.refs!.entities[0].id)!;
    expect(op.data).toMatchObject({ npcType: 'mentor', circle: 'trabajo' });
  });

  it('guardar_persona: editar una ficha vieja (Mentor, Rival) conserva su rol, su tipo y su frecuencia', async () => {
    const luis: Entity = { id: 'luis', module: 'npcs', kind: 'npc', sort: 1, data: { name: 'Luis', npcType: 'mentor', relation: 3, key: true, lastContact: '2026-10-01' } };
    const rafa: Entity = { id: 'rafa', module: 'npcs', kind: 'npc', sort: 1, data: { name: 'Rafa', npcType: 'rival', relation: 3, key: false } };
    const pepa: Entity = { id: 'pepa', module: 'npcs', kind: 'npc', sort: 1, data: { name: 'Pepa', npcType: 'party', relation: 3, key: false } };
    const store = mk([], ents(luis, rafa, pepa));
    const before = (await store.snapshot()).people.list.find((p) => p.id === 'luis')!;
    expect(before).toMatchObject({ role: 'Mentor', cadenceDays: 30, temperature: 'tibia' });
    const r = await call(store, 'guardar_persona', { id: 'luis', telefono: '5512345678' });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Mentor · persona clave · frecuencia cada mes');
    const saved = (await store.catalog()).find((e) => e.id === 'luis')!.data as NpcData;
    expect(saved).toMatchObject({ role: 'Mentor', npcType: 'mentor', circle: 'trabajo', phone: '5512345678' });
    expect(cadenceFor(saved, GAME_CONFIG)).toBe(30);
    const after = (await store.snapshot()).people.list.find((p) => p.id === 'luis')!;
    expect(after).toMatchObject({ role: 'Mentor', cadenceDays: 30, temperature: 'tibia' });
    // Rival y el tipo 'party' tampoco se pierden
    expect((await call(store, 'guardar_persona', { id: 'rafa', clave: true })).isError).toBeFalsy();
    expect((await store.catalog()).find((e) => e.id === 'rafa')!.data).toMatchObject({ role: 'Rival', npcType: 'rival', circle: 'conocidos' });
    expect((await call(store, 'guardar_persona', { id: 'pepa', notas: 'De la prepa' })).isError).toBeFalsy();
    expect((await store.catalog()).find((e) => e.id === 'pepa')!.data).toMatchObject({ role: null, npcType: 'party', circle: 'amigos' });
    // borrar el rol a propósito sí lo quita
    expect((await call(store, 'guardar_persona', { id: 'luis', rol: '' })).isError).toBeFalsy();
    expect((await store.catalog()).find((e) => e.id === 'luis')!.data).toMatchObject({ role: null, npcType: 'aliado' });
  });

  it('guardar_persona: la fecha en que se conocieron acepta día completo y un valor viejo no bloquea otras ediciones', async () => {
    const old = person('old', { name: 'Toño', circle: 'amigos', role: 'Amigo', metOn: '2031' });
    const store = mk([], ents(old));
    // un valor guardado antes (desde la app) no impide marcarlo como clave
    const r = await call(store, 'guardar_persona', { id: 'old', clave: true });
    expect(r.isError).toBeFalsy();
    expect((await store.catalog()).find((e) => e.id === 'old')!.data).toMatchObject({ key: true, metOn: '2031' });
    // pero un valor nuevo sí se valida
    expect((await call(store, 'guardar_persona', { id: 'old', conocio_fecha: '2015-13' })).isError).toBe(true);
    expect((await call(store, 'guardar_persona', { id: 'old', conocio_fecha: '2026-11-20' })).isError).toBe(true);
    expect((await call(store, 'guardar_persona', { id: 'old', conocio_fecha: '2015-06-12' })).isError).toBeFalsy();
    expect((await store.catalog()).find((e) => e.id === 'old')!.data).toMatchObject({ metOn: '2015-06-12' });
    // lo que guarda la IA, la app lo acepta igual
    expect(isValidMetOnAsOf('2015-06-12', TODAY)).toBe(true);
  });

  it('ver_mi_gente y ver_persona muestran nivel, lo que falta, temperatura, lugares y contactos', async () => {
    const events = [talk('2026-11-02', 'vale', 'persona', { placeId: 'place-cafe' }), talk('2026-11-03', 'vale', 'mensaje'), talk('2026-11-12', 'vale', 'persona'), talk(TODAY, 'sofi', 'llamada')];
    const store = mk(events);
    const all = (await call(store, 'ver_mi_gente')).text;
    expect(all).toContain('Hoy: Sofía.');
    expect(all).toContain('## Pareja (1)');
    expect(all).toMatch(/\[vale\] Vale ★ clave \(Novia · Pareja · nivel 2 Presente · fría/);
    expect(all).toContain('Cumpleaños: Sofía en 12 días (2026-12-01), cumple 8.');
    expect((await call(store, 'ver_mi_gente', { circulo: 'amigos' })).text).not.toContain('Vale');
    const p = (await call(store, 'ver_persona', { persona_id: 'vale' })).text;
    expect(p).toContain('Cercanía: nivel 2 · Presente');
    expect(p).toContain('Llevan: 3 días con contacto, 2 en persona, 2 semanas y 1 mes distintos.');
    expect(p).toContain('Siguiente: nivel 3 Cercana (+30 XP)');
    expect(p).toContain('Lugares juntos: Café Avellaneda (1 día).');
    expect(p).toContain('frecuencia esperada: diario (automática)');
    expect((await call(store, 'ver_persona', { persona_id: 'nadie' })).isError).toBe(true);
    const resumen = (await call(store, 'ver_resumen')).text;
    expect(resumen).toContain('## Mi gente');
    expect(resumen).toContain('Familia y pareja: Vale [vale]');
    expect(resumen).toContain('[misión npc-vale]');
  });

  it('la foto para la IA trae a cada persona con familia primero', async () => {
    const snap = await mk().snapshot();
    expect(snap.people.list.map((p) => p.id)).toEqual(['vale', 'sofi', 'ana']);
    expect(snap.people.list[0]).toMatchObject({ circle: 'pareja', role: 'Novia', level: 1, levelName: 'En contacto', key: true, cadenceDays: 1 });
  });
});
