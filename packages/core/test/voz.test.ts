import { describe, expect, it } from 'vitest';
import {
  buildVoiceContext,
  inferMission,
  matchVoiceMission,
  memoryAssistantStore,
  parseDictation,
  parseSpanishNumber,
  project,
  renderOverview,
  runAssistantTool,
  splitDictation,
  validateEvent,
  voiceDuplicate,
  type Entity,
  type VoiceContext,
  type VoiceProposal,
} from '../src';
import { done, ev, seed } from './helpers';

const TODAY = '2026-11-19'; // jueves

const PEOPLE: Entity[] = [
  { id: 'npc-ana', module: 'npcs', kind: 'npc', sort: 1, data: { name: 'Ana López', npcType: 'aliado', relation: 3, key: true } },
  { id: 'npc-mama', module: 'npcs', kind: 'npc', sort: 2, data: { name: 'Mamá', npcType: 'party', relation: 5, key: true } },
  // Campos del sistema de personas (role/circle): se leen si existen.
  { id: 'npc-sofi', module: 'npcs', kind: 'npc', sort: 3, data: { name: 'Sofía', npcType: 'party', relation: 5, key: true, role: 'pareja', circle: 'familia' } },
  { id: 'npc-papa', module: 'npcs', kind: 'npc', sort: 4, data: { name: 'Jorge', npcType: 'party', relation: 4, key: true, role: 'papá' } },
  { id: 'npc-luis', module: 'npcs', kind: 'npc', sort: 5, data: { name: 'Luis', npcType: 'aliado', relation: 3, key: false, role: 'amigo' } },
  { id: 'npc-beto', module: 'npcs', kind: 'npc', sort: 6, data: { name: 'Beto', npcType: 'aliado', relation: 3, key: false, role: 'amigo' } },
];
const TODO: Entity = { id: 'todo-contador', module: 'planner', kind: 'todo', sort: 1, data: { title: 'Llamar al contador', size: 'chica', attribute: 'finanzas', date: TODAY } };
const SETTINGS: Entity = { ...seed.find((e) => e.id === 'settings')!, data: { ...seed.find((e) => e.id === 'settings')!.data, budgets: { Servicios: 3000, Alimentos: 6000 } } };
const ENTITIES: Entity[] = [...seed.filter((e) => e.id !== 'settings'), SETTINGS, ...PEOPLE, TODO];

const ctx = (events = [] as ReturnType<typeof ev>[], today = TODAY): VoiceContext => buildVoiceContext(events, ENTITIES, today);
const parse = (text: string, c = ctx()) => parseDictation(text, c);
/** Propuesta de un tipo (ingreso y gasto comparten forma). */
type Of<K extends VoiceProposal['kind']> = [Extract<VoiceProposal, { kind: K }>] extends [never] ? Extract<VoiceProposal, { kind: 'income' | 'expense' }> : Extract<VoiceProposal, { kind: K }>;
const only = <K extends VoiceProposal['kind']>(r: { proposals: VoiceProposal[] }, kind: K) => r.proposals.filter((p): p is Of<K> => p.kind === kind);

describe('números dichos en español', () => {
  it.each([
    ['200', 200],
    ['$1,500', 1500],
    ['$1,500.50', 1500.5],
    ['82.5', 82.5],
    ['82,5', 82.5],
    ['15 mil', 15000],
    ['2 mil 500', 2500],
    ['3 lucas', 3000],
    ['5k', 5000],
    ['doscientos', 200],
    ['mil quinientos', 1500],
    ['dos mil quinientos', 2500],
    ['doscientos cincuenta mil', 250000],
    ['treinta y cinco', 35],
    ['ochenta y dos punto cinco', 82.5],
    ['seis y media', 6.5],
    ['siete y cuarto', 7.25],
    ['un millón', 1000000],
    ['veintidós', 22],
  ])('"%s" → %d', (text, n) => {
    expect(parseSpanishNumber(text)).toBe(n);
  });

  it('sin número → null', () => {
    expect(parseSpanishNumber('nada por aquí')).toBeNull();
  });
});

