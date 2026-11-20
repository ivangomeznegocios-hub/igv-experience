import { describe, expect, it } from 'vitest';
import {
  EVENT_SCHEMAS,
  GAME_CONFIG,
  SKILL_CATEGORIES,
  TIME_AREAS,
  bookPercent,
  buildSnapshot,
  dayTimeline,
  fmtHoursMinutes,
  groupSkillsByCategory,
  guessSkillCategory,
  memoryAssistantStore,
  project,
  renderOverview,
  runAssistantTool,
  skillCategory,
  skillNameEdit,
  splitTimerSpan,
  timeAverages,
  timeByArea,
  timeByDay,
  timeBySkill,
  timeEntries,
  timeInsights,
  timeWeekCompare,
  validateEvent,
  type BookData,
  type Entity,
  type GameEvent,
  type SkillData,
} from '../src';
import { bySource, done, ev, run, seed } from './helpers';

const TODAY = '2026-11-19'; // jueves
const time = (date: string, minutes: number, area: string, extra: Record<string, unknown> = {}, env: Partial<GameEvent> = {}) =>
  ev('time.logged', date, { minutes, area, ...extra }, env);

const book = (id: string, data: Partial<BookData> = {}): Entity<BookData> => ({
  id,
  module: 'library',
  kind: 'book',
  sort: 1,
  data: { title: id, bookType: 'libro', status: 'leyendo', attribute: 'inteligencia', size: 'media', ...data },
});
const skill = (id: string, data: Partial<SkillData> = {}): Entity<SkillData> => ({
  id,
  module: 'skills',
  kind: 'skill',
  sort: 1,
  data: { name: id, attribute: 'inteligencia', ranks: ['a', 'b', 'c'], ...data },
});

describe('eventos del sistema habilidades', () => {
  const valid = (type: string, payload: unknown) => validateEvent({ id: 'evt-12345678', type, occurredAt: `${TODAY}T18:00:00.000Z`, localDate: TODAY, payload }).ok;

  it('time.logged valida minutos, área y hora de inicio', () => {
    expect(valid('time.logged', { minutes: 500, area: 'trabajo', note: 'Oficina' })).toBe(true);
    expect(valid('time.logged', { minutes: 60, area: 'estudio', skillId: 'skill-ingles', start: '07:30' })).toBe(true);
    expect(valid('time.logged', { minutes: 0, area: 'trabajo' })).toBe(false);
    expect(valid('time.logged', { minutes: 1441, area: 'trabajo' })).toBe(false);
    expect(valid('time.logged', { minutes: 30, area: 'oficina' })).toBe(false);
    expect(valid('time.logged', { minutes: 30, area: 'trabajo', start: '25:00' })).toBe(false);
  });

  it('las áreas del schema son exactamente TIME_AREAS', () => {
    const schema = EVENT_SCHEMAS['time.logged'];
    expect([...schema.shape.area.options]).toEqual([...TIME_AREAS]);
  });

  it('library.progress pide página o porcentaje; library.note pide texto', () => {
    expect(valid('library.progress', { bookId: 'b1', page: 40 })).toBe(true);
    expect(valid('library.progress', { bookId: 'b1', percent: 55 })).toBe(true);
    expect(valid('library.progress', { bookId: 'b1' })).toBe(false);
    expect(valid('library.progress', { bookId: 'b1', percent: 120 })).toBe(false);
    expect(valid('library.note', { bookId: 'b1', text: 'Los hábitos son el interés compuesto de la mejora personal.' })).toBe(true);
    expect(valid('library.note', { bookId: 'b1', text: ' ' })).toBe(false);
  });
});

