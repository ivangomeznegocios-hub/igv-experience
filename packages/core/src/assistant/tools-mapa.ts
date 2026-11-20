import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import {
  MAP_CATALOG,
  MAP_CATALOG_BY_ID,
  MAP_COLLECTIONS,
  catalogIdOfPlace,
  catalogPlaceEntityId,
  mapNormalize,
  placeFromCatalog,
  searchMapCatalog,
  type CatalogPlace,
} from '../engine/map-catalog';
import { mapCatalogLinks, mapCollectionProgress, foldMapEvents, type MapSummary, type PlaceState } from '../engine/modules/map';
import {
  EMPRESA_PLACE_TYPES,
  PLACE_STATUS_NAMES,
  PLACE_TYPES,
  PLACE_TYPE_NAMES,
  VISIT_COMPANIES,
  placeLayer,
  type Entity,
  type GameEvent,
  type NpcData,
  type PlaceData,
  type PlaceLayer,
  type PlaceStatus,
  type PlaceType,
  type VisitCompany,
} from '../types';
import { fmtDay } from './format';
import { ToolError, list, makeEvent, ok, pastDate, tool, upsert, zDate, zFecha, zId, zText, type ActivityRefs, type AssistantStore } from './toolkit';

/** Herramientas de IA del Mapa (vida y empresa). Se registran en ASSISTANT_TOOLS (tools.ts). */

const MAP_TYPES = ['map.status_changed', 'place.visited'];
const COMPANY_TEXT: Record<VisitCompany, string> = { solo: 'solo', pareja: 'en pareja', familia: 'en familia', amigos: 'con amigos', trabajo: 'por trabajo', otro: 'con alguien más' };
const habitualVisits = () => GAME_CONFIG.mapa.habitualVisits;

const places = (catalog: Entity[]) => list<PlaceData>(catalog, 'map', 'place');

function where(d: PlaceData): string {
  return [d.city, d.zone].filter((x) => x && x.trim()).join(', ');
}

/** Lugar ya guardado o por crear (a partir del catálogo fijo o de un nombre nuevo). */
interface ResolvedPlace {
  entity: Entity<PlaceData>;
  /** true si hay que crearlo. */
  isNew: boolean;
}

/** Id nuevo para un lugar (los últimos caracteres del id generado: son los más aleatorios). */
function newPlaceId(store: AssistantStore): string {
  return `place-${store.newId().replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase()}`;
}

function newPlace(store: AssistantStore, data: PlaceData, id?: string): ResolvedPlace {
  return { entity: { id: id ?? newPlaceId(store), module: 'map', kind: 'place', data, sort: store.now().getTime() }, isNew: true };
}

function fromCatalog(catalog: Entity[], c: CatalogPlace): ResolvedPlace | null {
  const linked = places(catalog).find((p) => catalogIdOfPlace(p.id, p.data) === c.id);
  return linked ? { entity: linked, isNew: false } : null;
}

/**
 * Encuentra un lugar por id, id del catálogo de Jalisco o nombre. Si no existe y `create` viene, lo crea
 * (ligado al catálogo si es un lugar emblemático).
 */