describe('partir lo dictado en frases', () => {
  const texts = (t: string) => splitDictation(t).map((c) => c.text);

  it('por puntuación y conectores', () => {
    expect(texts('Hoy fui al gym, gasté 200 en comida y hablé con mi mamá')).toEqual(['Hoy fui al gym', 'gasté 200 en comida', 'hablé con mi mamá']);
    expect(texts('Fui al banco. Luego leí un rato')).toEqual(['Fui al banco', 'Luego leí un rato']);
    // El relleno ("luego", "hoy") se quita al armar el título.
    expect(parseDictation('Fui al banco. Luego medité un rato', ctx()).proposals.map((p) => (p.kind === 'mission' ? p.title : p.kind))).toEqual(['Fui al banco', 'Medité un rato']);
  });

  it('sin puntuación (como llega del dictado): corta donde empieza otro verbo', () => {
    expect(texts('hoy fui al gym gasté 200 en comida y le marqué a mi novia')).toEqual(['hoy fui al gym', 'gasté 200 en comida', 'le marqué a mi novia']);
    expect(texts('me levanté temprano medité y leí')).toEqual(['me levanté temprano', 'medité', 'leí']);
    expect(texts('le marqué a mi novia mañana tengo que llamar al banco')).toEqual(['le marqué a mi novia', 'mañana tengo que llamar al banco']);
    expect(texts('fui al gym en la mañana')).toEqual(['fui al gym en la mañana']);
  });

  it('no corta números, fracciones, listas de personas ni frases subordinadas', () => {
    expect(texts('dormí seis horas y media')).toEqual(['dormí seis horas y media']);
    expect(texts('treinta y cinco minutos de inglés')).toEqual(['treinta y cinco minutos de inglés']);
    expect(texts('peso 82.5')).toEqual(['peso 82.5']);
    expect(texts('comí con mi papá, mi mamá y mi hermano')).toEqual(['comí con mi papá, mi mamá y mi hermano']);
    expect(texts('comí con Ana y José')).toEqual(['comí con Ana y José']);
    expect(texts('hablé con Ana sobre lo que pasó')).toEqual(['hablé con Ana sobre lo que pasó']);
  });

  it('una lección no se parte y se lleva el tropiezo que la explica', () => {
    const c = splitDictation('Fui al gym. Me fue mal en la junta y aprendí que tengo que preparar mejor y llegar antes');
    expect(c).toEqual([
      { text: 'Fui al gym', lesson: false },
      { text: 'Me fue mal en la junta y aprendí que tengo que preparar mejor y llegar antes', lesson: true },
    ]);
  });
});

