import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { insights, monthPace, personalRecords, type GoalData, type PersonalRecord } from '@igv/core';
import { useGame } from '../data/store';
import { fmtDate, fmtMoney, fmtMonth, fmtNum, TZ } from '../lib/time';
import { Badge, Empty, PageHeader } from '../ui/kit';
import { GoalPaceLine, MonthPaceLine } from '../ui/Pace';
import { WeekPaceCard } from '../ui/WeekPace';
import '../life.css';

function fmtValue(r: PersonalRecord, currency: string) {
  if (r.unit === 'dinero') return fmtMoney(r.value, currency);
  if (r.unit === 'xp') return `${fmtNum(r.value)} XP`;
  return `${fmtNum(r.value)} ${r.unit}`;
}

function fmtWhen(r: PersonalRecord) {
  if (!r.when) return '';
  if (r.id === 'best_week') return `semana del ${fmtDate(r.when, true)}`;
  if (r.id === 'best_month' || r.id === 'best_income_month') return fmtMonth(r.when);
  return fmtDate(r.when, true);
}

/** Récords personales, ritmo de tus metas y patrones calculados de tus propios registros. */
export default function Records() {
  const { state, events, list } = useGame();
  const records = useMemo(() => personalRecords(state), [state]);
  const found = useMemo(() => insights(state, events, TZ), [state, events]);
  const mp = useMemo(() => monthPace(state), [state]);
  const goals = list<GoalData>('goals', 'goal').filter((g) => g.data.deadline && !g.data.archived && !state.goals[g.id]?.completedOn);
  const cur = state.settings.currency;

  return (
    <>
      <PageHeader title="Récords y datos" eyebrow="Progreso" />
      <WeekPaceCard />

      <div className="section-title">Tus récords</div>
      <div className="card">
        {records.every((r) => r.value === 0) && <Empty>Tus mejores marcas aparecerán aquí en cuanto registres algo.</Empty>}
        {records
          .filter((r) => r.value > 0)
          .map((r) => (
            <div key={r.id} className={`record ${r.brokenNow ? 'new' : ''}`}>
              <div className="grow">
                <div className="item-title">{r.label}</div>
                <div className="tiny muted">
                  {fmtWhen(r)}
                  {r.brokenNow && r.previous ? ` · antes: ${r.unit === 'dinero' ? fmtMoney(r.previous, cur) : fmtNum(r.previous)}` : ''}
                </div>
              </div>
              {r.brokenNow && <Badge tone="gold">Nuevo</Badge>}
              <div className="record-val">{fmtValue(r, cur)}</div>
            </div>
          ))}
      </div>

      <div className="section-title">Ritmo</div>
      <div className="card">
        <div className="item-title">Ingresos del mes</div>
        <div className="tiny muted">
          {fmtMoney(state.money.monthIncome, cur)} de {fmtMoney(state.money.goal, cur)}
        </div>
        <MonthPaceLine pace={mp} currency={cur} />
        {goals.map((g) => (
          <div key={g.id} style={{ marginTop: 14 }}>
            <div className="item-title">{g.data.title}</div>
            <div className="tiny muted">
              {fmtNum(state.goals[g.id]?.current ?? 0)} / {fmtNum(g.data.target)} {g.data.unit} · fecha límite {fmtDate(g.data.deadline!, true)}
            </div>
            <GoalPaceLine goal={g} state={state} />
          </div>
        ))}
        {goals.length === 0 && (
          <div className="tiny muted" style={{ marginTop: 12 }}>
            Ponle fecha límite a tus <Link to="/metas">metas</Link> y aquí verás si vas a llegar.
          </div>
        )}
      </div>

      <div className="section-title">Datos sobre ti</div>
      <div className="card">
        {found.length === 0 && <Empty>Con un par de semanas de registros (sueño, misiones y cierres del día) aquí aparecen tus patrones.</Empty>}
        {found.map((x) => (
          <div key={x.id} className="insight">
            <span className={`insight-dot ${x.tone}`} />
            <div>
              <div className="item-title">{x.title}</div>
              <div className="tiny muted">{x.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
