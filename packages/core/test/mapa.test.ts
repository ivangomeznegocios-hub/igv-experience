import { describe, expect, it } from 'vitest';
import {
  EVENT_SCHEMAS,
  GAME_CONFIG,
  MAP_CATALOG,
  MAP_CATALOG_BY_ID,
  MAP_COLLECTIONS,
  VISIT_COMPANIES,
  addDays,
  buildSnapshot,
  catalogPlaceEntityId,
  googleMapsUrl,
  memoryAssistantStore,
  parseMapCoords,
  placeFromCatalog,
  placeLayer,
  project,
  renderOverview,
  runAssistantTool,
  searchMapCatalog,
  validateEvent,
  type Entity,
  type GameEvent,
  type PlaceData,
} from '../src';
import { bySource, ev, run, seed } from './helpers';

const TODAY = '2026-11-19';
const place = (id: string, data: Partial<PlaceData> = {}): Entity<PlaceData> => ({ id, module: 'map', kind: 'place', data: { name: id, placeType: 'lugar', ...data }, sort: 0 });
const visit = (date: string, placeId: string, company = 'solo', extra: Record<string, unknown> = {}) => ev('place.visited', date, { placeId, company, ...extra });
const fromCat = (cid: string): Entity<PlaceData> => ({ id: catalogPlaceEntityId(cid), module: 'map', kind: 'place', data: placeFromCatalog(MAP_CATALOG_BY_ID.get(cid)!), sort: 0 });
const discovery = GAME_CONFIG.rewards.discovery;

describe('mapa: compatibilidad con la versión anterior', () => {
  it('lugares viejos (sin capa ni ciudad) y map.status_changed siguen funcionando igual', () => {
    const old = { id: 'p1', module: 'map', kind: 'place', data: { name: 'Cancún', placeType: 'lugar' }, sort: 0 };
    const s = run(
      [
        ev('map.status_changed', '2026-11-01', { placeId: 'p1', status: 'descubierto' }),
        ev('map.status_changed', '2026-11-02', { placeId: 'p1', status: 'dominado' }),
        ev('map.status_changed', '2026-11-03', { placeId: 'p1', status: 'descubierto' }),
      ],
      '2026-11-05',
      { entities: [...seed, old] },
    );
    expect(bySource(s, 'discovery')).toBe(discovery);
    expect(s.map.places.p1).toMatchObject({ status: 'descubierto', discoveredOn: '2026-11-01', masteredOn: '2026-11-02', visits: 0 });
    expect(s.map.discoveryDates).toEqual(['2026-11-01']);
    expect(s.attributes.values.creatividad.xp).toBe(discovery);
    expect(placeLayer(old.data as PlaceData)).toBe('vida');
    expect(s.map.summary.known).toBe(1);
  });

  it('el esquema de map.status_changed no cambió y place.visited usa las mismas compañías que VISIT_COMPANIES', () => {
    expect(validateEvent({ id: 'evt-00000001', type: 'map.status_changed', occurredAt: '2026-11-01T12:00:00Z', localDate: '2026-11-01', payload: { placeId: 'p1', status: 'dominado' } }).ok).toBe(true);
    expect((EVENT_SCHEMAS['place.visited'].shape.company.options as readonly string[]).slice()).toEqual([...VISIT_COMPANIES]);
    const base = { id: 'evt-00000002', type: 'place.visited', occurredAt: '2026-11-01T12:00:00Z', localDate: '2026-11-01' };
    expect(validateEvent({ ...base, payload: { placeId: 'p1', company: 'pareja', npcIds: ['n1'], note: 'cena', rating: 5 } }).ok).toBe(true);
    expect(validateEvent({ ...base, payload: { placeId: 'p1', company: 'novia' } }).ok).toBe(false);
    expect(validateEvent({ ...base, payload: { placeId: 'p1', company: 'solo', rating: 9 } }).ok).toBe(false);
  });
});

