import type { PlaceType } from '@igv/core';

/**
 * Buscar lugares por nombre en cualquier parte del mundo (y el nombre de un punto del mapa) con Nominatim de
 * OpenStreetMap, el mismo proveedor de las calles del mapa. Política de uso: solo búsquedas que pide el usuario
 * (botón o Enter, nunca mientras escribe), máximo 1 por segundo y con caché. El navegador manda el Referer de la
 * app; no se manda nada más que lo que se busca.
 */

const BASE = 'https://nominatim.openstreetmap.org';

export interface GeoResult {
  /** Nombre corto (p. ej. "Disneyland Park"). */
  name: string;
  /** Dónde está, para distinguir resultados ("Anaheim, California, Estados Unidos"). */
  detail: string;
  city?: string;
  zone?: string;
  country?: string;
  lat: number;
  lng: number;
  /** Tipo de lugar sugerido para la app. */
  placeType: PlaceType;
}

interface NominatimRow {
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string | undefined>;
}

const TYPE_MAP: Record<string, PlaceType> = {
  restaurant: 'restaurante',
  fast_food: 'restaurante',
  food_court: 'restaurante',
  cafe: 'cafe',
  ice_cream: 'cafe',
  bakery: 'cafe',
  bar: 'bar',
  pub: 'bar',
  nightclub: 'bar',
  biergarten: 'bar',
  park: 'parque',
  garden: 'parque',
  playground: 'parque',
  dog_park: 'parque',
  zoo: 'experiencia',
  theme_park: 'experiencia',
  aquarium: 'experiencia',
  water_park: 'experiencia',
  attraction: 'experiencia',
  museum: 'museo',
  gallery: 'museo',
  theatre: 'cultura',
  cinema: 'cultura',
  arts_centre: 'cultura',
  place_of_worship: 'cultura',
  library: 'cultura',
  stadium: 'deporte',
  sports_centre: 'deporte',
  pitch: 'deporte',
  golf_course: 'deporte',
  fitness_centre: 'deporte',
  beach: 'playa',
  beach_resort: 'playa',
  mall: 'compras',
  marketplace: 'compras',
  department_store: 'compras',
  supermarket: 'compras',
  village: 'pueblo',
  hamlet: 'pueblo',
  city: 'viaje',
  town: 'viaje',
  state: 'viaje',
  country: 'viaje',
  administrative: 'viaje',
  hotel: 'viaje',
  resort: 'viaje',
};
const CATEGORY_MAP: Record<string, PlaceType> = { natural: 'naturaleza', historic: 'cultura', shop: 'compras', place: 'viaje', boundary: 'viaje', leisure: 'parque', tourism: 'experiencia' };

/** Tipo de lugar de la app a partir de la clase y el tipo de OpenStreetMap. */
export function guessPlaceType(category?: string, type?: string): PlaceType {
  if (category === 'natural' && (type === 'beach' || type === 'bay')) return 'playa';
  if (type && TYPE_MAP[type]) return TYPE_MAP[type];
  if (category && CATEGORY_MAP[category]) return CATEGORY_MAP[category];
  return 'lugar';
}

const pick = (a: Record<string, string | undefined> | undefined, keys: string[]) => {
  for (const k of keys) if (a?.[k]?.trim()) return a[k]!.trim();
  return undefined;
};

/** Convierte una fila de Nominatim (jsonv2 con addressdetails) en un resultado de la app. */
export function parseNominatimRow(row: NominatimRow): GeoResult | null {
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  const a = row.address;
  const city = pick(a, ['city', 'town', 'village', 'municipality', 'hamlet', 'county', 'state_district', 'state']);
  const zone = pick(a, ['suburb', 'neighbourhood', 'quarter', 'city_district']);
  const country = pick(a, ['country']);
  const parts = (row.display_name ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Una dirección sin nombre: "Avenida Chapultepec 123" (no el número suelto con que empieza display_name).
  const street = a?.road ? [a.road, a.house_number].filter(Boolean).join(' ') : undefined;
  const name = row.name?.trim() || street || parts[0] || city || country || 'Lugar';
  const region = pick(a, ['state', 'region', 'province']);
  const detail = [...new Set([zone, city, region, country].filter((x): x is string => !!x && x !== name))].join(', ') || parts.slice(1, 4).join(', ');
  const category = row.category ?? row.class;
  const type = row.type === 'administrative' && row.addresstype ? row.addresstype : row.type;
  return { name, detail, city, zone: zone && zone !== name ? zone : undefined, country, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, placeType: guessPlaceType(category, type) };
}

export function parseNominatim(rows: unknown): GeoResult[] {
  if (!Array.isArray(rows)) return [];
  const out: GeoResult[] = [];
  for (const r of rows) {
    const g = parseNominatimRow(r as NominatimRow);
    if (g && !out.some((x) => x.name === g.name && x.detail === g.detail)) out.push(g);
  }
  return out;
}

/** Zoom de Nominatim (3 país … 18 edificio) según qué tan cerca está el mapa. */
export function reverseZoom(mapZoom: number): number {
  if (mapZoom < 5) return 3;
  if (mapZoom < 7) return 5;
  if (mapZoom < 9) return 8;
  if (mapZoom < 12) return 10;
  if (mapZoom < 15) return 14;
  return 18;
}

// ---------- Red (1 petición por segundo como máximo, con caché) ----------
const cache = new Map<string, unknown>();
let last = 0;

async function get(url: string): Promise<unknown> {
  if (cache.has(url)) return cache.get(url);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Sin conexión: no se puede buscar ahora.');
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('No se pudo buscar. Revisa tu conexión.');
  }
  if (!res.ok) throw new Error(res.status === 429 ? 'Demasiadas búsquedas seguidas. Espera un momento.' : 'No se pudo buscar. Intenta de nuevo.');
  const json = (await res.json()) as unknown;
  cache.set(url, json);
  return json;
}

/** Busca lugares por nombre o dirección. `near` da preferencia (sin limitar) a lo cercano. */
export async function searchPlaces(query: string, near?: { lat: number; lng: number } | null): Promise<GeoResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '6', 'accept-language': 'es', q });
  if (near) {
    const d = 1.5;
    params.set('viewbox', [near.lng - d, near.lat + d, near.lng + d, near.lat - d].map((n) => n.toFixed(3)).join(','));
  }
  return parseNominatim(await get(`${BASE}/search?${params}`));
}

/** Qué hay en un punto del mapa (ciudad, colonia o lugar, según el zoom). */
export async function reversePlace(lat: number, lng: number, mapZoom: number): Promise<GeoResult | null> {
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', 'accept-language': 'es', lat: lat.toFixed(5), lon: lng.toFixed(5), zoom: String(reverseZoom(mapZoom)) });
  const row = await get(`${BASE}/reverse?${params}`);
  if (!row || typeof row !== 'object' || 'error' in (row as object)) return null;
  const g = parseNominatimRow(row as NominatimRow);
  // El punto es el que tocaste, no el centro de lo que encontró; y sin nombre propio no se inventa uno.
  return g ? { ...g, name: (row as NominatimRow).name?.trim() ? g.name : '', lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : null;
}
