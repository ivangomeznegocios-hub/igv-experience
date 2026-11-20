import { useMemo, useState } from 'react';
import { monthKey, type Entity, type ItemData, type SavingsData } from '@igv/core';
import { addEvent, deleteEntity, saveEntity, useGame, voidEvent } from '../data/store';
import { updateSettings } from '../lib/actions';
import { fmtDate, fmtMoney, fmtMonth, newId } from '../lib/time';
import { Bar, Chips, Empty, Field, PageHeader, Sheet, Tabs, confirmAction, undoToast, TextInput, TextArea } from '../ui/kit';
import { Icon } from '../ui/icons';
import { MoneySheet } from './Hoy';

type Tab = 'money' | 'budget' | 'savings' | 'tool' | 'knowledge';

export default function Inventario() {
  const [tab, setTab] = useState<Tab>('money');
  return (
    <>
      <PageHeader title="Dinero y recursos" eyebrow="Más" />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'money', label: 'Dinero' },
          { value: 'budget', label: 'Presupuesto' },
          { value: 'savings', label: 'Ahorro' },
          { value: 'tool', label: 'Herramientas' },
          { value: 'knowledge', label: 'Conocimientos' },
        ]}
      />
      {tab === 'money' ? <Money /> : tab === 'budget' ? <Budget /> : tab === 'savings' ? <Savings /> : <Items kind={tab} />}
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
        <TextInput className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </Field>
      <Field label="Notas">
        <TextArea className="input" value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </Field>
      <Field label="Enlace">
        <input className="input" type="url" value={d.link ?? ''} onChange={(e) => setD({ ...d, link: e.target.value })} />
      </Field>
    </Sheet>
  );
}

/** Presupuesto mensual por categoría de gasto (dinero real; no da XP). */
function Budget() {
  const { state, events } = useGame();
  const cur = state.settings.currency;
  const budgets = state.settings.budgets ?? {};
  const month = state.money.currentMonth;
  const [editing, setEditing] = useState(false);
  const spent = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      if (e.voidedAt || e.type !== 'expense.recorded' || monthKey(e.localDate) !== month) continue;
      const c = String(e.payload.category ?? '').trim() || 'Sin categoría';
      m.set(c, (m.get(c) ?? 0) + e.payload.amount);
    }
    return m;
  }, [events, month]);
  const cats = [...new Set([...Object.keys(budgets), ...spent.keys()])];
  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0);
  const totalSpent = [...spent.values()].reduce((s, v) => s + v, 0);
  const [y, m] = month.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayN = Number(state.today.slice(8));
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2 style={{ textTransform: 'capitalize' }}>{fmtMonth(month)}</h2>
          <button className="btn sm ghost" onClick={() => setEditing(true)}>
            <Icon name="edit" /> Presupuesto
          </button>
        </div>
        {totalBudget > 0 && (
          <Bar
            value={totalSpent}
            max={totalBudget}
            tone={totalSpent > totalBudget ? 'red' : totalSpent > (totalBudget * dayN) / daysIn ? 'flame' : 'green'}
            size="lg"
            label={
              <>
                <span className="num">
                  {fmtMoney(totalSpent, cur)} / {fmtMoney(totalBudget, cur)}
                </span>
                <span>día {dayN} de {daysIn}</span>
              </>
            }
          />
        )}
        {cats.length === 0 && <Empty>Define cuánto quieres gastar al mes en cada categoría (comida, transporte, ocio…).</Empty>}
        {cats.map((c) => {
          const b = budgets[c] ?? 0;
          const sp = spent.get(c) ?? 0;
          return (
            <div key={c} style={{ marginTop: 12 }}>
              <div className="row between small">
                <b>{c}</b>
                <span className={`num ${b && sp > b ? 'red' : ''}`}>
                  {fmtMoney(sp, cur)}
                  {b ? ` / ${fmtMoney(b, cur)}` : ''}
                </span>
              </div>
              {b > 0 && <Bar value={sp} max={b} tone={sp > b ? 'red' : sp > (b * dayN) / daysIn ? 'flame' : 'green'} size="sm" />}
            </div>
          );
        })}
        <p className="tiny muted">La barra se pone naranja si vas gastando más rápido que el mes, y roja si te pasaste.</p>
      </div>
      {editing && <BudgetSheet onClose={() => setEditing(false)} />}
    </>
  );
}