describe('tu tiempo: funciones puras', () => {
  const evs = [
    time('2026-11-16', 500, 'trabajo', { note: 'Oficina', start: '09:00' }),
    time('2026-11-16', 45, 'traslado'),
    time('2026-11-17', 480, 'trabajo'),
    time('2026-11-17', 60, 'estudio', { skillId: 'skill-ingles' }),
    time('2026-11-18', 90, 'familia'),
    time('2026-11-18', 30, 'estudio', { skillId: 'skill-ingles' }, { voidedAt: '2026-11-18T20:00:00Z' }),
    time('2026-11-10', 420, 'trabajo'),
    time('2026-11-12', 120, 'amigos'),
    ev('mission.completed', '2026-11-17', { missionId: 'x', title: 'x', size: 'chica', attribute: 'fuerza', kind: 'quick' }),
  ];

  it('suma por área, habilidad y día; ignora anulados y otros eventos', () => {
    const byArea = timeByArea(evs, '2026-11-16', TODAY);
    expect(byArea.trabajo).toBe(980);
    expect(byArea.estudio).toBe(60);
    expect(byArea.familia).toBe(90);
    expect(byArea.traslado).toBe(45);
    expect(Object.keys(byArea).sort()).toEqual([...TIME_AREAS].sort());
    expect(timeBySkill(evs)).toEqual({ 'skill-ingles': 60 });
    expect(timeByDay(evs, '2026-11-16', '2026-11-17')).toEqual({ '2026-11-16': 545, '2026-11-17': 540 });
    expect(timeEntries(evs)).toHaveLength(7);
  });

  it('formatea horas y minutos', () => {
    expect(fmtHoursMinutes(500)).toBe('8 h 20 min');
    expect(fmtHoursMinutes(45)).toBe('45 min');
    expect(fmtHoursMinutes(180)).toBe('3 h');
    expect(fmtHoursMinutes(0)).toBe('0 min');
  });

  it('línea del día: bloques con hora y registros sin hora', () => {
    const tl = dayTimeline(evs, '2026-11-16');
    expect(tl.total).toBe(545);
    expect(tl.blocks).toHaveLength(1);
    expect(tl.blocks[0]).toMatchObject({ area: 'trabajo', startMin: 540, endMin: 1040, note: 'Oficina' });
    expect(tl.unscheduled.map((u) => u.area)).toEqual(['traslado']);
  });

  it('esta semana contra la pasada (completa y a estas alturas)', () => {
    const c = timeWeekCompare(evs, TODAY);
    expect(c.daysElapsed).toBe(4);
    expect(c.thisWeek.from).toBe('2026-11-16');
    expect(c.thisWeek.total).toBe(500 + 45 + 480 + 60 + 90);
    expect(c.lastWeek.total).toBe(540);
    // Semana pasada hasta el jueves 12: 420 + 120.
    expect(c.lastWeekToDate.total).toBe(540);
    expect(c.thisWeek.bySkill).toEqual({ 'skill-ingles': 60 });
  });

  it('los promedios usan días completos (hasta ayer)', () => {
    const a = timeAverages([...evs, time(TODAY, 600, 'trabajo')], TODAY, 28);
    expect(a.to).toBe('2026-11-18');
    expect(a.loggedDays).toBe(5);
    expect(a.total).toBe(500 + 45 + 480 + 60 + 90 + 420 + 120);
    expect(a.workdayAvg).toBe(Math.round((500 + 480 + 420) / 3));
  });

  it('"en qué se te va el tiempo" da observaciones cortas', () => {
    const ins = timeInsights(evs, TODAY);
    expect(ins[0]).toContain('trabajo');
    expect(ins.length).toBeGreaterThan(1);
    expect(ins.length).toBeLessThanOrEqual(5);
    expect(timeInsights([], TODAY)).toEqual([]);
  });

  it('el cronómetro se parte por día local (CDMX) al cruzar la medianoche', () => {
    // 22:30 a 01:15 hora de CDMX (UTC−6).
    const start = Date.parse('2026-11-19T04:30:00Z');
    const end = Date.parse('2026-11-19T07:15:00Z');
    expect(splitTimerSpan(start, end, 'America/Mexico_City')).toEqual([
      { date: '2026-11-18', start: '22:30', minutes: 90 },
      { date: '2026-11-19', start: '00:00', minutes: 75 },
    ]);
    expect(splitTimerSpan(end, start)).toEqual([]);
    expect(splitTimerSpan(start, start + 20_000)).toEqual([]);
  });
});

