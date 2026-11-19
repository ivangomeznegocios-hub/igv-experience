import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HABIT_VERDICT_LABELS,
  WEEKDAY_SHORT,
  fmtRate,
  fmtWeekdays,
  fmtWeekdaysLong,
  type Entity,
  type HabitStats,
  type HabitVerdict,
  type MissionData,
  type ViceData,
} from '@igv/core';
import { useGame } from '../data/store';
import { fmtDate } from '../lib/time';
import { Empty, PageHeader } from '../ui/kit';
import { Icon } from '../ui/icons';
import { DotStrip, ScoreRing, StripLegend, TrendText, VerdictBadge, makeHabit, useDismissed } from '../ui/HabitBits';
import '../styles/habitos.css';

const SECTIONS: { verdict: HabitVerdict; title: string }[] = [
  { verdict: 'bien', title: 'Lo que estás haciendo bien' },
  { verdict: 'medias', title: 'A medias' },
  { verdict: 'flojo', title: 'Flojo' },
  { verdict: 'nuevo', title: 'Recién empezados' },
];
const WD_LETTER = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Hábitos: cómo vas con tu rutina (se arma sola con lo que registras), lo que podría volverse hábito y lo que quieres dejar. */
export default function Habitos() {
  const { state, list, byId } = useGame();
  const h = state.habits;
  const [dismissed, dismiss] = useDismissed();
  const [open, setOpen] = useState<string | null>(null);
  const suggestions = h.suggestions.filter((s) => !dismissed.has(s.key));
  const vices = list<ViceData>('habits', 'vice');
  const pct = h.summary.last30.rate === null ? null : Math.round(h.summary.last30.rate * 100);

  return (
    <>
      <PageHeader
        title="Hábitos"
        eyebrow="Tu rutina · últimos 30 días"
        right={
          <Link to="/dia" className="btn sm ghost">
            <Icon name="checklist" /> Mi día
          </Link>
        }
      />

      {h.routine.length === 0 ? (
        <div className="card">
          <Empty>
            Tu rutina está vacía. Agrega diarias en <Link to="/misiones?tab=daily">Misiones → Diarias</Link> y aquí verás cómo vas con cada una.
          </Empty>
        </div>
      ) : (
        <div className="card hab-summary">
          <ScoreRing value={pct} size={76} stroke={7} />
          <div style={{ minWidth: 0 }}>
            <div className="small muted" style={{ marginBottom: 8 }}>
              Cumpliste {pct === null ? '—' : `${pct}%`} de tu rutina · 7 días: {fmtRate(h.summary.last7.rate)}
            </div>
            <div className="hab-counts">
              <div className="bien">
                <b>{h.summary.bien}</b>
                <span>muy bien</span>
              </div>
              <div className="medias">
                <b>{h.summary.medias}</b>
                <span>a medias</span>
              </div>
              <div className="flojo">
                <b>{h.summary.flojo}</b>
                <span>flojos</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <>
          <div className="section-title">Se está volviendo hábito</div>
          <div className="card">
            {suggestions.map((s) => {
              const existing = s.dailyId ? (byId.get(s.dailyId) as Entity<MissionData> | undefined) : undefined;
              return (
                <div key={s.key} className="hab-sug">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="item-title ellipsis">{s.title}</div>
                    <div className="tiny muted">
                      {s.times} días en las últimas {Math.round(s.windowDays / 7)} semanas · {s.days.length ? `sueles hacerlo ${fmtWeekdays(s.days)}` : 'casi diario'}
                    </div>
                  </div>
                  <button className="btn sm primary" onClick={() => makeHabit(s, existing)}>
                    Hazlo hábito
                  </button>
                  <button className="btn icon sm ghost" aria-label={`Descartar ${s.title}`} onClick={() => dismiss(s.key)}>
                    <Icon name="x" />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {SECTIONS.map(({ verdict, title }) => {
        const items = h.routine.filter((x) => x.verdict === verdict).sort((a, b) => (b.last30.rate ?? 0) - (a.last30.rate ?? 0) || b.streak - a.streak);
        if (!items.length) return null;
        return (
          <div key={verdict}>
            <div className="section-title">
              {title} · {items.length}
            </div>
            <div className="card">
              {items.map((x) => (
                <HabitRow key={x.id} h={x} open={open === x.id} onToggle={() => setOpen(open === x.id ? null : x.id)} />
              ))}
            </div>
          </div>
        );
      })}
      {h.routine.length > 0 && <StripLegend />}

      <div className="section-title">Hábitos a dejar</div>
      <div className="card">
        {vices.length === 0 && (
          <div className="small muted">
            ¿Algo que quieras dejar? <Link to="/enemigos">Agrégalo</Link> y cuenta tus días sin recaer.
          </div>
        )}
        {vices.map((v) => {
          const st = state.vices[v.id];
          return (
            <Link key={v.id} to="/enemigos" className="item" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="item-title ellipsis">{v.data.name}</div>
                <div className="hab-meta">
                  <span>
                    {st?.relapses30 ?? 0} {st?.relapses30 === 1 ? 'recaída' : 'recaídas'} en 30 días
                  </span>
                  <TrendText trend={st?.trend ?? null} />
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="hab-pct bien">{st?.current ?? 0}</div>
                <div className="tiny muted">días limpio</div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function HabitRow({ h, open, onToggle }: { h: HabitStats; open: boolean; onToggle: () => void }) {
  return (
    <div className="hab-row">
      <button className="hab-row-btn" onClick={onToggle} aria-expanded={open}>
        <div className="hab-top">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="item-title ellipsis">{h.title}</div>
            <div className="hab-meta">
              <span>
                Racha {h.streak}
                {h.best > h.streak ? ` · mejor ${h.best}` : ''}
              </span>
              <TrendText trend={h.trend} points={h.trendPoints} />
              {h.dueToday && <span>{h.doneToday ? '✓ hoy' : 'hoy te toca'}</span>}
            </div>
          </div>
          <div className={`hab-pct ${h.verdict}`}>{fmtRate(h.last30.rate)}</div>
        </div>
        <DotStrip strip={h.strip} />
        {h.weakDays.length > 0 && !open && <div className="tiny" style={{ marginTop: 6, color: 'var(--flame)' }}>Fallas más en {fmtWeekdaysLong(h.weakDays)}</div>}
      </button>
      {open && <HabitDetail h={h} />}
    </div>
  );
}

function HabitDetail({ h }: { h: HabitStats }) {
  return (
    <div className="hab-detail">
      <div className="row between" style={{ marginBottom: 10 }}>
        <VerdictBadge verdict={h.verdict} />
        <span className="tiny muted">Toca {fmtWeekdays(h.days)} · desde {fmtDate(h.since, true)}</span>
      </div>
      <div className="hab-nums">
        <div>
          <span>7 días</span>
          <b>{fmtRate(h.last7.rate)}</b>
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>
            {h.last7.done}/{h.last7.due}
          </span>
        </div>
        <div>
          <span>30 días</span>
          <b>{fmtRate(h.last30.rate)}</b>
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>
            {h.last30.done}/{h.last30.due}
          </span>
        </div>
        <div>
          <span>Mes anterior</span>
          <b>{fmtRate(h.prev30.rate)}</b>
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>{h.prev30.due ? `${h.prev30.done}/${h.prev30.due}` : 'sin datos'}</span>
        </div>
      </div>
      <div className="tiny muted" style={{ marginBottom: 6 }}>
        Por día de la semana (8 semanas)
      </div>
      <div className="hab-wd">
        {h.byWeekday.map((r, i) => (
          <div key={i} className={`hab-wd-col ${h.weakDays.includes(i) ? 'weak' : ''} ${r.due === 0 ? 'na' : ''}`} title={`${WEEKDAY_SHORT[i]}: ${r.done}/${r.due}`}>
            <div className="hab-wd-bar">{r.rate !== null && <i style={{ height: `${Math.max(4, r.rate * 100)}%` }} />}</div>
            <span>{WD_LETTER[i]}</span>
          </div>
        ))}
      </div>
      <div className="small" style={{ marginTop: 10 }}>
        {h.weakDays.length
          ? `Donde más fallas: ${fmtWeekdaysLong(h.weakDays)}. Prepáralo desde la noche anterior.`
          : h.verdict === 'bien'
            ? 'Sin días flojos: así se ve un hábito firme.'
            : `${HABIT_VERDICT_LABELS[h.verdict]}: ningún día de la semana destaca; es cuestión de constancia.`}
      </div>
      {h.lastDone && <div className="tiny muted" style={{ marginTop: 4 }}>Última vez: {fmtDate(h.lastDone, true)}</div>}
      <Link to="/misiones?tab=daily" className="btn sm ghost" style={{ marginTop: 8 }}>
        <Icon name="edit" /> Editar sus días
      </Link>
    </div>
  );
}
