import { useEffect, useMemo, useState } from 'react';
import {
  EXERCISE_BY_ID,
  coachPlan,
  type BodyArea,
  type CoachPlan,
  type CoachSettings,
  type GameState,
  type MealKind,
  type MealTag,
  type PrescribedSession,
  type WorkoutSet,
} from '@igv/core';
import { addEvent, getEvents, useGame, voidEvent } from '../data/store';
import { toast, undoToast } from '../ui/kit';
import { draftExercise, emptyDraft, saveTrainingSettings, type DraftExercise, type WorkoutDraft } from './entreno';
import { sfx } from './sound';

/**
 * Tu entrenador personal en la app: el plan sale de `coachPlan` (core, sin IA ni red) y aquí viven los registros
 * de un toque (comida, agua, pasos, cómo te sientes, check-in) y el borrador de la sesión del día.
 */

/** Hora actual que se actualiza cada minuto (la recuperación y los mensajes dependen de la hora). */
export function useNowIso(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Varias tarjetas leen el mismo plan: se calcula una vez por estado y minuto.
let cached: { state: GameState; minute: string; plan: CoachPlan } | null = null;

export function useCoachPlan(): CoachPlan {
  const { state } = useGame();
  const now = useNowIso();
  // Una vez por minuto basta: los mensajes del coach cambian con la hora, no con el segundo.
  const minute = now.slice(0, 16);
  return useMemo(() => {
    if (cached && cached.state === state && cached.minute === minute) return cached.plan;
    const plan = coachPlan(state, `${minute}:00.000Z`);
    cached = { state, minute, plan };
    return plan;
  }, [state, minute]);
}

// ---------------------------------------------------------------------------------------------
// Ajustes del plan
// ---------------------------------------------------------------------------------------------

export function saveCoachSettings(state: GameState, patch: Partial<CoachSettings>, extra: { where?: GameState['training']['settings']['where'] } = {}) {
  const prev = state.training.settings;
  const coach: CoachSettings = { ...(prev.coach ?? {}), ...patch };
  if (!coach.startDate) coach.startDate = state.today;
  return saveTrainingSettings(prev, { ...extra, coach });
}

// ---------------------------------------------------------------------------------------------
// Sesión del coach → borrador del registro de entrenamiento
// ---------------------------------------------------------------------------------------------

const fmtRange = (r: [number, number] | null, unit = '') => (r ? `${r[0]}–${r[1]}${unit}` : '');

/** Texto corto de lo que pide el coach en un ejercicio ("3 × 8–12 @ 20 kg · reserva 2–3"). */
export function targetText(e: PrescribedSession['exercises'][number]): string {
  const reps = e.seconds ? fmtRange(e.seconds, ' s') : fmtRange(e.reps);
  return `${e.sets} × ${reps}${e.targetKg ? ` @ ${e.targetKg} kg` : ''} · reserva ${e.rir[0]}–${e.rir[1]}`;
}

export function restText(sec: number): string {
  const s = Math.round(sec / 15) * 15;
  return s >= 120 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : `${s} s`;
}

/** Borrador con las series que pide el coach (reps y peso objetivo) para registrar mientras entrenas. */
export function draftFromCoach(session: PrescribedSession, state: GameState): WorkoutDraft {
  const tr = state.training;
  const base = { ...emptyDraft(tr.settings, tr.summary.usualWhere) };
  if (session.cardio) {
    const def = EXERCISE_BY_ID.get(session.cardio.exerciseId)!;
    const x = draftExercise(def, tr.records, 1);
    x.sets = [{ min: session.cardio.minutes }];
    x.coach = { target: `${session.cardio.minutes} min`, note: session.cardio.intensity };
    return { ...base, kind: session.cardio.exerciseId === 'caminar' ? 'caminata' : 'cardio', title: '', exercises: [x], minutes: session.cardio.minutes };
  }
  const exercises: DraftExercise[] = session.exercises.map((e) => {
    const def = EXERCISE_BY_ID.get(e.exerciseId)!;
    const x = draftExercise(def, tr.records, e.sets);
    const set: WorkoutSet =
      e.measure === 'tiempo' ? { sec: e.targetSec ?? e.seconds?.[0] ?? 30 } : { reps: e.targetReps ?? e.reps?.[1] ?? 10, ...(e.targetKg ? { kg: e.targetKg } : e.measure === 'peso' && tr.records[e.exerciseId]?.lastSets[0]?.kg ? { kg: tr.records[e.exerciseId].lastSets[0].kg } : {}) };
    x.sets = Array.from({ length: e.sets }, () => ({ ...set }));
    x.coach = { target: targetText(e), note: e.note, cue: e.cue, restSec: e.restSec };
    return x;
  });
  return { ...base, kind: 'fuerza', title: session.title, exercises, minutes: session.estMinutes || null };
}

// ---------------------------------------------------------------------------------------------
// Registros de un toque (solo registro: no dan XP)
// ---------------------------------------------------------------------------------------------

export function logMeal(p: { meal: MealKind; text?: string; tags: MealTag[]; proteinG?: number; kcal?: number }, date?: string) {
  const ev = addEvent('meal.logged', { meal: p.meal, text: p.text?.trim() || undefined, tags: p.tags, proteinG: p.proteinG || undefined, kcal: p.kcal || undefined }, { localDate: date });
  sfx.coin();
  undoToast('Comida registrada', () => voidEvent(ev.id));
  return ev;
}

export function logWater(glasses = 1, date?: string) {
  const ev = addEvent('water.logged', { glasses }, { localDate: date });
  undoToast(`+${glasses} ${glasses === 1 ? 'vaso' : 'vasos'} de agua`, () => voidEvent(ev.id));
  return ev;
}

/** Quita el último registro de agua del día (para corregir un toque de más). */
export function undoLastWater(date: string) {
  const last = getEvents()
    .filter((e) => e.type === 'water.logged' && e.localDate === date && !e.voidedAt)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))
    .at(-1);
  if (!last) return;
  voidEvent(last.id);
  toast('Quité el último registro de agua');
}

