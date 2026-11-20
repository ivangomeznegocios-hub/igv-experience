import { placeLayer, type MissionSize, type PlaceData, type PlaceType } from '../types';

/**
 * Catálogo fijo de lugares emblemáticos de Guadalajara y Jalisco (coordenadas aproximadas). En el mapa salen
 * como sugerencias "por conocer"; al visitar uno se crea (o se liga) el lugar del catálogo editable con id
 * `place-<id>`, y cuenta para sus colecciones. Cambiar esta lista recalcula las colecciones (como la config).
 */
export interface CatalogPlace {
  id: string;
  name: string;
  placeType: PlaceType;
  city: string;
  zone?: string;
  lat: number;
  lng: number;
}

export const MAP_CATALOG: readonly CatalogPlace[] = [
  // --- Guadalajara: Centro Histórico ---
  { id: 'gdl-catedral', name: 'Catedral de Guadalajara', placeType: 'cultura', city: 'Guadalajara', zone: 'Centro', lat: 20.6767, lng: -103.3475 },
  { id: 'gdl-palacio-gobierno', name: 'Palacio de Gobierno', placeType: 'museo', city: 'Guadalajara', zone: 'Centro', lat: 20.6759, lng: -103.3461 },
  { id: 'gdl-rotonda', name: 'Rotonda de los Jaliscienses Ilustres', placeType: 'cultura', city: 'Guadalajara', zone: 'Centro', lat: 20.6779, lng: -103.3469 },
  { id: 'gdl-teatro-degollado', name: 'Teatro Degollado', placeType: 'cultura', city: 'Guadalajara', zone: 'Centro', lat: 20.6766, lng: -103.3437 },
  { id: 'gdl-plaza-tapatia', name: 'Plaza Tapatía', placeType: 'cultura', city: 'Guadalajara', zone: 'Centro', lat: 20.6769, lng: -103.3404 },
  { id: 'gdl-hospicio-cabanas', name: 'Hospicio Cabañas', placeType: 'museo', city: 'Guadalajara', zone: 'Centro', lat: 20.6767, lng: -103.3376 },
  { id: 'gdl-san-juan-de-dios', name: 'Mercado San Juan de Dios', placeType: 'compras', city: 'Guadalajara', zone: 'Centro', lat: 20.6744, lng: -103.3368 },
  { id: 'gdl-plaza-mariachis', name: 'Plaza de los Mariachis', placeType: 'cultura', city: 'Guadalajara', zone: 'Centro', lat: 20.6736, lng: -103.3393 },
  { id: 'gdl-expiatorio', name: 'Templo Expiatorio', placeType: 'cultura', city: 'Guadalajara', zone: 'Centro', lat: 20.6737, lng: -103.3594 },
  { id: 'gdl-arena-coliseo', name: 'Arena Coliseo (lucha libre)', placeType: 'experiencia', city: 'Guadalajara', zone: 'Centro', lat: 20.6731, lng: -103.3322 },
  { id: 'gdl-agua-azul', name: 'Parque Agua Azul', placeType: 'parque', city: 'Guadalajara', zone: 'Centro', lat: 20.6609, lng: -103.3497 },
  // --- Guadalajara ---
  { id: 'gdl-minerva', name: 'Glorieta La Minerva', placeType: 'lugar', city: 'Guadalajara', zone: 'Vallarta', lat: 20.6744, lng: -103.3878 },
  { id: 'gdl-arcos', name: 'Los Arcos de Guadalajara', placeType: 'lugar', city: 'Guadalajara', zone: 'Vallarta', lat: 20.6738, lng: -103.3926 },
  { id: 'gdl-chapultepec', name: 'Avenida Chapultepec', placeType: 'bar', city: 'Guadalajara', zone: 'Americana', lat: 20.672, lng: -103.3693 },
  { id: 'gdl-colomos', name: 'Bosque Los Colomos', placeType: 'naturaleza', city: 'Guadalajara', zone: 'Providencia', lat: 20.7066, lng: -103.3934 },
  { id: 'gdl-huentitan', name: 'Barranca de Huentitán', placeType: 'naturaleza', city: 'Guadalajara', zone: 'Huentitán', lat: 20.7346, lng: -103.3183 },
  { id: 'gdl-zoologico', name: 'Zoológico Guadalajara', placeType: 'parque', city: 'Guadalajara', zone: 'Huentitán', lat: 20.7284, lng: -103.3076 },
  { id: 'gdl-estadio-jalisco', name: 'Estadio Jalisco', placeType: 'deporte', city: 'Guadalajara', zone: 'Independencia', lat: 20.705, lng: -103.3277 },
  { id: 'gdl-expo', name: 'Expo Guadalajara (FIL)', placeType: 'evento', city: 'Guadalajara', zone: 'Verde Valle', lat: 20.6528, lng: -103.3917 },
  // --- Zapopan ---
  { id: 'zap-basilica', name: 'Basílica de Zapopan', placeType: 'cultura', city: 'Zapopan', zone: 'Centro', lat: 20.721, lng: -103.3916 },
  { id: 'zap-andares', name: 'Andares', placeType: 'compras', city: 'Zapopan', zone: 'Puerta de Hierro', lat: 20.7104, lng: -103.4118 },
  { id: 'zap-akron', name: 'Estadio Akron', placeType: 'deporte', city: 'Zapopan', zone: 'El Bajío', lat: 20.6818, lng: -103.4626 },
  { id: 'zap-metropolitano', name: 'Parque Metropolitano', placeType: 'parque', city: 'Zapopan', zone: 'Las Águilas', lat: 20.6735, lng: -103.4405 },
  { id: 'zap-primavera', name: 'Bosque La Primavera', placeType: 'naturaleza', city: 'Zapopan', zone: 'La Primavera', lat: 20.646, lng: -103.553 },
  { id: 'zap-auditorio-telmex', name: 'Auditorio Telmex', placeType: 'evento', city: 'Zapopan', zone: 'Los Belenes', lat: 20.7387, lng: -103.3797 },
  // --- Tlaquepaque, Tonalá y Tlajomulco ---
  { id: 'tlq-centro', name: 'Centro de Tlaquepaque', placeType: 'pueblo', city: 'Tlaquepaque', zone: 'Centro', lat: 20.6407, lng: -103.3114 },
  { id: 'ton-centro', name: 'Tianguis de Tonalá', placeType: 'compras', city: 'Tonalá', zone: 'Centro', lat: 20.6237, lng: -103.234 },
  { id: 'tlj-cajititlan', name: 'Cajititlán', placeType: 'pueblo', city: 'Tlajomulco', zone: 'Cajititlán', lat: 20.429, lng: -103.317 },
  // --- Escapadas de Jalisco ---
  { id: 'jal-chapala', name: 'Malecón de Chapala', placeType: 'pueblo', city: 'Chapala', lat: 20.292, lng: -103.1915 },
  { id: 'jal-ajijic', name: 'Ajijic', placeType: 'pueblo', city: 'Chapala', zone: 'Ajijic', lat: 20.299, lng: -103.262 },
  { id: 'jal-tequila', name: 'Tequila', placeType: 'pueblo', city: 'Tequila', lat: 20.8826, lng: -103.8366 },
  { id: 'jal-guachimontones', name: 'Guachimontones', placeType: 'cultura', city: 'Teuchitlán', lat: 20.6945, lng: -103.8356 },
  { id: 'jal-tapalpa', name: 'Tapalpa', placeType: 'pueblo', city: 'Tapalpa', lat: 19.9447, lng: -103.7593 },
  { id: 'jal-mazamitla', name: 'Mazamitla', placeType: 'pueblo', city: 'Mazamitla', lat: 19.916, lng: -103.0197 },
  { id: 'jal-vallarta', name: 'Malecón de Puerto Vallarta', placeType: 'playa', city: 'Puerto Vallarta', lat: 20.61, lng: -105.2354 },
];

