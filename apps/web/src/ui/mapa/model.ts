import {
  GAME_CONFIG,
  MAP_CATALOG_BY_ID,
  VISIT_COMPANY_NAMES,
  catalogPlaceEntityId,
  placeFromCatalog,
  placeLayer,
  type CatalogPlace,
  type Entity,
  type GameState,
  type NpcData,
  type PlaceData,
  type PlaceStatus,
  type VisitCompany,
} from '@igv/core';
import { addEvent, deleteEntity, saveEntity, voidEvent } from '../../data/store';
import { newId } from '../../lib/time';
import { toast, undoToast } from '../kit';
import type { MarkerKind } from './MapView';

/** A dónde va una visita: un lugar guardado, uno del catálogo de Jalisco o uno nuevo por nombre. */
export type VisitTarget = { kind: 'place'; place: Entity<PlaceData> } | { kind: 'catalog'; place: CatalogPlace } | { kind: 'new'; name: string };

export const STATUS_TONE: Record<PlaceStatus, string | undefined> = { inexplorado: undefined, descubierto: 'teal', dominado: 'gold' };

export function statusOf(state: GameState, id: string): PlaceStatus {
  return state.map.places[id]?.status ?? 'inexplorado';
}

export function markerKind(p: Entity<PlaceData>, status: PlaceStatus): MarkerKind {
  if (placeLayer(p.data) === 'empresa') {
    if (p.data.active === false) return 'inactive';
    const t = p.data.placeType;
    return t === 'oficina' || t === 'sucursal' || t === 'cliente' || t === 'proveedor' || t === 'zona' ? t : 'cliente';
  }
  return status === 'dominado' ? 'habitual' : status === 'descubierto' ? 'known' : 'todo';
}

export const hasCoords = (d: Pick<PlaceData, 'lat' | 'lng'>) => typeof d.lat === 'number' && typeof d.lng === 'number' && Number.isFinite(d.lat) && Number.isFinite(d.lng);

export function whereText(d: Pick<PlaceData, 'city' | 'zone'>): string {
  return [d.zone, d.city].filter((x) => x && x.trim()).join(', ');
}

/** Personas sugeridas primero según con quién fuiste (lee `circle`/`role` si existen; si no, nada especial). */
export function sortPeopleFor(npcs: Entity<NpcData>[], company: VisitCompany | null): Entity<NpcData>[] {
  if (!company) return npcs;
  const words: Partial<Record<VisitCompany, string[]>> = {
    pareja: ['pareja', 'novia', 'novio', 'esposa', 'esposo'],
    familia: ['familia', 'hija', 'hijo', 'mama', 'mamá', 'papa', 'papá', 'hermana', 'hermano'],
    amigos: ['amigos', 'amiga', 'amigo'],
    trabajo: ['trabajo', 'clientes', 'cliente', 'equipo', 'socio', 'socia'],
  };
  const ws = words[company] ?? [];
  const score = (n: Entity<NpcData>) => {
    const d = n.data as NpcData & { circle?: unknown; role?: unknown };
    const tags = [d.circle, d.role, d.npcType].filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase());
    if (company === 'trabajo' && (d.npcType === 'cliente' || d.npcType === 'aliado')) return 0;
    return tags.some((t) => ws.some((w) => t.includes(w))) ? 0 : 1;
  };
  return [...npcs].sort((a, b) => score(a) - score(b));
}

/**
 * Registra una visita (crea el lugar si hace falta) con aviso y "Deshacer". Devuelve el id del lugar.
 * Las mismas reglas que el motor: la primera visita da XP una vez.
 */