describe('el tiempo NO da XP (regla de oro 3)', () => {
  it('agregar registros de tiempo no cambia la XP, los atributos ni el oro', () => {
    const base = [done('2026-11-17'), done('2026-11-18', 'daily-entrenar', 'media', 'fuerza')];
    const withTime = [...base, time('2026-11-17', 600, 'trabajo'), time('2026-11-18', 1440, 'estudio', { skillId: 'skill-ingles' }), time(TODAY, 120, 'ejercicio')];
    const a = run(base, TODAY);
    const b = run(withTime, TODAY);
    expect(b.xp.total).toBe(a.xp.total);
    expect(b.xp.ledger).toEqual(a.xp.ledger);
    expect(b.attributes.values).toEqual(a.attributes.values);
    expect(b.gold.balance).toBe(a.gold.balance);
    expect(b.time.weekMinutes).toBe(600 + 1440 + 120);
    expect(b.time.todayMinutes).toBe(120);
    expect(b.time.todayByArea.ejercicio).toBe(120);
  });

  it('las notas y el avance de un libro tampoco dan XP; terminarlo sí (una vez)', () => {
    const ents = [...seed, book('book-h', { pages: 300, size: 'grande' })];
    const evs = [
      ev('library.progress', '2026-11-10', { bookId: 'book-h', page: 30 }),
      ev('library.note', '2026-11-11', { bookId: 'book-h', text: 'Una idea' }),
    ];
    const s1 = run(evs, TODAY, { entities: ents });
    expect(s1.xp.total).toBe(0);
    const s2 = run([...evs, ev('library.finished', '2026-11-18', { bookId: 'book-h', title: 'H', size: 'grande', attribute: 'inteligencia' })], TODAY, { entities: ents });
    expect(bySource(s2, 'library')).toBe(GAME_CONFIG.missionXp.grande);
    expect(s2.xp.total).toBe(GAME_CONFIG.missionXp.grande);
  });
});

