import { useMemo, useRef, useState } from 'react';
import {
  EMPRESA_PLACE_TYPES,
  GAME_CONFIG,
  GDL_METRO_CITIES,
  MAP_CATALOG_BY_ID,
  MAP_COLLECTIONS,
  MAP_COLLECTIONS_BY_ID,
  PLACE_STATUS_NAMES,
  PLACE_TYPE_NAMES,
  VISIT_COMPANIES,
  VISIT_COMPANY_NAMES,
  catalogIdOfPlace,
  diffDays,
  googleMapsUrl,
  mapNormalize,
  placeLayer,
  type CatalogPlace,
  type Entity,
  type NpcData,
  type PlaceData,
  type PlaceLayer,
  type PlaceStatus,
  type VisitCompany,
} from '@igv/core';
import { addEvent, restoreEvent, useGame, voidEvent } from '../data/store';
import { daysAgo, fmtDate } from '../lib/time';
import { Icon } from '../ui/icons';
import { Badge, Bar, Empty, PageHeader, Tabs, toast, undoToast } from '../ui/kit';
import { MapView, corePoints, type MapMarker } from '../ui/mapa/MapView';
import { PlaceForm, VisitSheet } from '../ui/mapa/forms';
import { STATUS_TONE, getMapaPrefs, getPosition, hasCoords, markerKind, pendingCatalog, saveWish, setMapaPrefs, statusOf, whereText, type VisitTarget } from '../ui/mapa/model';
import '../styles/mapa.css';

type Sel = { kind: 'place' | 'catalog'; id: string } | null;
const MAIN_COMPANIES: VisitCompany[] = ['solo', 'pareja', 'familia', 'amigos'];
const EMPRESA_GROUP: Record<string, string> = { oficina: 'Oficinas', sucursal: 'Sucursales', cliente: 'Clientes', proveedor: 'Proveedores', zona: 'Zonas de operación' };
const cityKey = (c?: string | null) => mapNormalize(c ?? '');

