import { useMemo, useState } from 'react';
import { GAME_CONFIG, PLACE_STATUSES, PLACE_TYPES, type Entity, type PlaceData, type PlaceStatus } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame } from '../data/store';
import { fmtDate, newId } from '../lib/time';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, PageHeader, Sheet, Tabs, confirmAction } from '../ui/kit';

const STATUS_LABEL: Record<PlaceStatus, string> = { inexplorado: 'Por conocer', descubierto: 'Conocido', dominado: 'Habitual' };
const TYPE_LABEL: Record<string, string> = { lugar: 'Lugar', experiencia: 'Experiencia', comunidad: 'Comunidad' };

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Posiciona cada nodo de forma determinista en su región del mapa (Lugares / Experiencias / Comunidades). */
function layoutNodes(places: Entity<PlaceData>[]) {
  const regions: Record<string, { cx: number; cy: number; rx: number; ry: number }> = {
    lugar: { cx: 115, cy: 115, rx: 78, ry: 68 },
    experiencia: { cx: 300, cy: 105, rx: 82, ry: 65 },
    comunidad: { cx: 215, cy: 235, rx: 120, ry: 52 },
  };
  const counters: Record<string, number> = { lugar: 0, experiencia: 0, comunidad: 0 };
  return places.map((p) => {
    const reg = regions[p.data.placeType] ?? regions.lugar;
    const idx = counters[p.data.placeType] ?? 0;
    counters[p.data.placeType] = idx + 1;
    const h = hashStr(p.id);
    const angle = idx * 2.39996 + ((h % 100) / 100) * 0.45;
    const dist = Math.min(1, 0.28 + Math.sqrt(idx + 0.5) * 0.28);
    const x = Math.max(36, Math.min(384, reg.cx + Math.cos(angle) * reg.rx * dist));
    const y = Math.max(36, Math.min(286, reg.cy + Math.sin(angle) * reg.ry * dist));
    return { place: p, x, y };
  });
}