function resolvePlace(
  store: AssistantStore,
  catalog: Entity[],
  query: string,
  create: { tipo?: PlaceType; ciudad?: string; zona?: string; capa?: PlaceLayer } | null,
): ResolvedPlace {
  const q = query.trim();
  const mine = places(catalog);
  const byId = mine.find((p) => p.id === q);
  if (byId) return { entity: byId, isNew: false };
  const cid = MAP_CATALOG_BY_ID.has(q) ? q : q.startsWith('place-') && MAP_CATALOG_BY_ID.has(q.slice(6)) ? q.slice(6) : null;
  if (cid) {
    const c = MAP_CATALOG_BY_ID.get(cid)!;
    return fromCatalog(catalog, c) ?? newPlace(store, placeFromCatalog(c), catalogPlaceEntityId(c.id));
  }
  const n = mapNormalize(q);
  if (!n) throw new ToolError('Indica el lugar (nombre o id).');
  // "la oficina" = "Oficina": sin artículo al inicio.
  const bare = n.replace(/^(?:el|la|los|las|al|del)\s+/, '');
  const exact = mine.filter((p) => {
    const pn = mapNormalize(p.data.name);
    return pn === n || pn === bare;
  });
  if (exact.length === 1) return { entity: exact[0], isNew: false };
  if (exact.length > 1) throw new ToolError(`Hay varios lugares llamados "${q}": ${exact.map((p) => `${p.data.name} (${where(p.data) || 'sin ciudad'}) [${p.id}]`).join('; ')}. Usa el id.`);
  // Parcial solo en una dirección: lo escrito es parte del nombre guardado ("Palreal" → "Café Palreal"). Al revés
  // no: "Casa Bariachi" o "Casa de mi abuela" son lugares nuevos aunque ya exista "Casa".
  const partial = bare.length >= 4 ? mine.filter((p) => mapNormalize(p.data.name).includes(bare)) : [];
  if (partial.length === 1) return { entity: partial[0], isNew: false };
  if (partial.length > 1) throw new ToolError(`"${q}" coincide con varios lugares: ${partial.map((p) => `${p.data.name} [${p.id}]`).join('; ')}. Usa el id.`);
  // Catálogo de Jalisco: se liga solo si lo escrito es el nombre, su inicio o palabras completas de él
  // ("Akron" → "Estadio Akron"); "Tequila Grill" no es el pueblo de Tequila.
  const cat = searchMapCatalog(q, 4);
  const strong = cat.filter((c) => {
    const cn = mapNormalize(c.name);
    return [n, bare].some((x) => cn.startsWith(x) || (x.length >= 4 && ` ${cn} `.includes(` ${x} `)));
  });
  if (strong.length === 1) return fromCatalog(catalog, strong[0]) ?? newPlace(store, placeFromCatalog(strong[0]), catalogPlaceEntityId(strong[0].id));
  if (strong.length > 1) throw new ToolError(`"${q}" puede ser: ${strong.map((c) => `${c.name} [${c.id}]`).join('; ')}. Usa el id del catálogo.`);
  const saysNew = !!(create?.tipo || create?.ciudad || create?.zona);
  if (cat.length && !saysNew)
    throw new ToolError(
      `No encontré "${q}" tal cual. ¿Es alguno de estos lugares emblemáticos? ${cat.map((c) => `${c.name} [${c.id}]`).join('; ')}. Si es uno, usa su id; si es un lugar nuevo, manda también tipo o ciudad.`,
    );
  if (!create) throw new ToolError(`No encontré "${q}" en el mapa. Consulta ver_mapa o créalo con guardar_lugar.`);
  const placeType: PlaceType = create.tipo ?? 'lugar';
  const layer: PlaceLayer = create.capa ?? ((EMPRESA_PLACE_TYPES as readonly string[]).includes(placeType) ? 'empresa' : 'vida');
  return newPlace(store, { name: q.slice(0, 200), placeType, layer, city: create.ciudad || undefined, zone: create.zona || undefined });
}