describe('inferMission: tamaño y atributo automáticos', () => {
  it.each([
    ['Fui al gym', 'fuerza', 'media'],
    ['Corrí 5 km', 'fuerza', 'media'],
    ['Leí un rato', 'inteligencia', 'chica'],
    ['Estudié para el examen', 'inteligencia', 'media'],
    ['Cerré una venta con Grupo Norte', 'finanzas', 'grande'],
    ['Pagué la tarjeta', 'finanzas', 'chica'],
    ['Junta con el cliente nuevo', 'carisma', 'media'],
    ['Le escribí a mi mamá', 'relaciones', 'chica'],
    ['Comí con mi hija', 'relaciones', 'chica'],
    ['Diseñé el logo', 'creatividad', 'chica'],
    ['Medité 10 minutos', 'disciplina', 'chica'],
    ['Me levanté temprano', 'disciplina', 'chica'],
  ])('"%s" → %s · %s', (title, attribute, size) => {
    const r = inferMission(title);
    expect(r.attribute).toBe(attribute);
    expect(r.size).toBe(size);
    expect(r.source).toBe('diccionario');
  });

  it('las actividades físicas claras pesan más que la compañía; las personas más que el verbo', () => {
    expect(inferMission('Fui al gym con mi novia').attribute).toBe('fuerza');
    expect(inferMission('Le escribí una carta a mi papá').attribute).toBe('relaciones');
  });

  it('su historial manda: mismo título o uno parecido reutiliza lo que eligió', () => {
    const history = [
      { title: 'Fui al gym', size: 'chica' as const, attribute: 'disciplina' as const, count: 4 },
      { title: 'Revisé la propuesta de Punto Empresarios', size: 'grande' as const, attribute: 'carisma' as const, count: 1 },
    ];
    expect(inferMission('fui al gym', history)).toMatchObject({ size: 'chica', attribute: 'disciplina', source: 'historial', match: 'Fui al gym' });
    expect(inferMission('Revisé la propuesta de Punto Empresarios otra vez', history)).toMatchObject({ size: 'grande', attribute: 'carisma', source: 'parecido' });
  });

  it('sin pistas: chica · Disciplina', () => {
    expect(inferMission('Algo raro')).toEqual({ size: 'chica', attribute: 'disciplina', source: 'defecto' });
  });

  it('la duración nunca sube el tamaño (regla de oro 3: XP por acciones, no por horas)', () => {
    expect(inferMission('Leí 2 horas').size).toBe(inferMission('Leí 20 minutos').size);
    expect(inferMission('Jugué videojuegos 5 horas').size).toBe(inferMission('Jugué videojuegos 20 minutos').size);
    for (const d of ['una hora', 'hora y media', '3 horas', 'cinco hrs']) {
      // Solo una duración no es pista: sigue siendo "sin pistas" (y no basta para proponer una misión).
      expect(inferMission(`Algo raro ${d}`)).toEqual({ size: 'chica', attribute: 'disciplina', source: 'defecto' });
    }
  });
});

describe('contexto del analizador', () => {
  it('incluye diarias, agenda y personas; quita lo que ya no se puede completar', () => {
    const events = [done('2026-11-10', 'side-bot-whatsapp', 'grande', 'inteligencia', 'side'), done('2026-11-18', 'quick-cotice-a-acme', 'media', 'finanzas', 'quick', { title: 'Coticé a Acme' })];
    const c = ctx(events);
    expect(c.missions.find((m) => m.id === 'daily-leer')?.routine).toBe(true);
    expect(c.missions.some((m) => m.id === 'side-bot-whatsapp')).toBe(false);
    expect(c.missions.find((m) => m.id === 'todo-contador')?.kind).toBe('todo');
    expect(c.people.find((p) => p.id === 'npc-sofi')).toMatchObject({ role: 'pareja', circle: 'familia' });
    expect(c.history.find((h) => h.title === 'Coticé a Acme')).toMatchObject({ size: 'media', attribute: 'finanzas', count: 1 });
    expect(c.categories).toEqual(expect.arrayContaining(['Servicios', 'Alimentos']));
  });

  it('reconoce misiones del catálogo por parecido (verbos conjugados, sinónimos y opciones con "o")', () => {
    const m = ctx().missions;
    expect(matchVoiceMission('entrené pierna', m)?.id).toBe('daily-entrenar');
    expect(matchVoiceMission('fui al gimnasio', m)?.id).toBe('daily-entrenar');
    expect(matchVoiceMission('leí', m)?.id).toBe('daily-leer');
    expect(matchVoiceMission('estiré un rato', m)?.id).toBe('daily-caminar');
    expect(matchVoiceMission('contacté a 5 prospectos', m)?.id).toBe('daily-prospectos');
    expect(matchVoiceMission('le llamé al contador', m)?.id).toBe('todo-contador');
    expect(matchVoiceMission('fui al súper', m)).toBeNull();
  });
});

