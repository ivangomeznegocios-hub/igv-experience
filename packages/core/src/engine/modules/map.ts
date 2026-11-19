import type { Ctx } from '../context';
import { entitiesOf } from '../context';
import { placeLayer, type AttributeId, type Entity, type GameEvent, type PlaceData, type PlaceStatus, type VisitCompany } from '../../types';
import { compareDates } from '../../util/dates';
import { MAP_COLLECTIONS, catalogIdOfPlace } from '../map-catalog';

/**
 * Mapa (vida y empresa). Estado derivado de dos eventos, en orden cronológico:
 *  - `map.status_changed` (versión anterior y "marcar como habitual"): fija el estado a mano.
 *  - `place.visited`: cuenta una visita; con ≥1 el lugar queda al menos "conocido" y con
 *    `cfg.mapa.habitualVisits` al menos "habitual".
 * La primera vez que un lugar deja de estar "por conocer" (por cualquiera de los dos) da `rewards.discovery`
 * una sola vez. Completar una colección del catálogo fijo da la XP de una misión de su tamaño, una vez.
 */

export interface PlaceState {
  status: PlaceStatus;
  discoveredOn: string | null;
  masteredOn: string | null;
  /** Visitas registradas (`place.visited`). */
  visits: number;
  firstVisit: string | null;
  lastVisit: string | null;
  /** "Lo has vivido": primera vez con cada compañía. */
  firsts: Partial<Record<VisitCompany, string>>;
  /** Visitas por compañía. */
  byCompany: Partial<Record<VisitCompany, number>>;
  /** Personas de Mi gente con las que has ido (sin repetir, en orden de la primera vez). */
  people: string[];
  /** Calificación promedio (1–5) o null. */
  rating: number | null;
}

export interface PlaceVisit {
  id: string;
  placeId: string;
  date: string;
  company: VisitCompany;
  npcIds: string[];
  note?: string;
  rating?: number;
}

export interface MapFirst {
  placeId: string;
  date: string;
  company: VisitCompany;
}

export interface MapCollectionState {
  id: string;
  name: string;
  total: number;
  known: number;
  /** Ids del catálogo fijo ya conocidos. */
  knownIds: string[];
  completedOn: string | null;
  /** XP que da (o dio) al completarse. */
  xp: number;
}

/** Resumen compacto (pantalla y foto para la IA). */
export interface MapSummary {
  /** Capa vida (lugares del catálogo editable). */
  known: number;
  habitual: number;
  toKnow: number;
  visits: number;
  visitsThisYear: number;
  cities: string[];
  /** Lugares distintos de la capa vida que has vivido con cada compañía. */
  byCompany: Partial<Record<VisitCompany, number>>;
  recent: { placeId: string; name: string; date: string; company: VisitCompany }[];
  collections: { id: string; name: string; known: number; total: number; completedOn: string | null }[];
  empresa: {
    /** Lugares de la capa empresa que siguen activos. */
    active: number;
    clients: number;
    cities: { city: string; places: number; clients: number; since: string | null }[];
  };
}

export interface MapState {
  places: Record<string, PlaceState>;
  /** Fechas de cada primera visita (orden cronológico; las usan los logros "discoveries"). */
  discoveryDates: string[];
  /** Todas las visitas (orden cronológico). */
  visits: PlaceVisit[];
  /** Primeras veces con cada compañía en cada lugar (orden cronológico). */
  firsts: MapFirst[];
  collections: Record<string, MapCollectionState>;
  /** Catálogo fijo: id → lugar ligado y cuándo lo conociste. */
  catalog: Record<string, { placeId: string; discoveredOn: string | null }>;
  summary: MapSummary;
}

const RANK: Record<PlaceStatus, number> = { inexplorado: 0, descubierto: 1, dominado: 2 };

function emptyPlace(): PlaceState {
  return { status: 'inexplorado', discoveredOn: null, masteredOn: null, visits: 0, firstVisit: null, lastVisit: null, firsts: {}, byCompany: {}, people: [], rating: null };
}

