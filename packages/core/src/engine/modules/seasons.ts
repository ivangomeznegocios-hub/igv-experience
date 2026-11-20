import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { Entity, SeasonData } from '../../types';
import { addDays, diffDays } from '../../util/dates';

export interface JournalEntry {
  weekStart: string;
  happened: string;
  learned: string;
  next: string;
  eventId: string;
  date: string;
}

export interface SeasonReview {
  text: string;
  date: string;
  eventId: string;
}

export interface SeasonsState {
  current: Entity<SeasonData> | null;
  /** Semana actual dentro de la temporada (1..13) */
  currentWeek: number | null;
  reviews: Record<string, { start?: SeasonReview; end?: SeasonReview }>;
  journal: Record<string, JournalEntry>;
  completedDates: string[];
}

/** Primer día en que la revisión de fin cuenta para completar la temporada. */
export function endReviewOpensOn(season: Entity<SeasonData>, windowDays: number): string {
  return addDays(season.data.endDate, -(Math.max(1, windowDays) - 1));
}

/** ¿La temporada ya se completó? (revisión de fin escrita dentro de su ventana). */
export function seasonCompleted(state: SeasonsState, season: Entity<SeasonData>, windowDays: number): boolean {
  const end = state.reviews[season.id]?.end;
  return !!end && end.date >= endReviewOpensOn(season, windowDays);
}

export function reduceSeasons(ctx: Ctx): SeasonsState {
  const seasons = entitiesOf<SeasonData>(ctx, 'seasons', 'season').sort((a, b) => (a.data.startDate < b.data.startDate ? -1 : 1));
  const current = seasons.find((s) => s.data.startDate <= ctx.today && ctx.today <= s.data.endDate) ?? null;
  const currentWeek = current ? Math.floor(diffDays(current.data.startDate, ctx.today) / 7) + 1 : null;

  const reviews: SeasonsState['reviews'] = {};
  const completedDates: string[] = [];
  const byId = new Map(seasons.map((s) => [s.id, s]));
  const completed = new Set<string>();
  for (const ev of ofType<{ seasonId: string; phase: 'start' | 'end'; text: string }>(ctx, 'season.review')) {
    const r = (reviews[ev.payload.seasonId] ??= {});
    r[ev.payload.phase] = { text: ev.payload.text, date: ev.localDate, eventId: ev.id };
    if (ev.payload.phase !== 'end' || completed.has(ev.payload.seasonId)) continue;
    // La revisión de fin solo completa la temporada si se escribe en su última semana (o después).
    const season = byId.get(ev.payload.seasonId);
    if (season && ev.localDate < endReviewOpensOn(season, ctx.cfg.season.endReviewWindowDays)) continue;
    completed.add(ev.payload.seasonId);
    completedDates.push(ev.localDate);
  }

  const journal: Record<string, JournalEntry> = {};
  for (const ev of ofType<{ weekStart: string; happened: string; learned: string; next: string }>(ctx, 'journal.weekly')) {
    journal[ev.payload.weekStart] = { ...ev.payload, eventId: ev.id, date: ev.localDate };
  }
  return { current, currentWeek, reviews, journal, completedDates: completedDates.sort() };
}
