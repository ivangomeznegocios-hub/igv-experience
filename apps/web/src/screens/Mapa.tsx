import { useState } from 'react';
import { GAME_CONFIG, PLACE_STATUSES, PLACE_TYPES, type Entity, type PlaceData, type PlaceStatus } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame } from '../data/store';
import { fmtDate, newId } from '../lib/time';
import { Badge, Empty, Field, PageHeader, Sheet, confirmAction } from '../ui/kit';
import { Icon } from '../ui/icons';

const STATUS_LABEL: Record<PlaceStatus, string> = { inexplorado: 'Inexplorado', descubierto: 'Descubierto', dominado: 'Dominado' };
const TYPE_LABEL: Record<string, string> = { lugar: 'Lugar', experiencia: 'Experiencia', comunidad: 'Comunidad' };

export default function Mapa() {
  const { list, state } = useGame();
  const places = list<PlaceData>('map', 'place');
  const [edit, setEdit] = useState<Entity<PlaceData> | null>(null);
  const [creating, setCreating] = useState(false);
  const statusOf = (id: string): PlaceStatus => state.map.places[id]?.status ?? 'inexplorado';
  const discovered = places.filter((p) => statusOf(p.id) !== 'inexplorado').length;
  return (
    <>
      <PageHeader
        title="Mapa"
        eyebrow={`${discovered} de ${places.length} descubiertos`}
        right={
          <button className="btn sm primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Nuevo
          </button>
        }
      />
      {places.length === 0 && <Empty>Agrega lugares, experiencias y comunidades por descubrir. Cada descubrimiento da {GAME_CONFIG.rewards.discovery} XP.</Empty>}
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
                        {st?.discoveredOn && <Badge tone="teal">Descubierto {fmtDate(st.discoveredOn, true)}</Badge>}
                        {st?.masteredOn && s === 'dominado' && <Badge tone="gold">Dominado {fmtDate(st.masteredOn, true)}</Badge>}
                      </div>
                      {p.data.notes && <div className="tiny muted" style={{ marginTop: 3 }}>{p.data.notes}</div>}
                    </div>
                    {s === 'inexplorado' && (
                      <button className="btn sm primary" onClick={() => addEvent('map.status_changed', { placeId: p.id, status: 'descubierto' })}>
                        Descubrir
                      </button>
                    )}
                    {s === 'descubierto' && (
                      <button className="btn sm" onClick={() => confirmAction(`¿Dominaste "${p.data.name}"?`) && addEvent('map.status_changed', { placeId: p.id, status: 'dominado' })}>
                        Dominar
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
