import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { Entity, SeasonData } from '../../types';
import { diffDays } from '../../util/dates';

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

export function reduceSeasons(ctx: Ctx): SeasonsState {
  const seasons = entitiesOf<SeasonData>(ctx, 'seasons', 'season').sort((a, b) => (a.data.startDate < b.data.startDate ? -1 : 1));
  const current = seasons.find((s) => s.data.startDate <= ctx.today && ctx.today <= s.data.endDate) ?? null;
  const currentWeek = current ? Math.floor(diffDays(current.data.startDate, ctx.today) / 7) + 1 : null;

  const reviews: SeasonsState['reviews'] = {};
  const completedDates: string[] = [];
  for (const ev of ofType<{ seasonId: string; phase: 'start' | 'end'; text: string }>(ctx, 'season.review')) {
    const r = (reviews[ev.payload.seasonId] ??= {});
    const wasEnded = !!r.end;
    r[ev.payload.phase] = { text: ev.payload.text, date: ev.localDate, eventId: ev.id };
    if (ev.payload.phase === 'end' && !wasEnded) completedDates.push(ev.localDate);
  }

  const journal: Record<string, JournalEntry> = {};
  for (const ev of ofType<{ weekStart: string; happened: string; learned: string; next: string }>(ctx, 'journal.weekly')) {
    journal[ev.payload.weekStart] = { ...ev.payload, eventId: ev.id, date: ev.localDate };
  }
  return { current, currentWeek, reviews, journal, completedDates: completedDates.sort() };
}
