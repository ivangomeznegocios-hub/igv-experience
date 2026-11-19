import { useMemo, useState } from 'react';
import { monthKey, type Entity, type ItemData } from '@igv/core';
import { deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { fmtDate, fmtMoney, fmtMonth, newId } from '../lib/time';
import { Empty, Field, PageHeader, Sheet, Tabs, confirmAction } from '../ui/kit';
import { Icon } from '../ui/icons';
import { MoneySheet } from './Hoy';

type Tab = 'money' | 'tool' | 'knowledge';

export default function Inventario() {
  const [tab, setTab] = useState<Tab>('money');
  return (
    <>
      <PageHeader title="Inventario" eyebrow="Mundo" />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'money', label: 'Dinero' },
          { value: 'tool', label: 'Herramientas' },
          { value: 'knowledge', label: 'Conocimientos' },
        ]}
      />
      {tab === 'money' ? <Money /> : <Items kind={tab} />}
    </>
  );
}

function Money() {
  const { state, events } = useGame();
  const cur = state.settings.currency;
  const [month, setMonth] = useState(state.money.currentMonth);
  const [adding, setAdding] = useState<'income' | 'expense' | null>(null);
  const tx = useMemo(
    () =>
      events
        .filter((e) => !e.voidedAt && (e.type === 'income.recorded' || e.type === 'expense.recorded') && monthKey(e.localDate) === month)
        .sort((a, b) => (a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : a.occurredAt < b.occurredAt ? 1 : -1)),
    [events, month],
  );
  const m = state.money.months[month] ?? { income: 0, expense: 0 };
  const months = Object.keys(state.money.months).sort().reverse();
  if (!months.includes(state.money.currentMonth)) months.unshift(state.money.currentMonth);
  const shift = (dir: number) => {
    const [y, mm] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, mm - 1 + dir, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <>
      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <button className="btn icon ghost" onClick={() => shift(-1)} aria-label="Mes anterior">
            <Icon name="left" />
          </button>
          <b style={{ textTransform: 'capitalize' }}>{fmtMonth(month)}</b>
          <button className="btn icon ghost" onClick={() => shift(1)} aria-label="Mes siguiente" disabled={month >= state.money.currentMonth}>
            <Icon name="right" />
          </button>
        </div>
        <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div>
            <div className="eyebrow">Ingresos</div>
            <div className="num green" style={{ fontWeight: 800 }}>
              {fmtMoney(m.income, cur)}
            </div>
          </div>
          <div>
            <div className="eyebrow">Gastos</div>
            <div className="num red" style={{ fontWeight: 800 }}>
              {fmtMoney(m.expense, cur)}
            </div>
          </div>
          <div>
            <div className="eyebrow">Balance</div>
            <div className="num" style={{ fontWeight: 800 }}>
              {fmtMoney(m.income - m.expense, cur)}
            </div>
          </div>
        </div>
        <div className="grid2" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => setAdding('income')}>
            <Icon name="plus" /> Ingreso
          </button>
          <button className="btn" onClick={() => setAdding('expense')}>
            <Icon name="plus" /> Gasto
          </button>
        </div>
      </div>
      <div className="card">
        <h2>Movimientos</h2>
        {tx.length === 0 && <Empty>Sin movimientos este mes.</Empty>}
        {tx.map((e) => {
          const inc = e.type === 'income.recorded';
          return (
            <div key={e.id} className="item">
              <div className="grow">
                <div className="item-title ellipsis">{e.payload.concept || (inc ? 'Ingreso' : 'Gasto')}</div>
                <div className="tiny muted">
                  {fmtDate(e.localDate, true)}
                  {e.payload.category ? ` · ${e.payload.category}` : ''}
                </div>
              </div>
              <b className={`num ${inc ? 'green' : 'red'}`}>
                {inc ? '+' : '−'}
                {fmtMoney(e.payload.amount, cur)}
              </b>
              <button className="btn icon ghost danger" aria-label="Anular" onClick={() => confirmAction('¿Anular este movimiento?') && voidEvent(e.id)}>
                <Icon name="trash" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="card">
        <h2>Resumen mensual</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Mes</th>
              <th className="r">Ingresos</th>
              <th className="r">Gastos</th>
              <th className="r">Balance</th>
            </tr>
          </thead>
          <tbody>
            {months.slice(0, 12).map((k) => {
              const x = state.money.months[k] ?? { income: 0, expense: 0 };
              return (
                <tr key={k} onClick={() => setMonth(k)} style={{ cursor: 'pointer' }}>
                  <td style={{ textTransform: 'capitalize' }}>{fmtMonth(k)}</td>
                  <td className="r num">{fmtMoney(x.income, cur)}</td>
                  <td className="r num">{fmtMoney(x.expense, cur)}</td>
                  <td className={`r num ${x.income - x.expense >= 0 ? 'green' : 'red'}`}>{fmtMoney(x.income - x.expense, cur)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="tiny muted">El dinero real y la XP son sistemas separados.</p>
      </div>
      {adding && <MoneySheet kind={adding} onClose={() => setAdding(null)} />}
    </>
  );
}

function Items({ kind }: { kind: 'tool' | 'knowledge' }) {
  const { list } = useGame();
  const items = list<ItemData>('inventory', kind);
  const [edit, setEdit] = useState<Entity<ItemData> | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="card">
        {items.length === 0 && <Empty>{kind === 'tool' ? 'Agrega tus herramientas (software, equipo, plantillas…).' : 'Agrega lo que sabes: cursos, libros, métodos.'}</Empty>}
        {items.map((it) => (
          <div key={it.id} className="item">
            <Icon name={kind === 'tool' ? 'wrench' : 'book'} width={20} className="gold" />
            <div className="grow">
              <div className="item-title">{it.data.name}</div>
              {it.data.notes && <div className="tiny muted">{it.data.notes}</div>}
              {it.data.link && (
                <a className="tiny" href={it.data.link} target="_blank" rel="noreferrer">
                  {it.data.link}
                </a>
              )}
            </div>
            <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(it)}>
              <Icon name="edit" />
            </button>
          </div>
        ))}
      </div>
      <button className="btn block" onClick={() => setCreating(true)}>
        <Icon name="plus" /> Agregar
      </button>
      {(edit || creating) && <ItemForm kind={kind} initial={edit ?? undefined} onClose={() => (setEdit(null), setCreating(false))} />}
    </>
  );
}

function ItemForm({ kind, initial, onClose }: { kind: 'tool' | 'knowledge'; initial?: Entity<ItemData>; onClose: () => void }) {
  const [d, setD] = useState<ItemData>(initial?.data ?? { name: '', notes: '', link: '' });
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar' : kind === 'tool' ? 'Nueva herramienta' : 'Nuevo conocimiento'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim()}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `${kind}-${newId().slice(0, 8)}`, module: 'inventory', kind, data: d });
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
      <Field label="Notas">
        <textarea className="input" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </Field>
      <Field label="Enlace">
        <input className="input" type="url" value={d.link ?? ''} onChange={(e) => setD({ ...d, link: e.target.value })} />
      </Field>
    </Sheet>
  );
}
