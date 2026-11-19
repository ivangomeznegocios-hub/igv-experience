import type { Ctx } from '../context';
import { ofType } from '../context';
import type { AttributeId, MissionSize } from '../../types';
import type { MissionsState } from './missions';

export interface BountyInfo {
  date: string;
  missionId: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  bonus: number;
  completed: boolean;
}

export interface BountyState {
  /** Misión sorpresa de hoy (si ya se sorteó). */
  today: BountyInfo | null;
  /** Veces que se cumplió una misión sorpresa. */
  completedCount: number;
  history: BountyInfo[];
}

type DrawnPayload = { missionId: string; title: string; size: MissionSize; attribute: AttributeId };

/**
 * Misión sorpresa: el dispositivo sortea una misión al día y la guarda como evento `bounty.drawn`
 * (así editar el catálogo no cambia el historial). Si se completa ese mismo día, da un bono de XP.
 */
export function reduceBounty(ctx: Ctx, missions: MissionsState): BountyState {
  const byDate = new Map<string, { id: string; p: DrawnPayload }>();
  const drawn = [...ofType<DrawnPayload>(ctx, 'bounty.drawn')].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1));
  for (const ev of drawn) if (!byDate.has(ev.localDate)) byDate.set(ev.localDate, { id: ev.id, p: ev.payload });

  const history: BountyInfo[] = [];
  for (const [date, { id, p }] of [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const bonus = Math.round(((ctx.cfg.missionXp[p.size] ?? 0) * ctx.cfg.bounty.bonusPercent) / 100);
    const completed = !!missions.completions[p.missionId]?.dates.includes(date);
    if (completed) {
      ctx.addXp({ date, amount: bonus, source: 'bounty', label: `Bono sorpresa: ${p.title}`, attribute: p.attribute, eventId: id, refId: p.missionId });
    }
    history.push({ date, missionId: p.missionId, title: p.title, size: p.size, attribute: p.attribute, bonus, completed });
  }
  return {
    today: history.find((h) => h.date === ctx.today) ?? null,
    completedCount: history.filter((h) => h.completed).length,
    history,
  };
}
