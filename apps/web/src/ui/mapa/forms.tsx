import { useMemo, useState } from 'react';
import {
  EMPRESA_PLACE_TYPES,
  GAME_CONFIG,
  PLACE_LAYER_NAMES,
  PLACE_LAYERS,
  PLACE_TYPE_NAMES,
  VIDA_PLACE_TYPES,
  VISIT_COMPANIES,
  VISIT_COMPANY_NAMES,
  catalogPlaceEntityId,
  mapNormalize,
  parseMapCoords,
  placeFromCatalog,
  placeLayer,
  searchMapCatalog,
  type Entity,
  type NpcData,
  type PlaceData,
  type PlaceLayer,
  type PlaceType,
  type VisitCompany,
} from '@igv/core';
import { deleteEntity, saveEntity, useGame } from '../../data/store';
import { newId } from '../../lib/time';
import { Icon } from '../icons';
import { Chips, DateChips, Field, Sheet, confirmAction, toast, undoToast, useAutoFocus } from '../kit';
import { GDL_CENTER, MapView, type MapViewState } from './MapView';
import { CITY_SUGGESTIONS, getMapaPrefs, getPosition, hasCoords, registerVisit, sortPeopleFor, whereText, type VisitTarget } from './model';
import '../../styles/mapa.css';

// ---------------------------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------------------------