function BudgetSheet({ onClose }: { onClose: () => void }) {
  const { state } = useGame();
  const [rows, setRows] = useState<{ cat: string; amount: string }[]>(() => {
    const b = Object.entries(state.settings.budgets ?? {}).map(([cat, v]) => ({ cat, amount: String(v) }));
    return b.length ? b : [{ cat: 'Comida', amount: '' }];
  });
  return (
    <Sheet
      open
      onClose={onClose}
      title="Presupuesto mensual"
      actions={
        <button
          className="btn primary"
          onClick={() => {
            const budgets = Object.fromEntries(rows.filter((r) => r.cat.trim() && Number(r.amount) > 0).map((r) => [r.cat.trim(), Number(r.amount)]));
            updateSettings(state.settings, { budgets });
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        Usa los mismos nombres de categoría que al registrar gastos.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 8 }}>
          <TextInput className="input" value={r.cat} placeholder="Categoría" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, cat: e.target.value } : x)))} />
          <input className="input" style={{ width: 130 }} type="number" inputMode="decimal" value={r.amount} placeholder="Monto" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <button className="btn icon ghost danger" aria-label="Quitar" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <Icon name="x" />
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => setRows([...rows, { cat: '', amount: '' }])}>
        <Icon name="plus" /> Categoría
      </button>
    </Sheet>
  );
}

/** Metas de ahorro: aportar o retirar. Dinero real, separado de la XP. */
function Savings() {
  const { state, list } = useGame();
  const cur = state.settings.currency;
  const goals = list<SavingsData>('finance', 'savings');
  const [edit, setEdit] = useState<Entity<SavingsData> | 'new' | null>(null);
  const [moving, setMoving] = useState<{ g: Entity<SavingsData>; sign: 1 | -1 } | null>(null);
  return (
    <>
      {goals.length === 0 && <Empty>Crea un apartado: fondo de emergencia, viaje, enganche…</Empty>}
      {goals.map((g) => {
        const st = state.savings[g.id];
        return (
          <div key={g.id} className="card">
            <div className="card-head">
              <h2>{g.data.name}</h2>
              <button className="btn icon ghost" aria-label="Editar" onClick={() => setEdit(g)}>
                <Icon name="edit" />
              </button>
            </div>
            <Bar
              value={st?.current ?? 0}
              max={g.data.target}
              tone="green"
              size="lg"
              label={
                <>
                  <span className="num">
                    {fmtMoney(st?.current ?? 0, cur)} / {fmtMoney(g.data.target, cur)}
                  </span>
                  <span className="num">{Math.round((st?.progress ?? 0) * 100)}%</span>
                </>
              }
            />
            <div className="grid2" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => setMoving({ g, sign: 1 })}>
                <Icon name="plus" /> Aportar
              </button>
              <button className="btn" onClick={() => setMoving({ g, sign: -1 })}>
                Retirar
              </button>
            </div>
          </div>
        );
      })}
      <button className="btn block" onClick={() => setEdit('new')}>
        <Icon name="plus" /> Meta de ahorro
      </button>
      {edit && <SavingsSheet initial={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {moving && <MoveSheet goal={moving.g} sign={moving.sign} onClose={() => setMoving(null)} />}
    </>
  );
}

function MoveSheet({ goal, sign, onClose }: { goal: Entity<SavingsData>; sign: 1 | -1; onClose: () => void }) {
  const { state } = useGame();
  const [v, setV] = useState('');
  const cur = state.settings.currency;
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${sign > 0 ? 'Aportar a' : 'Retirar de'} ${goal.data.name}`}
      actions={
        <button
          className="btn primary"
          disabled={!(Number(v) > 0)}
          onClick={() => {
            const ev = addEvent('savings.moved', { goalId: goal.id, amount: sign * Number(v) });
            undoToast(`${sign > 0 ? 'Aportaste' : 'Retiraste'} ${fmtMoney(Number(v), cur)}`, () => voidEvent(ev.id));
            onClose();
          }}
        >
          Guardar
        </button>
      }
    >
      <Field label={`Monto (${cur})`}>
        <input className="input" type="number" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      </Field>
      <Chips value={Number(v) || null} onChange={(n) => setV(String(n))} options={[500, 1000, 2000, 5000].map((n) => ({ value: n, label: fmtMoney(n, cur) }))} />
    </Sheet>
  );
}

function SavingsSheet({ initial, onClose }: { initial: Entity<SavingsData> | null; onClose: () => void }) {
  const [d, setD] = useState<SavingsData>(initial?.data ?? { name: '', target: 50000 });
  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Editar meta de ahorro' : 'Nueva meta de ahorro'}
      actions={
        <>
          {initial && (
            <button className="btn ghost danger" onClick={() => confirmAction('¿Borrar esta meta de ahorro?') && (deleteEntity(initial.id), onClose())}>
              Borrar
            </button>
          )}
          <button
            className="btn primary"
            disabled={!d.name.trim() || !(d.target > 0)}
            onClick={() => {
              saveEntity({ id: initial?.id ?? `sav-${newId().slice(0, 8)}`, module: 'finance', kind: 'savings', data: { ...d, name: d.name.trim() } });
              onClose();
            }}
          >
            Guardar
          </button>
        </>
      }
    >
      <Field label="Nombre">
        <TextInput className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Fondo de emergencia" />
      </Field>
      <Field label="Objetivo">
        <input className="input" type="number" value={d.target} onChange={(e) => setD({ ...d, target: Number(e.target.value) })} />
      </Field>
    </Sheet>
  );
}
