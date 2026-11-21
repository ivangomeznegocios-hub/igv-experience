import { Link } from 'react-router-dom';
import type { CoachAction, CoachActionKind, CoachPlan, GameState } from '@igv/core';
import { useGame } from '../../data/store';
import { draftFromCoach, logWater, openCoachSheet, useCoachPlan } from '../../lib/coach';
import { openWorkout } from '../../lib/entreno';
import { Icon } from '../icons';
import { CoachFace } from './CoachFace';
import { useCoachEnabled } from '../../lib/voz';
import '../../styles/coach.css';

const ACTION_ICON: Record<CoachActionKind, string> = {
  arrancar: 'whistle',
  sesion: 'dumbbell',
  cardio: 'footsteps',
  sentir: 'heart',
  sueno: 'moon',
  medidas: 'ruler',
  checkin: 'checklist',
  comida: 'apple',
  agua: 'water',
  pasos: 'footsteps',
  perfil: 'user',
};

/** Hace lo que pide una acción del coach (abrir la sesión, una hoja o sumar un vaso de agua). */
export function runCoachAction(a: CoachAction, plan: CoachPlan, state: GameState) {
  switch (a.kind) {
    case 'arrancar':
    case 'perfil':
      return openCoachSheet('setup');
    case 'sesion':
    case 'cardio':
      return openWorkout({ draft: draftFromCoach(plan.today.session, state) });
    case 'checkin':
      return openCoachSheet({ kind: 'checkin', week: plan.checkinWeek ?? undefined });
    case 'agua':
      return logWater(1);
    case 'sentir':
      return openCoachSheet('sentir');
    case 'sueno':
      return openCoachSheet('sueno');
    case 'medidas':
      return openCoachSheet('medidas');
    case 'comida':
      return openCoachSheet('comida');
    case 'pasos':
      return openCoachSheet('pasos');
  }
}

/**
 * Tu coach te habla: carita con su ánimo, un mensaje según tu día (sesión pendiente, dormiste poco, ya entrenaste,
 * vas atrasado…) y lo que te pide (empezar la sesión, cómo te sientes, check-in, medidas, comida, agua, pasos).
 * `compact` = versión para Hoy.
 */
export function CoachCard({ compact = false }: { compact?: boolean }) {
  const { state } = useGame();
  const plan = useCoachPlan();
  const ai = useCoachEnabled();
  const b = plan.brief;
  const [first, ...rest] = b.actions;
  const more = rest.slice(0, compact ? 2 : 6);
  return (
    <div className={`card coach-card mood-${b.mood} ${compact ? 'compact' : ''}`}>
      <div className="coach-head">
        <CoachFace mood={b.mood} size={compact ? 46 : 60} title={plan.profile.coachName} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="eyebrow">
            {plan.profile.coachName}
            {plan.profile.configured ? ` · ${plan.phase.name}${plan.phase.light ? ' (ligera)' : ''} · semana ${plan.phase.weekNumber}` : ' · tu entrenador'}
          </div>
          <div className="coach-msg-main">
            {!compact && <span className="muted">{b.greeting} </span>}
            {b.message}
          </div>
        </div>
      </div>
      {b.extra.length > 0 && (
        <ul className="coach-extra">
          {(compact ? b.extra.slice(0, 1) : b.extra).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {(first || more.length > 0) && (
        <div className="coach-actions-row">
          {first && (
            <button className="btn primary coach-primary" onClick={() => runCoachAction(first, plan, state)}>
              <span>
                <Icon name={ACTION_ICON[first.kind]} /> {first.label}
              </span>
              {first.detail && !compact && <small className="coach-act-detail">{first.detail}</small>}
            </button>
          )}
          {more.map((a) => (
            <button key={a.kind} className="btn sm" onClick={() => runCoachAction(a, plan, state)} title={a.detail}>
              <Icon name={ACTION_ICON[a.kind]} /> {a.label}
            </button>
          ))}
        </div>
      )}
      {compact ? (
        <div className="row between" style={{ marginTop: 8 }}>
          <Link to="/entreno?tab=coach" className="tiny linkish">
            Ver tu plan →
          </Link>
          {ai && (
            <button className="tiny linkish" onClick={() => openCoachSheet('chat')}>
              <Icon name="chat" width={13} /> Pregúntale
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
