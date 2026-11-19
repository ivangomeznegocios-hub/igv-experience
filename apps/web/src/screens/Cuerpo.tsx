import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BODY_MEASURE_KEYS, BODY_MEASURE_LABELS, BODY_MEASURE_UNITS, addDays, describeMeasures, firstMeasures as firstOf } from '@igv/core';
import { useGame, voidEvent } from '../data/store';
import { fmtDate } from '../lib/time';
import { Empty, PageHeader, confirmAction } from '../ui/kit';
import { BarChart, LineChart } from '../ui/charts';
import { Icon } from '../ui/icons';
import { openQuickAdd } from '../ui/QuickAdd';

/** Cuerpo: peso, entrenamientos y sueño. Solo registro (la XP viene de las misiones). */
export default function Cuerpo() {
  const { state } = useGame();
  const b = state.body;
  const weights = b.entries.filter((e) => typeof e.weightKg === 'number').map((e) => ({ label: fmtDate(e.date), value: e.weightKg! }));
  const sleep = useMemo(() => {
    const from = addDays(state.today, -29);
    const map = new Map(b.sleep.map((s) => [s.date, s.hours]));
    return Array.from({ length: 30 }, (_, i) => {
      const d = addDays(from, i);
      return { label: fmtDate(d), value: map.get(d) ?? 0 };
    });
  }, [b.sleep, state.today]);
  const avgSleep = b.sleep.slice(-14).reduce((s, x) => s + x.hours, 0) / Math.max(1, b.sleep.slice(-14).length);
  const workouts = [...b.entries].filter((e) => e.workout?.trim()).reverse();
  const diff = b.lastWeight && b.firstWeight ? b.lastWeight.kg - b.firstWeight.kg : null;
  const firstMeasures = firstOf(b.entries);
  const measured = BODY_MEASURE_KEYS.filter((k) => k !== 'weightKg' && b.latest[k] !== undefined);
  const measureLogs = [...b.entries].filter((e) => describeMeasures(e)).reverse();
  return (
    <>
      <PageHeader
        title="Cuerpo"
        eyebrow="Salud"
        right={
          <button className="btn sm primary" onClick={() => openQuickAdd({ mode: 'body' })}>
            <Icon name="plus" /> Registrar
          </button>
        }
      />
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 12 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">Peso</div>
          <div className="stat-big num">{b.lastWeight ? `${b.lastWeight.kg}` : '—'}</div>
          <div className="tiny muted">{diff !== null ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg desde ${fmtDate(b.firstWeight!.date)}` : 'kg'}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">Entrenos esta semana</div>
          <div className="stat-big num teal">{b.workoutsThisWeek}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="eyebrow">Sueño (14 días)</div>
          <div className="stat-big num">{b.sleep.length ? avgSleep.toFixed(1) : '—'}</div>
          <div className="tiny muted">horas promedio</div>
        </div>
      </div>
      <div className="card">
        <h2>Peso</h2>
        <LineChart points={weights.slice(-40)} format={(n) => `${n.toFixed(1)} kg`} />
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Medidas</h2>
          <Link to="/personaje" className="btn sm ghost">
            <Icon name="user" /> Ver mi personaje
          </Link>
        </div>
        {measured.length === 0 && <Empty>Registra tu % de grasa y tus contornos en Perfil: le dan forma a tu personaje y aquí ves cómo cambian.</Empty>}
        {measured.map((k) => {
          const now = b.latest[k]!;
          const start = firstMeasures[k];
          const d = start !== undefined ? now - start : 0;
          return (
            <div key={k} className="item" style={{ padding: '7px 0' }}>
              <div className="grow small">{BODY_MEASURE_LABELS[k]}</div>
              {Math.abs(d) >= 0.05 && (
                <span className="tiny muted num">
                  {d > 0 ? '+' : '−'}
                  {Math.abs(d).toFixed(1)}
                </span>
              )}
              <b className="num">
                {now} <span className="tiny muted">{BODY_MEASURE_UNITS[k]}</span>
              </b>
            </div>
          );
        })}
        {measureLogs.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              Registros de medidas ({measureLogs.length})
            </summary>
            {measureLogs.slice(0, 40).map((e) => (
              <div key={e.eventId} className="item" style={{ padding: '6px 0' }}>
                <div className="grow small">
                  {describeMeasures(e)}
                  <div className="tiny muted">{fmtDate(e.date, true)}</div>
                </div>
                <button className="btn icon ghost danger" aria-label="Anular" onClick={() => confirmAction('¿Anular este registro?') && voidEvent(e.eventId)}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </details>
        )}
      </div>
      <div className="card">
        <h2>Sueño (30 días)</h2>
        <BarChart data={sleep} color="var(--season)" format={(n) => `${n} h`} />
        <div className="tiny muted">Viene de tu check-in de energía de cada mañana.</div>
      </div>
      <div className="card">
        <h2>Entrenamientos</h2>
        {workouts.length === 0 && <Empty>Registra tus entrenamientos con el botón +.</Empty>}
        {workouts.slice(0, 30).map((w) => (
          <div key={w.eventId} className="item" style={{ padding: '6px 0' }}>
            <div className="grow small">
              {w.workout}
              <div className="tiny muted">
                {fmtDate(w.date, true)}
                {w.weightKg ? ` · ${w.weightKg} kg` : ''}
              </div>
            </div>
            <button className="btn icon ghost danger" aria-label="Anular" onClick={() => confirmAction('¿Anular este registro?') && voidEvent(w.eventId)}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