describe('parseDictation: lo que dices → propuestas', () => {
  it('un día completo dictado de corrido', () => {
    const r = parse('Hoy fui al gym, gasté 200 en comida y hablé con mi mamá');
    expect(r.proposals.map((p) => p.kind)).toEqual(['mission', 'expense', 'person']);
    expect(r.proposals[0]).toMatchObject({ missionId: 'daily-entrenar', matched: true, date: TODAY });
    expect(r.proposals[1]).toMatchObject({ amount: 200, concept: 'Comida', category: 'Alimentos' });
    expect(r.proposals[2]).toMatchObject({ npcId: 'npc-mama', name: 'Mamá' });
    expect(r.unknown).toEqual([]);
  });

  it('gastos: monto, concepto y categoría (con sus propios nombres de categoría)', () => {
    expect(only(parse('pagué 1,500 de luz'), 'expense')[0]).toMatchObject({ amount: 1500, concept: 'Luz', category: 'Servicios' });
    expect(only(parse('$350 de gasolina'), 'expense')[0]).toMatchObject({ amount: 350, concept: 'Gasolina', category: 'Transporte' });
    expect(only(parse('gasté mil quinientos en el súper'), 'expense')[0]).toMatchObject({ amount: 1500, concept: 'Súper' });
    expect(only(parse('compré 2 kilos de carne en 300 pesos'), 'expense')[0]).toMatchObject({ amount: 300 });
    // "…y 150 de uber": el segundo monto hereda que es gasto.
    expect(only(parse('gasté 200 en comida y 150 de uber'), 'expense').map((p) => [p.amount, p.concept])).toEqual([
      [200, 'Comida'],
      [150, 'Uber'],
    ]);
  });

  it('un segundo monto con su propio día no se pierde ("ayer gasté 200 y hoy 300")', () => {
    const r = parse('ayer gasté 200 y hoy 300');
    expect(only(r, 'expense').map((p) => [p.amount, p.date])).toEqual([
      [200, '2026-11-18'],
      [300, TODAY],
    ]);
    expect(r.unknown).toEqual([]);
  });

  it('la categoría de un concepto que ya registró gana', () => {
    const events = [ev('expense.recorded', '2026-11-01', { amount: 90, concept: 'Tacos', category: 'Antojos' })];
    expect(only(parse('gasté 120 en tacos', ctx(events)), 'expense')[0].category).toBe('Antojos');
  });

  it('ingresos: cobré, me pagaron, vendí, facturé; cerrar una venta también es misión', () => {
    expect(only(parse('me pagaron 5,000 de la página web de Grupo Norte'), 'income')[0]).toMatchObject({ amount: 5000, concept: 'Página web de Grupo Norte' });
    expect(only(parse('cobré 3 lucas de una asesoría'), 'income')[0]).toMatchObject({ amount: 3000, concept: 'Asesoría' });
    expect(only(parse('vendí 2 mil de playeras'), 'income')[0]).toMatchObject({ amount: 2000 });
    expect(only(parse('facturé quince mil'), 'income')[0]).toMatchObject({ amount: 15000 });
    expect(only(parse('me cobraron 300 de comisión'), 'expense')[0]).toMatchObject({ amount: 300 });
    // Dinero que alguien te dio: ingreso, no gasto.
    for (const t of ['me regalaron 500 pesos', 'me prestaron 2 mil pesos', 'me reembolsaron 800 pesos', 'me devolvieron 300 pesos']) {
      const r = parse(t);
      expect(only(r, 'expense')).toEqual([]);
      expect(only(r, 'income')).toHaveLength(1);
    }
    expect(only(parse('mi papá me pasó 1000 pesos'), 'income')[0]).toMatchObject({ amount: 1000, concept: 'Papá' });
    expect(only(parse('me dio 200 pesos mi mamá'), 'income')[0]).toMatchObject({ amount: 200, concept: 'Mamá' });
    // Si la frase dice que lo gastaste, es gasto.
    expect(only(parse('me dio hambre y gasté 100 en tacos'), 'expense')[0]).toMatchObject({ amount: 100, concept: 'Tacos' });
    const deal = parse('Cerré una venta de 15 mil con Grupo Norte');
    expect(only(deal, 'income')[0]).toMatchObject({ amount: 15000, concept: 'Venta con Grupo Norte' });
    expect(only(deal, 'mission')[0]).toMatchObject({ title: 'Cerré una venta con Grupo Norte', size: 'grande', attribute: 'finanzas', missionKind: 'quick' });
  });

  it('sueño, con palabras y fracciones; "anoche" cuenta para hoy', () => {
    expect(only(parse('dormí 7 horas'), 'sleep')[0]).toMatchObject({ hours: 7, date: TODAY });
    expect(only(parse('dormí seis horas y media'), 'sleep')[0]).toMatchObject({ hours: 6.5 });
    expect(only(parse('anoche dormí como cinco horas'), 'sleep')[0]).toMatchObject({ hours: 5, date: TODAY });
    expect(only(parse('ayer dormí 8 horas'), 'sleep')[0]).toMatchObject({ hours: 8, date: '2026-11-18' });
    // "a las 12" es una hora del día, no horas de sueño.
    expect(only(parse('me dormí a las 12'), 'sleep')).toEqual([]);
    // Una siesta no es la noche (pisaría el check-in de la mañana).
    expect(only(parse('dormí una siesta de una hora'), 'sleep')).toEqual([]);
    expect(only(parse('me dormí una hora en la tarde'), 'sleep')).toEqual([]);
    expect(only(parse('anoche dormí 7 horas y en la tarde una siesta'), 'sleep')[0]).toMatchObject({ hours: 7 });
  });

  it('peso', () => {
    expect(only(parse('peso 82.5'), 'weight')[0]).toMatchObject({ kg: 82.5 });
    expect(only(parse('hoy pesé 81 kilos'), 'weight')[0]).toMatchObject({ kg: 81 });
    expect(only(parse('pesé ochenta y dos punto cinco kilos'), 'weight')[0]).toMatchObject({ kg: 82.5 });
    expect(only(parse('amanecí en 80 kilos y medio'), 'weight')[0]).toMatchObject({ kg: 80.5 });
    expect(only(parse('gasté 500 pesos'), 'weight')).toEqual([]);
    // "Me levanté" no es una carga.
    expect(only(parse('me levanté temprano y pesé 80 kilos'), 'weight')[0]).toMatchObject({ kg: 80 });
  });

  it('una carga en el gym no es tu peso: se propone el entrenamiento', () => {
    for (const t of ['hice sentadilla con 80 kilos', 'levanté 100 kilos en press de banca', 'hice peso muerto con 120 kg']) {
      const r = parse(t);
      expect(only(r, 'weight')).toEqual([]);
      expect(only(r, 'mission')).toHaveLength(1);
    }
    const gym = parse('fui al gym y cargué 60 kilos');
    expect(only(gym, 'weight')).toEqual([]);
    expect(only(gym, 'mission')[0]).toMatchObject({ missionId: 'daily-entrenar' });
  });

  it('día de descanso', () => {
    expect(only(parse('hoy descanso'), 'rest')).toHaveLength(1);
    expect(only(parse('ayer fue mi día de descanso'), 'rest')[0].date).toBe('2026-11-18');
  });

  it('personas por nombre, por papel ("mi papá", "mi novia") y con canal', () => {
    const r = parse('le marqué a mi novia y comí con mi papá');
    const people = only(r, 'person');
    expect(people.map((p) => [p.npcId, p.channel])).toEqual([
      ['npc-sofi', 'llamada'],
      ['npc-papa', 'persona'],
    ]);
    expect(only(r, 'mission')).toEqual([]);
    expect(only(parse('hablé con Ana sobre la propuesta'), 'person')[0]).toMatchObject({ npcId: 'npc-ana', note: 'Hablé con Ana sobre la propuesta' });
    expect(only(parse('le mandé whats a Luis'), 'person')[0]).toMatchObject({ npcId: 'npc-luis', channel: 'mensaje' });
    // Dos personas con el mismo papel: se elige una y la otra queda como alternativa.
    expect(only(parse('salí con mi amigo'), 'person')[0]).toMatchObject({ npcId: 'npc-luis', alternatives: [{ id: 'npc-beto', name: 'Beto' }] });
    // "mis papás" = papá y mamá.
    expect(only(parse('cené con mis papás'), 'person').map((p) => p.npcId).sort()).toEqual(['npc-mama', 'npc-papa']);
  });

  it('persona sin ficha → misión de Relaciones; con una diaria ligada, la diaria', () => {
    expect(only(parse('comí con mi abuela'), 'mission')[0]).toMatchObject({ title: 'Comí con mi abuela', attribute: 'relaciones', missionKind: 'quick' });
    expect(only(parse('estuve con mi hijo en el parque'), 'mission')[0]).toMatchObject({ missionId: 'daily-hijo', matched: true });
  });

  it('actividad con alguien: misión y contacto', () => {
    const r = parse('antier corrí 5 km con Ana');
    expect(only(r, 'person')[0]).toMatchObject({ npcId: 'npc-ana', date: '2026-11-17' });
    expect(only(r, 'mission')[0]).toMatchObject({ title: 'Corrí 5 km con Ana', attribute: 'fuerza', size: 'media', date: '2026-11-17' });
  });

  it('misiones: del catálogo (rutina y agenda) o rápidas con tamaño y atributo inferidos', () => {
    const r = parse('leí 20 páginas y medité, luego le llamé al contador');
    expect(only(r, 'mission').map((p) => [p.missionId, p.matched])).toEqual([
      ['daily-leer', true],
      ['quick-medite', false],
      ['todo-contador', true],
    ]);
    expect(only(parse('diseñé el logo de Punto Empresarios'), 'mission')[0]).toMatchObject({ attribute: 'creatividad', inferred: 'diccionario' });
  });

  it('usa el historial para las misiones rápidas', () => {
    const events = [done('2026-11-12', 'quick-medite', 'media', 'creatividad', 'quick', { title: 'Medité' })];
    expect(only(parse('medité', ctx(events)), 'mission')[0]).toMatchObject({ size: 'media', attribute: 'creatividad', inferred: 'historial' });
  });

  it('lecciones', () => {
    const r = parse('Me fue mal en la junta y aprendí que tengo que llevar los números listos');
    expect(r.proposals).toHaveLength(1);
    expect(only(r, 'lesson')[0].text).toBe('Me fue mal en la junta y aprendí que tengo que llevar los números listos');
    expect(only(parse('la lección de hoy es no prometer fechas sin revisar'), 'lesson')).toHaveLength(1);
  });

  it('pendientes para después van a la agenda (y su fecha no se pega a lo demás)', () => {
    const r = parse('mañana tengo que llamar al banco y hoy leí');
    expect(only(r, 'todo')[0]).toMatchObject({ title: 'Llamar al banco', date: '2026-11-20' });
    expect(only(r, 'mission')[0]).toMatchObject({ missionId: 'daily-leer', date: TODAY });
    expect(only(parse('no olvidar pagar la renta'), 'todo')[0]).toMatchObject({ title: 'Pagar la renta', date: TODAY });
    expect(only(parse('el viernes junta con Grupo Norte'), 'todo')[0]).toMatchObject({ date: '2026-11-20' });
  });

  it('fechas relativas: ayer, antier, hace N días, el lunes (y se quedan para lo que sigue)', () => {
    expect(parse('ayer fui al gym y leí').proposals.map((p) => p.date)).toEqual(['2026-11-18', '2026-11-18']);
    expect(parse('hace 3 días leí').proposals[0].date).toBe('2026-11-16');
    const r = parse('el lunes fui al cine con mi novia');
    expect(r.proposals.map((p) => p.date)).toEqual(['2026-11-16', '2026-11-16']);
    expect(only(r, 'mission')[0].title).toBe('Fui al cine con mi novia');
  });

  it('no registra lo que NO hiciste ni el relleno', () => {
    expect(parse('no fui al gym').proposals).toEqual([]);
    expect(parse('no fui al gym').unknown).toEqual(['no fui al gym']);
    expect(parse('bueno este pues nada').proposals).toEqual([]);
    expect(parse('fue un buen día').proposals).toEqual([]);
    // Negaciones a media frase: ni gasto, ni ingreso, ni misión.
    for (const t of ['el cliente no me pagó los 5 mil', 'todavía no me pagan los 5 mil pesos', 'me cancelaron la junta']) {
      const r = parse(t);
      expect(r.proposals).toEqual([]);
      expect(r.unknown).toEqual([t]);
    }
    // Un "no" que no niega la acción no la borra.
    expect(only(parse('fui al gym aunque no tenía ganas'), 'mission')).toHaveLength(1);
  });

  it('el tiempo no es una misión: ni las horas solas ni el tiempo perdido', () => {
    expect(only(parse('vi la tele 3 horas'), 'mission')).toEqual([]);
    expect(only(parse('perdí 3 horas en redes sociales'), 'mission')).toEqual([]);
    expect(only(parse('jugué videojuegos 5 horas'), 'mission')[0]?.size).toBe(only(parse('jugué videojuegos 20 minutos'), 'mission')[0]?.size);
  });

  it('no duplica la misma misión del mismo día', () => {
    const r = parse('entrené. Fui al gym');
    expect(only(r, 'mission')).toHaveLength(1);
  });

  it('con otra fecha de referencia (notas viejas) todo es relativo a ese día', () => {
    const r = parse('ayer fui al gym', ctx([], '2026-11-10'));
    expect(r.proposals[0].date).toBe('2026-11-09');
  });
});

