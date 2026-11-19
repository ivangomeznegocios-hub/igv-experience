import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { ChallengeData } from '../../types';
import { addDays, diffDays } from '../../util/dates';

export interface ChallengeAttempt {
  startDate: string;
  /** Último día del reto (inclusive). */
  endDate: string;
  /** Días cumplidos (dentro del intento). */
  checked: string[];
  status: 'active' | 'completed' | 'failed';
  /** Día en que se completó o el día que se saltó (falló). */
  closedOn: string | null;
}

export interface ChallengeState {
  attempts: ChallengeAttempt[];
  /** Intento en curso (o null). */
  current: ChallengeAttempt | null;
  /** Último intento (en curso o terminado). */
  last: ChallengeAttempt | null;
  /** Días cumplidos seguidos del intento en curso. */
  streak: number;
  checkedToday: boolean;
  completions: number;
}

/**
 * Retos de N días seguidos. Cada `challenge.started` abre un intento (si no hay otro en curso).
 * Un intento falla si un día ya terminado no se marcó; hoy nunca lo hace fallar.
 * Completarlo da la XP de una misión de su tamaño (una vez por intento completado).
 */
export function reduceChallenges(ctx: Ctx): Record<string, ChallengeState> {
  const out: Record<string, ChallengeState> = {};
  const starts = new Map<string, string[]>();
  const checks = new Map<string, Set<string>>();
  for (const e of ofType<{ challengeId: string }>(ctx, 'challenge.started')) {
    if (!starts.has(e.payload.challengeId)) starts.set(e.payload.challengeId, []);
    starts.get(e.payload.challengeId)!.push(e.localDate);
  }
  for (const e of ofType<{ challengeId: string }>(ctx, 'challenge.checked')) {
    if (!checks.has(e.payload.challengeId)) checks.set(e.payload.challengeId, new Set());
    checks.get(e.payload.challengeId)!.add(e.localDate);
  }

  for (const c of entitiesOf<ChallengeData>(ctx, 'challenges', 'challenge')) {
    const days = Math.max(1, Math.min(365, Math.round(c.data.days || ctx.cfg.challenge.defaultDays)));
    const checked = checks.get(c.id) ?? new Set<string>();
    const attempts: ChallengeAttempt[] = [];
    let busyUntil: string | null = null; // último día ocupado por un intento
    for (const start of [...(starts.get(c.id) ?? [])].sort()) {
      if (busyUntil && start <= busyUntil) continue; // ya había un intento en curso ese día
      const endDate = addDays(start, days - 1);
      const done: string[] = [];
      let status: ChallengeAttempt['status'] = 'active';
      let closedOn: string | null = null;
      for (let i = 0; i < days; i++) {
        const d = addDays(start, i);
        if (d > ctx.today) break;
        if (checked.has(d)) {
          done.push(d);
          if (i === days - 1) {
            status = 'completed';
            closedOn = d;
          }
        } else if (d < ctx.today) {
          status = 'failed';
          closedOn = d;
          break;
        } else break; // hoy sin marcar: sigue vivo
      }
      attempts.push({ startDate: start, endDate, checked: done, status, closedOn });
      busyUntil = status === 'active' ? '9999-12-31' : closedOn;
      if (status === 'completed') {
        ctx.addXp({
          date: closedOn!,
          amount: ctx.cfg.missionXp[c.data.size] ?? 0,
          source: 'challenge',
          label: `Reto completado: ${c.data.title} (${days} días)`,
          attribute: c.data.attribute,
          refId: c.id,
        });
      }
    }
    const current = attempts.find((a) => a.status === 'active') ?? null;
    out[c.id] = {
      attempts,
      current,
      last: attempts.at(-1) ?? null,
      streak: current ? current.checked.length : 0,
      checkedToday: !!current && current.checked.includes(ctx.today),
      completions: attempts.filter((a) => a.status === 'completed').length,
    };
  }
  return out;
}

/** Número de día (1..N) de hoy dentro de un intento. */
export function challengeDayNumber(a: ChallengeAttempt, today: string): number {
  return diffDays(a.startDate, today) + 1;
}
