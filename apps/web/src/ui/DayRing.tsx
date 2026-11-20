import { Link } from 'react-router-dom';
import type { DayPart, DayPartId, DayStatus, GameState } from '@igv/core';
import { useGame } from '../data/store';
import { updateSettings } from '../lib/actions';
import { fmtNum } from '../lib/time';
import { openDayDeck } from './DayDeck';
import { Icon } from './icons';
import { toast } from './kit';
import '../styles/mesa.css';

export const PART_LABELS: Record<DayPartId, string> = { routine: 'Rutina', plan: 'Tus 3', log: 'Registro', close: 'Cierre' };

export const STATUS_LABELS: Record<DayStatus, string> = {
  won: 'Día ganado',
  saved: 'Día salvado',
  rest: 'Descanso',
  free: 'Día libre',
  pause: 'Pausa',
  lost: 'No ganado',
  pending: 'En juego',
};

const WEEK_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Activa el marcador desde hoy (más adelante lo hará el arranque guiado). */
export function startScore(state: GameState) {
  updateSettings(state.settings, { scoreStart: state.today });
  toast('Listo: desde hoy cada día cuenta. Gánalo con tu rutina, tus 3 y tu cierre.', 'xp');
}

/**
 * El anillo del día: un arco partido en las piezas del puntaje (rutina, tus 3, registro, cierre), cada una del
 * tamaño de su peso y llena según lo que llevas. La marca indica dónde se gana el día.
 */
export function DayDial({ parts, score, threshold, won, size = 188, animatedScore }: { parts: DayPart[]; score: number; threshold: number; won: boolean; size?: number; animatedScore?: number }) {
  const stroke = Math.round(size * 0.075);
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  const span = 0.75; // 270°
  const arc = c * span;
  const totalW = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const gap = parts.length > 1 ? Math.max(3, stroke * 0.45) : 0;
  let offset = 0;
  const segs = parts.map((p) => {
    const len = (p.weight / totalW) * arc;
    const seg = { p, start: offset, len: Math.max(0, len - gap) };
    offset += len;
    return seg;
  });
  // La marca de "ganar" en el punto del arco que corresponde al umbral.
  const angle = 135 + 270 * (threshold / 100);
  const rad = (angle * Math.PI) / 180;
  const cx = size / 2;
  const tick = (k: number) => ({ x: cx + Math.cos(rad) * (r + k), y: cx + Math.sin(rad) * (r + k) });
  const t1 = tick(-stroke / 2 - 4);
  const t2 = tick(stroke / 2 + 4);
  const shown = animatedScore ?? score;
  return (
    <div className={`dial ${won ? 'won' : ''}`} style={{ width: size, height: size }} role="img" aria-label={`Puntaje del día: ${score} de 100. Se gana con ${threshold}.`}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`rotate(135 ${cx} ${cx})`}>
          {segs.map(({ p, start, len }) => (
            <g key={p.id}>
              <circle className="dial-track" cx={cx} cy={cx} r={r} fill="none" strokeWidth={stroke} strokeDasharray={`${len} ${c}`} strokeDashoffset={-start} />
              <circle
                className={`dial-fill part-${p.id}`}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                strokeWidth={stroke}
                strokeDasharray={`${len * p.value} ${c}`}
                strokeDashoffset={-start}
              />
            </g>
          ))}
        </g>
        <line className="dial-tick" x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} />
      </svg>
      <div className="dial-center">
        <b className="dial-score num">{shown}</b>
        <span className="dial-of">de 100</span>
      </div>
    </div>
  );
}

/** Las piezas del puntaje con lo que llevas de cada una. */
export function PartsLegend({ parts }: { parts: DayPart[] }) {
  return (
    <ul className="dial-legend">
      {parts.map((p) => (
        <li key={p.id} className={p.value >= 1 ? 'full' : ''}>
          <i className={`part-${p.id}`} aria-hidden="true" />
          <span>{PART_LABELS[p.id]}</span>
          <b className="num">{p.id === 'close' ? (p.done ? 'Hecho' : 'Falta') : `${p.done}/${p.due}`}</b>
        </li>
      ))}
    </ul>
  );
}

/** La semana en curso: un cuadro por día con cómo quedó. */
export function WeekDots({ state }: { state: GameState }) {
  const w = state.days.week;
  return (
    <div className="week-dots" aria-label={`Esta semana: ${w.won} días ganados`}>
      {w.days.map((d, i) => (
        <div key={d.date} className={`wd ${d.status ?? 'none'} ${d.date === state.today ? 'today' : ''}`} title={d.status ? `${STATUS_LABELS[d.status]}${d.score !== null ? ` · ${d.score}` : ''}` : ''}>
          <span>{WEEK_INITIALS[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** Tarjeta principal de la mesa: anillo, veredicto, semana y nivel. */
export function DayCard() {
  const { state } = useGame();
  const t = state.days.today;
  const { level } = state;
  const levelLine = (
    <Link to="/personaje" className="dial-level">
      <span className="num">Nivel {level.level}</span>
      <span className="dial-level-bar" aria-hidden="true">
        <i style={{ width: `${Math.round((level.xpIntoLevel / Math.max(1, level.xpNeeded)) * 100)}%` }} />
      </span>
      <span className="muted num">{fmtNum(level.nextLevelXp - level.totalXp)} XP al {level.level + 1}</span>
      <span className="gold num dial-gold">
        <Icon name="coin" width={13} height={13} /> {fmtNum(state.gold.balance)}
      </span>
    </Link>
  );

  if (!t) {
    return (
      <section className="card day-card" aria-label="Tu día">
        <div className="day-card-empty">
          <h2>Cada día es una partida</h2>
          <p className="small muted">
            Tu rutina, tus 3 del día, lo que registras y tu cierre suman hasta 100 puntos. Con {state.days.threshold} ganas el día. Los días que no juegas no
            cuentan en tu contra.
          </p>
          <button className="btn primary" onClick={() => startScore(state)}>
            Empezar desde hoy
          </button>
        </div>
        {levelLine}
      </section>
    );
  }

  const won = t.status === 'won';
  return (
    <section className={`card day-card ${won ? 'is-won' : ''}`} aria-label="Tu día">
      <div className="day-card-main">
        <DayDial parts={t.parts} score={t.score} threshold={state.days.threshold} won={won} />
        <div className="day-card-side">
          <div className={`day-verdict ${t.status}`}>{won ? 'Día ganado' : `Te faltan ${t.toWin} para ganar`}</div>
          <PartsLegend parts={t.parts} />
          {t.logMissing.length > 0 && (
            <button className="btn sm day-log-btn" onClick={() => openDayDeck({ date: state.today })}>
              Registrar lo que falta ({t.logMissing.length})
            </button>
          )}
          <WeekDots state={state} />
          <div className="tiny muted">
            {state.days.week.won} {state.days.week.won === 1 ? 'día ganado' : 'días ganados'} esta semana
            {state.days.totals.currentRun > 1 && ` · ${state.days.totals.currentRun} seguidos`}
          </div>
        </div>
      </div>
      {levelLine}
    </section>
  );
}