export function logSteps(steps: number, date?: string) {
  const ev = addEvent('steps.logged', { steps: Math.round(steps) }, { localDate: date });
  undoToast(`${Math.round(steps).toLocaleString('es-MX')} pasos`, () => voidEvent(ev.id));
  return ev;
}

export function logReadiness(p: { energy: number; soreness: number; pain: BodyArea[]; note?: string }) {
  const ev = addEvent('coach.readiness', { energy: p.energy, soreness: p.soreness, pain: p.pain, note: p.note?.trim() || undefined });
  undoToast('Anotado: tu sesión de hoy se ajustó', () => voidEvent(ev.id));
  return ev;
}

export function logCheckin(p: { weekStart: string; effort: number; energy: number; mood: number; pain: BodyArea[]; wins?: string; struggles?: string }) {
  const ev = addEvent('coach.checkin', { ...p, wins: p.wins?.trim() || undefined, struggles: p.struggles?.trim() || undefined });
  sfx.coin();
  undoToast('Check-in guardado', () => voidEvent(ev.id));
  return ev;
}

export function logSleep(hours: number) {
  const ev = addEvent('checkin.morning', { sleepHours: Math.round(hours * 10) / 10 });
  undoToast(`Dormiste ${Math.round(hours * 10) / 10} h`, () => voidEvent(ev.id));
  return ev;
}

export function logMeasures(p: { weightKg?: number; waistCm?: number; bodyFatPct?: number; note?: string }) {
  const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => (typeof v === 'number' ? v > 0 : !!v))) as typeof p;
  if (!Object.keys(clean).length) return null;
  const ev = addEvent('body.logged', clean);
  sfx.coin();
  undoToast('Medidas guardadas', () => voidEvent(ev.id));
  return ev;
}

// ---------------------------------------------------------------------------------------------
// Hojas del coach (se abren desde Hoy, Entrenamiento o Nutrición)
// ---------------------------------------------------------------------------------------------

export type CoachSheetKind = 'setup' | 'sentir' | 'checkin' | 'comida' | 'pasos' | 'sueno' | 'medidas' | 'chat';
export interface CoachSheetOptions {
  kind: CoachSheetKind;
  /** Para el check-in: lunes de la semana a revisar. */
  week?: string;
  /** Para el chat: pregunta inicial. */
  ask?: string;
}
const sheetBus = new Set<(o: CoachSheetOptions) => void>();
let pendingSheet: CoachSheetOptions | null = null;

export function openCoachSheet(o: CoachSheetOptions | CoachSheetKind) {
  const opts = typeof o === 'string' ? { kind: o } : o;
  if (!sheetBus.size) pendingSheet = opts;
  sheetBus.forEach((f) => f(opts));
}

export function onOpenCoachSheet(f: (o: CoachSheetOptions) => void) {
  sheetBus.add(f);
  if (pendingSheet) {
    const p = pendingSheet;
    pendingSheet = null;
    f(p);
  }
  return () => {
    sheetBus.delete(f);
  };
}