/** Mismo orden que project(): día local, momento exacto, id. */
function chrono(a: GameEvent, b: GameEvent): number {
  return compareDates(a.localDate, b.localDate) || (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface MapFold {
  places: Record<string, PlaceState>;
  /** Primeras visitas (cronológico), con el evento que la causó. */
  discoveries: { placeId: string; date: string; eventId: string }[];
  visits: PlaceVisit[];
  firsts: MapFirst[];
}

/**
 * Pliega los eventos del mapa (`map.status_changed` y `place.visited`, ya válidos) en el estado de cada
 * lugar. Puro: lo usan el reductor y las herramientas de IA.
 */
export function foldMapEvents(events: GameEvent[], habitualVisits: number): MapFold {
  const sorted = events.filter((e) => e.type === 'map.status_changed' || e.type === 'place.visited').sort(chrono);
  const places: Record<string, PlaceState> = {};
  const ratings: Record<string, { sum: number; n: number }> = {};
  const discoveries: MapFold['discoveries'] = [];
  const visits: PlaceVisit[] = [];
  const firsts: MapFirst[] = [];
  const need = Math.max(1, habitualVisits || 1);
  for (const ev of sorted) {
    const p = ev.payload as { placeId: string; status?: PlaceStatus; company?: VisitCompany; npcIds?: string[]; note?: string; rating?: number };
    if (!p?.placeId) continue;
    const st = (places[p.placeId] ??= emptyPlace());
    if (ev.type === 'map.status_changed') {
      if (!p.status || !(p.status in RANK)) continue;
      st.status = p.status;
    } else {
      const company = (p.company ?? 'otro') as VisitCompany;
      const npcIds = Array.isArray(p.npcIds) ? p.npcIds : [];
      st.visits++;
      st.firstVisit ??= ev.localDate;
      st.lastVisit = ev.localDate;
      st.byCompany[company] = (st.byCompany[company] ?? 0) + 1;
      if (!st.firsts[company]) {
        st.firsts[company] = ev.localDate;
        firsts.push({ placeId: p.placeId, date: ev.localDate, company });
      }
      for (const id of npcIds) if (!st.people.includes(id)) st.people.push(id);
      if (typeof p.rating === 'number') {
        const r = (ratings[p.placeId] ??= { sum: 0, n: 0 });
        r.sum += p.rating;
        r.n++;
        st.rating = Math.round((r.sum / r.n) * 10) / 10;
      }
      visits.push({ id: ev.id, placeId: p.placeId, date: ev.localDate, company, npcIds, note: p.note, rating: p.rating });
      const derived: PlaceStatus = st.visits >= need ? 'dominado' : 'descubierto';
      if (RANK[derived] > RANK[st.status]) st.status = derived;
    }
    if (st.status !== 'inexplorado' && !st.discoveredOn) {
      st.discoveredOn = ev.localDate;
      discoveries.push({ placeId: p.placeId, date: ev.localDate, eventId: ev.id });
    }
    if (st.status === 'dominado' && !st.masteredOn) st.masteredOn = ev.localDate;
  }
  return { places, discoveries, visits, firsts };
}

/** Qué lugares (ids) están ligados a cada lugar del catálogo fijo. */
export function mapCatalogLinks(placeIds: Iterable<string>, entities: Entity[]): Map<string, string[]> {
  const links = new Map<string, string[]>();
  const add = (cid: string | null, pid: string) => {
    if (!cid) return;
    const l = links.get(cid) ?? [];
    if (!l.includes(pid)) l.push(pid);
    links.set(cid, l);
  };
  for (const e of entities) if (e.module === 'map' && e.kind === 'place' && !e.deletedAt) add(catalogIdOfPlace(e.id, e.data as PlaceData), e.id);
  for (const id of placeIds) add(catalogIdOfPlace(id, null), id);
  return links;
}

/** Progreso de cada colección: el día en que conociste cada lugar del catálogo (el más temprano de sus ligas). */
export function mapCollectionProgress(places: Record<string, PlaceState>, links: Map<string, string[]>) {
  const knownOn = new Map<string, string>();
  for (const [cid, pids] of links) {
    let best: string | null = null;
    for (const pid of pids) {
      const d = places[pid]?.discoveredOn;
      if (d && (!best || d < best)) best = d;
    }
    if (best) knownOn.set(cid, best);
  }
  const collections = MAP_COLLECTIONS.map((c) => {
    const knownIds = c.placeIds.filter((id) => knownOn.has(id));
    const completedOn = knownIds.length === c.placeIds.length && c.placeIds.length > 0 ? knownIds.map((id) => knownOn.get(id)!).sort().at(-1)! : null;
    return { collection: c, knownIds, completedOn };
  });
  return { knownOn, collections };
}

export function reduceMap(ctx: Ctx): MapState {
  const cfgMap = (ctx.cfg as { mapa?: { habitualVisits?: number; empresaAttribute?: string } }).mapa;
  const evs = [...(ctx.byType.get('map.status_changed') ?? []), ...(ctx.byType.get('place.visited') ?? [])];
  const fold = foldMapEvents(evs, cfgMap?.habitualVisits ?? 5);
  const { places } = fold;

  const nameOf = (id: string) => (ctx.entityById.get(id)?.data as PlaceData | undefined)?.name ?? 'Lugar';
  for (const d of fold.discoveries) {
    const data = ctx.entityById.get(d.placeId)?.data as PlaceData | undefined;
    const attribute = (placeLayer(data) === 'empresa' ? (cfgMap?.empresaAttribute ?? 'finanzas') : ctx.cfg.defaultAttributes.discovery) as AttributeId;
    ctx.addXp({
      date: d.date,
      amount: ctx.cfg.rewards.discovery,
      source: 'discovery',
      label: `Primera visita: ${nameOf(d.placeId)}`,
      attribute,
      eventId: d.eventId,
      refId: d.placeId,
    });
  }

  // Colecciones del catálogo fijo.
  const links = mapCatalogLinks(Object.keys(places), ctx.entities);
  const collections: Record<string, MapCollectionState> = {};
  const { knownOn, collections: progress } = mapCollectionProgress(places, links);
  for (const { collection: c, knownIds, completedOn } of progress) {
    const xp = ctx.cfg.missionXp[c.size] ?? 0;
    collections[c.id] = { id: c.id, name: c.name, total: c.placeIds.length, known: knownIds.length, knownIds, completedOn, xp };
    if (completedOn) {
      ctx.addXp({
        date: completedOn,
        amount: xp,
        source: 'discovery',
        label: `Colección completa: ${c.name}`,
        attribute: ctx.cfg.defaultAttributes.discovery as AttributeId,
        refId: `collection:${c.id}`,
      });
    }
  }
  const catalog: MapState['catalog'] = {};
  for (const [cid, pids] of links) {
    const live = pids.find((id) => ctx.entityById.has(id)) ?? pids[0];
    catalog[cid] = { placeId: live, discoveredOn: knownOn.get(cid) ?? null };
  }

  return {
    places,
    discoveryDates: fold.discoveries.map((d) => d.date),
    visits: fold.visits,
    firsts: fold.firsts,
    collections,
    catalog,
    summary: summarize(ctx, places, fold, collections),
  };
}

function summarize(ctx: Ctx, places: Record<string, PlaceState>, fold: MapFold, collections: Record<string, MapCollectionState>): MapSummary {
  const all = entitiesOf<PlaceData>(ctx, 'map', 'place');
  const vida = all.filter((e) => placeLayer(e.data) === 'vida');
  const empresa = all.filter((e) => placeLayer(e.data) === 'empresa');
  const statusOf = (id: string) => places[id]?.status ?? 'inexplorado';
  const known = vida.filter((e) => statusOf(e.id) !== 'inexplorado');
  const byCompany: MapSummary['byCompany'] = {};
  for (const e of known) for (const c of Object.keys(places[e.id]?.firsts ?? {}) as VisitCompany[]) byCompany[c] = (byCompany[c] ?? 0) + 1;
  const cityKey = (c: string | undefined) => (c ?? '').trim();
  const cities = [...new Set(known.map((e) => cityKey(e.data.city)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const year = ctx.today.slice(0, 4);
  const vidaIds = new Set(vida.map((e) => e.id));

  const byCity = new Map<string, { city: string; places: number; clients: number; since: string | null }>();
  const activeEmpresa = empresa.filter((e) => e.data.active !== false);
  for (const e of activeEmpresa) {
    const city = cityKey(e.data.city) || 'Sin ciudad';
    const row = byCity.get(city) ?? { city, places: 0, clients: 0, since: null };
    row.places++;
    if (e.data.placeType === 'cliente') row.clients++;
    const since = e.data.since ?? null;
    if (since && (!row.since || since < row.since)) row.since = since;
    byCity.set(city, row);
  }

  return {
    known: known.length,
    habitual: vida.filter((e) => statusOf(e.id) === 'dominado').length,
    toKnow: vida.length - known.length,
    visits: fold.visits.filter((v) => vidaIds.has(v.placeId)).length,
    visitsThisYear: fold.visits.filter((v) => vidaIds.has(v.placeId) && v.date.startsWith(year)).length,
    cities,
    byCompany,
    recent: fold.visits
      .filter((v) => ctx.entityById.has(v.placeId))
      .slice(-5)
      .reverse()
      .map((v) => ({ placeId: v.placeId, name: (ctx.entityById.get(v.placeId)!.data as PlaceData).name, date: v.date, company: v.company })),
    collections: Object.values(collections).map((c) => ({ id: c.id, name: c.name, known: c.known, total: c.total, completedOn: c.completedOn })),
    empresa: {
      active: activeEmpresa.length,
      clients: activeEmpresa.filter((e) => e.data.placeType === 'cliente').length,
      cities: [...byCity.values()].sort((a, b) => b.places - a.places || a.city.localeCompare(b.city, 'es')),
    },
  };
}
