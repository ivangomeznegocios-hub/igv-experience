import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import {
  cadenceFor,
  circleOf,
  contactsOf,
  isValidBirthday,
  isValidMetOnAsOf,
  knownForText,
  levelNameFor,
  nextBirthday,
  nextLevelInfo,
  npcTypeOnSave,
  relationSummary,
  roleInfo,
  roleOf,
  TEMPERATURE_NAMES,
  type PeopleContact,
} from '../engine/modules/gente';
import {
  CHANNEL_NAMES,
  CIRCLE_NAMES,
  CONTACT_CHANNELS,
  NPC_TYPES,
  PEOPLE_CIRCLES,
  type GuildData,
  type NpcData,
  type PeopleCircle,
  type PlaceData,
} from '../types';
import { addDays } from '../util/dates';
import { fmtDay } from './format';
import type { AssistantSnapshot } from './snapshot';
import { ToolError, find, makeEvent, newEntityId, ok, pastDate, tool, upsert, zDate, zFecha, zId, zText, type AssistantTool } from './toolkit';

/**
 * Herramientas de IA de "Mi gente": registrar contactos (varias personas, canal y lugar), guardar fichas
 * completas y consultar niveles de cercanía, temperatura, cumpleaños y lugares.
 */

type PersonRow = AssistantSnapshot['people']['list'][number];

