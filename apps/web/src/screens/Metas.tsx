import { useState } from 'react';
import { ATTRIBUTE_NAMES, GAME_CONFIG, type Entity, type GoalData } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { fmtDate, fmtNum, newId } from '../lib/time';
import { AttrChips, Badge, Bar, Empty, Field, PageHeader, Sheet, SizeChips, confirmAction, undoToast } from '../ui/kit';
import { Icon } from '../ui/icons';

type Goal = GoalData & { archived?: boolean };

/** Metas con contador ("Leer 12 libros en 2027"): al cumplirlas dan la XP de una misión de su tamaño. */
export default function Metas() {
  const { state, list } = useGame();
  const goals = list<Goal>('goals', 'goal');
  const active = goals.filter((g) => !g.data.archived && !state.goals[g.id]?.completedOn);
  const done = goals.filter((g) => !g.data.archived && state.goals[g.id]?.completedOn);
  const archived = goals.filter((g) => g.data.archived);
  const [edit, setEdit] = useState<Entity<Goal> | 'new' | null>(null);
  const add = (g: Entity<Goal>, n: number) => {
    const ev = addEvent('goal.progress', { goalId: g.id, amount: n });
    undoToast(`${g.data.title}: +${n} ${g.data.unit}`, () => voidEvent(ev.id));
  };
  const card = (g: Entity<Goal>) => {
    const st = state.goals[g.id];
    const daysLeft = g.data.deadline ? Math.ceil((Date.parse(g.data.deadline) - Date.parse(state.today)) / 86400000) : null;
    return (
      <div key={g.id} className="card">
        <div className="card-head" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <h2 style={{ marginBottom: 4 }}>{g.data.title}</h2>
            <div className="row wrap" style={{ gap: 4 }}>
              <Badge>{ATTRIBUTE_NAMES[g.data.attribute]}</Badge>
              <Badge tone="gold">+{GAME_CONFIG.missionXp[g.data.size]} XP al cumplirla</Badge>
              {st?.completedOn && <Badge tone="green">Cumplida {fmtDate(st.completedOn, true)}</Badge>}
              {daysLeft !== null && !st?.completedOn && <Badge tone={daysLeft < 0 ? 'red' : 'blue'}>{daysLeft < 0 ? 'Vencida' : `${daysLeft} días`}</Badge>}
            </div>
          </div>
          <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(g)}>
            <Icon name="edit" />
          </button>
        </div>
        <Bar
          value={st?.current ?? 0}
          max={g.data.target}
          tone={st?.completedOn ? 'green' : 'violet'}
          size="lg"
          label={
            <>
              <span className="num">
                {fmtNum(st?.current ?? 0)} / {fmtNum(g.data.target)} {g.data.unit}
              </span>
              <span className="num">{Math.round((st?.progress ?? 0) * 100)}%</span>
            </>
          }
        />
        {!g.data.archived && (
          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            {[1, 5, 10].map((n) => (
              <button key={n} className="btn sm" onClick={() => add(g, n)}>
                +{n}
              </button>
            ))}
            <CustomAdd onAdd={(n) => add(g, n)} />
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      <PageHeader
        title="Metas"
        eyebrow="Progreso"
        right={
          <button className="btn sm primary" onClick={() => setEdit('new')}>
            <Icon name="plus" /> Meta
          </button>
        }
      />
      {active.length === 0 && done.length === 0 && <Empty>Crea metas con número: libros, kilómetros, clientes, ventas… Cada avance suma y al llegar ganas XP.</Empty>}
      {active.map(card)}
      {done.length > 0 && <div className="section-title">Cumplidas</div>}
      {done.map(card)}
      {archived.length > 0 && <div className="section-title">Archivadas</div>}
      {archived.map(card)}
      {edit && <GoalSheet initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function CustomAdd({ onAdd }: { onAdd: (n: number) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="row" style={{ gap: 4 }}>
      <input className="input" style={{ width: 80, minHeight: 32, padding: '4px 8px' }} type="number" inputMode="decimal" placeholder="otro" value={v} onChange={(e) => setV(e.target.value)} />
      <button
        className="btn sm"
        disabled={!(Number(v) > 0)}
        onClick={() => {
          onAdd(Number(v));
          setV('');
        }}
      >
        OK
      </button>
    </div>
  );
}

function GoalSheet({ initial, onClose }: { initial: Entity<Goal> | null; onClose: () => void }) {
  const { state } = useGame();
  const [d, setD] = useState<Goal>(initial?.data ?? { title: '', target: 12, unit: 'libros', attribute: 'inteligencia', size: 'grande', deadline: `${state.today.slice(0, 4)}-12-31` });
  const completed = initial ? !!state.goals[initial.id]?.completedOn : false;
  const save = (patch: Partial<Goal> = {}) => {
    saveEntity({ id: initial?.id ?? `goal-${newId().slice(0, 8)}`, module: 'goals', kind: 'goal', data: { ...d, ...patch, title: d.title.trim() } });
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar meta' : 'Nueva meta'}
      actions={
        <>
          {initial &&
            (completed ? (
              <button className="btn ghost" onClick={() => save({ archived: !d.archived })}>
                {d.archived ? 'Desarchivar' : 'Archivar'}
              </button>
            ) : (
              <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar esta meta y sus avances?') && (deleteEntity(initial.id), onClose())}>
                Borrar
              </button>
            ))}
          <button className="btn primary" disabled={!d.title.trim() || !(d.target > 0) || !d.unit.trim()} onClick={() => save()}>
            Guardar
          </button>
        </>
      }
    >
      <Field label="Meta">
        <input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Leer 12 libros en 2027" />
      </Field>
      <div className="grid2">
        <Field label="Objetivo">
          <input className="input" type="number" min={1} value={d.target} onChange={(e) => setD({ ...d, target: Number(e.target.value) })} />
        </Field>
        <Field label="Unidad">
          <input className="input" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="libros, km, clientes" />
        </Field>
      </div>
      <Field label="Fecha límite (opcional)">
        <input className="input" type="date" value={d.deadline ?? ''} onChange={(e) => setD({ ...d, deadline: e.target.value || null })} />
      </Field>
      <Field label="Recompensa al cumplirla">
        <SizeChips value={d.size} onChange={(size) => setD({ ...d, size })} />
      </Field>
      <Field label="Atributo">
        <AttrChips value={d.attribute} onChange={(attribute) => setD({ ...d, attribute })} />
      </Field>
      {completed && <p className="tiny muted">Las metas cumplidas no se borran (su XP ya cuenta): puedes archivarlas.</p>}
    </Sheet>
  );
}
