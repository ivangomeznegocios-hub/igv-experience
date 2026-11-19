import { EVENT_LABELS, MISSION_SIZE_NAMES, addDays, describeMeasures, type EventType, type GameEvent } from '@igv/core';
import { restoreEvent, useGame, voidEvent } from '../data/store';
import { fmtDate, fmtMoney, fmtWeekday } from '../lib/time';
import { Badge, Empty, Sheet, confirmAction } from './kit';
import { Icon } from './icons';
import { openQuickAdd } from './QuickAdd';

const SOURCE_LABEL: Record<string, string> = {
  mission: 'Misión',
  streak: 'Racha',
  lesson: 'Lección',
  achievement: 'Logro',
  skill: 'Habilidad',
  boss_phase: 'Gran reto',
  recurring_boss: 'Reto recurrente',
  discovery: 'Mapa',
  bounty: 'Sorpresa',
  goal: 'Meta',
  library: 'Biblioteca',
  challenge: 'Reto completado',
};
const MOODS = ['😫', '😕', '😐', '🙂', '🔥'];

/** Describe un evento en una línea. */
export function describeEvent(e: GameEvent, currency = 'MXN'): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'mission.completed':
      return `${p.title} (${MISSION_SIZE_NAMES[p.size as keyof typeof MISSION_SIZE_NAMES] ?? p.size})`;
    case 'income.recorded':
    case 'expense.recorded':
      return `${fmtMoney(p.amount, currency)} ${p.concept ?? ''}`;
    case 'checkin.morning':
      return `${p.sleepHours} h de sueño`;
    case 'lesson.written':
      return String(p.text ?? '').slice(0, 80);
    case 'boss.recurring_defeated':
    case 'npc.interaction':
      return String(p.note ?? '').slice(0, 80);
    case 'day.closed':
      return `${p.mood ? MOODS[p.mood - 1] + ' ' : ''}${p.note ?? ''}`;
    case 'bounty.drawn':
      return p.title;
    case 'reward.redeemed':
      return `${p.name} (${p.cost} oro)`;
    case 'goal.progress':
      return `+${p.amount}`;
    case 'library.finished':
      return p.title;
    case 'body.logged':
      return [describeMeasures(p), p.workout ?? '', p.note ?? ''].filter(Boolean).join(' · ');
    case 'savings.moved':
      return fmtMoney(p.amount, currency);
    default:
      return '';
  }
}

/** Todo lo que pasó en un día: XP, registros (con anular/restaurar) y botón para registrar en ese día. */
export function DaySheet({ date, onClose, onNav }: { date: string; onClose: () => void; onNav?: (d: string) => void }) {
  const { state, events } = useGame();
  const xp = state.xp.ledger.filter((e) => e.date === date);
  const total = xp.reduce((s, e) => s + e.amount, 0);
  const dayEvents = events
    .filter((e) => e.localDate === date && e.type !== 'bounty.drawn' && e.type !== 'daily.selected' && e.type !== 'weekly.selected')
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const closure = state.dayClosures[date];
  const future = date > state.today;
  return (
    <Sheet open onClose={onClose} title={`${fmtWeekday(date)} ${fmtDate(date, true)}`}>
      {onNav && (
        <div className="row between" style={{ marginTop: -6, marginBottom: 10 }}>
          <button className="btn sm ghost" onClick={() => onNav(addDays(date, -1))}>
            <Icon name="left" /> Anterior
          </button>
          <button className="btn sm ghost" onClick={() => onNav(addDays(date, 1))} disabled={date >= state.today}>
            Siguiente <Icon name="right" />
          </button>
        </div>
      )}
      {future ? (
        <Empty>Este día aún no llega.</Empty>
      ) : (
        <>
          <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
            <Badge tone="gold">+{total} XP</Badge>
            {state.streak && events.some((e) => !e.voidedAt && e.type === 'rest_day.marked' && e.localDate === date) && <Badge tone="blue">Descanso</Badge>}
            {closure?.mood && <Badge>{MOODS[closure.mood - 1]}</Badge>}
          </div>
          {closure?.note && <p className="small" style={{ marginTop: 0 }}>“{closure.note}”</p>}
          {xp.length > 0 && (
            <>
              <div className="eyebrow">XP</div>
              {xp.map((e, i) => (
                <div key={i} className="item" style={{ padding: '6px 0' }}>
                  <div className="grow small">
                    {e.label} <span className="tiny muted">· {SOURCE_LABEL[e.source] ?? e.source}</span>
                  </div>
                  <b className="gold num small">+{e.amount}</b>
                </div>
              ))}
            </>
          )}
          <div className="eyebrow" style={{ marginTop: 12 }}>
            Registros
          </div>
          {dayEvents.length === 0 && <div className="small muted">Nada registrado este día.</div>}
          {dayEvents.map((e) => (
            <div key={e.id} className="item" style={{ padding: '6px 0', opacity: e.voidedAt ? 0.5 : 1 }}>
              <div className="grow">
                <div className="small" style={{ fontWeight: 650, textDecoration: e.voidedAt ? 'line-through' : undefined }}>
                  {EVENT_LABELS[e.type as EventType] ?? e.type}
                </div>
                <div className="tiny muted ellipsis">{describeEvent(e, state.settings.currency)}</div>
              </div>
              {e.voidedAt ? (
                <button className="btn sm ghost" onClick={() => restoreEvent(e.id)}>
                  Restaurar
                </button>
              ) : (
                <button className="btn sm ghost danger" onClick={() => confirmAction('¿Anular este registro? Deja de contar y todo se recalcula.') && voidEvent(e.id)}>
                  Anular
                </button>
              )}
            </div>
          ))}
          <button
            className="btn primary block"
            style={{ marginTop: 12 }}
            onClick={() => {
              onClose();
              openQuickAdd({ mode: 'menu', date });
            }}
          >
            <Icon name="plus" /> Registrar en este día
          </button>
        </>
      )}
    </Sheet>
  );
}