describe('mapa: visitas y estado', () => {
  it('una visita lo vuelve conocido (+XP una vez); con N visitas es habitual', () => {
    const n = GAME_CONFIG.mapa.habitualVisits;
    const events = Array.from({ length: n + 2 }, (_, i) => visit(addDays('2026-10-01', i), 'p1'));
    const s = run(events, TODAY, { entities: [...seed, place('p1')] });
    const st = s.map.places.p1;
    expect(st.visits).toBe(n + 2);
    expect(st.status).toBe('dominado');
    expect(st.discoveredOn).toBe('2026-10-01');
    expect(st.masteredOn).toBe(addDays('2026-10-01', n - 1));
    expect(bySource(s, 'discovery')).toBe(discovery);
    expect(s.xp.ledger.find((e) => e.source === 'discovery')?.label).toBe('Primera visita: p1');

    const one = run([visit('2026-10-01', 'p1')], TODAY, { entities: [...seed, place('p1')] });
    expect(one.map.places.p1.status).toBe('descubierto');
  });

  it('la primera visita da XP una sola vez, venga del evento viejo o de una visita', () => {
    const a = run([ev('map.status_changed', '2026-10-01', { placeId: 'p1', status: 'descubierto' }), visit('2026-10-05', 'p1')], TODAY, { entities: [...seed, place('p1')] });
    const b = run([visit('2026-10-01', 'p1'), ev('map.status_changed', '2026-10-05', { placeId: 'p1', status: 'dominado' })], TODAY, { entities: [...seed, place('p1')] });
    expect(bySource(a, 'discovery')).toBe(discovery);
    expect(bySource(b, 'discovery')).toBe(discovery);
    expect(b.map.places.p1.status).toBe('dominado');
    expect(a.map.discoveryDates).toEqual(['2026-10-01']);
  });

  it('un cambio manual fija el estado; las visitas posteriores lo pueden subir', () => {
    const s = run([visit('2026-10-01', 'p1'), ev('map.status_changed', '2026-10-02', { placeId: 'p1', status: 'inexplorado' })], TODAY, { entities: [...seed, place('p1')] });
    expect(s.map.places.p1.status).toBe('inexplorado');
    expect(s.map.places.p1.discoveredOn).toBe('2026-10-01');
    const t = run([visit('2026-10-01', 'p1'), ev('map.status_changed', '2026-10-02', { placeId: 'p1', status: 'inexplorado' }), visit('2026-10-03', 'p1')], TODAY, { entities: [...seed, place('p1')] });
    expect(t.map.places.p1.status).toBe('descubierto');
    expect(bySource(t, 'discovery')).toBe(discovery);
  });

  it('"Lo has vivido": primeras veces por compañía, personas y calificación', () => {
    const s = run(
      [
        visit('2026-09-01', 'p1', 'solo', { rating: 4 }),
        visit('2026-09-10', 'p1', 'pareja', { npcIds: ['n-ana'], rating: 5 }),
        visit('2026-09-20', 'p1', 'familia', { npcIds: ['n-ana', 'n-sofi'] }),
        visit('2026-09-25', 'p1', 'pareja', { npcIds: ['n-ana'] }),
        visit('2026-09-26', 'p2', 'familia'),
      ],
      TODAY,
      { entities: [...seed, place('p1', { city: 'Zapopan' }), place('p2', { city: 'Guadalajara' })] },
    );
    const st = s.map.places.p1;
    expect(st.firsts).toEqual({ solo: '2026-09-01', pareja: '2026-09-10', familia: '2026-09-20' });
    expect(st.byCompany).toEqual({ solo: 1, pareja: 2, familia: 1 });
    expect(st.people).toEqual(['n-ana', 'n-sofi']);
    expect(st.rating).toBe(4.5);
    expect(s.map.firsts.map((f) => `${f.placeId}:${f.company}`)).toEqual(['p1:solo', 'p1:pareja', 'p1:familia', 'p2:familia']);
    expect(s.map.summary.byCompany).toEqual({ solo: 1, pareja: 1, familia: 2 });
    expect(s.map.summary.cities).toEqual(['Guadalajara', 'Zapopan']);
    expect(s.map.summary.recent[0]).toMatchObject({ placeId: 'p2', company: 'familia' });
    expect(s.map.visits).toHaveLength(5);
  });

  it('visitas anuladas o en el futuro no cuentan', () => {
    const v = visit('2026-10-01', 'p1');
    const s = run([{ ...v, voidedAt: '2026-10-02T00:00:00Z' }, visit('2026-12-01', 'p1')], TODAY, { entities: [...seed, place('p1')] });
    expect(s.map.places.p1).toBeUndefined();
    expect(bySource(s, 'discovery')).toBe(0);
  });
});