function MultiChips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="chips" role="group">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Stars({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div className="mapa-stars" role="radiogroup" aria-label="Calificación">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} de 5`} className={value && n <= value ? 'on' : ''} onClick={() => onChange(value === n ? undefined : n)}>
          <Icon name="star" />
        </button>
      ))}
    </div>
  );
}

const CITY_LIST_ID = 'mapa-cities';
function CityDatalist({ extra }: { extra: string[] }) {
  const all = [...new Set([...extra.filter(Boolean), ...CITY_SUGGESTIONS])];
  return (
    <datalist id={CITY_LIST_ID}>
      {all.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
  );
}

/** Buscador de lugar: tus lugares, los emblemáticos de Jalisco o uno nuevo con ese nombre. */
function PlacePicker({ onPick }: { onPick: (t: VisitTarget) => void }) {
  const { list, state } = useGame();
  const ref = useAutoFocus<HTMLInputElement>();
  const [q, setQ] = useState('');
  const mine = list<PlaceData>('map', 'place');
  const ids = useMemo(() => new Set(mine.map((p) => p.id)), [mine]);
  const n = mapNormalize(q);
  const recent = [...mine].sort((a, b) => (state.map.places[b.id]?.lastVisit ?? '').localeCompare(state.map.places[a.id]?.lastVisit ?? ''));
  const hits = n ? recent.filter((p) => mapNormalize(`${p.data.name} ${p.data.zone ?? ''} ${p.data.city ?? ''}`).includes(n)).slice(0, 6) : recent.slice(0, 5);
  const cat = n.length >= 3 ? searchMapCatalog(q, 5).filter((c) => !ids.has(state.map.catalog[c.id]?.placeId ?? catalogPlaceEntityId(c.id))) : [];
  const exact = mine.some((p) => mapNormalize(p.data.name) === n) || cat.some((c) => mapNormalize(c.name) === n);
  return (
    <div className="mapa-picker">
      <div className="search-box">
        <Icon name="search" width={18} />
        <input ref={ref} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿A dónde fuiste? Restaurante, parque, ciudad…" />
      </div>
      <div className="mapa-picker-list">
        {hits.map((p) => (
          <button key={p.id} type="button" className="mapa-pick" onClick={() => onPick({ kind: 'place', place: p })}>
            <Icon name="pin" width={18} />
            <span className="grow">
              <b>{p.data.name}</b>
              <small>{[PLACE_TYPE_NAMES[p.data.placeType] ?? '', whereText(p.data)].filter(Boolean).join(' · ')}</small>
            </span>
            {state.map.places[p.id]?.visits ? <small className="muted">{state.map.places[p.id].visits}×</small> : <small className="muted">por conocer</small>}
          </button>
        ))}
        {cat.map((c) => (
          <button key={c.id} type="button" className="mapa-pick" onClick={() => onPick({ kind: 'catalog', place: c })}>
            <Icon name="compass" width={18} />
            <span className="grow">
              <b>{c.name}</b>
              <small>
                {PLACE_TYPE_NAMES[c.placeType]} · {whereText(c)} · emblemático
              </small>
            </span>
          </button>
        ))}
        {n.length >= 2 && !exact && (
          <button type="button" className="mapa-pick new" onClick={() => onPick({ kind: 'new', name: q.trim() })}>
            <Icon name="plus" width={18} />
            <span className="grow">
              <b>Agregar “{q.trim()}”</b>
              <small>Lugar nuevo en tu mapa</small>
            </span>
          </button>
        )}
        {!n && !mine.length && <p className="tiny muted">Escribe el nombre: un restaurante, un parque, un museo, una ciudad…</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// "Fui a…": registrar una visita
// ---------------------------------------------------------------------------------------------

export function VisitForm({
  date,
  setDate,
  today,
  onDone,
  preset,
  presetCompany,
}: {
  date: string;
  setDate: (d: string) => void;
  today: string;
  onDone: () => void;
  preset?: VisitTarget | null;
  presetCompany?: VisitCompany;
}) {
  const { list, state } = useGame();
  const [target, setTarget] = useState<VisitTarget | null>(preset ?? null);
  const [company, setCompany] = useState<VisitCompany | null>(presetCompany ?? null);
  const [npcIds, setNpcIds] = useState<string[]>([]);
  const [rating, setRating] = useState<number | undefined>();
  const [note, setNote] = useState('');
  const [extra, setExtra] = useState<Partial<PlaceData>>({ placeType: 'restaurante' });
  const [locating, setLocating] = useState(false);
  const npcs = sortPeopleFor(list<NpcData>('npcs', 'npc'), company);
  const placeState = target?.kind === 'place' ? state.map.places[target.place.id] : undefined;
  const first = !!target && !placeState?.discoveredOn;
  const name = target ? (target.kind === 'new' ? target.name : target.kind === 'place' ? target.place.data.name : target.place.name) : '';
  const sub = target ? (target.kind === 'place' ? whereText(target.place.data) : target.kind === 'catalog' ? whereText(target.place) : 'Lugar nuevo') : '';

  const locate = async () => {
    setLocating(true);
    try {
      const p = await getPosition();
      setExtra((x) => ({ ...x, ...p }));
      toast('Ubicación lista');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLocating(false);
    }
  };

  return (
    <>
      {target ? (
        <div className="mapa-target">
          <Icon name="pin" width={20} />
          <div className="grow">
            <b>{name}</b>
            <small>
              {sub}
              {placeState?.visits ? ` · ${placeState.visits} ${placeState.visits === 1 ? 'visita' : 'visitas'}` : ''}
            </small>
          </div>
          {!preset && (
            <button type="button" className="btn sm ghost" onClick={() => setTarget(null)}>
              Cambiar
            </button>
          )}
        </div>
      ) : (
        <Field label="¿A dónde?">
          <PlacePicker onPick={setTarget} />
        </Field>
      )}

      {target?.kind === 'new' && (
        <div className="mapa-newplace">
          <div className="row" style={{ gap: 8 }}>
            <select className="input" value={extra.placeType} onChange={(e) => setExtra({ ...extra, placeType: e.target.value as PlaceType })} aria-label="Tipo de lugar">
              {VIDA_PLACE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PLACE_TYPE_NAMES[t]}
                </option>
              ))}
            </select>
            <input className="input" list={CITY_LIST_ID} value={extra.city ?? ''} onChange={(e) => setExtra({ ...extra, city: e.target.value })} placeholder="Ciudad" aria-label="Ciudad" />
            <CityDatalist extra={[]} />
          </div>
          <button type="button" className="btn sm ghost" onClick={locate} disabled={locating}>
            <Icon name="locate" /> {hasCoords(extra) ? 'Ubicación guardada ✓' : locating ? 'Buscando…' : 'Estoy aquí: usar mi ubicación'}
          </button>
        </div>
      )}

      <Field label="¿Con quién?">
        <Chips value={company} onChange={setCompany} options={VISIT_COMPANIES.map((c) => ({ value: c, label: VISIT_COMPANY_NAMES[c] }))} />
      </Field>
      {npcs.length > 0 && company && company !== 'solo' && (
        <Field label="¿Quiénes? (opcional)">
          <MultiChips value={npcIds} onChange={setNpcIds} options={npcs.slice(0, 14).map((n) => ({ value: n.id, label: n.data.name }))} />
        </Field>
      )}
      <Field label="¿Qué tal estuvo? (opcional)">
        <Stars value={rating} onChange={setRating} />
      </Field>
      <Field label="Nota (opcional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qué hicieron, qué pidieron…" />
      </Field>
      <Field label="¿Cuándo?">
        <DateChips value={date} onChange={setDate} today={today} />
      </Field>
      <button
        className="btn primary block"
        disabled={!target || !company}
        onClick={() => {
          registerVisit(target!, { company: company!, npcIds: company === 'solo' ? [] : npcIds, note, rating, date }, state, target!.kind === 'new' ? { ...extra, city: extra.city?.trim() || undefined } : undefined);
          onDone();
        }}
      >
        Registrar visita{first ? ` · +${GAME_CONFIG.rewards.discovery} XP` : ''}
      </button>
    </>
  );
}

/** Hoja "Fui a…" para usar desde la pantalla del mapa. */
export function VisitSheet({ preset, presetCompany, today, onClose }: { preset?: VisitTarget | null; presetCompany?: VisitCompany; today: string; onClose: () => void }) {
  const [date, setDate] = useState(today);
  return (
    <Sheet open onClose={onClose} title={preset ? 'Registrar visita' : 'Fui a…'}>
      <VisitForm date={date} setDate={setDate} today={today} onDone={onClose} preset={preset} presetCompany={presetCompany} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Crear / editar un lugar
// ---------------------------------------------------------------------------------------------

export function PlaceForm({ initial, layer, onClose, onSaved }: { initial?: Entity<PlaceData>; layer: PlaceLayer; onClose: () => void; onSaved?: (id: string) => void }) {
  const { list, state } = useGame();
  const [d, setD] = useState<PlaceData>(initial?.data ?? { name: '', placeType: layer === 'empresa' ? 'cliente' : 'restaurante', layer });
  const lay = placeLayer(d);
  const [mapOpen, setMapOpen] = useState(hasCoords(d));
  const [focus, setFocus] = useState<{ lat: number; lng: number; z?: number; key: number } | null>(null);
  const [coordText, setCoordText] = useState('');
  const [locating, setLocating] = useState(false);
  const tiles = getMapaPrefs().tiles;
  const mine = list<PlaceData>('map', 'place');
  const ids = new Set(mine.map((p) => p.id));
  const npcs = list<NpcData>('npcs', 'npc');
  const types = lay === 'empresa' ? EMPRESA_PLACE_TYPES : VIDA_PLACE_TYPES;
  const catHits = !initial && lay === 'vida' && !d.catalogId && d.name.trim().length >= 3 ? searchMapCatalog(d.name, 3).filter((c) => !ids.has(state.map.catalog[c.id]?.placeId ?? catalogPlaceEntityId(c.id))) : [];
  const start: MapViewState = hasCoords(d) ? { lat: d.lat!, lng: d.lng!, z: 15 } : (() => {
    const ref = mine.find((p) => hasCoords(p.data) && (!d.city || mapNormalize(p.data.city ?? '') === mapNormalize(d.city)));
    return ref ? { lat: ref.data.lat!, lng: ref.data.lng!, z: 13 } : { ...GDL_CENTER, z: 12 };
  })();

  const setCoords = (c: { lat: number; lng: number }, move = true) => {
    setD((x) => ({ ...x, lat: Math.round(c.lat * 1e5) / 1e5, lng: Math.round(c.lng * 1e5) / 1e5 }));
    setMapOpen(true);
    if (move) setFocus({ ...c, z: 16, key: Date.now() });
  };
  const locate = async () => {
    setLocating(true);
    try {
      setCoords(await getPosition());
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLocating(false);
    }
  };

  const save = () => {
    const data: PlaceData = { ...d, name: d.name.trim(), city: d.city?.trim() || undefined, zone: d.zone?.trim() || undefined, notes: d.notes?.trim() || undefined, layer: lay };
    if (!mapOpen) {
      data.lat = null;
      data.lng = null;
    }
    const id = initial?.id ?? (d.catalogId ? catalogPlaceEntityId(d.catalogId) : `place-${newId().replace(/-/g, '').slice(0, 10)}`);
    saveEntity<PlaceData>({ id, module: 'map', kind: 'place', data });
    toast(initial ? 'Lugar actualizado' : `"${data.name}" quedó en tu mapa`);
    onSaved?.(id);
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar lugar' : lay === 'empresa' ? 'Lugar de la empresa' : 'Nuevo lugar'}
      actions={
        <>
          {initial && (
            <button
              className="btn ghost danger"
              onClick={() => {
                if (!confirmAction(`¿Borrar "${initial.data.name}" del mapa? Sus visitas y su XP se conservan.`)) return;
                deleteEntity(initial.id);
                undoToast('Lugar borrado', () => saveEntity(initial));
                onClose();
              }}
            >
              Borrar
            </button>
          )}
          <button className="btn primary" disabled={!d.name.trim()} onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={lay === 'empresa' ? 'Oficina, cliente, bodega…' : 'Tacos, parque, museo, ciudad…'} />
      </Field>
      {catHits.length > 0 && (
        <div className="mapa-catalog-hits">
          {catHits.map((c) => (
            <button
              key={c.id}
              type="button"
              className="mapa-pick"
              onClick={() => {
                setD({ ...placeFromCatalog(c), notes: d.notes });
                setMapOpen(true);
                setFocus({ lat: c.lat, lng: c.lng, z: 15, key: Date.now() });
              }}
            >
              <Icon name="compass" width={18} />
              <span className="grow">
                <b>{c.name}</b>
                <small>{whereText(c)} · usar datos del lugar emblemático</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {!initial && (
        <Field label="Capa">
          <Chips
            value={lay}
            onChange={(v) => setD({ ...d, layer: v, placeType: v === 'empresa' ? 'cliente' : 'restaurante', catalogId: v === 'empresa' ? null : d.catalogId })}
            options={PLACE_LAYERS.map((l) => ({ value: l, label: l === 'empresa' ? 'Mi empresa' : 'Mi vida' }))}
          />
        </Field>
      )}
      <Field label="Tipo">
        {lay === 'empresa' ? (
          <Chips value={d.placeType} onChange={(v) => setD({ ...d, placeType: v })} options={EMPRESA_PLACE_TYPES.map((t) => ({ value: t as PlaceType, label: PLACE_TYPE_NAMES[t] }))} />
        ) : (
          <select className="input" value={(types as readonly string[]).includes(d.placeType) ? d.placeType : 'lugar'} onChange={(e) => setD({ ...d, placeType: e.target.value as PlaceType })}>
            {types.map((t) => (
              <option key={t} value={t}>
                {PLACE_TYPE_NAMES[t]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid2" style={{ gap: 8 }}>
        <Field label="Ciudad">
          <input className="input" list={CITY_LIST_ID} value={d.city ?? ''} onChange={(e) => setD({ ...d, city: e.target.value })} placeholder="Guadalajara" />
        </Field>
        <Field label="Colonia o zona">
          <input className="input" value={d.zone ?? ''} onChange={(e) => setD({ ...d, zone: e.target.value })} placeholder="Centro, Americana…" />
        </Field>
      </div>
      <CityDatalist extra={mine.map((p) => p.data.city ?? '')} />

      <Field label="Ubicación">
        {mapOpen ? (
          <div className="mapa-pickmap">
            <MapView
              markers={[]}
              crosshair
              initial={start}
              focus={focus}
              height={210}
              tiles={tiles}
              onViewChange={(v) => mapOpen && setCoords(v, false)}
              ariaLabel="Mueve el mapa para poner el punto"
            />
            <div className="row between tiny muted" style={{ marginTop: 6 }}>
              <span>Mueve el mapa hasta que la mira quede en el lugar.</span>
              <button type="button" className="btn sm ghost" onClick={() => setMapOpen(false)}>
                Quitar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn sm" onClick={() => setMapOpen(true)}>
            <Icon name="pin" /> Ponerlo en el mapa
          </button>
        )}
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          <button type="button" className="btn sm ghost" onClick={locate} disabled={locating}>
            <Icon name="locate" /> {locating ? 'Buscando…' : 'Usar mi ubicación'}
          </button>
          <input
            className="input grow"
            style={{ minHeight: 32, fontSize: 13 }}
            value={coordText}
            onChange={(e) => {
              setCoordText(e.target.value);
              const c = parseMapCoords(e.target.value);
              if (c) setCoords(c);
            }}
            placeholder="Pegar coordenadas o liga de Google Maps"
            aria-label="Coordenadas o liga de Google Maps"
          />
        </div>
      </Field>

      {lay === 'empresa' && (
        <>
          {npcs.length > 0 && (
            <Field label="Contactos (Mi gente)">
              <MultiChips value={d.npcIds ?? []} onChange={(v) => setD({ ...d, npcIds: v })} options={npcs.map((n) => ({ value: n.id, label: n.data.name }))} />
            </Field>
          )}
          <div className="grid2" style={{ gap: 8, alignItems: 'end' }}>
            <Field label="Desde">
              <input className="input" type="date" value={d.since ?? ''} onChange={(e) => setD({ ...d, since: e.target.value || null })} />
            </Field>
            <label className="field mapa-check">
              <input type="checkbox" checked={d.active !== false} onChange={(e) => setD({ ...d, active: e.target.checked })} />
              <span>Sigue activo</span>
            </label>
          </div>
        </>
      )}
      <Field label="Notas">
        <textarea className="input" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </Field>
      {initial && <p className="tiny muted">Capa: {PLACE_LAYER_NAMES[lay]}</p>}
    </Sheet>
  );
}