export const MAP_CATALOG_BY_ID: ReadonlyMap<string, CatalogPlace> = new Map(MAP_CATALOG.map((p) => [p.id, p]));

/** Ciudades de la zona metropolitana de Guadalajara. */
export const GDL_METRO_CITIES = ['Guadalajara', 'Zapopan', 'Tlaquepaque', 'Tonalá', 'Tlajomulco', 'El Salto'] as const;

export interface MapCollection {
  id: string;
  name: string;
  description: string;
  /** Completarla da la XP de una misión de este tamaño (una vez). */
  size: MissionSize;
  placeIds: string[];
}

const ids = (pred: (p: CatalogPlace) => boolean) => MAP_CATALOG.filter(pred).map((p) => p.id);

export const MAP_COLLECTIONS: readonly MapCollection[] = [
  {
    id: 'gdl-esencial',
    name: 'Guadalajara esencial',
    description: 'Lo imprescindible de la zona metropolitana.',
    size: 'epica',
    placeIds: ids((p) => (GDL_METRO_CITIES as readonly string[]).includes(p.city)),
  },
  {
    id: 'centro-historico',
    name: 'Centro Histórico',
    description: 'De la Catedral al Hospicio Cabañas.',
    size: 'grande',
    placeIds: ['gdl-catedral', 'gdl-palacio-gobierno', 'gdl-rotonda', 'gdl-teatro-degollado', 'gdl-plaza-tapatia', 'gdl-hospicio-cabanas', 'gdl-san-juan-de-dios', 'gdl-plaza-mariachis', 'gdl-expiatorio'],
  },
  {
    id: 'zapopan',
    name: 'Zapopan',
    description: 'Basílica, bosques, estadio y más.',
    size: 'grande',
    placeIds: ids((p) => p.city === 'Zapopan'),
  },
  {
    id: 'naturaleza',
    name: 'Naturaleza tapatía',
    description: 'Bosques, barrancas y parques para salir del concreto.',
    size: 'grande',
    placeIds: ['gdl-colomos', 'gdl-huentitan', 'zap-primavera', 'zap-metropolitano', 'gdl-agua-azul', 'tlj-cajititlan'],
  },
  {
    id: 'en-vivo',
    name: 'Estadios y escenarios',
    description: 'Futbol, lucha libre, conciertos y teatro.',
    size: 'media',
    placeIds: ['zap-akron', 'gdl-estadio-jalisco', 'gdl-arena-coliseo', 'zap-auditorio-telmex', 'gdl-teatro-degollado'],
  },
  {
    id: 'escapadas',
    name: 'Escapadas de Jalisco',
    description: 'Pueblos, lago, sierra y playa a unas horas.',
    size: 'epica',
    placeIds: ids((p) => !(GDL_METRO_CITIES as readonly string[]).includes(p.city)),
  },
];