describe('mapa: capa empresa', () => {
  it('la primera visita suma a Finanzas y el resumen dice dónde opera la empresa', () => {
    const entities = [
      ...seed,
      place('of', { name: 'Oficina', placeType: 'oficina', layer: 'empresa', city: 'Zapopan', since: '2024-03-01' }),
      place('c1', { name: 'Cliente Uno', placeType: 'cliente', layer: 'empresa', city: 'Guadalajara', npcIds: ['n1'] }),
      place('c2', { name: 'Cliente Dos', placeType: 'cliente', layer: 'empresa', city: 'Guadalajara' }),
      place('c3', { name: 'Cliente viejo', placeType: 'cliente', layer: 'empresa', city: 'Monterrey', active: false }),
      place('x', { name: 'Sin capa pero cliente', placeType: 'cliente' }),
    ];
    const s = run([visit('2026-11-01', 'c1', 'trabajo')], TODAY, { entities });
    expect(s.attributes.values.finanzas.xp).toBe(discovery);
    expect(s.attributes.values.creatividad.xp).toBe(0);
    expect(placeLayer(entities.at(-1)!.data as PlaceData)).toBe('empresa');
    const e = s.map.summary.empresa;
    expect(e.active).toBe(4);
    expect(e.clients).toBe(3);
    expect(e.cities.find((c) => c.city === 'Guadalajara')).toMatchObject({ places: 2, clients: 2 });
    expect(e.cities.find((c) => c.city === 'Zapopan')).toMatchObject({ places: 1, since: '2024-03-01' });
    expect(e.cities.some((c) => c.city === 'Monterrey')).toBe(false);
    // La capa empresa no cuenta en "conocidos" de la vida.
    expect(s.map.summary.known).toBe(0);
  });
});

