import { useLocation, useNavigate } from 'react-router-dom';
import { TIME_AREA_NAMES } from '@igv/core';
import { fmtClock, useNow, useTimer } from '../../lib/timeTimer';
import { AREA_COLOR } from './shared';

/** Aviso flotante del cronómetro de "Tu tiempo" mientras corre (en cualquier pantalla menos en /tiempo). */
export default function TimerPill() {
  const timer = useTimer();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const hidden = !timer || pathname.startsWith('/tiempo');
  const now = useNow(!hidden, 1000);
  if (hidden || !timer) return null;
  return (
    <button className="hab-timer-pill" onClick={() => navigate('/tiempo')} aria-label="Cronómetro en curso: abrir Tu tiempo">
      <i className="hab-live" style={{ background: AREA_COLOR[timer.area] }} />
      {TIME_AREA_NAMES[timer.area]}
      <b className="num">{fmtClock(now - timer.startedAt)}</b>
    </button>
  );
}