/** Personas de Mi gente por id o nombre (exacto o, si es único, por coincidencia parcial: "Ana" → "Ana López"). */
function resolvePeople(catalog: Entity[], names: string[] | undefined): string[] {
  if (!names?.length) return [];
  const npcs = list<NpcData>(catalog, 'npcs', 'npc');
  const out: string[] = [];
  for (const raw of names) {
    const q = raw.trim();
    const byId = npcs.find((p) => p.id === q);
    const n = mapNormalize(q);
    const exact = npcs.filter((p) => mapNormalize(p.data.name) === n);
    const partial = npcs.filter((p) => mapNormalize(p.data.name).split(' ').includes(n) || mapNormalize(p.data.name).startsWith(n));
    const hit = byId ?? (exact.length === 1 ? exact[0] : exact.length === 0 && partial.length === 1 ? partial[0] : null);
    if (!hit) {
      const many = exact.length > 1 ? exact : partial;
      if (many.length > 1) throw new ToolError(`"${q}" coincide con varias personas: ${many.map((p) => `${p.data.name} [${p.id}]`).join('; ')}. Usa el id.`);
      throw new ToolError(`No encontré a "${q}" en Mi gente. Créala con guardar_persona o quítala de la lista.`);
    }
    if (!out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

function namesOf(catalog: Entity[], ids: string[]): string[] {
  return ids.map((id) => (catalog.find((e) => e.id === id)?.data as { name?: string } | undefined)?.name ?? id);
}

function placeLine(p: Entity<PlaceData>, st: PlaceState | undefined, catalog: Entity[]): string {
  const status = PLACE_STATUS_NAMES[st?.status ?? 'inexplorado'].toLowerCase();
  const parts = [`- [${p.id}] ${p.data.name} (${PLACE_TYPE_NAMES[p.data.placeType] ?? p.data.placeType}${where(p.data) ? ` · ${where(p.data)}` : ''}): ${status}`];
  if (st?.visits) parts.push(`${st.visits} ${st.visits === 1 ? 'visita' : 'visitas'} (última ${st.lastVisit})`);
  const lived = (Object.keys(st?.firsts ?? {}) as VisitCompany[]).map((c) => COMPANY_TEXT[c]);
  if (lived.length) parts.push(lived.join(', '));
  const people = [...new Set([...(st?.people ?? []), ...(p.data.npcIds ?? [])])];
  if (people.length) parts.push(`con ${namesOf(catalog, people).join(', ')}`);
  if (st?.rating) parts.push(`${st.rating}/5`);
  if (placeLayer(p.data) === 'empresa') parts.push(p.data.active === false ? 'ya no opera ahí' : `activo${p.data.since ? ` desde ${p.data.since}` : ''}`);
  if (p.data.lat == null || p.data.lng == null) parts.push('sin ubicación');
  return parts.join(' · ');
}

async function mapEvents(store: AssistantStore, placeId?: string): Promise<GameEvent[]> {
  return store.events({ types: MAP_TYPES, ...(placeId ? { match: { placeId } } : {}), order: 'asc' });
}

// ---------------------------------------------------------------------------------------------
// Panorama (renderOverview)
// ---------------------------------------------------------------------------------------------

export function renderMapaOverview(m: MapSummary): string[] {
  if (!m.known && !m.toKnow && !m.empresa.active) return [];
  const L = ['', '## Mapa'];
  L.push(
    `Conoce ${m.known} ${m.known === 1 ? 'lugar' : 'lugares'} (${m.habitual} habituales)${m.cities.length ? ` en ${m.cities.length} ${m.cities.length === 1 ? 'ciudad' : 'ciudades'}` : ''}; ${m.toKnow} por conocer. Visitas este año: ${m.visitsThisYear}.`,
  );
  const lived = (Object.entries(m.byCompany) as [VisitCompany, number][]).map(([c, n]) => `${COMPANY_TEXT[c]} ${n}`);
  if (lived.length) L.push(`Lugares vividos: ${lived.join(' · ')}.`);
  const started = m.collections.filter((c) => c.known > 0);
  if (started.length) L.push(`Colecciones: ${started.map((c) => `${c.name} ${c.known}/${c.total}${c.completedOn ? ' (completa)' : ''}`).join(' · ')}.`);
  if (m.recent.length) L.push(`Últimas visitas: ${m.recent.map((v) => `${v.date} ${v.name} (${COMPANY_TEXT[v.company]})`).join('; ')}.`);
  if (m.empresa.active) L.push(`Empresa: opera en ${m.empresa.cities.map((c) => `${c.city} (${c.places}${c.clients ? `, ${c.clients} clientes` : ''})`).join(', ')}.`);
  return L;
}

// ---------------------------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------------------------

const verMapa = tool({
  name: 'ver_mapa',
  title: 'Ver mapa',
  group: 'consultar',
  writes: false,
  description:
    'Mapa de lugares de Iván con sus ids: estado (por conocer / conocido / habitual), visitas, con quién los ha vivido (solo, pareja, familia, amigos), colecciones del catálogo de Jalisco con su avance y, en la capa empresa, dónde opera su empresa (oficinas, sucursales, clientes, proveedores, zonas). Con "sugerencias" lista lugares emblemáticos que aún no conoce.',
  input: z.object({
    capa: z.enum(['vida', 'empresa', 'todo']).optional().describe('Por defecto, vida.'),
    ciudad: z.string().trim().max(80).optional().describe('Filtra por ciudad o municipio.'),
    sugerencias: z.boolean().optional().describe('Incluir lugares emblemáticos de Jalisco por conocer (con su id de catálogo).'),
  }),
  async run({ capa, ciudad, sugerencias }, store) {
    const layer = capa ?? 'vida';
    const [catalog, events] = await Promise.all([store.catalog(), mapEvents(store)]);
    const fold = foldMapEvents(events.filter((e) => e.localDate <= store.today), habitualVisits());
    const city = ciudad ? mapNormalize(ciudad) : null;
    const inCity = (c?: string) => !city || mapNormalize(c ?? '') === city;
    const all = places(catalog).filter((p) => (layer === 'todo' || placeLayer(p.data) === layer) && inCity(p.data.city));
    const L: string[] = [];
    if (layer !== 'empresa') {
      const vida = all.filter((p) => placeLayer(p.data) === 'vida');
      const status = (id: string): PlaceStatus => fold.places[id]?.status ?? 'inexplorado';
      const known = vida.filter((p) => status(p.id) !== 'inexplorado');
      L.push(`# Mapa · vida${ciudad ? ` · ${ciudad}` : ''}`);
      L.push(`Conoce ${known.length} lugares (${known.filter((p) => status(p.id) === 'dominado').length} habituales; habitual = ${habitualVisits()}+ visitas o marcado a mano), ${vida.length - known.length} por conocer.`);
      const lived = VISIT_COMPANIES.map((c) => [c, known.filter((p) => fold.places[p.id]?.firsts[c]).length] as const).filter(([, n]) => n > 0);
      if (lived.length) L.push(`Lo ha vivido: ${lived.map(([c, n]) => `${COMPANY_TEXT[c]} ${n}`).join(' · ')}.`);
      const links = mapCatalogLinks(Object.keys(fold.places), catalog);
      const { collections } = mapCollectionProgress(fold.places, links);
      L.push(
        `Colecciones (completar una da XP una vez): ${collections
          .map(({ collection: c, knownIds, completedOn }) => `${c.name} ${knownIds.length}/${c.placeIds.length}${completedOn ? ` (completa el ${completedOn})` : ` (+${GAME_CONFIG.missionXp[c.size]} XP)`}`)
          .join(' · ')}.`,
      );
      L.push('', 'Lugares:');
      const sorted = [...vida].sort((a, b) => (fold.places[b.id]?.lastVisit ?? '').localeCompare(fold.places[a.id]?.lastVisit ?? '') || a.data.name.localeCompare(b.data.name, 'es'));
      for (const p of sorted.slice(0, 80)) L.push(placeLine(p, fold.places[p.id], catalog));
      if (sorted.length > 80) L.push(`(y ${sorted.length - 80} más)`);
      if (!sorted.length) L.push('(ninguno todavía)');
      if (sugerencias) {
        const linked = new Set([...links.entries()].filter(([, pids]) => pids.some((id) => fold.places[id]?.discoveredOn || catalog.some((e) => e.id === id))).map(([cid]) => cid));
        const todo = MAP_CATALOG.filter((c) => !linked.has(c.id) && inCity(c.city));
        L.push('', `Lugares emblemáticos por conocer (${todo.length}; para registrar una visita usa registrar_visita con el id):`);
        for (const c of todo) L.push(`- [${c.id}] ${c.name} (${PLACE_TYPE_NAMES[c.placeType]} · ${[c.city, c.zone].filter(Boolean).join(', ')}) · colecciones: ${MAP_COLLECTIONS.filter((k) => k.placeIds.includes(c.id)).map((k) => k.name).join(', ')}`);
      }
    }
    if (layer !== 'vida') {
      const emp = all.filter((p) => placeLayer(p.data) === 'empresa');
      const active = emp.filter((p) => p.data.active !== false);
      const cities = new Map<string, { n: number; clients: number }>();
      for (const p of active) {
        const c = p.data.city?.trim() || 'Sin ciudad';
        const row = cities.get(c) ?? { n: 0, clients: 0 };
        row.n++;
        if (p.data.placeType === 'cliente') row.clients++;
        cities.set(c, row);
      }
      if (L.length) L.push('');
      L.push('# Mapa · empresa');
      L.push(active.length ? `Opera en: ${[...cities.entries()].map(([c, r]) => `${c} (${r.n} ${r.n === 1 ? 'lugar' : 'lugares'}${r.clients ? `, ${r.clients} clientes` : ''})`).join(' · ')}.` : 'Sin lugares de la empresa registrados.');
      for (const t of EMPRESA_PLACE_TYPES) {
        const group = emp.filter((p) => p.data.placeType === t);
        if (!group.length) continue;
        L.push('', `${PLACE_TYPE_NAMES[t]}:`);
        for (const p of group) L.push(placeLine(p, fold.places[p.id], catalog));
      }
    }
    return { text: L.join('\n') };
  },
});

const PEOPLE_HELP = 'Nombres o ids de personas de Mi gente que fueron (p. ej. su novia o sus hijas).';

const registrarVisita = tool({
  name: 'registrar_visita',
  title: 'Registrar visita a un lugar',
  group: 'registrar',
  writes: true,
  description: `Registra que Iván FUE a un lugar y con quién (solo, pareja = con su novia, familia, amigos, trabajo u otro). Acepta el id o el nombre: si el lugar no existe se crea, y si es un lugar emblemático de Jalisco se liga al catálogo (cuenta para sus colecciones). La primera visita a un lugar da +${GAME_CONFIG.rewards.discovery} XP (una vez); con ${GAME_CONFIG.mapa.habitualVisits} visitas se vuelve habitual.`,
  input: z.object({
    lugar: zText(200).describe('Id (de ver_mapa), id del catálogo de Jalisco o nombre del lugar.'),
    compania: z.enum(VISIT_COMPANIES).describe('Con quién fue.'),
    personas: z.array(zText(100)).max(20).optional().describe(PEOPLE_HELP),
    nota: z.string().trim().max(2000).optional(),
    calificacion: z.number().int().min(1).max(5).optional().describe('Qué tal estuvo, de 1 a 5 (solo si él lo dijo).'),
    tipo: z.enum(PLACE_TYPES).optional().describe('Solo si el lugar es nuevo: categoría (restaurante, cafe, bar, parque, naturaleza, museo, cultura, deporte, compras, evento, pueblo, playa, viaje, experiencia, comunidad, lugar; en la empresa: oficina, sucursal, cliente, proveedor, zona).'),
    ciudad: z.string().trim().max(80).optional().describe('Solo si el lugar es nuevo: ciudad o municipio.'),
    zona: z.string().trim().max(80).optional().describe('Solo si el lugar es nuevo: colonia o zona.'),
    fecha: zFecha,
  }),
  async run(input, store) {
    const date = pastDate(store, input.fecha);
    const catalog = await store.catalog();
    const place = resolvePlace(store, catalog, input.lugar, { tipo: input.tipo, ciudad: input.ciudad, zona: input.zona });
    const npcIds = resolvePeople(catalog, input.personas);
    const p = place.entity;
    const before = await mapEvents(store, p.id);
    const dup = before.find((e) => e.type === 'place.visited' && !e.voidedAt && e.localDate === date && e.payload.company === input.compania);
    if (dup) return { text: `La visita a "${p.data.name}" (${COMPANY_TEXT[input.compania]}) ya estaba registrada ese día. No registré nada nuevo. Registro [${dup.id}].` };

    const ev = makeEvent(store, 'place.visited', { placeId: p.id, company: input.compania, npcIds: npcIds.length ? npcIds : undefined, note: input.nota || undefined, rating: input.calificacion }, date);
    const refs: Partial<ActivityRefs> = { events: [ev.id], entities: [] };
    if (place.isNew) {
      const { ref } = await upsert<PlaceData>(store, null, p);
      refs.entities = [ref];
    }
    const valid = before.filter((e) => !e.voidedAt && e.localDate <= store.today);
    const prevState = foldMapEvents(valid, habitualVisits()).places[p.id];
    const nextState = foldMapEvents([...valid, ev], habitualVisits()).places[p.id];
    await store.addEvents([ev]);

    const notes: string[] = [];
    if (!prevState?.discoveredOn && nextState?.discoveredOn) notes.push(`¡Primera visita! +${GAME_CONFIG.rewards.discovery} XP`);
    else if (!prevState?.firsts[input.compania]) notes.push(`Primera vez ${COMPANY_TEXT[input.compania]}`);
    if (nextState?.status === 'dominado' && prevState?.status !== 'dominado') notes.push('ya es habitual');
    const cid = catalogIdOfPlace(p.id, p.data);
    if (cid) {
      const all = (await mapEvents(store)).filter((e) => !e.voidedAt && e.localDate <= store.today);
      const ents = place.isNew ? [...catalog, p] : catalog;
      const pBefore = mapCollectionProgress(foldMapEvents(all.filter((e) => e.id !== ev.id), habitualVisits()).places, mapCatalogLinks(all.map((e) => e.payload.placeId), ents)).collections;
      const withEv = all.some((e) => e.id === ev.id) ? all : [...all, ev];
      const pAfter = mapCollectionProgress(foldMapEvents(withEv, habitualVisits()).places, mapCatalogLinks(withEv.map((e) => e.payload.placeId), ents)).collections;
      for (const a of pAfter) {
        if (!a.collection.placeIds.includes(cid)) continue;
        const b = pBefore.find((x) => x.collection.id === a.collection.id);
        if (a.completedOn && !b?.completedOn) notes.push(`¡Colección completa: ${a.collection.name}! +${GAME_CONFIG.missionXp[a.collection.size]} XP`);
        else if (a.knownIds.length !== b?.knownIds.length) notes.push(`${a.collection.name}: ${a.knownIds.length}/${a.collection.placeIds.length}`);
      }
    }
    const who = `${COMPANY_TEXT[input.compania]}${npcIds.length ? ` con ${namesOf(catalog, npcIds).join(', ')}` : ''}`;
    const when = date === store.today ? 'hoy' : fmtDay(date);
    return ok(
      `Visita registrada: ${p.data.name}${place.isNew ? ' (lugar nuevo en el mapa)' : ''}, ${who}, ${when}. ${notes.length ? `${notes.join(' · ')}. ` : ''}Lleva ${nextState?.visits ?? 1} ${nextState?.visits === 1 ? 'visita' : 'visitas'}. Registro [${ev.id}], lugar [${p.id}].`,
      `Visita a ${p.data.name} (${COMPANY_TEXT[input.compania]})`,
      refs,
    );
  },
});

const ESTADOS: Record<string, PlaceStatus> = { por_conocer: 'inexplorado', conocido: 'descubierto', habitual: 'dominado' };

const guardarLugar = tool({
  name: 'guardar_lugar',
  title: 'Guardar lugar del mapa',
  group: 'organizar',
  writes: true,
  description:
    'Crea o edita un lugar del mapa. Capa "vida" (lugares que quiere conocer o ya conoce) o "empresa" (oficina, sucursal, cliente, proveedor o zona donde opera su empresa). Para editar manda "id"; solo cambia los campos que mandes. Un lugar emblemático de Jalisco se liga solo al catálogo (o manda "catalogo_id"). Crear un lugar no da XP: la XP llega con la primera visita (registrar_visita).',
  input: z.object({
    id: zId.optional().describe('Para editar uno existente (de ver_mapa).'),
    nombre: zText(200).optional(),
    tipo: z.enum(PLACE_TYPES).optional(),
    capa: z.enum(['vida', 'empresa']).optional(),
    ciudad: z.string().trim().max(80).optional().describe('Ciudad o municipio (Guadalajara, Zapopan, Tlaquepaque…).'),
    zona: z.string().trim().max(80).optional().describe('Colonia o zona.'),
    lat: z.number().min(-85).max(85).optional(),
    lng: z.number().min(-180).max(180).optional(),
    notas: z.string().trim().max(2000).optional(),
    personas: z.array(zText(100)).max(30).optional().describe('Personas de Mi gente ligadas (en empresa: contactos del cliente o proveedor). Reemplaza la lista.'),
    activo: z.boolean().optional().describe('Empresa: false si ya no opera ahí.'),
    desde: zDate.optional().describe('Empresa: desde cuándo opera ahí (YYYY-MM-DD).'),
    catalogo_id: zId.optional().describe('Id de un lugar emblemático (ver_mapa con sugerencias) para ligarlo.'),
    estado: z.enum(['por_conocer', 'conocido', 'habitual']).optional().describe('Fija el estado a mano (queda como registro de hoy). Normalmente sale solo de las visitas.'),
  }),
  async run(i, store) {
    if ((i.lat === undefined) !== (i.lng === undefined)) throw new ToolError('Manda lat y lng juntos.');
    const catalog = await store.catalog();
    let existing: Entity<PlaceData> | null = null;
    let base: PlaceData | null = null;
    let id: string;
    const cat = i.catalogo_id ? MAP_CATALOG_BY_ID.get(i.catalogo_id) : undefined;
    if (i.catalogo_id && !cat) throw new ToolError(`No existe "${i.catalogo_id}" en el catálogo de Jalisco. Consulta ver_mapa con sugerencias.`);
    if (i.id) {
      const e = places(catalog).find((p) => p.id === i.id);
      if (!e) throw new ToolError(`No encontré el lugar "${i.id}". Consulta ver_mapa.`);
      existing = e;
      id = e.id;
    } else if (cat) {
      const linked = fromCatalog(catalog, cat);
      existing = linked?.entity ?? null;
      id = existing?.id ?? catalogPlaceEntityId(cat.id);
      if (!existing) base = placeFromCatalog(cat);
    } else {
      if (!i.nombre) throw new ToolError('Para un lugar nuevo manda "nombre" (o "catalogo_id").');
      const n = mapNormalize(i.nombre);
      const dup = places(catalog).find((p) => mapNormalize(p.data.name) === n);
      if (dup) throw new ToolError(`Ya existe "${dup.data.name}" [${dup.id}]. Para editarlo manda su id.`);
      const auto = MAP_CATALOG.find((c) => mapNormalize(c.name) === n);
      const linked = auto ? fromCatalog(catalog, auto) : null;
      if (linked) throw new ToolError(`"${auto!.name}" ya está en el mapa [${linked.entity.id}]. Para editarlo manda su id.`);
      id = auto ? catalogPlaceEntityId(auto.id) : newPlaceId(store);
      base = auto ? placeFromCatalog(auto) : { name: i.nombre, placeType: 'lugar' };
    }
    const prev = existing?.data ?? base!;
    const data: PlaceData = { ...prev };
    if (i.nombre) data.name = i.nombre;
    if (i.tipo) data.placeType = i.tipo;
    if (i.capa) data.layer = i.capa;
    else if (i.tipo && !existing) data.layer = (EMPRESA_PLACE_TYPES as readonly string[]).includes(i.tipo) ? 'empresa' : 'vida';
    if (i.ciudad !== undefined) data.city = i.ciudad || undefined;
    if (i.zona !== undefined) data.zone = i.zona || undefined;
    if (i.lat !== undefined) {
      data.lat = i.lat;
      data.lng = i.lng;
    }
    if (i.notas !== undefined) data.notes = i.notas || undefined;
    if (i.personas) data.npcIds = resolvePeople(catalog, i.personas);
    if (i.activo !== undefined) data.active = i.activo;
    if (i.desde !== undefined) data.since = i.desde;
    // Un lugar viejo ligado al catálogo solo por su nombre guarda la liga (si se renombra, sigue contando).
    const nameLink = existing && !cat && !data.catalogId ? catalogIdOfPlace(existing.id, existing.data) : null;
    if (nameLink) data.catalogId = nameLink;
    if (cat) {
      data.catalogId = cat.id;
      if (data.lat == null || data.lng == null) {
        data.lat = cat.lat;
        data.lng = cat.lng;
      }
      data.city ||= cat.city;
      data.zone ||= cat.zone;
    }
    data.layer ??= placeLayer(data);
    const { saved, ref } = await upsert<PlaceData>(store, existing, { id, module: 'map', kind: 'place', data });
    const refs: Partial<ActivityRefs> = { entities: [ref], events: [] };
    let statusText = '';
    if (i.estado) {
      const target = ESTADOS[i.estado];
      const evs = existing ? (await mapEvents(store, id)).filter((e) => !e.voidedAt && e.localDate <= store.today) : [];
      const cur = foldMapEvents(evs, habitualVisits()).places[id]?.status ?? 'inexplorado';
      if (cur !== target) {
        const ev = makeEvent(store, 'map.status_changed', { placeId: id, status: target }, store.today);
        await store.addEvents([ev]);
        refs.events = [ev.id];
        const first = cur === 'inexplorado' && !foldMapEvents(evs, habitualVisits()).places[id]?.discoveredOn;
        statusText = ` Estado: ${PLACE_STATUS_NAMES[target].toLowerCase()}${first ? ` (primera visita: +${GAME_CONFIG.rewards.discovery} XP)` : ''}. Registro [${ev.id}].`;
      }
    }
    const what = existing ? 'Actualicé' : 'Agregué al mapa';
    const layerText = placeLayer(saved.data as PlaceData) === 'empresa' ? 'empresa' : 'vida';
    return ok(
      `${what} "${data.name}" (${PLACE_TYPE_NAMES[data.placeType] ?? data.placeType} · capa ${layerText}${where(data) ? ` · ${where(data)}` : ''}${data.catalogId ? ' · del catálogo de Jalisco' : ''}) [${saved.id}].${statusText}`,
      `${existing ? 'Editó' : 'Agregó'} el lugar "${data.name}"`,
      refs,
    );
  },
});

export const MAPA_TOOLS = [verMapa, registrarVisita, guardarLugar];
