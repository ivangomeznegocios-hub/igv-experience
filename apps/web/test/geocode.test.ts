import { describe, expect, it } from 'vitest';
import { guessPlaceType, parseNominatim, parseNominatimRow, reverseZoom } from '../src/lib/geocode';

describe('buscar lugares (Nominatim)', () => {
  it('convierte un resultado: nombre, dónde está, ciudad y tipo de lugar', () => {
    const disney = parseNominatimRow({
      lat: '33.8120918',
      lon: '-117.9189742',
      name: 'Disneyland Park',
      display_name: 'Disneyland Park, 1313, Disneyland Drive, Anaheim, Orange County, California, 92802, Estados Unidos',
      category: 'tourism',
      type: 'theme_park',
      address: { tourism: 'Disneyland Park', city: 'Anaheim', county: 'Orange County', state: 'California', country: 'Estados Unidos' },
    });
    expect(disney).toEqual({
      name: 'Disneyland Park',
      detail: 'Anaheim, California, Estados Unidos',
      city: 'Anaheim',
      zone: undefined,
      country: 'Estados Unidos',
      lat: 33.81209,
      lng: -117.91897,
      placeType: 'experiencia',
    });
  });

  it('una ciudad es "Ciudad / viaje"; una dirección sin nombre usa la calle, no el número', () => {
    const tokyo = parseNominatimRow({
      lat: '35.68',
      lon: '139.76',
      name: 'Tokio',
      display_name: 'Tokio, Japón',
      category: 'boundary',
      type: 'administrative',
      addresstype: 'city',
      address: { city: 'Tokio', country: 'Japón' },
    });
    expect(tokyo).toMatchObject({ name: 'Tokio', city: 'Tokio', detail: 'Japón', placeType: 'viaje' });
    const addr = parseNominatimRow({
      lat: '20.67',
      lon: '-103.37',
      name: '',
      display_name: '123, Avenida Chapultepec, Americana, Guadalajara, Jalisco, México',
      category: 'place',
      type: 'house',
      address: { house_number: '123', road: 'Avenida Chapultepec', suburb: 'Americana', city: 'Guadalajara', state: 'Jalisco', country: 'México' },
    });
    expect(addr).toMatchObject({ name: 'Avenida Chapultepec 123', zone: 'Americana', city: 'Guadalajara', detail: 'Americana, Guadalajara, Jalisco, México' });
  });

  it('descarta coordenadas inválidas y resultados repetidos', () => {
    expect(parseNominatimRow({ lat: 'x', lon: '1' })).toBeNull();
    expect(parseNominatimRow({ lat: '89', lon: '1' })).toBeNull();
    const row = { lat: '20.6', lon: '-103.3', name: 'Tacos', address: { city: 'Guadalajara' }, category: 'amenity', type: 'fast_food' };
    expect(parseNominatim([row, row, { lat: 'no' }])).toHaveLength(1);
    expect(parseNominatim({ error: 'x' })).toEqual([]);
  });

  it('tipos de lugar y zoom de búsqueda inversa', () => {
    expect(guessPlaceType('amenity', 'restaurant')).toBe('restaurante');
    expect(guessPlaceType('amenity', 'cafe')).toBe('cafe');
    expect(guessPlaceType('natural', 'beach')).toBe('playa');
    expect(guessPlaceType('natural', 'peak')).toBe('naturaleza');
    expect(guessPlaceType('leisure', 'stadium')).toBe('deporte');
    expect(guessPlaceType('shop', 'shoes')).toBe('compras');
    expect(guessPlaceType('highway', 'residential')).toBe('lugar');
    expect(reverseZoom(3)).toBe(3);
    expect(reverseZoom(11)).toBe(10);
    expect(reverseZoom(16)).toBe(18);
  });
});