describe('no duplicar lo que ya está registrado (voiceDuplicate)', () => {
  const base = { key: 'v1', date: TODAY, source: '' };
  const check = (p: VoiceProposal, events: ReturnType<typeof ev>[]) => voiceDuplicate(p, project({ events, entities: ENTITIES, today: TODAY }), events);

  it('misiones, descanso y contacto (como antes)', () => {
    const events = [done(TODAY, 'daily-leer'), ev('rest_day.marked', '2026-11-18'), ev('npc.interaction', TODAY, { npcId: 'npc-ana' })];
    expect(check({ ...base, kind: 'mission', missionId: 'daily-leer', title: 'Leer', size: 'chica', attribute: 'inteligencia', missionKind: 'daily', matched: true }, events)).toBeTruthy();
    expect(check({ ...base, kind: 'mission', missionId: 'daily-leer', title: 'Leer', size: 'chica', attribute: 'inteligencia', missionKind: 'daily', matched: true, date: '2026-11-18' }, events)).toBeNull();
    expect(check({ ...base, kind: 'rest', date: '2026-11-18' }, events)).toBeTruthy();
    expect(check({ ...base, kind: 'person', npcId: 'npc-ana', name: 'Ana', alternatives: [] }, events)).toBeTruthy();
    expect(check({ ...base, kind: 'person', npcId: 'npc-mama', name: 'Mamá', alternatives: [] }, events)).toBeNull();
  });

  it('un gasto o una lección iguales del mismo día (p. ej. lo que el Coach alcanzó a registrar antes de cortarse)', () => {
    const gasto = ev('expense.recorded', TODAY, { amount: 200, concept: 'Comida' });
    const leccion = ev('lesson.written', TODAY, { text: 'Me fue mal en la junta y aprendí que debo planear mejor', missionId: null, attribute: 'inteligencia' });
    const events = [gasto, leccion];
    const expense = (amount: number, concept: string, date = TODAY): VoiceProposal => ({ ...base, kind: 'expense', amount, concept, date });
    expect(check(expense(200, 'comida'), events)).toBeTruthy();
    expect(check(expense(200, 'Uber'), events)).toBeNull();
    expect(check(expense(300, 'Comida'), events)).toBeNull();
    expect(check(expense(200, 'Comida', '2026-11-18'), events)).toBeNull();
    expect(check({ ...base, kind: 'income', amount: 200, concept: 'Comida' }, events)).toBeNull();
    expect(check({ ...base, kind: 'lesson', text: 'Me fue mal en la junta y aprendí que debo planear mejor' }, events)).toBeTruthy();
    expect(check({ ...base, kind: 'lesson', text: 'Otra lección distinta' }, events)).toBeNull();
    // Anulado ya no cuenta.
    const voided = [{ ...gasto, voidedAt: `${TODAY}T20:00:00.000Z` }];
    expect(check(expense(200, 'Comida'), voided)).toBeNull();
  });
});