const joinNames = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ago = (d: number | null) => (d === null ? 'sin registro' : d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`);
const freq = (n: number) => (n <= 0 ? 'sin meta' : n === 1 ? 'diario' : n === 7 ? 'cada semana' : n === 30 ? 'cada mes' : `cada ${n} días`);
const TREND: Record<PersonRow['trend'], string> = { sube: 'se está acercando', baja: 'se está alejando', estable: '' };

/** La sección de personas de la foto, con valores por defecto (por si llega una foto de una versión anterior). */
function peopleOf(s: AssistantSnapshot): Required<AssistantSnapshot['people']> {
  const pp = (s.people ?? {}) as Partial<AssistantSnapshot['people']>;
  return {
    overdue: pp.overdue ?? [],
    keyPeople: pp.keyPeople ?? 0,
    total: pp.total ?? pp.list?.length ?? 0,
    lastContact: pp.lastContact ?? {},
    list: pp.list ?? [],
    today: pp.today ?? [],
    birthdays: pp.birthdays ?? [],
    week: pp.week ?? { contacts: 0, people: 0 },
    recentLevelUps: pp.recentLevelUps ?? [],
  };
}

function personLine(p: PersonRow): string {
  const bits = [
    `${p.role ? `${p.role} · ` : ''}${CIRCLE_NAMES[p.circle]}`,
    `nivel ${p.level} ${p.levelName}`,
    p.temperature ? TEMPERATURE_NAMES[p.temperature].toLowerCase() : null,
    `último contacto ${ago(p.daysSince)}`,
    `frecuencia: ${freq(p.cadenceDays)}`,
    TREND[p.trend] || null,
  ].filter(Boolean);
  return `- [${p.id}] ${p.name}${p.key ? ' ★ clave' : ''} (${bits.join(' · ')})${p.next ? ` · ${p.next}` : ''}`;
}

/** Líneas de "Mi gente" para el panorama (renderOverview). */
export function renderPeopleOverview(s: AssistantSnapshot): string[] {
  const pp = peopleOf(s);
  if (!pp.list.length) return [];
  const byId = new Map(pp.list.map((p) => [p.id, p]));
  const L: string[] = ['', '## Mi gente'];
  const today = pp.today.map((id) => byId.get(id)?.name).filter(Boolean) as string[];
  L.push(today.length ? `Hoy tuvo contacto con: ${joinNames(today)}.` : 'Hoy todavía no registra contacto con nadie.');
  L.push(`Esta semana: ${pl(pp.week.contacts, 'contacto', 'contactos')} con ${pl(pp.week.people, 'persona', 'personas')}.`);
  const fam = pp.list.filter((p) => p.circle === 'familia' || p.circle === 'pareja').slice(0, 8);
  if (fam.length)
    L.push(
      `Familia y pareja: ${fam.map((p) => `${p.name} [${p.id}] (${p.role ?? CIRCLE_NAMES[p.circle]}, nivel ${p.level} ${p.levelName}${p.temperature ? `, ${TEMPERATURE_NAMES[p.temperature].toLowerCase()}` : ''}, ${ago(p.daysSince)})`).join('; ')}.`,
    );
  const cold = pp.list.filter((p) => p.temperature === 'fria').slice(0, 5);
  if (cold.length) L.push(`Se están enfriando (más tiempo sin contacto del que quiere): ${cold.map((p) => `${p.name} [${p.id}] ${ago(p.daysSince)}, frecuencia ${freq(p.cadenceDays)}`).join('; ')}.`);
  if (pp.birthdays.length)
    L.push(`Cumpleaños próximos: ${pp.birthdays.map((b) => `${b.name} ${b.inDays === 0 ? 'HOY' : `${fmtDay(b.date)} (en ${b.inDays} días)`}${b.turns ? `, cumple ${b.turns}` : ''}`).join('; ')}.`);
  if (pp.recentLevelUps.length) L.push(`Niveles de cercanía recientes: ${pp.recentLevelUps.map((u) => `${u.name} → ${u.levelName} (nivel ${u.level}, ${u.date})`).join('; ')}.`);
  return L;
}

/** Una línea para APP_GUIDE. */
export const GENTE_GUIDE = `Mi gente: cada persona tiene círculo (${PEOPLE_CIRCLES.map((c) => CIRCLE_NAMES[c].toLowerCase()).join(', ')}), rol (novia, hija, mamá, primo, amigo, socio, cliente…), dónde y cuándo se conocieron y cumpleaños. Nivel de cercanía 1–5 que se GANA con días distintos de contacto, convivencias en persona y constancia en semanas y meses (10 mensajes en un día = 1 día); nunca baja y cada nivel nuevo da XP de Relaciones (${GAME_CONFIG.gente.levels.map((l) => `${l.level}: ${l.xp}`).join(', ')}). Temperatura cálida/tibia/fría según días sin contacto contra su frecuencia esperada (pareja diario, hijos cada 2 días, padres semanal, amigos mensual, conocidos sin meta). Registra con registrar_contacto (varias personas a la vez, canal persona/llamada/videollamada/mensaje y lugar); consulta con ver_mi_gente y ver_persona.`;

// ---------------------------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------------------------

export const registrarContactoTool = tool({
  name: 'registrar_contacto',
  title: 'Registrar contacto con personas',
  group: 'registrar',
  writes: true,
  description:
    'Registra que habló o convivió con una o varias personas de "Mi gente" (un registro por persona; ids de ver_mi_gente o ver_catalogo personas). canal: persona (convivieron en persona), llamada, videollamada o mensaje; lugar_id (ver_catalogo lugares) si fue en un lugar. Los contactos suben el nivel de cercanía y la temperatura; el contacto no da XP, ganar un nivel sí. Si era una persona clave olvidada, mejor usa completar_mision con "npc-<id>".',
  input: z.object({
    persona_id: zId.optional().describe('Una persona.'),
    personas: z.array(zId).min(1).max(20).optional().describe('Varias personas a la vez (ids).'),
    canal: z.enum(CONTACT_CHANNELS).optional().describe('persona, llamada, videollamada o mensaje. Si no se sabe, omítelo.'),
    lugar_id: zId.optional().describe('Lugar del mapa donde convivieron (sin canal, cuenta como en persona).'),
    nota: z.string().trim().max(2000).optional(),
    fecha: zFecha,
  }),
  async run({ persona_id, personas, canal, lugar_id, nota, fecha }, store) {
    const date = pastDate(store, fecha);
    const ids = [...new Set([...(persona_id ? [persona_id] : []), ...(personas ?? [])])];
    if (!ids.length) throw new ToolError('Indica "persona_id" o "personas".');
    if (ids.length > 20) throw new ToolError('Máximo 20 personas por registro.');
    const catalog = await store.catalog();
    const people = ids.map((id) => find<NpcData>(catalog, id, 'npcs', ['npc'], 'la persona'));
    const place = lugar_id ? find<PlaceData>(catalog, lugar_id, 'map', ['place'], 'el lugar') : null;
    const evs = people.map((npc) =>
      makeEvent(
        store,
        'npc.interaction',
        { npcId: npc.id, ...(nota ? { note: nota } : {}), ...(canal ? { channel: canal } : {}), ...(place ? { placeId: place.id } : {}) },
        date,
      ),
    );
    await store.addEvents(evs);
    const names = joinNames(people.map((p) => p.data.name));
    const how = [canal ? CHANNEL_NAMES[canal].toLowerCase() : '', place ? `en ${place.data.name}` : ''].filter(Boolean).join(' ');
    return ok(
      `Registré el contacto con ${names}${how ? ` (${how})` : ''}, ${date === store.today ? 'hoy' : fmtDay(date)}. Registros: ${evs.map((e) => `[${e.id}]`).join(' ')}. Para ver cómo va su nivel de cercanía usa ver_persona.`,
      `Contacto con ${names}`,
      { events: evs.map((e) => e.id) },
    );
  },
});

// ---------------------------------------------------------------------------------------------
// Organizar
// ---------------------------------------------------------------------------------------------

/** '' borra el campo; undefined lo deja como estaba. */
const zClearable = (max: number) => z.string().trim().max(max).optional();
const blankToNull = (v: string | undefined, prev: string | null | undefined) => (v === undefined ? (prev ?? null) : v === '' ? null : v);

export const guardarPersonaTool = tool({
  name: 'guardar_persona',
  title: 'Agregar o editar persona',
  group: 'organizar',
  writes: true,
  description:
    'Agrega o edita una persona de "Mi gente" (ficha completa). circulo: familia, pareja, amigos, trabajo, clientes, comunidad o conocidos (si no lo das, se deduce del rol). rol: Novia, Esposa, Hija, Hijo, Mamá, Papá, Hermana, Primo, Tía, Abuelo, Sobrina, Suegra, Cuñado, Mejor amigo, Amiga, Socio, Colega, Jefe, Empleado, Cliente, Mentor, Vecino, Conocido… o texto libre. Persona clave = aviso cuando se enfría o pasan 30 días sin contacto. No inventes nombres ni datos: pregúntale. Para borrar un campo de texto manda "".',
  input: z.object({
    id: zId.optional().describe('Para EDITAR una persona existente, su id. Sin id, se crea una nueva.'),
    nombre: zText(120).optional(),
    circulo: z.enum(PEOPLE_CIRCLES).optional(),
    rol: zClearable(60),
    clave: z.boolean().optional().describe('Persona clave.'),
    conocio_en: zClearable(200).describe('Dónde se conocieron (texto).'),
    conocio_lugar_id: zClearable(100).describe('Lugar del mapa donde se conocieron (ver_catalogo lugares).'),
    conocio_fecha: zClearable(10).describe("Cuándo se conocieron: 'YYYY', 'YYYY-MM' o 'YYYY-MM-DD'."),
    cumpleanos: zClearable(10).describe("'MM-DD' o 'YYYY-MM-DD' (con año se sabe cuántos cumple)."),
    telefono: zClearable(30),
    grupo_id: zClearable(100).describe('Grupo (equipo, generación, club…) al que pertenece.'),
    nivel_inicial: z.number().int().min(1).max(5).optional().describe('Punto de partida: qué tan cercana ya era la relación antes de usar la app (1–5). Solo cambia el nivel que se ve; no da XP.'),
    frecuencia_dias: z.number().int().min(0).max(365).nullable().optional().describe('Cada cuántos días quiere tener contacto (0 = sin meta; null = automático por rol y círculo).'),
    ultimo_contacto: zDate.optional().describe('Solo al crear: último contacto antes de registrar nada (YYYY-MM-DD). Por defecto, hoy.'),
    notas: z.string().max(2000).optional(),
    tipo: z.enum(NPC_TYPES).optional().describe('(Versión anterior) party, aliado, mentor, cliente o rival. Mejor usa circulo y rol.'),
    relacion: z.number().int().min(1).max(5).optional().describe('(Versión anterior) 1 a 5. Mejor usa nivel_inicial.'),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const prev = i.id ? find<NpcData>(catalog, i.id, 'npcs', ['npc'], 'la persona') : null;
    const p: Partial<NpcData> = prev?.data ?? {};
    const name = i.nombre ?? p.name;
    if (!name) throw new ToolError('Falta "nombre".');
    // Fichas viejas: el rol (Mentor, Rival, Cliente) solo existe en `npcType`; se conserva al editar otra cosa
    // (si se cambia el `tipo` viejo, el rol vuelve a salir de él).
    const role = blankToNull(i.rol, i.tipo ? p.role : roleOf(p));
    const fromRole = i.rol ? roleInfo(i.rol)?.circle : undefined;
    const circle: PeopleCircle = i.circulo ?? fromRole ?? (p.circle || (i.tipo ? circleOf({ npcType: i.tipo }) : null) || circleOf({ ...p, role }));
    const metOn = blankToNull(i.conocio_fecha, p.metOn);
    // Solo se valida si cambia: un valor viejo guardado desde la app no bloquea editar otra cosa.
    if (metOn && metOn !== (p.metOn ?? null) && !isValidMetOnAsOf(metOn, store.today))
      throw new ToolError(`"conocio_fecha" inválida (${metOn}): usa 'YYYY', 'YYYY-MM' o 'YYYY-MM-DD', no en el futuro.`);
    const birthday = blankToNull(i.cumpleanos, p.birthday);
    if (birthday && !isValidBirthday(birthday)) throw new ToolError(`"cumpleanos" inválido (${birthday}): usa 'MM-DD' o 'YYYY-MM-DD'.`);
    const metPlaceId = blankToNull(i.conocio_lugar_id, p.metPlaceId);
    if (metPlaceId && metPlaceId !== p.metPlaceId) find<PlaceData>(catalog, metPlaceId, 'map', ['place'], 'el lugar');
    const guildId = blankToNull(i.grupo_id, p.guildId);
    if (guildId && guildId !== p.guildId) find<GuildData>(catalog, guildId, 'npcs', ['guild'], 'el grupo');
    let lastContact = p.lastContact ?? null;
    if (!prev) {
      lastContact = i.ultimo_contacto ?? store.today;
      if (lastContact > store.today) throw new ToolError(`"ultimo_contacto" no puede estar en el futuro (hoy es ${store.today}).`);
    }
    const data: NpcData = {
      ...(p as NpcData),
      name,
      circle,
      role,
      npcType: i.tipo ?? npcTypeOnSave(p, circle, role),
      key: i.clave ?? p.key ?? false,
      relation: i.relacion ?? p.relation ?? 3,
      guildId,
      notes: i.notas ?? p.notes ?? '',
      lastContact,
      metWhere: blankToNull(i.conocio_en, p.metWhere),
      metPlaceId,
      metOn,
      birthday,
      phone: blankToNull(i.telefono, p.phone),
      ...(i.nivel_inicial !== undefined ? { startLevel: i.nivel_inicial } : {}),
      ...(i.frecuencia_dias !== undefined ? { cadenceDays: i.frecuencia_dias } : {}),
    };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'npc'), module: 'npcs', kind: 'npc', data });
    const extra = [data.role ?? CIRCLE_NAMES[circle], data.key ? 'persona clave' : '', `frecuencia ${freq(cadenceFor(data, GAME_CONFIG))}`].filter(Boolean).join(' · ');
    return ok(`${prev ? 'Actualizada' : 'Agregada'}: ${data.name} (${extra}). Id [${saved.id}].`, `${prev ? 'Editó' : 'Agregó'} a ${data.name}`, { entities: [ref] });
  },
});

// ---------------------------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------------------------

export const verMiGente = tool({
  name: 'ver_mi_gente',
  title: 'Ver Mi gente',
  group: 'consultar',
  writes: false,
  description:
    'Mi gente completa: con quién tuvo contacto hoy, contactos de la semana, cumpleaños próximos, quién se acerca o se aleja y cada persona por círculo con su nivel de cercanía, temperatura, último contacto, frecuencia esperada y lo que le falta para el siguiente nivel (con ids).',
  input: z.object({
    circulo: z.enum(PEOPLE_CIRCLES).optional().describe('Solo un círculo.'),
    buscar: z.string().trim().max(60).optional().describe('Texto a buscar en nombre o rol.'),
  }),
  async run({ circulo, buscar }, store) {
    const pp = peopleOf(await store.snapshot());
    const q = buscar ? buscar.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
    const match = (p: PersonRow) => !q || `${p.name} ${p.role ?? ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q);
    const rows = pp.list.filter((p) => (!circulo || p.circle === circulo) && match(p));
    const filtered = !!(q || circulo);
    const L: string[] = [`# Mi gente · ${pp.total} ${pp.total === 1 ? 'persona' : 'personas'}${filtered ? ` (muestro ${rows.length})` : ''}`];
    const inScope = new Map(rows.map((p) => [p.id, p]));
    const today = pp.today.map((id) => inScope.get(id)?.name).filter(Boolean) as string[];
    L.push(today.length ? `Hoy: ${joinNames(today)}.` : 'Hoy: nadie registrado todavía.');
    if (!filtered) L.push(`Esta semana: ${pl(pp.week.contacts, 'contacto', 'contactos')} con ${pl(pp.week.people, 'persona', 'personas')}.`);
    const bds = pp.birthdays.filter((b) => inScope.has(b.id));
    if (bds.length) L.push(`Cumpleaños: ${bds.map((b) => `${b.name} ${b.inDays === 0 ? 'HOY' : `en ${b.inDays} días (${b.date})`}${b.turns ? `, cumple ${b.turns}` : ''}`).join('; ')}.`);
    const up = rows.filter((p) => p.trend === 'sube' && p.temperature !== 'fria').map((p) => p.name);
    const down = rows.filter((p) => p.trend === 'baja').map((p) => p.name);
    const cold = rows.filter((p) => p.temperature === 'fria').map((p) => p.name);
    if (up.length) L.push(`Se están acercando: ${joinNames(up)}.`);
    if (down.length) L.push(`Se están alejando: ${joinNames(down)}.`);
    if (cold.length) L.push(`Frías (más tiempo sin contacto del que quiere): ${joinNames(cold)}.`);
    const ups = pp.recentLevelUps.filter((u) => inScope.has(u.id));
    if (ups.length) L.push(`Niveles recientes: ${ups.map((u) => `${u.name} → ${u.levelName} (${u.date})`).join('; ')}.`);
    for (const c of PEOPLE_CIRCLES) {
      const inC = rows.filter((p) => p.circle === c);
      if (!inC.length) continue;
      L.push('', `## ${CIRCLE_NAMES[c]} (${inC.length})`);
      for (const p of inC) L.push(personLine(p));
    }
    if (!rows.length) L.push('', q || circulo ? '(nadie con ese filtro)' : '(todavía no hay personas: agrégalas con guardar_persona)');
    return { text: L.join('\n') };
  },
});

