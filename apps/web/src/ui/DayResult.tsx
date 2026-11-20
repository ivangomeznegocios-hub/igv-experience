import { useEffect, useRef, useState } from 'react';
import { GAME_CONFIG, addDays, goldFor, type DayPart } from '@igv/core';
import { useGame } from '../data/store';
import { haptic, sfx } from '../lib/sound';
import { fmtDate, fmtNum, fmtWeekday } from '../lib/time';
import { DayDial, PartsLegend, STATUS_LABELS, WeekDots } from './DayRing';
import { openPlanSheet } from './DayPlan';
import '../styles/mesa.css';

const bus = new Set<(date: string) => void>();
/** Muestra el resultado de un día (se abre solo al cerrarlo). */
export function openDayResult(date: string) {
  bus.forEach((f) => f(date));
}

/** Cuenta de 0 al valor (respeta "reducir movimiento"). */
export function useCountUp(target: number, ms = 900): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Se monta una vez en App. */
export function DayResultHost() {
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    const f = (d: string) => setDate(d);
    bus.add(f);
    return () => {
      bus.delete(f);
    };
  }, []);
  if (!date) return null;
  return <DayResult key={date} date={date} onClose={() => setDate(null)} />;
}

function DayResult({ date, onClose }: { date: string; onClose: () => void }) {
  const { state } = useGame();
  const r = state.days.byDate[date];
  const isToday = date === state.today;
  const score = r?.score ?? 0;
  const shown = useCountUp(score);
  // Las piezas del anillo se llenan junto con el número.
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setFilled(true), 60);
    return () => window.clearTimeout(t);
  }, []);
  const cheered = useRef(false);
  useEffect(() => {
    if (cheered.current || !r) return;
    cheered.current = true;
    if (r.status === 'won') {
      window.setTimeout(() => {
        sfx.perfectDay();
        haptic([30, 60, 30]);
      }, 850);
    }
  }, [r]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const xp = state.xp.ledger.reduce((s, e) => (e.date === date ? s + e.amount : s), 0);
  const gold =
    state.xp.ledger.reduce((s, e) => (e.date === date ? s + goldFor(e, GAME_CONFIG.gold.xpPerGold) : s), 0) +
    state.gold.bonuses.reduce((s, b) => (b.date === date ? s + b.amount : s), 0);
  const closeBonus = state.gold.bonuses.find((b) => b.source === 'day_close' && b.date === date);
  const pending = isToday && r?.status !== 'won' ? (state.days.today?.pending ?? []).slice(0, 3) : [];
  const tomorrow = addDays(state.today, 1);
  const canPlan = isToday && !state.plans[tomorrow]?.items.length;

  const verdict = !r ? 'Sin marcador' : r.status === 'pending' ? 'Aún puedes ganarlo' : STATUS_LABELS[r.status];
  const verdictSub =
    !r ? null : r.status === 'pending' ? `Te faltan ${state.days.threshold - score} puntos.` : r.status === 'saved' ? 'Hiciste tu mínimo: tu ritmo sigue.' : null;
  const parts: DayPart[] = (r?.parts ?? []).map((p) => (filled ? p : { ...p, value: 0 }));

  return (
    <div className="result-overlay" role="dialog" aria-modal="true" aria-label={`Resultado del ${fmtDate(date, true)}`}>
      <div className="result-box">
        <div className="result-date">
          {fmtWeekday(date)} {fmtDate(date, true)}
        </div>
        {r ? (
          <>
            <DayDial parts={parts} score={score} animatedScore={shown} threshold={state.days.threshold} won={r.status === 'won'} size={210} />
            <div className={`result-verdict ${r.status}`}>{verdict}</div>
            {verdictSub && <div className="small muted" style={{ marginTop: -8 }}>{verdictSub}</div>}
            <PartsLegend parts={r.parts} />
          </>
        ) : (
          <p className="muted">{state.days.start ? 'Este día es anterior a tu marcador.' : 'Tu marcador aún no empieza: actívalo en Hoy con "Empezar desde hoy".'}</p>
        )}

        <div className="result-earned">
          <div>
            <b className="num">+{fmtNum(xp)}</b>
            <span>XP</span>
          </div>
          <div>
            <b className="num gold">+{fmtNum(gold)}</b>
            <span>oro{closeBonus ? ` (incluye ${closeBonus.amount} por cerrar)` : ''}</span>
          </div>
        </div>

        {pending.length > 0 && (
          <div className="result-left">
            <div className="small">Lo que todavía suma hoy</div>
            <ul>
              {pending.map((p) => (
                <li key={p.missionId}>
                  <span>{p.title}</span>
                  <b className="num">+{p.points}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {r && (
          <div className="result-week">
            <WeekDots state={state} />
            <div className="tiny muted">
              {state.days.week.won} {state.days.week.won === 1 ? 'día ganado' : 'días ganados'} esta semana
            </div>
          </div>
        )}

        <div className="result-actions">
          {canPlan && (
            <button
              className="btn primary"
              onClick={() => {
                onClose();
                openPlanSheet(tomorrow);
              }}
            >
              Planear mañana
            </button>
          )}
          <button className={`btn ${canPlan ? '' : 'primary'}`} onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