describe('notas de voz (note.captured / note.processed)', () => {
  it('validan su forma', () => {
    const base = { id: 'note-0001', occurredAt: `${TODAY}T18:00:00.000Z`, localDate: TODAY };
    const ok = validateEvent({ ...base, type: 'note.captured', payload: { text: 'fui al gym' } });
    expect(ok.ok && ok.event.payload).toEqual({ text: 'fui al gym', source: 'voz', handled: 'pendiente' });
    expect(validateEvent({ ...base, type: 'note.captured', payload: { text: '   ' } }).ok).toBe(false);
    expect(validateEvent({ ...base, type: 'note.processed', payload: { noteId: 'note-0001', via: 'otra' } }).ok).toBe(false);
  });

  it('quedan pendientes hasta procesarse; anular el cierre las regresa; no dan XP', () => {
    const a = ev('note.captured', '2026-11-18', { text: 'gasté 200', source: 'voz', handled: 'pendiente' });
    const b = ev('note.captured', TODAY, { text: 'fui al gym', source: 'voz', handled: 'pendiente' });
    const c = ev('note.captured', TODAY, { text: 'leí', source: 'texto', handled: 'local' });
    const p = ev('note.processed', TODAY, { noteId: a.id, via: 'coach' });
    let s = project({ events: [a, b, c, p], entities: seed, today: TODAY });
    expect(s.notes.pending.map((n) => n.id)).toEqual([b.id]);
    expect(s.notes.total).toBe(3);
    expect(s.notes.resolved).toEqual({ [a.id]: 'coach', [c.id]: 'local' });
    expect(s.xp.total).toBe(0);
    s = project({ events: [a, b, c, { ...p, voidedAt: '2026-11-19T20:00:00.000Z' }], entities: seed, today: TODAY });
    expect(s.notes.pending.map((n) => n.id)).toEqual([b.id, a.id]);
  });
});

