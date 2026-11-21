import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPRESA_PLACE_TYPES,
  GAME_CONFIG,
  PLACE_LAYER_NAMES,
  PLACE_LAYERS,
  PLACE_TYPE_NAMES,
  VIDA_PLACE_TYPES,
  VISIT_COMPANIES,
  VISIT_COMPANY_NAMES,
  catalogIdOfPlace,
  catalogPlaceEntityId,
  mapNormalize,
  parseMapCoords,
  placeFromCatalog,
  placeLayer,
  searchMapCatalog,
  type Entity,
  type NpcData,
  type PlaceData,
  type PlaceGoal,
  type PlaceLayer,
  type PlaceType,
  type VisitCompany,
} from '@igv/core';
import { deleteEntity, saveEntity, useGame } from '../../data/store';
import { reversePlace, searchPlaces, type GeoResult } from '../../lib/geocode';
import { fmtDate, newId } from '../../lib/time';
import { Icon } from '../icons';
import { Chips, DateChips, Field, Sheet, confirmAction, toast, undoToast, useAutoFocus, TextInput, TextArea } from '../kit';
import { GDL_CENTER, MapView, type MapViewState } from './MapView';
import { CITY_SUGGESTIONS, fmtGoalBy, getMapaPrefs, getPosition, hasCoords, homeCenter, registerVisit, sortPeopleFor, suggestionsOn, whereText, type VisitTarget } from './model';
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

/** Personas que se ven de entrada en "¿Quiénes?" (el resto con "Ver todas"). */
const PEOPLE_SHOWN = 14;

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

/** Zoom para ver un resultado de búsqueda: una ciudad de lejos, un lugar de cerca. */
export function zoomFor(t: PlaceType): number {
  return t === 'viaje' ? 11 : t === 'pueblo' || t === 'naturaleza' || t === 'playa' ? 13 : 16;
}

/**
 * Buscar un lugar en cualquier parte del mundo (OpenStreetMap). Solo busca al tocar "Buscar" o Enter (política de
 * uso de Nominatim: nada de buscar mientras escribes). Da preferencia a lo cercano a tus lugares.
 */
export function GeoSearch({
  initial = '',
  onPick,
  autoFocus = false,
  placeholder = 'Busca un lugar, ciudad o dirección',
}: {
  initial?: string;
  onPick: (g: GeoResult) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const { list } = useGame();
  const focusRef = useAutoFocus<HTMLInputElement>();
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<GeoResult[] | null>(null);
  const near = useMemo(() => homeCenter(list<PlaceData>('map', 'place')), [list]);
  const run = async () => {
    if (q.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      setRes(await searchPlaces(q, near));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mapa-geo">
      <div className="mapa-geo-bar">
        <div className="search-box">
          <Icon name="search" width={18} />
          <TextInput
            ref={autoFocus ? focusRef : undefined}
            className="input"
            value={q}
            onChange={(e) => (setQ(e.target.value), setRes(null))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void run();
              }
            }}
            enterKeyHint="search"
            placeholder={placeholder}
            aria-label="Buscar lugar"
          />
        </div>
        <button type="button" className="btn" onClick={() => void run()} disabled={busy || q.trim().length < 2}>
          {busy ? 'Buscando…' : 'Buscar'}
        </button>
      </div>
      {res &&
        (res.length ? (
          <div className="mapa-picker-list">
            {res.map((g) => (
              <button
                key={`${g.lat},${g.lng},${g.name}`}
                type="button"
                className="mapa-pick"
                onClick={() => {
                  onPick(g);
                  setRes(null);
                }}
              >
                <Icon name="pin" width={18} />
                <span className="grow">
                  <b>{g.name}</b>
                  <small>{[PLACE_TYPE_NAMES[g.placeType] !== PLACE_TYPE_NAMES.lugar ? PLACE_TYPE_NAMES[g.placeType] : '', g.detail].filter(Boolean).join(' · ')}</small>
                </span>
              </button>
            ))}
            <span className="tiny muted mapa-geo-src">Datos © OpenStreetMap</span>
          </div>
        ) : (
          <p className="tiny muted">No encontré “{q.trim()}”. Prueba con otro nombre o agrega la ciudad (p. ej. “Disneyland California”).</p>
        ))}
    </div>
  );
}