describe('lo que sabes hacer', () => {
  it('deduce la categoría de las habilidades de ejemplo', () => {
    const cats = Object.fromEntries(seed.filter((e) => e.module === 'skills').map((e) => [e.id, skillCategory(e.data as SkillData)]));
    expect(cats['skill-ventas']).toBe('negocio');
    expect(cats['skill-liderazgo']).toBe('negocio');
    expect(cats['skill-finanzas']).toBe('negocio');
    expect(cats['skill-tecnologia']).toBe('tecnologia');
    expect(cats['skill-ingles']).toBe('idioma');
    expect(cats['skill-comunicacion']).toBe('social');
    expect(guessSkillCategory('Cocinar mole')).toBe('hogar');
    expect(guessSkillCategory('Tocar guitarra')).toBe('arte');
    expect(guessSkillCategory('Correr medio maratón')).toBe('deporte');
    expect(guessSkillCategory('Algo raro', 'fuerza')).toBe('deporte');
    expect(guessSkillCategory('Algo raro')).toBe('otro');
    // La categoría guardada gana.
    expect(skillCategory({ name: 'Inglés', attribute: 'inteligencia', category: 'oficio' })).toBe('oficio');
  });

  it('al escribir el nombre de una habilidad nueva, adivina categoría y atributo sin pisar lo que elegiste', () => {
    // Nada elegido: categoría y atributo salen del nombre.
    expect(skillNameEdit('Guitarra', { category: false, attribute: false })).toEqual({ name: 'Guitarra', category: 'arte', attribute: 'creatividad' });
    // Elegiste Disciplina y luego corriges el nombre: el atributo no se toca (la XP de sus rangos va a donde elegiste).
    const fix = skillNameEdit('Guitarra eléctrica', { category: false, attribute: true });
    expect(fix).toEqual({ name: 'Guitarra eléctrica', category: 'arte' });
    expect('attribute' in fix).toBe(false);
    // Elegiste la categoría: solo cambia el nombre.
    expect(skillNameEdit('Guitarra', { category: true, attribute: false })).toEqual({ name: 'Guitarra' });
  });

  it('agrupa por categoría en el orden fijo', () => {
    const groups = groupSkillsByCategory(seed.filter((e) => e.module === 'skills') as Entity<SkillData>[]);
    const order = groups.map((g) => g.category);
    expect(order).toEqual(SKILL_CATEGORIES.filter((c) => order.includes(c)));
    expect(groups.find((g) => g.category === 'negocio')!.items).toHaveLength(3);
  });

  it('cada habilidad suma su tiempo, sesiones y última práctica (sin XP); los rangos siguen igual', () => {
    const evs = [
      time('2026-11-10', 60, 'estudio', { skillId: 'skill-ingles' }),
      time('2026-11-17', 45, 'estudio', { skillId: 'skill-ingles' }),
      time('2026-11-18', 30, 'trabajo', { skillId: 'skill-borrada' }),
      ev('skill.rank_unlocked', '2026-11-12', { skillId: 'skill-ventas', rank: 1, evidence: '10 llamadas' }),
      ev('skill.rank_unlocked', '2026-11-13', { skillId: 'skill-ventas', rank: 3, evidence: 'fuera de orden' }),
    ];
    const s = run(evs, TODAY);
    expect(s.skills['skill-ingles']).toMatchObject({ rank: 0, minutes: 105, minutesThisWeek: 45, sessions: 2, lastPractice: '2026-11-17', category: 'idioma' });
    expect(s.skills['skill-ventas']).toMatchObject({ rank: 1, rankName: 'Aprendiz', minutes: 0, lastPractice: '2026-11-12', category: 'negocio' });
    expect(s.skills['skill-borrada']).toBeUndefined();
    expect(bySource(s, 'skill')).toBe(GAME_CONFIG.rewards.skillRank);
  });
});

describe('biblioteca: avance y lo que aprendí', () => {
  const ents = [...seed, book('book-a', { title: 'Hábitos atómicos', pages: 320, rating: 5 }), book('book-b', { title: 'Curso de ventas', bookType: 'curso' })];

  it('el último avance gana y se convierte a % con las páginas', () => {
    const s = run(
      [
        ev('library.progress', '2026-11-01', { bookId: 'book-a', page: 40 }),
        ev('library.progress', '2026-11-15', { bookId: 'book-a', page: 160 }),
        ev('library.progress', '2026-11-16', { bookId: 'book-b', percent: 30 }),
        ev('library.progress', '2026-11-17', { bookId: 'book-b', page: 3 }),
      ],
      TODAY,
      { entities: ents },
    );
    expect(s.library.progress['book-a']).toMatchObject({ date: '2026-11-15', page: 160, percent: 50, startedOn: '2026-11-01', updates: 2 });
    // Sin páginas totales, la página no se puede convertir a %.
    expect(s.library.progress['book-b']).toMatchObject({ page: 3, percent: null });
    expect(bookPercent({ percent: 99.6 })).toBe(100);
    expect(bookPercent({ page: 10 }, null)).toBeNull();
  });

  it('las notas van de la más reciente a la más vieja, con conteo por libro', () => {
    const s = run(
      [
        ev('library.note', '2026-11-01', { bookId: 'book-a', text: 'Sistemas, no metas.' }),
        ev('library.note', '2026-11-05', { bookId: 'book-a', text: 'Hazlo obvio.', page: 80 }),
        ev('library.note', '2026-11-06', { bookId: 'book-x', title: 'Libro que ya no está', text: 'Idea suelta' }),
      ],
      TODAY,
      { entities: ents },
    );
    expect(s.library.notes.map((n) => n.text)).toEqual(['Idea suelta', 'Hazlo obvio.', 'Sistemas, no metas.']);
    expect(s.library.notes[1]).toMatchObject({ title: 'Hábitos atómicos', page: 80 });
    expect(s.library.notes[0].title).toBe('Libro que ya no está');
    expect(s.library.notesByBook).toEqual({ 'book-a': 2, 'book-x': 1 });
  });

  it('terminados por año con su calificación actual', () => {
    const s = run([ev('library.finished', '2026-03-02', { bookId: 'book-a', title: 'Hábitos atómicos', size: 'media', attribute: 'inteligencia', note: 'Sistemas' })], TODAY, { entities: ents });
    expect(s.library.finished['book-a']).toMatchObject({ date: '2026-03-02', rating: 5, note: 'Sistemas' });
    expect(s.library.byYear['2026']).toBe(1);
  });
});