describe('herramientas de IA de notas', () => {
  const runTool = (store: ReturnType<typeof memoryAssistantStore>, name: string, input: unknown = {}) => runAssistantTool(name, input, store, { allowWrites: true });

  it('ver_notas, guardar_nota y marcar_nota', async () => {
    const pending = ev('note.captured', '2026-11-18', { text: 'ayer gasté 300 en uber', source: 'voz', handled: 'pendiente' });
    const handled = ev('note.captured', TODAY, { text: 'leí', source: 'voz', handled: 'coach' });
    const store = memoryAssistantStore({ events: [pending, handled], entities: seed, today: TODAY });

    const list = await runTool(store, 'ver_notas');
    expect(list.text).toContain(pending.id);
    expect(list.text).toContain('ayer gasté 300 en uber');
    expect(list.text).not.toContain(handled.id);

    const saved = await runTool(store, 'guardar_nota', { texto: 'revisar el contrato de Acme' });
    expect(saved.isError).toBeFalsy();
    expect(saved.refs?.events).toHaveLength(1);

    const marked = await runTool(store, 'marcar_nota', { nota_id: pending.id });
    expect(marked.summary).toContain('Procesó la nota');
    const again = await runTool(store, 'marcar_nota', { nota_id: pending.id });
    expect(again.text).toContain('ya estaba procesada');
    expect((await runTool(store, 'marcar_nota', { nota_id: 'no-existe' })).isError).toBe(true);

    const after = await runTool(store, 'ver_notas');
    expect(after.text).not.toContain(pending.id);
    expect(after.text).toContain('revisar el contrato de Acme');

    // El panorama avisa que hay notas por procesar.
    expect(renderOverview(await store.snapshot())).toContain('Notas por procesar: 1');
  });
});
