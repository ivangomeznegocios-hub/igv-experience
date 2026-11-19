import { useState } from 'react';
import { type Entity, type ViceData } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { fmtDate, newId } from '../lib/time';
import { Empty, Field, PageHeader, Sheet, confirmAction, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';

/** Malos hábitos como enemigos: se cuentan los días sin caer. Nunca dan ni quitan XP. */
export default function Enemigos() {
  const { state, list } = useGame();
  const vices = list<ViceData>('habits', 'vice');
  const [edit, setEdit] = useState<Entity<ViceData> | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Enemigos"
        eyebrow="Malos hábitos"
        right={
          <button className="btn sm primary" onClick={() => setEdit('new')}>
            <Icon name="plus" /> Enemigo
          </button>
        }
      />
      <p className="small muted" style={{ marginTop: -6 }}>
        Cada enemigo cuenta los días seguidos que lo tienes a raya. Si caes, lo registras y la cuenta vuelve a empezar. Tu XP nunca baja por esto.
      </p>
      {vices.length === 0 && <Empty>Agrega un hábito que quieras vencer: redes sociales de noche, comida chatarra, posponer…</Empty>}
      {vices.map((v) => {
        const st = state.vices[v.id];
        return (
          <div key={v.id} className="card">
            <div className="card-head">
              <h2>{v.data.name}</h2>
              <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(v)}>
                <Icon name="edit" />
              </button>
            </div>
            <div className="row" style={{ gap: 18 }}>
              <div>
                <div className="stat-big num green">{st?.current ?? 0}</div>
                <div className="tiny muted">días sin caer</div>
              </div>
              <div>
                <div className="stat-big num">{st?.best ?? 0}</div>
                <div className="tiny muted">récord</div>
              </div>
              <div className="grow" />
              <button
                className="btn sm danger"
                disabled={st?.relapsedToday}
                onClick={() => {
                  if (!confirmAction(`¿Registrar una caída en "${v.data.name}"? La cuenta vuelve a 0 (tu XP no cambia).`)) return;
                  const ev = addEvent('vice.relapse', { viceId: v.id });
                  undoToast('Registrado. Mañana empieza otra racha.', () => voidEvent(ev.id));
                }}
              >
                {st?.relapsedToday ? 'Caí hoy' : 'Caí'}
              </button>
            </div>
            {st && st.relapses.length > 0 && <div className="tiny muted" style={{ marginTop: 8 }}>Última caída: {fmtDate(st.lastRelapse, true)} · {st.relapses.length} en total</div>}
          </div>
        );
      })}
      {edit && <ViceSheet initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ViceSheet({ initial, onClose }: { initial: Entity<ViceData> | null; onClose: () => void }) {
  const { state } = useGame();
  const [d, setD] = useState<ViceData>(initial?.data ?? { name: '', startDate: state.today });
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar enemigo' : 'Nuevo enemigo'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este enemigo?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `vice-${newId().slice(0, 8)}`, module: 'habits', kind: 'vice', data: { ...d, name: d.name.trim() } });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Mal hábito">
        <input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Redes sociales después de las 10 pm" />
      </Field>
      <Field label="Contar desde">
        <input className="input" type="date" max={state.today} value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} />
      </Field>
      <Field label="Notas">
        <textarea className="input" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Por qué lo quieres vencer, qué lo dispara…" />
      </Field>
    </Sheet>
  );
}