describe('herramientas de IA del sistema habilidades', () => {
  const tool = (store: ReturnType<typeof memoryAssistantStore>, name: string, input: unknown = {}, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });
  const mk = (events: GameEvent[] = [], entities: Entity[] = seed) => memoryAssistantStore({ events, entities, today: TODAY });
  const YDAY = '2026-11-18';

  it('registrar_tiempo guarda el registro, no da XP y no duplica', async () => {
    const store = mk();
    const r = await tool(store, 'registrar_tiempo', { area: 'trabajo', horas: 8, minutos: 20, nota: 'Oficina', fecha: YDAY });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('8 h 20 min de trabajo');
    expect(r.refs?.events).toHaveLength(1);
    const [e] = store.allEvents();
    expect(e).toMatchObject({ type: 'time.logged', localDate: YDAY, payload: { minutes: 500, area: 'trabajo', note: 'Oficina', skillId: null } });
    const again = await tool(store, 'registrar_tiempo', { area: 'trabajo', minutos: 500, fecha: YDAY });
    expect(again.text).toContain('Ya estaba');
    expect(store.allEvents()).toHaveLength(1);
    expect(project({ events: store.allEvents(), entities: seed, today: TODAY }).xp.total).toBe(0);
  });

  it('registrar_tiempo valida duración, habilidad y que no sea tiempo que aún no pasa', async () => {
    const store = mk();
    expect((await tool(store, 'registrar_tiempo', { area: 'trabajo' })).isError).toBe(true);
    expect((await tool(store, 'registrar_tiempo', { area: 'oficina', horas: 1 })).isError).toBe(true);
    expect((await tool(store, 'registrar_tiempo', { area: 'estudio', horas: 1, habilidad_id: 'no-existe' })).isError).toBe(true);
    // En la memoria "ahora" es mediodía en CDMX: 13 h de hoy todavía no caben.
    const r = await tool(store, 'registrar_tiempo', { area: 'trabajo', horas: 13 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('¿Fue ayer?');
    expect((await tool(store, 'registrar_tiempo', { area: 'trabajo', horas: 1, inicio: '18:00' })).isError).toBe(true);
    const ok = await tool(store, 'registrar_tiempo', { area: 'estudio', minutos: 40, habilidad_id: 'skill-ingles', inicio: '07:00' });
    expect(ok.isError).toBeFalsy();
    expect(store.allEvents()[0].payload).toMatchObject({ skillId: 'skill-ingles', start: '07:00', minutes: 40 });
  });

  it('registrar_tiempo se niega en modo solo lectura; ver_tiempo sí responde', async () => {
    const store = mk([time(YDAY, 500, 'trabajo', { note: 'Oficina' }), time('2026-11-17', 60, 'familia'), time('2026-11-12', 300, 'trabajo')]);
    expect((await tool(store, 'registrar_tiempo', { area: 'trabajo', horas: 1, fecha: YDAY }, false)).isError).toBe(true);
    const v = await tool(store, 'ver_tiempo', {}, false);
    expect(v.isError).toBeFalsy();
    expect(v.text).toContain('Esta semana: 9 h 20 min');
    expect(v.text).toContain('no da XP');
    const d = await tool(store, 'ver_tiempo', { dia: YDAY }, false);
    expect(d.text).toContain('Trabajo 8 h 20 min');
    const range = await tool(store, 'ver_tiempo', { desde: '2026-11-01', hasta: TODAY }, false);
    expect(range.text).toContain('Total: 14 h 20 min');
  });

  it('guardar_habilidad agrega en una línea con categoría deducida y no duplica nombres', async () => {
    const store = mk();
    const r = await tool(store, 'guardar_habilidad', { nombre: 'Cocinar para 20 personas', vivo_de_esto: false });
    expect(r.isError).toBeFalsy();
    const created = store.allEntities().find((e) => (e.data as SkillData).name === 'Cocinar para 20 personas')!;
    expect(created.data).toMatchObject({ category: 'hogar', attribute: 'disciplina', livelihood: false });
    expect((created.data as SkillData).ranks).toHaveLength(3);
    const dup = await tool(store, 'guardar_habilidad', { nombre: 'ventas y NEGOCIACIÓN' });
    expect(dup.isError).toBe(true);
    expect(dup.text).toContain('skill-ventas');
    const edit = await tool(store, 'guardar_habilidad', { id: 'skill-ventas', vivo_de_esto: true, notas: 'Método SPIN' });
    expect(edit.isError).toBeFalsy();
    const ventas = store.allEntities().find((e) => e.id === 'skill-ventas')!;
    expect(ventas.data).toMatchObject({ livelihood: true, notes: 'Método SPIN', category: 'negocio', name: 'Ventas y negociación' });
    const list = await tool(store, 'ver_habilidades');
    expect(list.text).toContain('De esto vive: Ventas y negociación');
    expect(list.text).toContain('## Hogar');
  });

  it('subir_rango_habilidad sube en orden con evidencia (+100 XP) y respeta la fecha del rango anterior', async () => {
    const store = mk([ev('skill.rank_unlocked', '2026-11-10', { skillId: 'skill-ingles', rank: 1, evidence: 'Conversación de 30 min' })]);
    const early = await tool(store, 'subir_rango_habilidad', { habilidad_id: 'skill-ingles', evidencia: 'Junta en inglés', fecha: '2026-11-05' });
    expect(early.isError).toBe(true);
    const r = await tool(store, 'subir_rango_habilidad', { habilidad_id: 'skill-ingles', evidencia: 'Junta de negocios en inglés con un cliente' });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Experto');
    const s = project({ events: store.allEvents(), entities: seed, today: TODAY });
    expect(s.skills['skill-ingles'].rank).toBe(2);
    expect(bySource(s, 'skill')).toBe(2 * GAME_CONFIG.rewards.skillRank);
  });

  it('avance_de_libro y nota_de_libro registran sin XP; un pendiente pasa a leyendo', async () => {
    const store = mk([], [...seed, book('book-a', { title: 'Hábitos atómicos', pages: 320, status: 'pendiente' })]);
    const a = await tool(store, 'avance_de_libro', { libro_id: 'book-a', pagina: 80 });
    expect(a.isError).toBeFalsy();
    expect(a.text).toContain('25%');
    expect(a.refs?.entities).toHaveLength(1);
    expect((store.allEntities().find((e) => e.id === 'book-a')!.data as BookData).status).toBe('leyendo');
    expect((await tool(store, 'avance_de_libro', { libro_id: 'book-a', pagina: 999 })).isError).toBe(true);
    expect((await tool(store, 'avance_de_libro', { libro_id: 'book-a' })).isError).toBe(true);
    const n = await tool(store, 'nota_de_libro', { libro_id: 'book-a', texto: 'El 1% diario se acumula.' });
    expect(n.isError).toBeFalsy();
    const n2 = await tool(store, 'nota_de_libro', { libro_id: 'book-a', texto: 'el 1% diario se acumula.' });
    expect(n2.text).toContain('ya estaba');
    const s = project({ events: store.allEvents(), entities: store.allEntities(), today: TODAY });
    expect(s.xp.total).toBe(0);
    expect(s.library.progress['book-a'].percent).toBe(25);
    expect(s.library.notes).toHaveLength(1);
    const v = await tool(store, 'ver_biblioteca');
    expect(v.text).toContain('Hábitos atómicos: 25%');
    expect(v.text).toContain('El 1% diario se acumula.');
    const detail = await tool(store, 'ver_biblioteca', { libro_id: 'book-a' });
    expect(detail.text).toContain('Lo que aprendí (1)');
  });

  it('terminar_libro acepta calificación y guardar_libro liga páginas y habilidad', async () => {
    const store = mk();
    const g = await tool(store, 'guardar_libro', { titulo: 'SPIN Selling', paginas: 200, habilidad_id: 'skill-ventas', estado: 'leyendo' });
    expect(g.isError).toBeFalsy();
    const b = store.allEntities().find((e) => e.module === 'library')!;
    expect(b.data).toMatchObject({ pages: 200, skillId: 'skill-ventas', rating: null });
    expect((await tool(store, 'guardar_libro', { titulo: 'X', habilidad_id: 'nada' })).isError).toBe(true);
    const t = await tool(store, 'terminar_libro', { libro_id: b.id, nota: 'Preguntar antes de presentar', calificacion: 4 });
    expect(t.isError).toBeFalsy();
    expect(t.refs?.entities).toHaveLength(1);
    expect(store.allEntities().find((e) => e.id === b.id)!.data).toMatchObject({ rating: 4 });
    const again = await tool(store, 'terminar_libro', { libro_id: b.id, calificacion: 5 });
    expect(again.text).toContain('5/5');
    const s = project({ events: store.allEvents(), entities: store.allEntities(), today: TODAY });
    expect(bySource(s, 'library')).toBe(GAME_CONFIG.missionXp.media);
    const sk = await tool(store, 'ver_habilidades');
    expect(sk.text).toContain('libros: SPIN Selling');
  });

  it('la foto y el panorama incluyen tiempo, habilidades y lectura', async () => {
    const ents: Entity[] = [...seed.map((e) => (e.id === 'skill-ventas' ? { ...e, data: { ...e.data, livelihood: true } } : e)), book('book-a', { title: 'Hábitos atómicos', pages: 100 })];
    const evs = [
      time(YDAY, 500, 'trabajo'),
      time(TODAY, 30, 'estudio', { skillId: 'skill-ingles' }),
      time('2026-11-11', 200, 'trabajo'),
      ev('library.progress', YDAY, { bookId: 'book-a', page: 40 }),
      ev('library.note', YDAY, { bookId: 'book-a', text: 'Ambiente > fuerza de voluntad' }),
    ];
    const state = project({ events: evs, entities: ents, today: TODAY });
    const snap = buildSnapshot(state, ents, { version: 1, computedBy: 'app', now: new Date(`${TODAY}T18:00:00Z`) });
    expect(snap.time).toMatchObject({ todayTotal: 30, thisWeekTotal: 530, lastWeekTotal: 200, lastWeekToDate: 200 });
    expect(snap.time.skillsThisWeek).toEqual([{ id: 'skill-ingles', name: 'Inglés', minutes: 30 }]);
    expect(snap.skills.find((x) => x.id === 'skill-ingles')).toMatchObject({ category: 'idioma', minutes: 30, lastPractice: TODAY });
    expect(snap.library.reading).toEqual([{ id: 'book-a', title: 'Hábitos atómicos', percent: 40, page: 40, pages: 100, lastUpdate: YDAY }]);
    expect(snap.library.notes).toBe(1);
    const text = renderOverview(snap);
    expect(text).toContain('## Tiempo, habilidades y lectura');
    expect(text).toContain('De esto vive: Ventas y negociación');
    expect(text).toContain('Hábitos atómicos 40%');
    const guide = await tool(mk(), 'guia_de_la_app');
    expect(guide.text).toContain('NO da XP');
  });
});