export function registerVisit(
  target: VisitTarget,
  v: { company: VisitCompany; npcIds: string[]; note?: string; rating?: number; date: string },
  state: GameState,
  extra?: Partial<PlaceData>,
): string {
  let placeId: string;
  let created: string | null = null;
  let name: string;
  if (target.kind === 'place') {
    placeId = target.place.id;
    name = target.place.data.name;
  } else if (target.kind === 'catalog') {
    placeId = state.map.catalog[target.place.id]?.placeId ?? catalogPlaceEntityId(target.place.id);
    name = target.place.name;
    saveEntity<PlaceData>({ id: placeId, module: 'map', kind: 'place', data: placeFromCatalog(target.place) });
    created = placeId;
  } else {
    placeId = `place-${newId().replace(/-/g, '').slice(0, 10)}`;
    name = target.name.trim();
    saveEntity<PlaceData>({ id: placeId, module: 'map', kind: 'place', data: { name, placeType: 'lugar', layer: 'vida', ...extra } });
    created = placeId;
  }
  const first = !state.map.places[placeId]?.discoveredOn;
  const firstWith = !first && !state.map.places[placeId]?.firsts[v.company];
  const ev = addEvent('place.visited', { placeId, company: v.company, npcIds: v.npcIds.length ? v.npcIds : undefined, note: v.note?.trim() || undefined, rating: v.rating }, { localDate: v.date });
  const msg = first ? `Primera visita: ${name} · +${GAME_CONFIG.rewards.discovery} XP` : firstWith ? `Primera vez ${VISIT_COMPANY_NAMES[v.company].toLowerCase()} en ${name}` : `Visita registrada: ${name}`;
  undoToast(msg, () => {
    voidEvent(ev.id);
    if (created) deleteEntity(created);
    toast('Visita anulada');
  });
  return placeId;
}

/** Guarda un lugar del catálogo como "por conocer" (quiero ir). */
export function saveWish(c: CatalogPlace, state: GameState): string {
  const id = state.map.catalog[c.id]?.placeId ?? catalogPlaceEntityId(c.id);
  saveEntity<PlaceData>({ id, module: 'map', kind: 'place', data: placeFromCatalog(c) });
  undoToast(`"${c.name}" quedó en tu mapa por conocer`, () => deleteEntity(id));
  return id;
}

/** Lugares del catálogo fijo que todavía no están en tu mapa (ni conocidos por visitas de un lugar ya borrado). */
export function pendingCatalog(state: GameState, entityIds: Set<string>): CatalogPlace[] {
  const out: CatalogPlace[] = [];
  for (const c of MAP_CATALOG_BY_ID.values()) {
    const link = state.map.catalog[c.id];
    if (link && (entityIds.has(link.placeId) || link.discoveredOn)) continue;
    out.push(c);
  }
  return out;
}

/** Ubicación actual (una sola lectura). */
export function getPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Tu navegador no da la ubicación.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }),
      (err) => reject(new Error(err.code === 1 ? 'Permite el acceso a tu ubicación para usarla.' : 'No se pudo obtener tu ubicación.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

// ---------- Preferencias de esta pantalla (solo en este dispositivo) ----------
const KEY = 'igv-mapa';
export interface MapaPrefs {
  layer: 'vida' | 'empresa';
  tiles: boolean;
  suggest: boolean;
}
const DEFAULTS: MapaPrefs = { layer: 'vida', tiles: true, suggest: true };
export function getMapaPrefs(): MapaPrefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<MapaPrefs>) };
  } catch {
    return DEFAULTS;
  }
}
export function setMapaPrefs(p: Partial<MapaPrefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getMapaPrefs(), ...p }));
  } catch {
    // sin almacenamiento: solo en esta sesión
  }
}

/** Ciudades sugeridas para el formulario (zona metropolitana de Guadalajara y Jalisco). */
export const CITY_SUGGESTIONS = ['Guadalajara', 'Zapopan', 'Tlaquepaque', 'Tonalá', 'Tlajomulco', 'El Salto', 'Chapala', 'Tequila', 'Tapalpa', 'Mazamitla', 'Puerto Vallarta', 'Ciudad de México', 'Monterrey'];
