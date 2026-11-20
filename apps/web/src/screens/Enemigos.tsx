import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtWeekdaysLong, type Entity, type ViceData, type ViceState } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { fmtDate, newId } from '../lib/time';
import { Empty, Field, PageHeader, Sheet, confirmAction, undoToast, TextInput, TextArea } from '../ui/kit';
import { Icon } from '../ui/icons';
import { TrendText, VerdictBadge } from '../ui/HabitBits';

/** Hábitos a dejar: se cuentan los días sin recaída. Nunca dan ni quitan XP. */
export default function Enemigos() {
  const { state, list } = useGame();
  const vices = list<ViceData>('habits', 'vice');
  const [edit, setEdit] = useState<Entity<ViceData> | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Hábitos a dejar"
        eyebrow="Días sin recaída"
        right={
          <button className="btn sm primary" onClick={() => setEdit('new')}>
            <Icon name="plus" /> Hábito
          </button>
        }
      />
      <p className="small muted" style={{ marginTop: -6 }}>
        Cada hábito cuenta los días seguidos sin recaída. Si recaes, lo registras y la cuenta vuelve a empezar. Tu XP nunca baja por esto.{' '}
        <Link to="/habitos">Ver también tus hábitos buenos</Link>.
      </p>
      {vices.length === 0 && <Empty>Agrega un hábito que quieras dejar: redes sociales de noche, comida chatarra, posponer…</Empty>}
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
                <div className="tiny muted">días sin recaída</div>
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
                  if (!confirmAction(`¿Registrar una recaída en "${v.data.name}"? La cuenta vuelve a 0 (tu XP no cambia).`)) return;
                  const ev = addEvent('vice.relapse', { viceId: v.id });
                  undoToast('Registrado. Mañana empieza otra racha.', () => voidEvent(ev.id));
                }}
              >
                {st?.relapsedToday ? 'Recaída hoy' : 'Recaí'}
              </button>
            </div>
            {st && <ViceStats st={st} />}
            {st && st.relapses.length > 0 && <div className="tiny muted" style={{ marginTop: 8 }}>Última recaída: {fmtDate(st.lastRelapse, true)} · {st.relapses.length} en total</div>}
          </div>
        );
      })}
      {edit && <ViceSheet initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

const MONTH_LETTER = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** Frecuencia de recaídas: veredicto, últimos 30 días contra los 30 anteriores, meses y patrón. */
function ViceStats({ st }: { st: ViceState }) {
  if (st.trackedDays < 3) return null;
  const max = Math.max(1, ...st.byMonth.map((m) => m.count));
  const pattern = [
    st.worstWeekday !== null ? `Sueles recaer en ${fmtWeekdaysLong([st.worstWeekday])}` : '',
    st.everyDays ? `≈ una recaída cada ${st.everyDays} días` : '',
  ].filter(Boolean);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="hab-meta">
        <VerdictBadge verdict={st.verdict} />
        <span>
          {st.relapses30} {st.relapses30 === 1 ? 'recaída' : 'recaídas'} en 30 días{st.trend ? ` · antes ${st.relapsesPrev30}` : ''}
        </span>
        <TrendText trend={st.trend} />
      </div>
      {st.relapses.length > 0 && st.byMonth.length > 1 && (
        <div className="vice-months" aria-label="Días con recaída por mes">
          {st.byMonth.map((m) => (
            <div key={m.month} title={`${m.month}: ${m.count}`}>
              <span className="num">{m.count}</span>
              <i className={m.count ? '' : 'zero'} style={{ height: m.count ? 4 + (m.count / max) * 26 : 3 }} />
              <span>{MONTH_LETTER[Number(m.month.slice(5, 7)) - 1]}</span>
            </div>
          ))}
        </div>
      )}
      {pattern.length > 0 && <div className="tiny" style={{ marginTop: 8, color: 'var(--flame)' }}>{pattern.join(' · ')}</div>}
    </div>
  );
}

function ViceSheet({ initial, onClose }: { initial: Entity<ViceData> | null; onClose: () => void }) {
  const { state } = useGame();
  const [d, setD] = useState<ViceData>(initial?.data ?? { name: '', startDate: state.today });
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar hábito' : 'Nuevo hábito a dejar'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar este hábito?') && (deleteEntity(initial.id), onClose())}>
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
      <Field label="Hábito">
        <TextInput className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Redes sociales después de las 10 pm" />
      </Field>
      <Field label="Contar desde">
        <input className="input" type="date" max={state.today} value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} />
      </Field>
      <Field label="Notas">
        <TextArea className="input" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Por qué lo quieres dejar, qué lo dispara…" />
      </Field>
    </Sheet>
  );
}
