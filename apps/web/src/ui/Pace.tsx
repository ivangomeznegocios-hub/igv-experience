import { goalPace, toLocalDate, type Entity, type GameState, type GoalData, type Pace } from '@igv/core';
import { fmtMoney, fmtNum, TZ } from '../lib/time';
import '../life.css';

const STATUS: Record<Pace['status'], string> = {
  done: 'Cumplida',
  ahead: 'Vas adelantado',
  on_track: 'Vas en ritmo',
  behind: 'Vas atrasado',
  overdue: 'Se pasó la fecha',
};

/** Fecha en que empezó una meta: su creación, o su primer avance. */
export function goalStart(g: Entity<GoalData>, state: GameState): string {
  const first = state.goals[g.id]?.entries[0]?.date;
  const created = g.createdAt ? toLocalDate(g.createdAt, TZ) : null;
  return [first, created, state.today].filter(Boolean).sort()[0]!;
}

/** Línea de ritmo de una meta con fecha límite ("necesitas 3 por semana; llevas 2"). */
export function GoalPaceLine({ goal, state }: { goal: Entity<GoalData>; state: GameState }) {
  const gs = state.goals[goal.id];
  if (!gs || gs.completedOn) return null;
  const p = goalPace(goal.data, gs, goalStart(goal, state), state.today);
  if (!p) return null;
  const u = goal.data.unit;
  const n = (x: number) => (x >= 10 ? fmtNum(Math.round(x)) : String(Math.round(x * 10) / 10));
  return (
    <div className={`pace ${p.status}`}>
      <b>{STATUS[p.status]}.</b>{' '}
      {p.status === 'overdue' ? (
        <>Te faltan {n(p.remaining)} {u}. Cambia la fecha o dale un último empujón.</>
      ) : (
        <>
          Necesitas <b>{n(p.neededPerWeek)}</b> {u}/semana; tu ritmo es <b>{n(p.actualPerWeek)}</b>. A este paso llegas a {n(Math.min(p.projected, gs.target * 9))} de {n(gs.target)}.
        </>
      )}
    </div>
  );
}

/** Ritmo del ingreso del mes contra la meta mensual. */
export function MonthPaceLine({ pace, currency }: { pace: (Pace & { perDayNeeded: number }) | null; currency: string }) {
  if (!pace) return null;
  return (
    <div className={`pace ${pace.status}`}>
      <b>{STATUS[pace.status]}.</b>{' '}
      {pace.status === 'done' ? (
        <>Meta del mes cubierta.</>
      ) : (
        <>
          Te faltan <b>{fmtMoney(pace.remaining, currency)}</b>: unos <b>{fmtMoney(pace.perDayNeeded, currency)}</b> por día. A tu ritmo cierras el mes en {fmtMoney(pace.projected, currency)}.
        </>
      )}
    </div>
  );
}