export const MAP_COLLECTIONS_BY_ID: ReadonlyMap<string, MapCollection> = new Map(MAP_COLLECTIONS.map((c) => [c.id, c]));

/** Id del lugar (catálogo editable) que se crea al visitar un lugar del catálogo fijo. */
export function catalogPlaceEntityId(catalogId: string): string {
  return `place-${catalogId}`;
}

/** Nombre normalizado → id del catálogo fijo. */
const CATALOG_ID_BY_NAME: ReadonlyMap<string, string> = new Map(MAP_CATALOG.map((p) => [mapNormalize(p.name), p.id]));

/**
 * Lugar del catálogo fijo al que corresponde un lugar: por `catalogId`, por su id `place-<id>` o, si no trae
 * ninguno (lugares guardados antes del catálogo, con id al azar), porque se llama exactamente igual que uno
 * del catálogo (solo en la capa vida). Así no se duplica ni vuelve a dar la XP de primera visita.
 */
export function catalogIdOfPlace(placeId: string, data?: Pick<PlaceData, 'catalogId' | 'name' | 'layer' | 'placeType'> | null): string | null {
  if (data?.catalogId && MAP_CATALOG_BY_ID.has(data.catalogId)) return data.catalogId;
  if (placeId.startsWith('place-') && MAP_CATALOG_BY_ID.has(placeId.slice(6))) return placeId.slice(6);
  if (data?.name && placeLayer(data) === 'vida') return CATALOG_ID_BY_NAME.get(mapNormalize(data.name)) ?? null;
  return null;
}

/** Datos del lugar editable a partir del catálogo fijo. */
export function placeFromCatalog(c: CatalogPlace): PlaceData {
  return { name: c.name, placeType: c.placeType, layer: 'vida', city: c.city, zone: c.zone, lat: c.lat, lng: c.lng, catalogId: c.id };
}

/** Minúsculas, sin acentos ni signos (para buscar por nombre). */
export function mapNormalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Busca en el catálogo fijo por nombre (exacto primero; luego contiene / está contenido). */
export function searchMapCatalog(query: string, limit = 8): CatalogPlace[] {
  const q = mapNormalize(query);
  if (!q) return [];
  const exact = MAP_CATALOG.filter((p) => mapNormalize(p.name) === q);
  if (exact.length) return exact;
  const words = q.split(' ').filter((w) => w.length > 2);
  const scored = MAP_CATALOG.map((p) => {
    const n = mapNormalize(`${p.name} ${p.city} ${p.zone ?? ''}`);
    const name = mapNormalize(p.name);
    let score = 0;
    if (name.startsWith(q)) score += 6;
    if (n.includes(q)) score += 4;
    if (q.includes(name)) score += 5;
    for (const w of words) if (n.includes(w)) score += 1;
    return { p, score };
  }).filter((x) => x.score >= Math.min(4, Math.max(1, words.length)));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

/** Liga para abrir el lugar en Google Maps (con coordenadas si las tiene; si no, por nombre y ciudad). */
export function googleMapsUrl(p: Pick<PlaceData, 'name' | 'city' | 'lat' | 'lng'>): string {
  const q = typeof p.lat === 'number' && typeof p.lng === 'number' ? `${p.lat},${p.lng}` : [p.name, p.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Coordenadas válidas (grados). */
export function validMapCoords(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
}

/**
 * Lee coordenadas de texto: "20.6767, -103.3475", "geo:20.67,-103.34" o una liga de Google Maps (el pin
 * …!3d20.67!4d-103.34 primero; si no, …/@20.67,-103.34,15z, que es el centro de la vista, ?q=… o ?query=…).
 * Devuelve null si no encuentra un par válido (p. ej. ligas cortas maps.app.goo.gl, que no traen coordenadas).
 */
export function parseMapCoords(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /^(?:geo|loc):\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/i,
    /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|center)=(-?\d{1,3}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /^(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (validMapCoords(lat, lng)) return { lat, lng };
  }
  return null;
}