export default function Mapa() {
  const { list, state, byId } = useGame();
  const today = state.today;
  const prefs0 = useMemo(getMapaPrefs, []);
  const [layer, setLayerS] = useState<PlaceLayer>(prefs0.layer);
  const [tiles, setTilesS] = useState(prefs0.tiles);
  const [suggest, setSuggestS] = useState(prefs0.suggest);
  const [company, setCompany] = useState<VisitCompany | 'todo'>('todo');
  const [etype, setEtype] = useState<string>('todo');
  const [city, setCity] = useState('');
  const [collection, setCollection] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [visit, setVisit] = useState<{ preset: VisitTarget | null; company?: VisitCompany } | null>(null);
  const [form, setForm] = useState<{ initial?: Entity<PlaceData> } | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; z?: number; key: number } | null>(null);
  const [q, setQ] = useState('');
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const setLayer = (l: PlaceLayer) => {
    setLayerS(l);
    setSel(null);
    setCity('');
    setCollection(null);
    setMapaPrefs({ layer: l });
  };
  const setTiles = (v: boolean) => (setTilesS(v), setMapaPrefs({ tiles: v }));
  const setSuggest = (v: boolean) => (setSuggestS(v), setMapaPrefs({ suggest: v }));

  const all = list<PlaceData>('map', 'place');
  const ids = useMemo(() => new Set(all.map((p) => p.id)), [all]);
  const inLayer = all.filter((p) => placeLayer(p.data) === layer);
  const col = collection ? MAP_COLLECTIONS_BY_ID.get(collection) ?? null : null;
  const st = (id: string) => state.map.places[id];

  const cities = useMemo(() => {
    const count = new Map<string, { name: string; n: number }>();
    for (const p of inLayer) {
      const name = p.data.city?.trim();
      if (!name) continue;
      const k = cityKey(name);
      const row = count.get(k) ?? { name, n: 0 };
      row.n++;
      count.set(k, row);
    }
    return [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'es'));
  }, [inLayer]);

  const filtered = inLayer.filter(
    (p) =>
      (!city || cityKey(p.data.city) === cityKey(city)) &&
      (layer === 'vida' ? company === 'todo' || !!st(p.id)?.firsts[company] : etype === 'todo' || p.data.placeType === etype) &&
      (!col || col.placeIds.includes(catalogIdOfPlace(p.id, p.data) ?? '')),
  );
  const pending = layer === 'vida' && company === 'todo' && (suggest || col) ? pendingCatalog(state, ids).filter((c) => (!city || cityKey(c.city) === cityKey(city)) && (!col || col.placeIds.includes(c.id))) : [];

  const markers: MapMarker[] = [
    ...filtered.filter((p) => hasCoords(p.data)).map((p) => ({ id: p.id, lat: p.data.lat!, lng: p.data.lng!, kind: markerKind(p, statusOf(state, p.id)), label: p.data.name })),
    ...pending.map((c) => ({ id: `cat:${c.id}`, lat: c.lat, lng: c.lng, kind: 'suggest' as const, label: c.name })),
  ];
  // Encuadre: tus lugares; sin lugares, las sugerencias de la zona metropolitana (no todo Jalisco).
  const mineOnMap = markers.filter((m) => m.kind !== 'suggest' && m.kind !== 'inactive');
  const fitTo = col || city ? markers : mineOnMap.length ? corePoints(mineOnMap) : markers.filter((m) => (GDL_METRO_CITIES as readonly string[]).includes(MAP_CATALOG_BY_ID.get(m.id.slice(4))?.city ?? ''));
  const fitKey = `${layer}|${company}|${etype}|${city}|${collection}|${suggest}|${mineOnMap.length > 0}`;

  const selPlace = sel?.kind === 'place' ? (all.find((p) => p.id === sel.id) ?? null) : null;
  const selCatalog = sel?.kind === 'catalog' ? (MAP_CATALOG_BY_ID.get(sel.id) ?? null) : null;

  const select = (id: string) => setSel(id.startsWith('cat:') ? { kind: 'catalog', id: id.slice(4) } : { kind: 'place', id });
  const showOnMap = (p: { id: string; lat?: number | null; lng?: number | null }, kind: 'place' | 'catalog' = 'place') => {
    setSel({ kind, id: p.id });
    if (typeof p.lat === 'number' && typeof p.lng === 'number') setFocus({ lat: p.lat, lng: p.lng, z: 15, key: Date.now() });
    mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const locate = async () => {
    try {
      const p = await getPosition();
      setMe(p);
      setFocus({ ...p, z: 14, key: Date.now() });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const sum = state.map.summary;
  const eyebrow =
    layer === 'vida'
      ? `${sum.known} ${sum.known === 1 ? 'conocido' : 'conocidos'} · ${sum.habitual} ${sum.habitual === 1 ? 'habitual' : 'habituales'}`
      : sum.empresa.active
        ? `Opera en ${sum.empresa.cities.length} ${sum.empresa.cities.length === 1 ? 'ciudad' : 'ciudades'}`
        : 'Mi empresa';

  return (
    <div className="mapa">
      <PageHeader
        title="Mapa"
        eyebrow={eyebrow}
        right={
          layer === 'vida' ? (
            <button className="btn sm primary" onClick={() => setVisit({ preset: null })}>
              <Icon name="pin" /> Fui a…
            </button>
          ) : (
            <button className="btn sm primary" onClick={() => setForm({})}>
              <Icon name="plus" /> Lugar
            </button>
          )
        }
      />

      <Tabs
        value={layer}
        onChange={setLayer}
        options={[
          { value: 'vida', label: 'Mi vida' },
          { value: 'empresa', label: 'Mi empresa' },
        ]}
      />

      <div className="card mapa-card" ref={mapRef}>
        <MapView
          markers={markers}
          fitTo={fitTo}
          fitAllTo={col || city || !mineOnMap.length ? markers : mineOnMap}
          selectedId={sel ? (sel.kind === 'catalog' ? `cat:${sel.id}` : sel.id) : null}
          onSelect={select}
          fitKey={fitKey}
          focus={focus}
          tiles={tiles}
          me={me}
          onLocate={locate}
          height="min(58vh, 430px)"
          ariaLabel={layer === 'vida' ? 'Mapa de lugares que conoces' : 'Mapa de tu empresa'}
        />
        <div className="mapa-foot">
          <div className="mapa-legend">
            {layer === 'vida' ? (
              <>
                <span>
                  <i className="mk-habitual" /> Habitual
                </span>
                <span>
                  <i className="mk-known" /> Conocido
                </span>
                <span>
                  <i className="mk-todo" /> Por conocer
                </span>
                {pending.length > 0 && (
                  <span>
                    <i className="mk-suggest" /> Sugerencia
                  </span>
                )}
              </>
            ) : (
              <>
                <span>
                  <i className="mk-oficina" /> Oficina / sucursal
                </span>
                <span>
                  <i className="mk-cliente" /> Cliente
                </span>
                <span>
                  <i className="mk-proveedor" /> Proveedor
                </span>
                <span>
                  <i className="mk-zona" /> Zona
                </span>
              </>
            )}
          </div>
          <div className="mapa-toggles">
            {layer === 'vida' && (
              <button type="button" className={`chip ${suggest ? 'on' : ''}`} aria-pressed={suggest} onClick={() => setSuggest(!suggest)}>
                Sugerencias
              </button>
            )}
            <button type="button" className={`chip ${tiles ? 'on' : ''}`} aria-pressed={tiles} onClick={() => setTiles(!tiles)}>
              Calles
            </button>
          </div>
        </div>
      </div>

      {selPlace && (
        <PlaceCard
          place={selPlace}
          byId={byId}
          today={today}
          onVisit={() => setVisit({ preset: { kind: 'place', place: selPlace }, company: placeLayer(selPlace.data) === 'empresa' ? 'trabajo' : undefined })}
          onEdit={() => setForm({ initial: selPlace })}
          onClose={() => setSel(null)}
        />
      )}
      {selCatalog && (
        <CatalogCard
          place={selCatalog}
          knownOn={state.map.catalog[selCatalog.id]?.discoveredOn ?? null}
          onVisit={() => setVisit({ preset: { kind: 'catalog', place: selCatalog } })}
          onWish={() => {
            const id = saveWish(selCatalog, state);
            setSel({ kind: 'place', id });
          }}
          onClose={() => setSel(null)}
        />
      )}

      <div className="mapa-filters">
        {layer === 'vida' ? (
          <>
            <button type="button" className={`chip ${company === 'todo' ? 'on' : ''}`} onClick={() => setCompany('todo')}>
              Todo
            </button>
            {VISIT_COMPANIES.filter((c) => MAIN_COMPANIES.includes(c) || sum.byCompany[c]).map((c) => (
              <button key={c} type="button" className={`chip ${company === c ? 'on' : ''}`} onClick={() => setCompany(company === c ? 'todo' : c)}>
                {VISIT_COMPANY_NAMES[c]}
                {sum.byCompany[c] ? <small>{sum.byCompany[c]}</small> : null}
              </button>
            ))}
          </>
        ) : (
          <>
            <button type="button" className={`chip ${etype === 'todo' ? 'on' : ''}`} onClick={() => setEtype('todo')}>
              Todo
            </button>
            {EMPRESA_PLACE_TYPES.filter((t) => inLayer.some((p) => p.data.placeType === t)).map((t) => (
              <button key={t} type="button" className={`chip ${etype === t ? 'on' : ''}`} onClick={() => setEtype(etype === t ? 'todo' : t)}>
                {EMPRESA_GROUP[t]}
              </button>
            ))}
          </>
        )}
        {cities.length > 1 && (
          <select className="input mapa-city" value={city} onChange={(e) => setCity(e.target.value)} aria-label="Ciudad">
            <option value="">Todas las ciudades</option>
            {cities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.n})
              </option>
            ))}
          </select>
        )}
        {col && (
          <button type="button" className="chip on" onClick={() => setCollection(null)}>
            {col.name} <Icon name="x" width={12} />
          </button>
        )}
      </div>

      {layer === 'vida' ? (
        <VidaSections
          places={inLayer}
          filtered={filtered}
          q={q}
          setQ={setQ}
          collection={collection}
          setCollection={(c) => {
            setCollection(c);
            setSel(null);
            if (c) mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          setCompany={setCompany}
          onShow={showOnMap}
          onVisit={(t) => setVisit({ preset: t })}
          onNew={() => setForm({})}
        />
      ) : (
        <EmpresaSections places={filtered} total={inLayer.length} byId={byId} onShow={showOnMap} onNew={() => setForm({})} setCity={setCity} />
      )}

      {visit && <VisitSheet preset={visit.preset} presetCompany={visit.company} today={today} onClose={() => setVisit(null)} />}
      {form && <PlaceForm initial={form.initial} layer={layer} onClose={() => setForm(null)} onSaved={(id) => setSel({ kind: 'place', id })} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Tarjeta del lugar seleccionado
// ---------------------------------------------------------------------------------------------

function PlaceCard({ place, byId, today, onVisit, onEdit, onClose }: { place: Entity<PlaceData>; byId: Map<string, Entity>; today: string; onVisit: () => void; onEdit: () => void; onClose: () => void }) {
  const { state } = useGame();
  const s = state.map.places[place.id];
  const status: PlaceStatus = s?.status ?? 'inexplorado';
  const empresa = placeLayer(place.data) === 'empresa';
  const visits = state.map.visits.filter((v) => v.placeId === place.id).slice(-4).reverse();
  const people = [...new Set([...(s?.people ?? []), ...(place.data.npcIds ?? [])])].map((id) => (byId.get(id)?.data as NpcData | undefined)?.name).filter(Boolean);
  const cid = catalogIdOfPlace(place.id, place.data);
  const inCollections = cid ? MAP_COLLECTIONS.filter((c) => c.placeIds.includes(cid)) : [];
  const lived = VISIT_COMPANIES.filter((c) => MAIN_COMPANIES.includes(c) || s?.firsts[c]);
  const name = (id: string) => (byId.get(id)?.data as NpcData | undefined)?.name ?? '';

  return (
    <div className="card mapa-sel">
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div className="grow">
          <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
            <Badge>{PLACE_TYPE_NAMES[place.data.placeType] ?? place.data.placeType}</Badge>
            {empresa ? place.data.active === false ? <Badge tone="red">Ya no opera</Badge> : <Badge tone="gold">Activo</Badge> : <Badge tone={STATUS_TONE[status]}>{PLACE_STATUS_NAMES[status]}</Badge>}
            {!hasCoords(place.data) && <Badge>Sin ubicación</Badge>}
          </div>
          <h2 style={{ margin: 0 }}>{place.data.name}</h2>
          {whereText(place.data) && <div className="small muted">{whereText(place.data)}</div>}
        </div>
        <button className="btn icon ghost" aria-label="Cerrar" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>

      <div className="mapa-facts">
        {s?.discoveredOn ? (
          <span>
            Primera visita <b>{fmtDate(s.discoveredOn, true)}</b>
          </span>
        ) : (
          <span>{empresa ? 'Sin visitas registradas' : `Primera visita: +${GAME_CONFIG.rewards.discovery} XP`}</span>
        )}
        {!!s?.visits && (
          <span>
            <b>{s.visits}</b> {s.visits === 1 ? 'visita' : 'visitas'} · última {daysAgo(diffDays(s.lastVisit!, today))}
          </span>
        )}
        {status === 'descubierto' && !empresa && (
          <span>
            Habitual con {GAME_CONFIG.mapa.habitualVisits} visitas ({s?.visits ?? 0}/{GAME_CONFIG.mapa.habitualVisits})
          </span>
        )}
        {s?.rating && (
          <span>
            <Icon name="star" width={13} className="gold" /> <b>{s.rating}</b>
          </span>
        )}
        {empresa && place.data.since && <span>Desde {fmtDate(place.data.since, true)}</span>}
      </div>

      {!empresa && (
        <div className="mapa-lived" aria-label="Lo has vivido">
          {lived.map((c) => (
            <span key={c} className={s?.firsts[c] ? 'on' : ''} title={s?.firsts[c] ? `Primera vez ${VISIT_COMPANY_NAMES[c].toLowerCase()}: ${fmtDate(s.firsts[c]!, true)}` : undefined}>
              {s?.firsts[c] && <Icon name="check" width={12} />}
              {VISIT_COMPANY_NAMES[c]}
            </span>
          ))}
        </div>
      )}
      {people.length > 0 && (
        <div className="small" style={{ marginTop: 8 }}>
          <span className="muted">{empresa ? 'Contactos: ' : 'Con: '}</span>
          {people.join(', ')}
        </div>
      )}
      {inCollections.length > 0 && <div className="tiny muted" style={{ marginTop: 6 }}>Colecciones: {inCollections.map((c) => c.name).join(' · ')}</div>}
      {place.data.notes && <p className="small muted" style={{ margin: '8px 0 0' }}>{place.data.notes}</p>}

      {visits.length > 0 && (
        <div className="mapa-visits">
          {visits.map((v) => (
            <div key={v.id} className="mapa-visit">
              <span className="grow">
                <b>{fmtDate(v.date, v.date.slice(0, 4) !== today.slice(0, 4))}</b> · {VISIT_COMPANY_NAMES[v.company].toLowerCase()}
                {v.npcIds.length ? ` con ${v.npcIds.map(name).filter(Boolean).join(', ')}` : ''}
                {v.rating ? ` · ${v.rating}★` : ''}
                {v.note ? <small> · {v.note}</small> : null}
              </span>
              <button
                type="button"
                className="btn icon ghost sm"
                aria-label="Anular visita"
                onClick={() => {
                  voidEvent(v.id);
                  undoToast('Visita anulada', () => restoreEvent(v.id));
                }}
              >
                <Icon name="x" width={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn primary" onClick={onVisit}>
          <Icon name="pin" /> {s?.visits ? 'Registrar visita' : 'Ya fui'}
        </button>
        {status === 'descubierto' && !empresa && (
          <button
            className="btn"
            onClick={() => {
              const ev = addEvent('map.status_changed', { placeId: place.id, status: 'dominado' });
              undoToast(`"${place.data.name}" ya es habitual`, () => voidEvent(ev.id));
            }}
          >
            <Icon name="check" /> Habitual
          </button>
        )}
        <a className="btn" href={googleMapsUrl(place.data)} target="_blank" rel="noreferrer">
          <Icon name="external" /> Google Maps
        </a>
        <button className="btn icon ghost" aria-label="Editar" onClick={onEdit}>
          <Icon name="edit" />
        </button>
      </div>
    </div>
  );
}

function CatalogCard({ place, knownOn, onVisit, onWish, onClose }: { place: CatalogPlace; knownOn: string | null; onVisit: () => void; onWish: () => void; onClose: () => void }) {
  const cols = MAP_COLLECTIONS.filter((c) => c.placeIds.includes(place.id));
  return (
    <div className="card mapa-sel">
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div className="grow">
          <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
            <Badge>{PLACE_TYPE_NAMES[place.placeType]}</Badge>
            {knownOn ? <Badge tone={STATUS_TONE.descubierto}>{PLACE_STATUS_NAMES.descubierto}</Badge> : <Badge>{PLACE_STATUS_NAMES.inexplorado}</Badge>}
          </div>
          <h2 style={{ margin: 0 }}>{place.name}</h2>
          <div className="small muted">{whereText(place)}</div>
        </div>
        <button className="btn icon ghost" aria-label="Cerrar" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>
        {knownOn ? `Conocido desde ${fmtDate(knownOn, true)}` : `Primera visita: +${GAME_CONFIG.rewards.discovery} XP`} · Cuenta para {cols.map((c) => c.name).join(' y ')}
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn primary" onClick={onVisit}>
          <Icon name="pin" /> Ya fui
        </button>
        <button className="btn" onClick={onWish}>
          <Icon name="flag" /> Quiero ir
        </button>
        <a className="btn" href={googleMapsUrl(place)} target="_blank" rel="noreferrer">
          <Icon name="external" /> Google Maps
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Capa vida
// ---------------------------------------------------------------------------------------------

function VidaSections({
  places,
  filtered,
  q,
  setQ,
  collection,
  setCollection,
  setCompany,
  onShow,
  onVisit,
  onNew,
}: {
  places: Entity<PlaceData>[];
  filtered: Entity<PlaceData>[];
  q: string;
  setQ: (q: string) => void;
  collection: string | null;
  setCollection: (c: string | null) => void;
  setCompany: (c: VisitCompany) => void;
  onShow: (p: { id: string; lat?: number | null; lng?: number | null }, kind?: 'place' | 'catalog') => void;
  onVisit: (t: VisitTarget) => void;
  onNew: () => void;
}) {
  const { state, byId } = useGame();
  const sum = state.map.summary;
  const n = mapNormalize(q);
  const shown = filtered.filter((p) => !n || mapNormalize(`${p.data.name} ${p.data.zone ?? ''} ${p.data.city ?? ''}`).includes(n));
  const firsts = state.map.firsts.filter((f) => f.company !== 'otro' && byId.has(f.placeId) && placeLayer((byId.get(f.placeId)!.data as PlaceData) ?? null) === 'vida').slice(-5).reverse();

  return (
    <>
      <div className="mapa-stats">
        <Stat n={sum.known} label="conocidos" tone="teal" />
        <Stat n={sum.habitual} label="habituales" tone="gold" />
        <Stat n={sum.toKnow} label="por conocer" />
        <Stat n={sum.cities.length} label={sum.cities.length === 1 ? 'ciudad' : 'ciudades'} />
      </div>

      <div className="section-title">Colecciones</div>
      <div className="card">
        {MAP_COLLECTIONS.map((c) => {
          const cs = state.map.collections[c.id];
          const open = collection === c.id;
          return (
            <div key={c.id} className={`mapa-col ${open ? 'open' : ''}`}>
              <button type="button" className="mapa-col-head" onClick={() => setCollection(open ? null : c.id)} aria-expanded={open}>
                <span className="grow">
                  <b>{c.name}</b>
                  <small>
                    Conoces {cs?.known ?? 0} de {c.placeIds.length}
                    {cs?.completedOn ? ` · completa el ${fmtDate(cs.completedOn, true)}` : ` · +${GAME_CONFIG.missionXp[c.size]} XP al completarla`}
                  </small>
                </span>
                <Icon name={open ? 'up' : 'down'} width={16} className="muted" />
              </button>
              <Bar value={cs?.known ?? 0} max={c.placeIds.length} tone={cs?.completedOn ? undefined : 'teal'} size="sm" />
              {open && (
                <div className="mapa-col-items">
                  {c.placeIds.map((cid) => {
                    const cat = MAP_CATALOG_BY_ID.get(cid)!;
                    const link = state.map.catalog[cid];
                    const ent = link && byId.has(link.placeId) ? (byId.get(link.placeId) as Entity<PlaceData>) : null;
                    const known = !!link?.discoveredOn;
                    return (
                      <div key={cid} className="item">
                        <i className={`mapa-dot ${known ? (state.map.places[link!.placeId]?.status === 'dominado' ? 'mk-habitual' : 'mk-known') : ent ? 'mk-todo' : 'mk-suggest'}`} />
                        <button type="button" className="grow mapa-link" onClick={() => (ent ? onShow({ id: ent.id, lat: ent.data.lat, lng: ent.data.lng }) : onShow({ id: cid, lat: cat.lat, lng: cat.lng }, 'catalog'))}>
                          <span className="item-title">{cat.name}</span>
                          <small className="muted">{known ? `Conocido desde ${fmtDate(link!.discoveredOn, true)}` : whereText(cat)}</small>
                        </button>
                        {!known && (
                          <button type="button" className="btn sm" onClick={() => onVisit(ent ? { kind: 'place', place: ent } : { kind: 'catalog', place: cat })}>
                            Ya fui
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {(sum.known > 0 || firsts.length > 0) && (
        <>
          <div className="section-title">Lo has vivido</div>
          <div className="card">
            <div className="mapa-companies">
              {VISIT_COMPANIES.filter((c) => MAIN_COMPANIES.includes(c) || sum.byCompany[c]).map((c) => (
                <button key={c} type="button" onClick={() => setCompany(c)}>
                  <b>{sum.byCompany[c] ?? 0}</b>
                  <span>{VISIT_COMPANY_NAMES[c]}</span>
                </button>
              ))}
            </div>
            {firsts.length > 0 && (
              <div className="mapa-firsts">
                {firsts.map((f) => {
                  const p = byId.get(f.placeId) as Entity<PlaceData>;
                  return (
                    <button key={`${f.placeId}-${f.company}`} type="button" className="mapa-first" onClick={() => onShow({ id: p.id, lat: p.data.lat, lng: p.data.lng })}>
                      <span className="tiny muted">{fmtDate(f.date)}</span>
                      <span className="grow">
                        Primera vez {VISIT_COMPANY_NAMES[f.company].toLowerCase()} · <b>{p.data.name}</b>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <div className="section-title row between">
        <span>Tus lugares</span>
        <button type="button" className="btn sm ghost" onClick={onNew}>
          <Icon name="plus" /> Agregar
        </button>
      </div>
      {places.length === 0 ? (
        <div className="card">
          <Empty>
            Registra a dónde vas con “Fui a…” o elige un lugar emblemático en el mapa. La primera visita a cada lugar da +{GAME_CONFIG.rewards.discovery} XP y con {GAME_CONFIG.mapa.habitualVisits} visitas se vuelve habitual.
          </Empty>
        </div>
      ) : (
        <div className="card">
          {places.length > 6 && (
            <div className="search-box">
              <Icon name="search" width={18} />
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar lugar, colonia o ciudad" />
            </div>
          )}
          {(['dominado', 'descubierto', 'inexplorado'] as PlaceStatus[]).map((s) => {
            const group = shown
              .filter((p) => statusOf(state, p.id) === s)
              .sort((a, b) => (state.map.places[b.id]?.lastVisit ?? '').localeCompare(state.map.places[a.id]?.lastVisit ?? '') || a.data.name.localeCompare(b.data.name, 'es'));
            if (!group.length) return null;
            return (
              <div key={s} className="mapa-group">
                <div className="mapa-group-title">
                  {PLACE_STATUS_NAMES[s]} · {group.length}
                </div>
                {group.map((p) => (
                  <PlaceRow key={p.id} place={p} onShow={() => onShow({ id: p.id, lat: p.data.lat, lng: p.data.lng })} onVisit={() => onVisit({ kind: 'place', place: p })} />
                ))}
              </div>
            );
          })}
          {shown.length === 0 && <Empty>Nada con ese filtro.</Empty>}
        </div>
      )}
    </>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div className="mapa-stat">
      <b className={tone}>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function PlaceRow({ place, onShow, onVisit, sub }: { place: Entity<PlaceData>; onShow: () => void; onVisit?: () => void; sub?: string }) {
  const { state } = useGame();
  const s = state.map.places[place.id];
  const kind = markerKind(place, s?.status ?? 'inexplorado');
  const lived = (Object.keys(s?.firsts ?? {}) as VisitCompany[]).filter((c) => c !== 'otro');
  return (
    <div className={`item mapa-row ${place.data.active === false ? 'off' : ''}`}>
      <i className={`mapa-dot mk-${kind}`} />
      <button type="button" className="grow mapa-link" onClick={onShow}>
        <span className="item-title">{place.data.name}</span>
        <small className="muted">
          {sub ?? [PLACE_TYPE_NAMES[place.data.placeType], whereText(place.data)].filter(Boolean).join(' · ')}
          {s?.visits ? ` · ${s.visits} ${s.visits === 1 ? 'visita' : 'visitas'}` : ''}
          {lived.length ? ` · ${lived.map((c) => VISIT_COMPANY_NAMES[c].toLowerCase()).join(', ')}` : ''}
          {!hasCoords(place.data) ? ' · sin ubicación' : ''}
        </small>
      </button>
      {onVisit && (
        <button type="button" className="btn sm" onClick={onVisit}>
          Fui
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Capa empresa
// ---------------------------------------------------------------------------------------------

function EmpresaSections({ places, total, byId, onShow, onNew, setCity }: { places: Entity<PlaceData>[]; total: number; byId: Map<string, Entity>; onShow: (p: { id: string; lat?: number | null; lng?: number | null }) => void; onNew: () => void; setCity: (c: string) => void }) {
  const { state } = useGame();
  const e = state.map.summary.empresa;
  if (total === 0) {
    return (
      <div className="card">
        <Empty>
          Marca dónde opera tu empresa: oficinas, sucursales, clientes, proveedores y zonas de operación. Así ves en qué ciudades estás y a dónde puedes crecer.
        </Empty>
        <button className="btn primary block" onClick={onNew}>
          <Icon name="building" /> Agregar el primero
        </button>
      </div>
    );
  }
  const count = (t: string) => places.filter((p) => p.data.placeType === t && p.data.active !== false).length;
  const maxCity = Math.max(1, ...e.cities.map((c) => c.places));
  return (
    <>
      <div className="mapa-stats">
        <Stat n={e.cities.length} label={e.cities.length === 1 ? 'ciudad' : 'ciudades'} tone="gold" />
        <Stat n={e.clients} label={e.clients === 1 ? 'cliente' : 'clientes'} tone="teal" />
        <Stat n={count('oficina') + count('sucursal')} label="sedes" />
        <Stat n={count('proveedor')} label={count('proveedor') === 1 ? 'proveedor' : 'proveedores'} />
      </div>

      {e.cities.length > 0 && (
        <>
          <div className="section-title">Dónde opera</div>
          <div className="card">
            {e.cities.map((c) => (
              <button key={c.city} type="button" className="mapa-city-row" onClick={() => setCity(c.city === 'Sin ciudad' ? '' : c.city)}>
                <span className="row between">
                  <b>{c.city}</b>
                  <small className="muted">
                    {c.places} {c.places === 1 ? 'lugar' : 'lugares'}
                    {c.clients ? ` · ${c.clients} ${c.clients === 1 ? 'cliente' : 'clientes'}` : ''}
                    {c.since ? ` · desde ${fmtDate(c.since, true)}` : ''}
                  </small>
                </span>
                <Bar value={c.places} max={maxCity} tone="violet" size="sm" />
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-title row between">
        <span>Lugares de la empresa</span>
        <button type="button" className="btn sm ghost" onClick={onNew}>
          <Icon name="plus" /> Agregar
        </button>
      </div>
      <div className="card">
        {EMPRESA_PLACE_TYPES.map((t) => {
          const group = places.filter((p) => p.data.placeType === t).sort((a, b) => Number(a.data.active === false) - Number(b.data.active === false) || a.data.name.localeCompare(b.data.name, 'es'));
          if (!group.length) return null;
          return (
            <div key={t} className="mapa-group">
              <div className="mapa-group-title">
                {EMPRESA_GROUP[t]} · {group.length}
              </div>
              {group.map((p) => {
                const contacts = (p.data.npcIds ?? []).map((id) => (byId.get(id)?.data as NpcData | undefined)?.name).filter(Boolean);
                const sub = [whereText(p.data), contacts.length ? contacts.join(', ') : '', p.data.active === false ? 'ya no opera' : ''].filter(Boolean).join(' · ');
                return <PlaceRow key={p.id} place={p} sub={sub || PLACE_TYPE_NAMES[p.data.placeType]} onShow={() => onShow({ id: p.id, lat: p.data.lat, lng: p.data.lng })} />;
              })}
            </div>
          );
        })}
        {places.length === 0 && <Empty>Nada con ese filtro.</Empty>}
      </div>
    </>
  );
}