export default function Mapa() {
  const { list, state } = useGame();
  const places = list<PlaceData>('map', 'place');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Entity<PlaceData> | null>(null);
  const [creating, setCreating] = useState(false);

  const statusOf = (id: string): PlaceStatus => state.map.places[id]?.status ?? 'inexplorado';
  const discovered = places.filter((p) => statusOf(p.id) !== 'inexplorado').length;
  const mastered = places.filter((p) => statusOf(p.id) === 'dominado').length;
  const nodes = useMemo(() => layoutNodes(places), [places]);
  const selected = places.find((p) => p.id === selectedId) ?? places[0] ?? null;

  return (
    <>
      <PageHeader
        title="Mapa"
        eyebrow={`${discovered}/${places.length} conocidos · ${mastered} habituales`}
        right={
          <button className="btn sm primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nuevo
          </button>
        }
      />

      {places.length > 0 && (
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: 'map', label: 'Mapa visual' },
            { value: 'list', label: 'Lista' },
          ]}
        />
      )}

      {places.length === 0 && (
        <div className="card">
          <Empty>
            Tu mapa está vacío. Agrega lugares, experiencias y comunidades por conocer. La primera visita a cada uno da +{GAME_CONFIG.rewards.discovery} XP.
          </Empty>
        </div>
      )}

      {places.length > 0 && view === 'map' && (
        <>
          <div className="card world-map-card">
            <svg viewBox="0 0 420 320" className="world-map-svg" role="img" aria-label="Mapa interactivo de lugares conocidos y por conocer">
              <defs>
                <radialGradient id="wm-bg" cx="50%" cy="45%" r="70%">
                  <stop offset="0%" stopColor="var(--card-2)" />
                  <stop offset="100%" stopColor="var(--bg)" />
                </radialGradient>
                <radialGradient id="wm-fog" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--muted)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--muted)" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="wm-glow-teal" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--teal)" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="wm-glow-gold" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
                </radialGradient>
              </defs>

              <rect x="0" y="0" width="420" height="320" rx="14" fill="url(#wm-bg)" />

              {/* Curvas topográficas cartográficas */}
              <g fill="none" stroke="var(--line)" strokeWidth="1" opacity="0.55">
                <path d="M-10,90 Q90,50 180,105 T390,85 T440,120" />
                <path d="M-10,165 Q110,130 220,175 T430,155" />
                <path d="M-10,245 Q130,210 245,255 T435,235" />
                <ellipse cx="115" cy="115" rx="88" ry="62" strokeDasharray="3 5" />
                <ellipse cx="305" cy="108" rx="88" ry="58" strokeDasharray="3 5" />
                <ellipse cx="215" cy="238" rx="132" ry="50" strokeDasharray="3 5" />
              </g>

              {/* Etiquetas de regiones */}
              <g className="wm-region-lbl">
                <text x="115" y="42" textAnchor="middle">LUGARES</text>
                <text x="305" y="42" textAnchor="middle">EXPERIENCIAS</text>
                <text x="215" y="304" textAnchor="middle">COMUNIDADES</text>
              </g>

              {/* Rosa de los vientos */}
              <g transform="translate(384 282)" stroke="var(--gold)" strokeOpacity="0.45" fill="none">
                <circle r="15" strokeWidth="1" />
                <path d="M0,-12 L3,-3 L12,0 L3,3 L0,12 L-3,3 L-12,0 L-3,-3 Z" fill="var(--gold)" fillOpacity="0.2" strokeWidth="1" />
              </g>

              {/* Rutas entre nodos del mismo tipo */}
              {nodes.map((n, i) => {
                const next = nodes.slice(i + 1).find((m) => m.place.data.placeType === n.place.data.placeType);
                if (!next) return null;
                const revealed = statusOf(n.place.id) !== 'inexplorado' && statusOf(next.place.id) !== 'inexplorado';
                return (
                  <line
                    key={`${n.place.id}-${next.place.id}`}
                    x1={n.x}
                    y1={n.y}
                    x2={next.x}
                    y2={next.y}
                    stroke={revealed ? 'var(--gold)' : 'var(--line)'}
                    strokeOpacity={revealed ? 0.5 : 0.6}
                    strokeWidth={revealed ? 1.8 : 1.2}
                    strokeDasharray={revealed ? undefined : '4 4'}
                  />
                );
              })}

              {/* Nodos interactivos */}
              {nodes.map(({ place, x, y }) => {
                const s = statusOf(place.id);
                const isSel = selected?.id === place.id;
                return (
                  <g
                    key={place.id}
                    transform={`translate(${x} ${y})`}
                    className={`wm-node ${s} ${isSel ? 'sel' : ''}`}
                    onClick={() => setSelectedId(place.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Halo según estado (por conocer / conocido / habitual) */}
                    <circle r={s === 'inexplorado' ? 28 : 24} fill={s === 'dominado' ? 'url(#wm-glow-gold)' : s === 'descubierto' ? 'url(#wm-glow-teal)' : 'url(#wm-fog)'} />
                    {isSel && <circle r="16" fill="none" stroke="var(--text)" strokeWidth="1.6" strokeDasharray="3 3" />}
                    <circle
                      r="11"
                      fill={s === 'dominado' ? 'var(--gold)' : s === 'descubierto' ? 'var(--teal)' : 'var(--card-2)'}
                      stroke={s === 'inexplorado' ? 'var(--muted)' : '#090b10'}
                      strokeWidth="2"
                    />
                    {s === 'inexplorado' ? (
                      <text y="4" textAnchor="middle" fill="var(--muted)" fontSize="11" fontWeight="800">
                        ?
                      </text>
                    ) : s === 'dominado' ? (
                      <text y="4" textAnchor="middle" fill="#1a1205" fontSize="11" fontWeight="900">
                        ★
                      </text>
                    ) : (
                      <circle r="3.5" fill="#06201c" />
                    )}
                    <text y="23" textAnchor="middle" className="wm-node-lbl">
                      {place.data.name.length > 16 ? `${place.data.name.slice(0, 15)}…` : place.data.name}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--card-2)', border: '1px solid var(--muted)' }} /> Por conocer
              </span>
              <span>
                <i style={{ background: 'var(--teal)' }} /> Conocido (+{GAME_CONFIG.rewards.discovery} XP)
              </span>
              <span>
                <i style={{ background: 'var(--gold)' }} /> Habitual
              </span>
            </div>
          </div>

          {selected && (
            <div className="card">
              {(() => {
                const s = statusOf(selected.id);
                const st = state.map.places[selected.id];
                return (
                  <>
                    <div className="row between" style={{ alignItems: 'flex-start', gap: 10 }}>
                      <div className="grow">
                        <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
                          <Badge>{TYPE_LABEL[selected.data.placeType]}</Badge>
                          <Badge tone={s === 'dominado' ? 'gold' : s === 'descubierto' ? 'teal' : undefined}>{STATUS_LABEL[s]}</Badge>
                        </div>
                        <h2 style={{ margin: 0 }}>{selected.data.name}</h2>
                        {selected.data.notes && <p className="small muted" style={{ margin: '6px 0 0' }}>{selected.data.notes}</p>}
                        {st?.discoveredOn && (
                          <div className="tiny muted" style={{ marginTop: 6 }}>
                            Primera visita el {fmtDate(st.discoveredOn, true)}
                            {st.masteredOn && s === 'dominado' ? ` · Habitual desde el ${fmtDate(st.masteredOn, true)}` : ''}
                          </div>
                        )}
                      </div>
                      <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(selected)}>
                        <Icon name="edit" />
                      </button>
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 12 }}>
                      {s === 'inexplorado' && (
                        <button className="btn primary" onClick={() => addEvent('map.status_changed', { placeId: selected.id, status: 'descubierto' })}>
                          <Icon name="pin" /> Primera visita (+{GAME_CONFIG.rewards.discovery} XP)
                        </button>
                      )}
                      {s === 'descubierto' && (
                        <button className="btn primary" onClick={() => confirmAction(`¿"${selected.data.name}" ya es parte de tu vida habitual?`) && addEvent('map.status_changed', { placeId: selected.id, status: 'dominado' })}>
                          <Icon name="check" /> Marcar como habitual
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}

      {places.length > 0 && view === 'list' && (
        <>
          {PLACE_STATUSES.map((s) => {
            const group = places.filter((p) => statusOf(p.id) === s);
            if (!group.length) return null;
            return (
              <div key={s}>
                <div className="section-title">{STATUS_LABEL[s]}</div>
                <div className="card">
                  {group.map((p) => {
                    const st = state.map.places[p.id];
                    return (
                      <div key={p.id} className="item">
                        <Icon name="compass" width={22} className={s === 'dominado' ? 'gold' : s === 'descubierto' ? 'teal' : 'faint'} />
                        <div className="grow">
                          <div className="item-title">{p.data.name}</div>
                          <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                            <Badge>{TYPE_LABEL[p.data.placeType]}</Badge>
                            {st?.discoveredOn && <Badge tone="teal">Primera visita {fmtDate(st.discoveredOn, true)}</Badge>}
                            {st?.masteredOn && s === 'dominado' && <Badge tone="gold">Habitual {fmtDate(st.masteredOn, true)}</Badge>}
                          </div>
                          {p.data.notes && <div className="tiny muted" style={{ marginTop: 3 }}>{p.data.notes}</div>}
                        </div>
                        {s === 'inexplorado' && (
                          <button className="btn sm primary" onClick={() => addEvent('map.status_changed', { placeId: p.id, status: 'descubierto' })}>
                            Ya fui
                          </button>
                        )}
                        {s === 'descubierto' && (
                          <button className="btn sm" onClick={() => confirmAction(`¿"${p.data.name}" ya es parte de tu vida habitual?`) && addEvent('map.status_changed', { placeId: p.id, status: 'dominado' })}>
                            Habitual
                          </button>
                        )}
                        <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(p)}>
                          <Icon name="edit" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {(edit || creating) && <PlaceForm initial={edit ?? undefined} onClose={() => (setEdit(null), setCreating(false))} />}
    </>
  );
}

function PlaceForm({ initial, onClose }: { initial?: Entity<PlaceData>; onClose: () => void }) {
  const [d, setD] = useState<PlaceData>(initial?.data ?? { name: '', placeType: 'lugar', notes: '' });
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar' : 'Nuevo en el mapa'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar del mapa?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `place-${newId().slice(0, 8)}`, module: 'map', kind: 'place', data: d });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </Field>
      <Field label="Tipo">
        <select className="input" value={d.placeType} onChange={(e) => setD({ ...d, placeType: e.target.value as PlaceData['placeType'] })}>
          {PLACE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notas">
        <textarea className="input" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </Field>
    </Sheet>
  );
}