describe('mapa: catálogo de Jalisco y colecciones', () => {
  it('catálogo sano: ids únicos, coordenadas en Jalisco y colecciones con lugares existentes', () => {
    expect(MAP_CATALOG.length).toBeGreaterThanOrEqual(30);
    expect(MAP_CATALOG.length).toBeLessThanOrEqual(45);
    expect(new Set(MAP_CATALOG.map((p) => p.id)).size).toBe(MAP_CATALOG.length);
    for (const p of MAP_CATALOG) {
      expect(p.lat).toBeGreaterThan(18.9);
      expect(p.lat).toBeLessThan(22.8);
      expect(p.lng).toBeGreaterThan(-105.8);
      expect(p.lng).toBeLessThan(-101.4);
    }
    for (const c of MAP_COLLECTIONS) {
      expect(c.placeIds.length).toBeGreaterThan(2);
      for (const id of c.placeIds) expect(MAP_CATALOG_BY_ID.has(id)).toBe(true);
    }
    expect(MAP_COLLECTIONS.find((c) => c.id === 'gdl-esencial')!.placeIds).toContain('gdl-catedral');
  });

  it('completar una colección da la XP de su tamaño una vez, el día del último lugar', () => {
    const col = MAP_COLLECTIONS.find((c) => c.id === 'en-vivo')!;
    const ents = col.placeIds.map(fromCat);
    const events: GameEvent[] = col.placeIds.map((cid, i) => visit(addDays('2026-10-01', i), catalogPlaceEntityId(cid), 'amigos'));
    events.push(visit('2026-11-01', catalogPlaceEntityId(col.placeIds[0]), 'pareja'));
    const s = run(events, TODAY, { entities: [...seed, ...ents] });
    const c = s.map.collections['en-vivo'];
    expect(c).toMatchObject({ known: col.placeIds.length, total: col.placeIds.length, completedOn: addDays('2026-10-01', col.placeIds.length - 1), xp: GAME_CONFIG.missionXp[col.size] });
    const entries = s.xp.ledger.filter((e) => e.refId === 'collection:en-vivo');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amount: GAME_CONFIG.missionXp[col.size], source: 'discovery', label: 'Colección completa: Estadios y escenarios' });
    // Teatro Degollado también es del Centro Histórico: avanza esa colección.
    expect(s.map.collections['centro-historico'].knownIds).toEqual(['gdl-teatro-degollado']);
    expect(s.map.catalog['zap-akron']).toEqual({ placeId: 'place-zap-akron', discoveredOn: '2026-10-01' });
  });

  it('un lugar propio ligado con catalogId cuenta; uno borrado con id del catálogo también (sus visitas no se pierden)', () => {
    const own = place('place-1234abcd', { name: 'La Cate', catalogId: 'gdl-catedral' });
    const s = run([visit('2026-10-01', own.id), visit('2026-10-02', 'place-gdl-rotonda')], TODAY, { entities: [...seed, own] });
    expect(s.map.collections['centro-historico'].knownIds.sort()).toEqual(['gdl-catedral', 'gdl-rotonda']);
    expect(s.map.catalog['gdl-catedral'].placeId).toBe(own.id);
  });

  it('propiedad: agregar cualquier visita o cambio de estado nunca baja la XP ni los atributos', () => {
    let seedN = 7;
    const r = () => ((seedN = (seedN * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const pool = MAP_COLLECTIONS.find((c) => c.id === 'centro-historico')!.placeIds.concat(MAP_COLLECTIONS.find((c) => c.id === 'en-vivo')!.placeIds);
    const ents = [...new Set(pool)].map(fromCat).concat([place('own-1'), place('emp-1', { placeType: 'cliente', layer: 'empresa' })]);
    const ids = ents.map((e) => e.id);
    const statuses = ['inexplorado', 'descubierto', 'dominado'];
    for (let round = 0; round < 6; round++) {
      const events: GameEvent[] = [];
      let prev = run(events, TODAY, { entities: [...seed, ...ents] });
      for (let i = 0; i < 60; i++) {
        const date = addDays('2026-09-01', Math.floor(r() * 80));
        const pid = ids[Math.floor(r() * ids.length)];
        events.push(
          r() < 0.75
            ? visit(date, pid, VISIT_COMPANIES[Math.floor(r() * VISIT_COMPANIES.length)])
            : ev('map.status_changed', date, { placeId: pid, status: statuses[Math.floor(r() * 3)] }),
        );
        const next = run(events, TODAY, { entities: [...seed, ...ents] });
        expect(next.xp.total).toBeGreaterThanOrEqual(prev.xp.total);
        for (const [k, v] of Object.entries(next.attributes.values)) expect(v.xp).toBeGreaterThanOrEqual(prev.attributes.values[k as keyof typeof next.attributes.values].xp);
        prev = next;
      }
    }
  });
});

describe('mapa: utilidades', () => {
  it('lee coordenadas de texto y de ligas de Google Maps', () => {
    expect(parseMapCoords('20.6767, -103.3475')).toEqual({ lat: 20.6767, lng: -103.3475 });
    expect(parseMapCoords('https://www.google.com/maps/place/Catedral/@20.6767,-103.3475,17z/data=x')).toEqual({ lat: 20.6767, lng: -103.3475 });
    expect(parseMapCoords('https://maps.google.com/?q=20.67,-103.34')).toEqual({ lat: 20.67, lng: -103.34 });
    expect(parseMapCoords('no es coordenada')).toBeNull();
    expect(parseMapCoords('200, 500')).toBeNull();
  });

  it('busca en el catálogo y arma la liga a Google Maps', () => {
    expect(searchMapCatalog('catedral')[0].id).toBe('gdl-catedral');
    expect(searchMapCatalog('Hospicio Cabañas')[0].id).toBe('gdl-hospicio-cabanas');
    expect(searchMapCatalog('colomos')[0].id).toBe('gdl-colomos');
    expect(searchMapCatalog('Café Palreal')).toEqual([]);
    expect(googleMapsUrl({ name: 'X', lat: 20.5, lng: -103.1 })).toBe('https://www.google.com/maps/search/?api=1&query=20.5%2C-103.1');
    expect(googleMapsUrl({ name: 'Café X', city: 'Zapopan' })).toContain('Caf%C3%A9%20X%2C%20Zapopan');
  });
});

// ---------------------------------------------------------------------------------------------
// Herramientas de IA
// ---------------------------------------------------------------------------------------------

const npc = (id: string, name: string): Entity => ({ id, module: 'npcs', kind: 'npc', data: { name, npcType: 'party', relation: 5, key: true }, sort: 0 });
const people = [npc('n-ana', 'Ana López'), npc('n-sofi', 'Sofía'), npc('n-sofi2', 'Sofía Pérez')];
const mk = (events: GameEvent[] = [], entities: Entity[] = [...seed, ...people]) => memoryAssistantStore({ events, entities, today: TODAY });
const call = (store: ReturnType<typeof mk>, name: string, input: unknown, allowWrites = true) => runAssistantTool(name, input, store, { allowWrites });
const stateOf = (store: ReturnType<typeof mk>) => project({ events: store.allEvents(), entities: store.allEntities(), today: TODAY });

describe('mapa: herramientas de IA', () => {
  it('registrar_visita a un lugar emblemático lo crea ligado al catálogo, con personas por nombre', async () => {
    const store = mk();
    const r = await call(store, 'registrar_visita', { lugar: 'Hospicio Cabañas', compania: 'pareja', personas: ['Ana'] });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Primera visita');
    expect(r.text).toContain('Centro Histórico: 1/9');
    const ent = store.allEntities().find((e) => e.id === 'place-gdl-hospicio-cabanas')!;
    expect(ent.data).toMatchObject({ name: 'Hospicio Cabañas', catalogId: 'gdl-hospicio-cabanas', layer: 'vida', city: 'Guadalajara' });
    const [e] = store.allEvents();
    expect(e).toMatchObject({ type: 'place.visited', localDate: TODAY, payload: { placeId: ent.id, company: 'pareja', npcIds: ['n-ana'] } });
    expect(r.refs?.events).toEqual([e.id]);
    expect(r.refs?.entities.map((x) => x.id)).toEqual([ent.id]);
    const s = stateOf(store);
    expect(s.map.places[ent.id].status).toBe('descubierto');
    expect(bySource(s, 'discovery')).toBe(discovery);

    // Segunda vez (otro día, en familia): sin XP de primera visita; mismo día y compañía: no duplica.
    const r2 = await call(store, 'registrar_visita', { lugar: 'gdl-hospicio-cabanas', compania: 'familia', fecha: '2026-11-18' });
    expect(r2.text).toContain('Primera vez en familia');
    expect(r2.refs?.entities).toEqual([]);
    const r3 = await call(store, 'registrar_visita', { lugar: 'place-gdl-hospicio-cabanas', compania: 'pareja' });
    expect(r3.text).toContain('ya estaba registrada');
    expect(store.allEvents()).toHaveLength(2);
  });

  it('un lugar que no existe se crea; personas desconocidas o ambiguas dan error claro', async () => {
    const store = mk();
    const r = await call(store, 'registrar_visita', { lugar: 'Café Palreal', compania: 'amigos', tipo: 'cafe', ciudad: 'Guadalajara', zona: 'Lafayette', calificacion: 5 });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('lugar nuevo');
    const ent = store.allEntities().find((x) => x.module === 'map')!;
    expect(ent.data).toMatchObject({ name: 'Café Palreal', placeType: 'cafe', layer: 'vida', city: 'Guadalajara', zone: 'Lafayette' });
    expect(ent.data.catalogId).toBeUndefined();
    const again = await call(store, 'registrar_visita', { lugar: 'cafe palreal', compania: 'solo', fecha: '2026-11-10' });
    expect(again.text).not.toContain('lugar nuevo');
    expect(store.allEntities().filter((x) => x.module === 'map')).toHaveLength(1);

    const bad = await call(store, 'registrar_visita', { lugar: 'Café Palreal', compania: 'pareja', personas: ['Mariana'] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Mariana');
    const amb = await call(store, 'registrar_visita', { lugar: 'Café Palreal', compania: 'familia', personas: ['Sofía'] });
    expect(amb.isError).toBeFalsy(); // "Sofía" exacto gana sobre "Sofía Pérez"
    const fut = await call(store, 'registrar_visita', { lugar: 'Café Palreal', compania: 'solo', fecha: '2026-12-01' });
    expect(fut.isError).toBe(true);
  });

  it('guardar_lugar crea lugares de la empresa, edita por id y marca el estado a mano', async () => {
    const store = mk();
    const a = await call(store, 'guardar_lugar', { nombre: 'Oficina Providencia', tipo: 'oficina', ciudad: 'Guadalajara', lat: 20.69, lng: -103.38, desde: '2024-01-15' });
    expect(a.isError).toBeFalsy();
    const of = store.allEntities().find((x) => x.module === 'map')!;
    expect(of.data).toMatchObject({ layer: 'empresa', placeType: 'oficina', lat: 20.69, lng: -103.38, since: '2024-01-15' });
    const b = await call(store, 'guardar_lugar', { nombre: 'Cliente Andares', tipo: 'cliente', ciudad: 'Zapopan', personas: ['Ana López'] });
    const cl = store.allEntities().find((x) => x.module === 'map' && x.id !== of.id)!;
    expect(cl.data).toMatchObject({ layer: 'empresa', npcIds: ['n-ana'] });
    expect(b.refs?.entities[0].prev).toBeNull();

    const dup = await call(store, 'guardar_lugar', { nombre: 'oficina providencia' });
    expect(dup.isError).toBe(true);
    const half = await call(store, 'guardar_lugar', { id: of.id, lat: 20.7 });
    expect(half.isError).toBe(true);

    const edit = await call(store, 'guardar_lugar', { id: of.id, activo: false, estado: 'habitual' });
    expect(edit.isError).toBeFalsy();
    expect(edit.text).toContain('primera visita');
    const after = store.allEntities().find((x) => x.id === of.id)!;
    expect(after.data).toMatchObject({ name: 'Oficina Providencia', active: false, layer: 'empresa' });
    expect(edit.refs?.entities[0].prev?.data.active).toBeUndefined();
    const s = stateOf(store);
    expect(s.map.places[of.id].status).toBe('dominado');
    expect(s.attributes.values.finanzas.xp).toBe(discovery);

    const cat = await call(store, 'guardar_lugar', { nombre: 'Bosque Los Colomos' });
    expect(cat.text).toContain('catálogo de Jalisco');
    expect(store.allEntities().find((x) => x.id === 'place-gdl-colomos')?.data).toMatchObject({ catalogId: 'gdl-colomos', lat: 20.7066 });
  });

  it('ver_mapa lista lugares, colecciones, sugerencias y la empresa; el panorama incluye el mapa', async () => {
    const store = mk([visit('2026-11-01', 'place-gdl-catedral', 'familia', { npcIds: ['n-sofi'] })], [...seed, ...people, fromCat('gdl-catedral'), place('emp', { name: 'Bodega', placeType: 'proveedor', layer: 'empresa', city: 'Tlaquepaque' })]);
    const v = await call(store, 'ver_mapa', { sugerencias: true });
    expect(v.text).toContain('[place-gdl-catedral] Catedral de Guadalajara');
    expect(v.text).toContain('en familia');
    expect(v.text).toContain('con Sofía');
    expect(v.text).toContain('Centro Histórico 1/9');
    expect(v.text).toContain('[gdl-hospicio-cabanas] Hospicio Cabañas');
    expect(v.text).not.toContain('[gdl-catedral] Catedral');
    const e = await call(store, 'ver_mapa', { capa: 'empresa' });
    expect(e.text).toContain('Opera en: Tlaquepaque');
    expect(e.text).toContain('Proveedor:');
    const snap = await store.snapshot();
    expect(snap.mapa?.known).toBe(1);
    expect(renderOverview(snap)).toContain('## Mapa');
    const state = project({ events: store.allEvents(), entities: store.allEntities(), today: TODAY });
    expect(buildSnapshot(state, store.allEntities(), { version: 1, computedBy: 'app' }).mapa?.collections.length).toBe(MAP_COLLECTIONS.length);
  });

  it('en solo lectura registrar_visita y guardar_lugar se niegan', async () => {
    const store = mk();
    expect((await call(store, 'registrar_visita', { lugar: 'Catedral', compania: 'solo' }, false)).isError).toBe(true);
    expect((await call(store, 'guardar_lugar', { nombre: 'X' }, false)).isError).toBe(true);
    expect(store.allEvents()).toHaveLength(0);
    expect((await call(store, 'ver_mapa', {}, false)).isError).toBeFalsy();
  });
});
