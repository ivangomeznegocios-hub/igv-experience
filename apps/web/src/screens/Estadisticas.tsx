import { useMemo } from 'react';
import { ATTRIBUTE_IDS, ATTRIBUTE_NAMES, addDays, weekStart, xpByDate, xpSourceLabel } from '@igv/core';
import { projectAsOf, useGame } from '../data/store';
import { fmtDate, fmtMoney, fmtMonth, fmtNum } from '../lib/time';
import { PageHeader } from '../ui/kit';
import { BarChart, LineChart, Radar } from '../ui/charts';

const SHORT = ['Fue', 'Int', 'Car', 'Fin', 'Dis', 'Rel', 'Cre'];

export default function Estadisticas() {
  const { state, events, entities } = useGame();
  const xpDay = useMemo(() => xpByDate(state.xp.ledger), [state.xp.ledger]);

  const weeks = useMemo(() => {
    const ws = weekStart(state.today);
    return Array.from({ length: 16 }, (_, i) => {
      const start = addDays(ws, -7 * (15 - i));
      let v = 0;
      for (let d = 0; d < 7; d++) v += xpDay.get(addDays(start, d)) ?? 0;
      return { label: fmtDate(start), value: v };
    });
  }, [xpDay, state.today]);

  const past = useMemo(() => projectAsOf(events, entities, addDays(state.today, -90)), [events, entities, state.today]);
  // Si hace 90 días aún no calificabas tus atributos, se compara contra tu calificación inicial.
  const pastVal = (a: (typeof ATTRIBUTE_IDS)[number]) => (past.attributes.rated ? past.attributes.values[a].value : state.attributes.values[a].base);

  const months = useMemo(() => {
    const out: { label: string; value: number; value2: number }[] = [];
    const [y, m] = state.today.split('-').map(Number);
    for (let i = 11; i >= 0; i--) {
      const key = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
      const mm = state.money.months[key];
      out.push({ label: fmtMonth(key).slice(0, 3), value: mm?.income ?? 0, value2: mm?.expense ?? 0 });
    }
    return out;
  }, [state.money.months, state.today]);

  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of state.xp.ledger) m.set(e.source, (m.get(e.source) ?? 0) + e.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [state.xp.ledger]);

  const levelLine = useMemo(() => {
    let total = 0;
    const byWeek = new Map<string, number>();
    for (const e of state.xp.ledger) {
      total += e.amount;
      byWeek.set(weekStart(e.date), total);
    }
    return [...byWeek.entries()].slice(-30).map(([d, v]) => ({ label: fmtDate(d), value: v }));
  }, [state.xp.ledger]);

  const avgWeek = weeks.slice(0, -1).reduce((s, w) => s + w.value, 0) / Math.max(1, weeks.length - 1);
  return (
    <>
      <PageHeader title="Estadísticas" eyebrow="Progreso" />
      <div className="card">
        <div className="card-head">
          <h2>XP por semana</h2>
          <span className="tiny muted">promedio {fmtNum(avgWeek)}</span>
        </div>
        <BarChart data={weeks} format={fmtNum} />
      </div>
      <div className="card">
        <h2>Atributos: hoy vs hace 90 días</h2>
        <Radar
          axes={SHORT}
          series={[
            { values: ATTRIBUTE_IDS.map(pastVal), color: 'var(--muted)', label: past.attributes.rated ? 'Hace 90 días' : 'Calificación inicial' },
            { values: ATTRIBUTE_IDS.map((a) => state.attributes.values[a].value), color: 'var(--violet)', label: 'Hoy' },
          ]}
        />
        <table className="table" style={{ marginTop: 8 }}>
          <tbody>
            {ATTRIBUTE_IDS.map((a) => {
              const d = state.attributes.values[a].value - pastVal(a);
              return (
                <tr key={a}>
                  <td>{ATTRIBUTE_NAMES[a]}</td>
                  <td className="r num">{state.attributes.values[a].value}</td>
                  <td className={`r num ${d > 0 ? 'green' : 'muted'}`}>{d > 0 ? `+${d}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>XP acumulada</h2>
        <LineChart points={levelLine} color="var(--gold)" format={fmtNum} />
      </div>
      <div className="card">
        <h2>¿De dónde viene tu XP?</h2>
        {sources.map(([s, v]) => (
          <div key={s} className="row between small" style={{ padding: '4px 0' }}>
            <span>{xpSourceLabel(s, 'group')}</span>
            <b className="num">{fmtNum(v)}</b>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Ingresos vs gastos (12 meses)</h2>
        <BarChart data={months} color="var(--green)" format={(n) => fmtMoney(n, state.settings.currency)} highlightLast={false} />
        <div className="legend">
          <span>
            <i style={{ background: 'var(--green)' }} />
            Ingresos
          </span>
          <span>
            <i style={{ background: 'var(--red)' }} />
            Gastos
          </span>
        </div>
      </div>
    </>
  );
}
