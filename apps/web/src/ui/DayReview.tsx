import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { dayReviewInputFromState, fmtMissing, reviewDay, type DayReview } from '@igv/core';
import { useGame } from '../data/store';
import { localHour } from '../lib/narrator';
import { Icon } from './icons';
import { ScoreRing } from './HabitBits';
import '../styles/habitos.css';

/** Revisión de un día ("¿Cómo fue tu día?") calculada en el dispositivo. */
export function useDayReview(date: string): DayReview {
  const { state, events, entities } = useGame();
  return useMemo(() => reviewDay(dayReviewInputFromState(state, events, entities, date)), [state, events, entities, date]);
}

/** "sueño, gastos y con quién estuviste" (hoy, antes de la noche, no insiste con el cierre). */
export function missingLine(r: DayReview, max = 3): string {
  const gaps = r.isToday && localHour() < 18 ? r.missing.filter((c) => c.id !== 'cierre') : r.missing;
  return gaps.length ? `Te falta: ${fmtMissing(gaps, max)}` : r.missing.length ? 'Solo falta cerrar el día' : 'Todo registrado';
}

/** Fila compacta "Tu día: 60 % registrado · te falta…" que lleva a /dia. */
export function DayReviewRow({ date, onNavigate, flat }: { date?: string; onNavigate?: () => void; flat?: boolean }) {
  const { state } = useGame();
  const d = date ?? state.today;
  const r = useDayReview(d);
  if (r.score === null) return null;
  const to = d === state.today ? '/dia' : `/dia?fecha=${d}`;
  return (
    <Link to={to} onClick={onNavigate} className={`${flat ? '' : 'card '}day-row`} style={flat ? { padding: '4px 0 12px' } : undefined}>
      <ScoreRing value={r.score} size={46} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="eyebrow">¿Cómo fue tu día?</div>
        <b>{r.score >= 100 ? 'Día completo' : `${r.score}% registrado`}</b>
        <div className="tiny muted ellipsis">{missingLine(r, 2)}</div>
      </div>
      <Icon name="right" width={18} className="muted" />
    </Link>
  );
}