/** Buscador de lugar: tus lugares, los emblemáticos de Jalisco (si prendiste las sugerencias) o uno nuevo con ese nombre. */
function PlacePicker({ onPick }: { onPick: (t: VisitTarget) => void }) {
  const { list, state } = useGame();
  const ref = useAutoFocus<HTMLInputElement>();
  const [q, setQ] = useState('');
  const mine = list<PlaceData>('map', 'place');
  const ids = useMemo(() => new Set(mine.map((p) => p.id)), [mine]);
  const n = mapNormalize(q);
  // Primero tus objetivos pendientes (es a donde más probablemente fuiste si no es lo de siempre), luego lo reciente.
  const goalOpen = new Set(state.map.goals.filter((g) => !g.doneOn).map((g) => g.placeId));
  const recent = [...mine].sort((a, b) => (state.map.places[b.id]?.lastVisit ?? '').localeCompare(state.map.places[a.id]?.lastVisit ?? ''));
  const hits = n ? recent.filter((p) => mapNormalize(`${p.data.name} ${p.data.zone ?? ''} ${p.data.city ?? ''}`).includes(n)).slice(0, 6) : recent.slice(0, 5);
  const cat = suggestionsOn(state.settings) && n.length >= 3 ? searchMapCatalog(q, 5).filter((c) => !ids.has(state.map.catalog[c.id]?.placeId ?? catalogPlaceEntityId(c.id))) : [];
  const exact = mine.some((p) => mapNormalize(p.data.name) === n) || cat.some((c) => mapNormalize(c.name) === n);
  return (
    <div className="mapa-picker">
      <div className="search-box">
        <Icon name="search" width={18} />
        <TextInput ref={ref} className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿A dónde fuiste? Restaurante, parque, ciudad…" />
      </div>
      <div className="mapa-picker-list">
        {hits.map((p) => (
          <button key={p.id} type="button" className="mapa-pick" onClick={() => onPick({ kind: 'place', place: p })}>
            <Icon name="pin" width={18} />
            <span className="grow">
              <b>{p.data.name}</b>
              <small>{[PLACE_TYPE_NAMES[p.data.placeType] ?? '', whereText(p.data)].filter(Boolean).join(' · ')}</small>
            </span>
            {goalOpen.has(p.id) ? (
              <small className="flame">objetivo</small>
            ) : state.map.places[p.id]?.visits ? (
              <small className="muted">{state.map.places[p.id].visits}×</small>
            ) : (
              <small className="muted">por conocer</small>
            )}
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
        {n.length >= 2 && !exact && <p className="tiny muted">Si es nuevo, después de agregarlo puedes buscar dónde está.</p>}
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
  const [allPeople, setAllPeople] = useState(false);
  const [geo, setGeo] = useState(false);
  const npcs = sortPeopleFor(list<NpcData>('npcs', 'npc'), company);
  // Un objetivo que pide compañía la propone (si no viene otra).
  const goal = target?.kind === 'place' ? target.place.data.goal : null;
  const goalPlaceId = target?.kind === 'place' ? target.place.id : null;
  const goalOpen = !!goal && !state.map.goals.find((g) => g.placeId === goalPlaceId)?.doneOn;
  useEffect(() => {
    if (goalOpen && goal?.with && !company) setCompany(goal.with);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalOpen]);
  const shownPeople = allPeople ? npcs : npcs.filter((n, i) => i < PEOPLE_SHOWN || npcIds.includes(n.id));
  // Mismo lugar que usará registerVisit (un lugar del catálogo ya conocido, aunque se haya borrado, no vuelve a dar XP).
  const placeState =
    target?.kind === 'place' ? state.map.places[target.place.id] : target?.kind === 'catalog' ? state.map.places[state.map.catalog[target.place.id]?.placeId ?? catalogPlaceEntityId(target.place.id)] : undefined;
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
            <TextInput className="input" list={CITY_LIST_ID} value={extra.city ?? ''} onChange={(e) => setExtra({ ...extra, city: e.target.value })} placeholder="Ciudad" aria-label="Ciudad" />
            <CityDatalist extra={[]} />
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button type="button" className="btn sm ghost" onClick={locate} disabled={locating}>
              <Icon name="locate" /> {hasCoords(extra) && !geo ? 'Ubicación guardada ✓' : locating ? 'Buscando…' : 'Estoy aquí'}
            </button>
            <button type="button" className={`btn sm ghost ${geo ? 'on' : ''}`} onClick={() => setGeo(!geo)}>
              <Icon name="search" /> Buscar dónde está
            </button>
          </div>
          {geo && (
            <GeoSearch
              initial={target.name}
              onPick={(g) => {
                setExtra({ ...extra, lat: g.lat, lng: g.lng, city: extra.city?.trim() || g.city, zone: extra.zone || g.zone, placeType: g.placeType !== 'lugar' ? g.placeType : extra.placeType });
                setGeo(false);
                toast(`Ubicación: ${[g.name, g.detail].filter(Boolean).join(', ')}`);
              }}
            />
          )}
        </div>
      )}
      {goalOpen && goal && (
        <p className="tiny flame" style={{ margin: '-4px 0 10px' }}>
          Objetivo
          {goal.with ? ` ${VISIT_COMPANY_NAMES[goal.with].toLowerCase()}` : ''}
          {goal.by ? ` para ${fmtGoalBy(goal.by)}` : ''}: esta visita lo cumple
          {goal.with ? ` si fue ${VISIT_COMPANY_NAMES[goal.with].toLowerCase()}` : ''}.
        </p>
      )}

      <Field label="¿Con quién?">
        <Chips value={company} onChange={setCompany} options={VISIT_COMPANIES.map((c) => ({ value: c, label: VISIT_COMPANY_NAMES[c] }))} />
      </Field>
      {npcs.length > 0 && company && company !== 'solo' && (
        <Field label="¿Quiénes? (opcional)">
          <MultiChips value={npcIds} onChange={setNpcIds} options={shownPeople.map((n) => ({ value: n.id, label: n.data.name }))} />
          {!allPeople && npcs.length > shownPeople.length && (
            <button type="button" className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setAllPeople(true)}>
              Ver todas ({npcs.length})
            </button>
          )}
        </Field>
      )}
      <Field label="¿Qué tal estuvo? (opcional)">
        <Stars value={rating} onChange={setRating} />
      </Field>
      <Field label="Nota (opcional)">
        <TextInput className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qué hicieron, qué pidieron…" />
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
// Crear / editar un lugar (o un objetivo)
// ---------------------------------------------------------------------------------------------

type Intent = 'quiero' | 'objetivo' | 'fui';
const ANY = 'cualquiera';

export function PlaceForm({
  initial,
  layer,
  at,
  asGoal = false,
  onClose,
  onSaved,
  onWent,
}: {
  initial?: Entity<PlaceData>;
  layer: PlaceLayer;
  /** Punto marcado en el mapa (al mantener presionado o con la mira), con el zoom que tenía. */
  at?: { lat: number; lng: number; z: number } | null;
  /** Abrir ya como objetivo. */
  asGoal?: boolean;
  onClose: () => void;
  onSaved?: (id: string, data: PlaceData) => void;
  /** "Ya fui": se guardó el lugar y falta registrar la visita. */
  onWent?: (place: Entity<PlaceData>) => void;
}) {
  const { list, state } = useGame();
  const today = state.today;
  const year = Number(today.slice(0, 4));
  const pt = at ? { lat: Math.round(at.lat * 1e5) / 1e5, lng: Math.round(at.lng * 1e5) / 1e5 } : null;
  const [d, setD] = useState<PlaceData>(initial?.data ?? { name: '', placeType: layer === 'empresa' ? 'cliente' : 'lugar', layer, ...(pt ?? {}) });
  const lay = placeLayer(d);
  const oldGoal = initial?.data.goal ?? null;
  const oldGoalDone = !!initial && !!state.map.goals.find((g) => g.placeId === initial.id)?.doneOn;
  const [intent, setIntent] = useState<Intent>(asGoal || (oldGoal && !oldGoalDone) ? 'objetivo' : 'quiero');
  const [goalWith, setGoalWith] = useState<VisitCompany | null>(oldGoal?.with ?? null);
  const [goalBy, setGoalBy] = useState<string | null>(oldGoal?.by ?? null);
  const [mapOpen, setMapOpen] = useState(hasCoords(d));
  const [focus, setFocus] = useState<{ lat: number; lng: number; z?: number; key: number } | null>(null);
  const [coordText, setCoordText] = useState('');
  const [locating, setLocating] = useState(false);
  const [lookup, setLookup] = useState(false);
  const typed = useRef(!!initial);
  const tiles = getMapaPrefs().tiles;
  const mine = list<PlaceData>('map', 'place');
  const ids = new Set(mine.map((p) => p.id));
  const npcs = list<NpcData>('npcs', 'npc');
  const types = lay === 'empresa' ? EMPRESA_PLACE_TYPES : VIDA_PLACE_TYPES;
  const isGoal = lay === 'vida' && intent === 'objetivo';
  // Lugares sugeridos de Jalisco: solo si los prendiste. También al editar: así un lugar viejo (sin liga) se puede
  // ligar a su lugar emblemático y contar en sus colecciones.
  const catHits =
    suggestionsOn(state.settings) && lay === 'vida' && !d.catalogId && d.name.trim().length >= 3 ? searchMapCatalog(d.name, 3).filter((c) => !ids.has(state.map.catalog[c.id]?.placeId ?? catalogPlaceEntityId(c.id))) : [];
  const shortLink = !parseMapCoords(coordText) && /goo\.gl|maps\.app/i.test(coordText);
  const start: MapViewState = at
    ? { lat: at.lat, lng: at.lng, z: Math.max(3, Math.min(17, at.z)) }
    : hasCoords(d)
      ? { lat: d.lat!, lng: d.lng!, z: 15 }
      : (() => {
          const ref = mine.find((p) => hasCoords(p.data) && (!d.city || mapNormalize(p.data.city ?? '') === mapNormalize(d.city)));
          return ref ? { lat: ref.data.lat!, lng: ref.data.lng!, z: 13 } : { ...GDL_CENTER, z: 12 };
        })();

  // Punto marcado en el mapa: qué hay ahí (ciudad, colonia y, si tiene, el nombre del lugar).
  useEffect(() => {
    if (!at || initial) return;
    let live = true;
    setLookup(true);
    reversePlace(at.lat, at.lng, at.z)
      .then((g) => {
        if (!live || !g) return;
        // De cerca solo se propone el nombre de un lugar de verdad (restaurante, parque…), no el del pueblo o la ciudad.
        const town = g.placeType === 'viaje' || g.placeType === 'pueblo';
        const name = g.name && (!town || at.z < 12) ? g.name : '';
        setD((x) => ({
          ...x,
          name: typed.current || x.name ? x.name : name,
          city: x.city || g.city,
          zone: x.zone || (at.z >= 12 ? g.zone : undefined),
          placeType: x.placeType === 'lugar' && name ? g.placeType : x.placeType === 'lugar' && at.z < 9 ? 'viaje' : x.placeType,
        }));
      })
      .catch(() => undefined)
      .finally(() => live && setLookup(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCoords = (c: { lat: number; lng: number }, move = true, z = 16) => {
    setD((x) => ({ ...x, lat: Math.round(c.lat * 1e5) / 1e5, lng: Math.round(c.lng * 1e5) / 1e5 }));
    setMapOpen(true);
    if (move) setFocus({ ...c, z, key: Date.now() });
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
  const pickGeo = (g: GeoResult) => {
    setD((x) => ({
      ...x,
      name: typed.current && x.name.trim() ? x.name : g.name,
      city: g.city ?? x.city,
      zone: g.zone,
      placeType: lay === 'vida' && (x.placeType === 'lugar' || !typed.current) && g.placeType !== 'lugar' ? g.placeType : x.placeType,
    }));
    setCoords(g, true, zoomFor(g.placeType));
  };

  const save = () => {
    const data: PlaceData = { ...d, name: d.name.trim(), city: d.city?.trim() || undefined, zone: d.zone?.trim() || undefined, notes: d.notes?.trim() || undefined, layer: lay };
    if (!mapOpen) {
      data.lat = null;
      data.lng = null;
    }
    if (isGoal) {
      // Editar un objetivo pendiente conserva desde cuándo; uno cumplido (o nuevo) empieza hoy.
      const goal: PlaceGoal = { with: goalWith, by: goalBy, since: oldGoal && !oldGoalDone ? oldGoal.since : today };
      data.goal = goal;
    } else if (lay === 'vida' && (intent === 'quiero' || intent === 'fui') && oldGoal && !oldGoalDone) data.goal = null;
    // Un lugar ligado al catálogo solo por su nombre guarda la liga (si lo renombras, sigue contando).
    const nameLink = initial && !data.catalogId ? catalogIdOfPlace(initial.id, initial.data) : null;
    if (nameLink) data.catalogId = nameLink;
    const id = initial?.id ?? (d.catalogId ? catalogPlaceEntityId(d.catalogId) : `place-${newId().replace(/-/g, '').slice(0, 10)}`);
    const saved = saveEntity<PlaceData>({ id, module: 'map', kind: 'place', data });
    if (!initial && intent === 'fui' && lay === 'vida') {
      onClose();
      onWent?.(saved as Entity<PlaceData>);
      return;
    }
    toast(initial ? 'Lugar actualizado' : isGoal ? `Objetivo nuevo: ${data.name}` : `"${data.name}" quedó en tu mapa`);
    onSaved?.(id, data);
    onClose();
  };

  const byOptions = [
    { value: 'none', label: 'Sin fecha' },
    { value: String(year), label: `Este año` },
    { value: String(year + 1), label: String(year + 1) },
    { value: String(year + 2), label: String(year + 2) },
    { value: 'mes', label: goalBy && /^\d{4}-\d{2}$/.test(goalBy) ? fmtGoalBy(goalBy) : 'Elegir mes' },
  ];
  const byValue = !goalBy ? 'none' : /^\d{4}-\d{2}$/.test(goalBy) ? 'mes' : byOptions.some((o) => o.value === goalBy) ? goalBy : 'mes';

  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar lugar' : lay === 'empresa' ? 'Lugar de la empresa' : isGoal ? 'Nuevo objetivo' : 'Agregar al mapa'}
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
            {!initial && intent === 'fui' && lay === 'vida' ? 'Siguiente' : 'Guardar'}
          </button>
        </>
      }
    >
      {!initial && !at && (
        <Field label="Buscar">
          <GeoSearch autoFocus onPick={pickGeo} placeholder={lay === 'empresa' ? 'Busca la dirección o el negocio' : 'Disneyland California, un restaurante, una ciudad…'} />
        </Field>
      )}
      {at && !initial && lookup && (
        <p className="tiny muted" style={{ margin: '0 0 8px' }}>
          Buscando qué hay en ese punto…
        </p>
      )}

      <Field label="Nombre">
        <TextInput
          className="input"
          value={d.name}
          onChange={(e) => {
            typed.current = true;
            setD({ ...d, name: e.target.value });
          }}
          placeholder={lay === 'empresa' ? 'Oficina, cliente, bodega…' : 'Tacos, parque, museo, ciudad, viaje…'}
        />
      </Field>
      {catHits.length > 0 && (
        <div className="mapa-catalog-hits">
          {catHits.map((c) => (
            <button
              key={c.id}
              type="button"
              className="mapa-pick"
              onClick={() => {
                // Al editar se liga sin perder lo tuyo (mismo id, nombre, notas y ubicación).
                const next = initial ? { ...d, catalogId: c.id, lat: d.lat ?? c.lat, lng: d.lng ?? c.lng, city: d.city || c.city, zone: d.zone || c.zone } : { ...placeFromCatalog(c), notes: d.notes };
                setD(next);
                setMapOpen(true);
                setFocus({ lat: next.lat!, lng: next.lng!, z: 15, key: Date.now() });
              }}
            >
              <Icon name="compass" width={18} />
              <span className="grow">
                <b>{c.name}</b>
                <small>
                  {whereText(c)} · {initial ? 'es este lugar emblemático: cuenta en sus colecciones' : 'usar datos del lugar emblemático'}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}

      {lay === 'vida' && (
        <Field label={initial ? '¿Es un objetivo?' : '¿Qué es para ti?'}>
          <Chips
            value={intent}
            onChange={setIntent}
            options={
              initial
                ? [
                    { value: 'quiero' as Intent, label: 'No' },
                    {
                      value: 'objetivo' as Intent,
                      label: (
                        <>
                          <Icon name="flag" width={14} /> Sí, es un objetivo
                        </>
                      ),
                      tone: 'flame',
                    },
                  ]
                : [
                    { value: 'quiero' as Intent, label: 'Quiero ir' },
                    {
                      value: 'objetivo' as Intent,
                      label: (
                        <>
                          <Icon name="flag" width={14} /> Objetivo
                        </>
                      ),
                      tone: 'flame',
                    },
                    { value: 'fui' as Intent, label: 'Ya fui' },
                  ]
            }
          />
        </Field>
      )}
      {initial && oldGoal && oldGoalDone && intent !== 'objetivo' && (
        <p className="tiny muted" style={{ margin: '-4px 0 10px' }}>
          Objetivo cumplido el {fmtDate(state.map.goals.find((g) => g.placeId === initial.id)!.doneOn, true)}. Márcalo otra vez si quieres volver.
        </p>
      )}
      {isGoal && (
        <div className="mapa-goal-fields">
          <Field label="¿Con quién quieres ir?">
            <Chips
              value={goalWith ?? ANY}
              onChange={(v) => setGoalWith(v === ANY ? null : (v as VisitCompany))}
              options={[{ value: ANY, label: 'Da igual' }, ...VISIT_COMPANIES.filter((c) => c !== 'otro').map((c) => ({ value: c as string, label: VISIT_COMPANY_NAMES[c] }))]}
            />
          </Field>
          <Field label="¿Para cuándo?">
            <Chips value={byValue} onChange={(v) => setGoalBy(v === 'none' ? null : v === 'mes' ? (goalBy && /^\d{4}-\d{2}$/.test(goalBy) ? goalBy : `${today.slice(0, 7)}`) : v)} options={byOptions} />
            {byValue === 'mes' && (
              <input
                className="input"
                type="month"
                style={{ marginTop: 8 }}
                value={goalBy && /^\d{4}-\d{2}$/.test(goalBy) ? goalBy : ''}
                min={today.slice(0, 7)}
                onChange={(e) => setGoalBy(e.target.value || null)}
                aria-label="Mes"
              />
            )}
          </Field>
          <p className="tiny muted" style={{ margin: '-4px 0 10px' }}>
            Se cumple cuando registres una visita
            {goalWith ? ` ${VISIT_COMPANY_NAMES[goalWith].toLowerCase()}` : ''}. La primera visita da +{GAME_CONFIG.rewards.discovery} XP.
          </p>
        </div>
      )}

      {!initial && (
        <Field label="Capa">
          <Chips
            value={lay}
            onChange={(v) => setD({ ...d, layer: v, placeType: v === 'empresa' ? 'cliente' : 'lugar', catalogId: v === 'empresa' ? null : d.catalogId })}
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
          <TextInput className="input" list={CITY_LIST_ID} value={d.city ?? ''} onChange={(e) => setD({ ...d, city: e.target.value })} placeholder="Guadalajara" />
        </Field>
        <Field label="Colonia o zona">
          <TextInput className="input" value={d.zone ?? ''} onChange={(e) => setD({ ...d, zone: e.target.value })} placeholder="Centro, Americana…" />
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
              <span>Mueve el mapa hasta que la mira quede en el lugar. No tiene que ser exacto.</span>
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
        {initial && (
          <div style={{ marginTop: 8 }}>
            <GeoSearch onPick={pickGeo} placeholder="Buscar otra ubicación" />
          </div>
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
        {shortLink && <p className="tiny muted">Las ligas cortas de Google Maps no traen coordenadas. Ábrela en el navegador y pega la liga completa, o las coordenadas.</p>}
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
      <Field label={isGoal ? '¿Por qué? (opcional)' : 'Notas'}>
        <TextArea className="input" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder={isGoal ? 'Qué quieren hacer ahí, qué celebran…' : undefined} />
      </Field>
      {initial && <p className="tiny muted">Capa: {PLACE_LAYER_NAMES[lay]}</p>}
    </Sheet>
  );
}
