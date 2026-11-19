import type { Ctx } from '../context';
import { ofType } from '../context';
import type { DailySlot, MissionSize, AttributeId } from '../../types';
import { weekStart } from '../../util/dates';

export interface CompletionInfo {
  count: number;
  firstDate: string;
  lastDate: string;
  dates: string[];
}

export interface MissionsState {
  completions: Record<string, CompletionInfo>;
  /** Fechas (ordenadas) de todas las misiones completadas que cuentan. */
  completionDates: string[];
  /** Misiones completadas hoy (ids). */
  completedToday: string[];
  activeDays: Set<string>;
  dailySelections: Partial<Record<DailySlot, string>>;
  weeklyMissionId: string | null;
}

type CompletedPayload = {
  missionId: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  kind: string;
  npcId?: string | null;
};

/** Diarias y misiones de NPC se pueden repetir (una vez por día); el resto cuenta una sola vez. */
const REPEATABLE = new Set(['daily', 'npc']);

export function reduceMissions(ctx: Ctx): MissionsState {
  const completions: Record<string, CompletionInfo> = {};
  const completionDates: string[] = [];
  const activeDays = new Set<string>();
  const seenDaily = new Set<string>();

  // Duplicados: gana el primer REGISTRO (no la fecha más antigua). Así, registrar algo nuevo
  // nunca invalida un evento que ya contaba y la XP nunca baja.
  const all = ofType<CompletedPayload>(ctx, 'mission.completed');
  const winners = new Set<string>();
  for (const ev of [...all].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.occurredAt < b.occurredAt ? -1 : 1))) {
    const p = ev.payload;
    const dedupeKey = REPEATABLE.has(p.kind) ? `${p.missionId}|${ev.localDate}` : p.missionId;
    if (seenDaily.has(dedupeKey)) continue;
    seenDaily.add(dedupeKey);
    winners.add(ev.id);
  }

  for (const ev of all) {
    if (!winners.has(ev.id)) continue;
    const p = ev.payload;

    const amount = ctx.cfg.missionXp[p.size] ?? 0;
    ctx.addXp({ date: ev.localDate, amount, source: 'mission', label: p.title, attribute: p.attribute, eventId: ev.id, refId: p.missionId });

    const c = (completions[p.missionId] ??= { count: 0, firstDate: ev.localDate, lastDate: ev.localDate, dates: [] });
    c.count++;
    c.lastDate = ev.localDate;
    c.dates.push(ev.localDate);
    completionDates.push(ev.localDate);
    activeDays.add(ev.localDate);
  }

  const dailySelections: Partial<Record<DailySlot, string>> = {};
  for (const ev of ofType<{ slot: DailySlot; missionId: string }>(ctx, 'daily.selected')) {
    if (ev.localDate === ctx.today) dailySelections[ev.payload.slot] = ev.payload.missionId;
  }

  let weeklyMissionId: string | null = null;
  const thisWeek = weekStart(ctx.today);
  for (const ev of ofType<{ missionId: string }>(ctx, 'weekly.selected')) {
    if (weekStart(ev.localDate) === thisWeek) weeklyMissionId = ev.payload.missionId;
  }

  const completedToday = Object.entries(completions)
    .filter(([, c]) => c.dates.includes(ctx.today))
    .map(([id]) => id);

  return { completions, completionDates: completionDates.sort(), completedToday, activeDays, dailySelections, weeklyMissionId };
}
