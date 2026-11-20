import type { GameState } from './project';
import { addDays } from '../util/dates';

/**
 * "Siguiente jugada": la única cosa que la pantalla principal te propone ahora mismo. Pura y determinista (la usa
 * la app y, después, el Coach). Nunca regaña: si regresas de una pausa, lo primero es la jugada de regreso.
 */
export type NextPlayAction =
  /** Regreso de una pausa: haz una cosa chica. */
  | { kind: 'comeback' }
  /** Activar el marcador (aún no hay `scoreStart`). */
  | { kind: 'start' }
  /** Resolver un compromiso que ya venció. */
  | { kind: 'pledge'; pledgeId: string }
  | { kind: 'sleep' }
  /** Elegir tus 3 de hoy. */
  | { kind: 'plan'; date: string }
  /** Completar una misión de tu rutina o de tus 3. */
  | { kind: 'mission'; missionId: string }
  /** Registrar lo que falta del día (baraja). */
  | { kind: 'log' }
  | { kind: 'close' }
  /** Planear mañana. */
  | { kind: 'plan-tomorrow'; date: string }
  | { kind: 'done' };

export interface NextPlay {
  id: string;
  title: string;
  sub: string;
  /** Puntos que suma al puntaje de hoy (si aplica). */
  points?: number;
  action: NextPlayAction;
}

export function nextPlay(state: GameState, opts: { hour: number }): NextPlay {
  const { days } = state;
  const t = days.today;
  const hour = opts.hour;

  if (!days.start || !t) {
    return { id: 'start', title: 'Arranca tu marcador', sub: 'Desde hoy cada día cuenta: gánalo con tu rutina, tus 3 y tu cierre.', action: { kind: 'start' } };
  }

  if (days.comeback && !days.comeback.done) {
    return {
      id: 'comeback',
      title: 'Qué bueno que regresaste',
      sub: `Haz una sola cosa chica hoy y recuperas tu impulso (×${(days.comeback.restoresPct / 100).toFixed(2).replace(/0$/, '')}).`,
      action: { kind: 'comeback' },
    };
  }

  const overdue = state.gold.pledges.find((p) => p.valid && p.status === 'open' && p.deadline < state.today);
  if (overdue) {
    return { id: `pledge-${overdue.pledgeId}`, title: `¿Cumpliste “${overdue.title}”?`, sub: 'Tu compromiso ya venció. Resuélvelo para liberar tu oro.', action: { kind: 'pledge', pledgeId: overdue.pledgeId } };
  }

  if (hour < 12 && state.energy.value === null) {
    return { id: 'sleep', title: '¿Cuánto dormiste?', sub: 'Un toque y sabes con cuánta energía arrancas.', action: { kind: 'sleep' } };
  }

  if (!state.plans[state.today]?.items.length && hour < 15 && t.status !== 'won') {
    return { id: 'plan', title: 'Elige tus 3 de hoy', sub: 'Las tres cosas que harían que hoy valga la pena.', action: { kind: 'plan', date: state.today } };
  }

  if (t.status !== 'won') {
    const top = t.pending[0];
    const logPts = t.logMissing.reduce((s, x) => s + x.points, 0);
    // Cerca de la noche, si cerrar y registrar alcanzan para ganar, eso primero.
    const late = hour >= 20;
    if (top && !(late && logPts + t.closePoints >= t.toWin)) {
      return {
        id: `mission-${top.missionId}`,
        title: top.title,
        sub: top.inPlan ? 'Es de tus 3 de hoy.' : 'Te toca hoy en tu rutina.',
        points: top.points,
        action: { kind: 'mission', missionId: top.missionId },
      };
    }
    if (t.logMissing.length) {
      return { id: 'log', title: 'Registra tu día', sub: 'Unos toques: lo que falta, una tarjeta a la vez.', points: logPts, action: { kind: 'log' } };
    }
  }

  if (!t.closed && (hour >= 18 || t.status === 'won')) {
    return {
      id: 'close',
      title: 'Cierra tu día',
      sub: t.status === 'won' ? 'Ya lo ganaste: ciérralo y ve tu resultado.' : `Cerrar suma ${t.closePoints} puntos.`,
      points: t.closePoints || undefined,
      action: { kind: 'close' },
    };
  }

  const tomorrow = addDays(state.today, 1);
  if (t.closed && !state.plans[tomorrow]?.items.length) {
    return { id: 'plan-tomorrow', title: 'Planea mañana', sub: 'Elige tus 3 y mañana arrancas con todo armado.', action: { kind: 'plan-tomorrow', date: tomorrow } };
  }

  if (!t.closed) {
    return { id: 'close', title: 'Cierra tu día', sub: 'Cuando termines, ciérralo y ve tu resultado.', points: t.closePoints || undefined, action: { kind: 'close' } };
  }
  return { id: 'done', title: 'Listo por hoy', sub: t.status === 'won' ? 'Día ganado. Descansa.' : 'Mañana es otro día.', action: { kind: 'done' } };
}
