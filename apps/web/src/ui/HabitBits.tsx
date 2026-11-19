import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HABIT_VERDICT_LABELS,
  dailySlotFor,
  fmtRate,
  fmtWeekdays,
  type Entity,
  type HabitDay,
  type HabitStats,
  type HabitSuggestion,
  type HabitTrend,
  type HabitVerdict,
  type MissionData,
} from '@igv/core';
import { deleteEntity, saveEntity, useGame } from '../data/store';
import { newId } from '../lib/time';
import { Icon } from './icons';
import { undoToast } from './kit';
import '../styles/habitos.css';

/** Anillo con el % (registro del día o cumplimiento). */
export function ScoreRing({ value, size = 44, stroke = 5 }: { value: number | null; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={`day-ring ${v >= 100 ? 'full' : ''}`} style={{ width: size, height: size }} aria-label={value === null ? 'Sin dato' : `${v}%`}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="fill" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <b style={{ fontSize: Math.round(size * 0.3) }}>
        {value === null ? '—' : v}
        {value !== null && <small>%</small>}
      </b>
    </div>
  );
}

const DAY_TITLE: Record<HabitDay, string> = {
  done: 'Hecho',
  missed: 'No lo hiciste',
  rest: 'Descanso',
  off: 'No tocaba',
  extra: 'Hecho (no tocaba)',
  before: 'Aún no existía',
  pending: 'Hoy, pendiente',
};

/** Últimos 30 días de un hábito (del más antiguo a hoy). */
export function DotStrip({ strip }: { strip: HabitDay[] }) {
  return (
    <div className="hab-strip" role="img" aria-label={`Últimos 30 días: ${strip.filter((d) => d === 'done').length} hechos, ${strip.filter((d) => d === 'missed').length} fallados`}>
      {strip.map((d, i) => (
        <span key={i} className={`hab-d ${d}`} title={DAY_TITLE[d]} />
      ))}
    </div>
  );
}

export function StripLegend() {
  const items: [HabitDay, string][] = [
    ['done', 'hecho'],
    ['missed', 'fallado'],
    ['rest', 'descanso'],
    ['off', 'no tocaba'],
    ['extra', 'extra'],
  ];
  return (
    <div className="hab-legend">
      {items.map(([d, l]) => (
        <span key={d}>
          <i className={`hab-d ${d}`} /> {l}
        </span>
      ))}
    </div>
  );
}

export const VERDICT_TONE: Record<HabitVerdict, string> = { bien: 'green', medias: 'gold', flojo: 'red', nuevo: '' };

export function VerdictBadge({ verdict }: { verdict: HabitVerdict }) {
  return <span className={`badge ${VERDICT_TONE[verdict]}`}>{HABIT_VERDICT_LABELS[verdict]}</span>;
}

export function TrendText({ trend, points }: { trend: HabitTrend | null; points?: number | null }) {
  if (!trend) return null;
  const arrow = trend === 'mejorando' ? '↑' : trend === 'empeorando' ? '↓' : '→';
  return (
    <span className={`hab-trend ${trend}`}>
      {arrow} {trend}
      {points !== undefined && points !== null && trend !== 'estable' ? ` ${points > 0 ? '+' : ''}${points} pts` : ''}
    </span>
  );
}

/** "Hazlo hábito": crea la diaria en la rutina (o mete a la rutina la que ya existía), con "Deshacer". */
export function makeHabit(s: HabitSuggestion, existing?: Entity<MissionData>) {
  if (existing) {
    const prev = existing;
    saveEntity<MissionData>({ id: prev.id, module: prev.module, kind: prev.kind, sort: prev.sort, data: { ...prev.data, routine: true, days: s.days.length ? s.days : prev.data.days } });
    undoToast(`«${s.title}» ya está en tu rutina`, () => saveEntity<MissionData>({ id: prev.id, module: prev.module, kind: prev.kind, sort: prev.sort, data: prev.data }));
    return;
  }
  const id = `daily-${newId().replace(/-/g, '').slice(0, 8)}`;
  saveEntity<MissionData>({
    id,
    module: 'missions',
    kind: 'daily',
    data: { title: s.title, size: s.size, attribute: s.attribute, category: dailySlotFor(s.attribute), routine: true, days: s.days },
  });
  undoToast(`«${s.title}» ya es parte de tu rutina (${fmtWeekdays(s.days)})`, () => deleteEntity(id));
}

const DISMISS_KEY = 'igv.habits.dismissed';

/** Sugerencias descartadas en este dispositivo (preferencia local, no es un registro). */
export function useDismissed(): [Set<string>, (key: string) => void] {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const dismiss = (key: string) => {
    const next = new Set(set).add(key);
    setSet(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...next].slice(-100)));
    } catch {
      /* sin almacenamiento local: solo se oculta en esta sesión */
    }
  };
  return [set, dismiss];
}

/** Lo más relevante de tus hábitos para Hoy (una línea). No se muestra si no hay nada que decir. */
export function HabitsHighlight() {
  const { state, byId } = useGame();
  const [dismissed] = useDismissed();
  const h = state.habits;
  const sug = h.suggestions.find((s) => !dismissed.has(s.key));
  if (sug) {
    const existing = sug.dailyId ? (byId.get(sug.dailyId) as Entity<MissionData> | undefined) : undefined;
    return (
      <div className="card hab-highlight">
        <Icon name="repeat" />
        <Link to="/habitos" className="grow">
          Lo haces seguido: <b>{sug.title}</b>
          <div className="tiny muted">
            {sug.times} días en las últimas {Math.round(sug.windowDays / 7)} semanas
          </div>
        </Link>
        <button className="btn sm primary" onClick={() => makeHabit(sug, existing)}>
          Hazlo hábito
        </button>
      </div>
    );
  }
  const weak = [...h.routine]
    .filter((x: HabitStats) => x.dueToday && !x.doneToday && (x.verdict === 'flojo' || x.trend === 'empeorando'))
    .sort((a, b) => (a.last30.rate ?? 1) - (b.last30.rate ?? 1))[0];
  if (!weak) return null;
  return (
    <Link to="/habitos" className="card hab-highlight">
      <Icon name="repeat" />
      <div className="grow">
        <b>{weak.title}</b> {weak.verdict === 'flojo' ? 'va flojo' : 'va de bajada'}: {fmtRate(weak.last30.rate)} en 30 días
        <div className="tiny muted">Hoy te toca · {weak.trend === 'empeorando' && weak.trendPoints !== null ? `${weak.trendPoints} pts vs. el mes anterior` : 'un día a la vez'}</div>
      </div>
      <Icon name="right" width={16} className="muted" />
    </Link>
  );
}