export const verPersona = tool({
  name: 'ver_persona',
  title: 'Ver una persona',
  group: 'consultar',
  writes: false,
  description:
    'Ficha de una persona: rol, círculo, nivel de cercanía con sus requisitos (días con contacto, en persona, semanas y meses), temperatura, frecuencia, cumpleaños, dónde y cuándo se conocieron, lugares donde han convivido y sus últimos contactos con id (para anular_registro).',
  input: z.object({ persona_id: zId }),
  async run({ persona_id }, store) {
    const catalog = await store.catalog();
    const ent = find<NpcData>(catalog, persona_id, 'npcs', ['npc'], 'la persona');
    const d = ent.data;
    const [s, interactions, missions, visits] = await Promise.all([
      store.snapshot(),
      store.events({ types: ['npc.interaction'], match: { npcId: ent.id }, to: store.today, order: 'asc' }),
      store.events({ types: ['mission.completed'], match: { npcId: ent.id }, to: store.today, order: 'asc' }),
      store.events({ types: ['place.visited'], to: store.today, order: 'asc' }),
    ]);
    const contacts: PeopleContact[] = [...interactions, ...missions, ...visits]
      .flatMap((e) => contactsOf(e))
      .filter((c) => c.npcId === ent.id)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const sum = relationSummary(contacts, GAME_CONFIG);
    const row = peopleOf(s).list.find((p) => p.id === ent.id);
    const start = Math.max(1, Math.min(5, Math.floor(Number(d.startLevel) || 1)));
    const level = Math.max(start, sum.earnedLevel);
    const next = nextLevelInfo(sum.counts, level, d, GAME_CONFIG);
    const byId = new Map(catalog.map((e) => [e.id, e]));
    const placeName = (id: string | null | undefined) => (id ? ((byId.get(id)?.data as PlaceData | undefined)?.name ?? id) : '');
    const circle = circleOf(d);
    const role = roleOf(d);

    const L: string[] = [`# ${d.name} [${ent.id}]${d.key ? ' ★ persona clave' : ''}`];
    L.push(`${role ? `${role} · ` : ''}${CIRCLE_NAMES[circle]}${d.guildId ? ` · grupo ${(byId.get(d.guildId)?.data as GuildData | undefined)?.name ?? d.guildId}` : ''}${d.phone ? ` · tel. ${d.phone}` : ''}`);
    L.push(
      `Cercanía: nivel ${level} · ${levelNameFor(d, level)}${start > sum.earnedLevel ? ` (punto de partida ${start}; ganado con contactos: ${sum.earnedLevel})` : ''}. ${
        Object.entries(sum.levelDates)
          .map(([l, date]) => `Nivel ${l} el ${date}`)
          .join(', ') || 'Sin niveles ganados todavía'
      }.`,
    );
    L.push(`Llevan: ${pl(sum.counts.days, 'día', 'días')} con contacto, ${sum.counts.inPerson} en persona, ${pl(sum.counts.weeks, 'semana', 'semanas')} y ${pl(sum.counts.months, 'mes', 'meses')} distintos.`);
    if (next) L.push(`Siguiente: nivel ${next.level} ${next.name} (+${GAME_CONFIG.gente.levels.find((g) => g.level === next.level)?.xp ?? 0} XP) · ${next.hint}. Requisitos: ${next.gaps.map((g) => `${g.have}/${g.need} ${g.key === 'days' ? 'días' : g.key === 'inPerson' ? 'en persona' : g.key === 'weeks' ? 'semanas' : 'meses'}`).join(', ')}.`);
    else L.push('Nivel máximo de cercanía.');
    const cadence = cadenceFor(d, GAME_CONFIG);
    L.push(`Temperatura: ${row?.temperature ? TEMPERATURE_NAMES[row.temperature] : 'sin meta o sin registro'} · último contacto ${ago(row?.daysSince ?? null)} · frecuencia esperada: ${freq(cadence)}${d.cadenceDays !== undefined && d.cadenceDays !== null ? ' (elegida)' : ' (automática)'}${row && TREND[row.trend] ? ` · ${TREND[row.trend]}` : ''}.`);
    const bd = nextBirthday(ent.id, d.birthday, store.today);
    if (bd) L.push(`Cumpleaños: ${d.birthday} · ${bd.inDays === 0 ? 'HOY' : `en ${bd.inDays} días`}${bd.turns ? ` (cumple ${bd.turns})` : ''}.`);
    const known = d.metOn ?? contacts[0]?.date ?? null;
    if (d.metWhere || d.metPlaceId || d.metOn)
      L.push(`Se conocieron: ${[d.metWhere, placeName(d.metPlaceId)].filter(Boolean).join(' · ') || 'lugar sin registrar'}${d.metOn ? ` · ${d.metOn}` : ''}${knownForText(known, store.today) ? ` (hace ${knownForText(known, store.today)})` : ''}.`);
    const places = new Map<string, Set<string>>();
    for (const c of contacts) if (c.placeId) (places.get(c.placeId) ?? places.set(c.placeId, new Set()).get(c.placeId)!).add(c.date);
    if (places.size) L.push(`Lugares juntos: ${[...places].sort((a, b) => b[1].size - a[1].size).map(([id, days]) => `${placeName(id)} (${days.size} ${days.size === 1 ? 'día' : 'días'})`).join('; ')}.`);
    const ch = new Map<string, number>();
    for (const c of contacts) ch.set(c.channel ? CHANNEL_NAMES[c.channel] : 'Sin especificar', (ch.get(c.channel ? CHANNEL_NAMES[c.channel] : 'Sin especificar') ?? 0) + 1);
    if (ch.size) L.push(`Por canal: ${[...ch].map(([k, v]) => `${k} ${v}`).join(', ')}.`);
    const last90 = new Set(contacts.filter((c) => c.date >= addDays(store.today, -89)).map((c) => c.date)).size;
    L.push(`Últimos 90 días: ${last90} días con contacto.`);
    if (d.notes) L.push(`Notas: ${d.notes}`);
    L.push('', 'Últimos contactos:');
    const recent = contacts.slice(-15).reverse();
    if (!recent.length) L.push('- (ninguno registrado)');
    for (const c of recent)
      L.push(
        `- ${c.date} [${c.eventId}] ${c.source === 'mission' ? 'Misión "Escribirle"' : c.source === 'place' ? 'Visita juntos' : 'Contacto'}${c.channel ? ` · ${CHANNEL_NAMES[c.channel].toLowerCase()}` : ''}${c.placeId ? ` · ${placeName(c.placeId)}` : ''}${c.note ? ` · ${c.note.slice(0, 100)}` : ''}`,
      );
    return { text: L.join('\n') };
  },
});

/** Herramientas nuevas de Mi gente (registrar_contacto y guardar_persona ya están en ASSISTANT_TOOLS). */
export const GENTE_TOOLS: AssistantTool[] = [verMiGente, verPersona];
