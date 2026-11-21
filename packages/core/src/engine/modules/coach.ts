import type { Ctx } from '../context';
import { ofType } from '../context';
import { BODY_AREAS, MEAL_KINDS, MEAL_TAGS, type BodyArea, type MealKind, type MealTag } from '../../types';

/**
 * Entrenador personal: junta lo que registras para que el coach te lea (comidas, agua, pasos, cómo te sientes y el
 * check-in semanal). Todo es SOLO registro: este reductor nunca da XP. El plan, la sesión del día y los consejos
 * se calculan con la hora en engine/coach.ts.
 */

export interface MealEntry {
  eventId: string;
  date: string;
  /** Momento de registro (ISO). */
  at: string;
  meal: MealKind;
  text: string;
  tags: MealTag[];
  proteinG: number | null;
  kcal: number | null;
}

export interface Readiness {
  eventId: string;
  date: string;
  energy: number;
  soreness: number;
  pain: BodyArea[];
  note: string;
}

export interface WeeklyCheckin {
  eventId: string;
  weekStart: string;
  /** Día en que lo contestaste. */
  date: string;
  effort: number;
  energy: number;
  mood: number;
  pain: BodyArea[];
  wins: string;
  struggles: string;
}

export interface CoachLogs {
  /** Comidas en orden cronológico. */
  meals: MealEntry[];
  /** Vasos de agua por día. */
  water: Record<string, number>;
  /** Pasos por día (el último registro del día gana). */
  steps: Record<string, number>;
  /** "¿Cómo te sientes hoy?" por día (el último gana). */
  readiness: Record<string, Readiness>;
  /** Check-in semanal por lunes de la semana (el último gana). */
  checkins: Record<string, WeeklyCheckin>;
}

/**
 * Zonas de molestia que esta versión conoce, sin repetir. Igual que con las etiquetas de comida: un registro de una
 * versión más nueva (con una zona que aquí no existe) no debe tronar el plan, la foto ni el texto para la IA.
 */
function knownAreas(xs: unknown): BodyArea[] {
  return [...new Set((Array.isArray(xs) ? xs : []).filter((a): a is BodyArea => (BODY_AREAS as readonly string[]).includes(a as string)))];
}

export function reduceCoach(ctx: Ctx): CoachLogs {
  const meals: MealEntry[] = [];
  for (const e of ofType<{ meal: MealKind; text?: string; tags?: MealTag[]; proteinG?: number; kcal?: number }>(ctx, 'meal.logged')) {
    const p = e.payload;
    meals.push({
      eventId: e.id,
      date: e.localDate,
      at: e.occurredAt,
      meal: (MEAL_KINDS as readonly string[]).includes(p.meal) ? p.meal : 'colacion',
      text: p.text?.trim() ?? '',
      tags: [...new Set((p.tags ?? []).filter((t) => (MEAL_TAGS as readonly string[]).includes(t)))],
      proteinG: typeof p.proteinG === 'number' && p.proteinG > 0 ? p.proteinG : null,
      kcal: typeof p.kcal === 'number' && p.kcal > 0 ? p.kcal : null,
    });
  }
  const water: Record<string, number> = {};
  for (const e of ofType<{ glasses: number }>(ctx, 'water.logged')) water[e.localDate] = (water[e.localDate] ?? 0) + Math.max(0, e.payload.glasses || 0);
  const steps: Record<string, number> = {};
  for (const e of ofType<{ steps: number }>(ctx, 'steps.logged')) steps[e.localDate] = Math.max(0, e.payload.steps || 0);
  const readiness: Record<string, Readiness> = {};
  for (const e of ofType<{ energy: number; soreness?: number; pain?: BodyArea[]; note?: string }>(ctx, 'coach.readiness'))
    readiness[e.localDate] = { eventId: e.id, date: e.localDate, energy: e.payload.energy, soreness: e.payload.soreness ?? 0, pain: knownAreas(e.payload.pain), note: e.payload.note ?? '' };
  const checkins: Record<string, WeeklyCheckin> = {};
  for (const e of ofType<{ weekStart: string; effort: number; energy: number; mood: number; pain?: BodyArea[]; wins?: string; struggles?: string }>(ctx, 'coach.checkin')) {
    const p = e.payload;
    checkins[p.weekStart] = { eventId: e.id, weekStart: p.weekStart, date: e.localDate, effort: p.effort, energy: p.energy, mood: p.mood, pain: knownAreas(p.pain), wins: p.wins ?? '', struggles: p.struggles ?? '' };
  }
  return { meals, water, steps, readiness, checkins };
}
