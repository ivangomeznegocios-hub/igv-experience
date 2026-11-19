import { useMemo, useState } from 'react';
import { DAY_HEAT_STEPS, addDays, heatLevel, weekday, xpByDate } from '@igv/core';
import { useGame } from '../data/store';
import { fmtMonth, fmtNum } from '../lib/time';
import { PageHeader } from '../ui/kit';
import { Icon } from '../ui/icons';
import { DaySheet } from '../ui/DaySheet';

const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Calendario mensual del historial: cada día pintado por su XP. Tocar un día muestra todo lo que pasó. */
export default function Historial() {
  const { state, events } = useGame();
  const [month, setMonth] = useState(state.today.slice(0, 7));
  const [day, setDay] = useState<string | null>(null);
  const xpDay = useMemo(() => xpByDate(state.xp.ledger), [state.xp.ledger]);
  const rest = useMemo(() => new Set(events.filter((e) => !e.voidedAt && e.type === 'rest_day.marked').map((e) => e.localDate)), [events]);
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = weekday(first);
  const days = Array.from({ length: daysIn }, (_, i) => addDays(first, i));
  const monthXp = days.reduce((s, d) => s + (xpDay.get(d) ?? 0), 0);
  const active = days.filter((d) => (xpDay.get(d) ?? 0) > 0).length;
  const shift = (dir: number) => {
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <>
      <PageHeader title="Historial" eyebrow="Calendario" />
      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <button className="btn icon ghost" onClick={() => shift(-1)} aria-label="Mes anterior">
            <Icon name="left" />
          </button>
          <div style={{ textAlign: 'center' }}>
            <b style={{ textTransform: 'capitalize' }}>{fmtMonth(month)}</b>
            <div className="tiny muted">
              +{fmtNum(monthXp)} XP · {active} días activos
            </div>
          </div>
          <button className="btn icon ghost" onClick={() => shift(1)} aria-label="Mes siguiente" disabled={month >= state.today.slice(0, 7)}>
            <Icon name="right" />
          </button>
        </div>
        <div className="cal-grid">
          {DOW.map((d, i) => (
            <div key={i} className="dow">
              {d}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`e${i}`} className="cal-day empty" />
          ))}
          {days.map((d) => {
            const x = xpDay.get(d) ?? 0;
            const future = d > state.today;
            const mood = state.dayClosures[d]?.mood;
            return (
              <button
                key={d}
                className={`cal-day ${future ? 'future' : `h${heatLevel(x, DAY_HEAT_STEPS)}`} ${d === state.today ? 'today' : ''} ${rest.has(d) ? 'rest' : ''}`}
                disabled={future}
                onClick={() => setDay(d)}
              >
                {Number(d.slice(8))}
                <small>{x ? `+${x}` : mood ? ['😫', '😕', '😐', '🙂', '🔥'][mood - 1] : ''}</small>
              </button>
            );
          })}
        </div>
        <div className="legend">
          <span>
            <i style={{ background: 'color-mix(in srgb,var(--green) 30%,var(--card-2))' }} />
            Más verde = más XP
          </span>
          <span>
            <i style={{ border: '1px dashed var(--season)' }} />
            Descanso
          </span>
        </div>
      </div>
      <p className="small muted" style={{ textAlign: 'center' }}>
        Toca un día para ver lo que hiciste, anular algo o registrar lo que se te olvidó.
      </p>
      {day && <DaySheet date={day} onClose={() => setDay(null)} onNav={setDay} />}
    </>
  );
}
