import { useEffect, useMemo, useState } from 'react';
import {
  EXERCISE_BY_ID,
  coachPlan,
  validateEvent,
  type BodyArea,
  type CoachPlan,
  type CoachSettings,
  type EventPayload,
  type EventType,
  type GameEvent,
  type GameState,
  type MealKind,
  type MealTag,
  type PrescribedExercise,
  type PrescribedSession,
  type WorkoutSet,
} from '@igv/core';
import { addEvent, getEvents, restoreEvent, useGame, voidEvent } from '../data/store';
import { toast, undoToast } from '../ui/kit';
import { draftExercise, emptyDraft, saveTrainingSettings, type DraftExercise, type WorkoutDraft } from './entreno';
import { sfx } from './sound';
import { newId, todayLocal } from './time';

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

/**
 * Opciones para cambiar un ejercicio de la sesión de hoy: las alternativas de su movimiento sin las que ya usa otro
 * ejercicio de la sesión (ahí el plan no aplicaría el cambio, o movería el otro ejercicio sin avisar).
 */
export function swapOptions(e: PrescribedExercise, session: PrescribedSession): PrescribedExercise['alternatives'] {
  const taken = new Set(session.exercises.filter((x) => x.slot !== e.slot).map((x) => x.exerciseId));
  return e.alternatives.filter((a) => a.id !== e.exerciseId && !taken.has(a.id));
}

/**
 * Cambia el ejercicio de un movimiento en tu plan. Solo guarda si en la sesión de hoy ese movimiento de verdad queda
 * con el ejercicio elegido; si no (otro ejercicio de la sesión ya lo usa), no toca nada y devuelve false: el cambio
 * no se vería hoy y solo movería otras sesiones.
 */
export function applySwap(state: GameState, slot: string, exerciseId: string, nowIso = new Date().toISOString()): boolean {
  const cs = state.training.settings.coach ?? {};
  const swaps = { ...(cs.swaps ?? {}), [slot]: exerciseId };
  const preview: GameState = { ...state, training: { ...state.training, settings: { ...state.training.settings, coach: { ...cs, swaps } } } };
  const after = coachPlan(preview, nowIso).today.session.exercises.find((x) => x.slot === slot);
  if (after?.exerciseId !== exerciseId) return false;
  saveCoachSettings(state, { swaps });
  return true;
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

/** Largo máximo de los textos libres (el mismo que valida el servidor en `events.ts`). */
const MAX_TEXT = 500;
const MAX_NOTE = 1000;
/** Texto libre limpio: sin espacios de más y recortado a lo que acepta el servidor (el dictado se salta `maxLength`). */
const clip = (s: string | undefined, max: number) => s?.trim().slice(0, max).trim() || undefined;

/**
 * Guarda el registro solo si el servidor lo aceptaría. Si no, avisa y no guarda nada (devuelve null): un evento
 * inválido hace que el servidor rechace el lote entero y se perderían los registros que iban antes en la cola.
 */
function addChecked<T extends EventType>(type: T, payload: EventPayload<T>, date: string | undefined, what: string): GameEvent | null {
  const check = validateEvent({ id: newId(), type, occurredAt: new Date().toISOString(), localDate: date ?? todayLocal(), payload });
  if (!check.ok) {
    toast(`No pude guardar ${what}: revisa los datos.`, 'error');
    return null;
  }
  return addEvent(type, payload, { localDate: date });
}

export function logMeal(p: { meal: MealKind; text?: string; tags: MealTag[]; proteinG?: number; kcal?: number }, date?: string) {
  const ev = addChecked('meal.logged', { meal: p.meal, text: clip(p.text, MAX_TEXT), tags: p.tags, proteinG: p.proteinG || undefined, kcal: p.kcal || undefined }, date, 'la comida');
  if (!ev) return null;
  sfx.coin();
  undoToast('Comida registrada', () => voidEvent(ev.id));
  return ev;
}

export function logWater(glasses = 1, date?: string) {
  const ev = addChecked('water.logged', { glasses }, date, 'el agua');
  if (!ev) return null;
  undoToast(`+${glasses} ${glasses === 1 ? 'vaso' : 'vasos'} de agua`, () => voidEvent(ev.id));
  return ev;
}

/**
 * "Quitar un vaso": quita UN vaso del día. Si el último registro traía varios (p. ej. "tomé 2 litros" desde la IA),
 * se anula y se registra otro con un vaso menos. Siempre con "Deshacer", que regresa ese vaso.
 */
export function undoLastWater(date: string) {
  const last = getEvents()
    .filter((e) => e.type === 'water.logged' && e.localDate === date && !e.voidedAt)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0)))
    .at(-1);
  if (!last) return;
  const glasses = (last.payload as EventPayload<'water.logged'>).glasses ?? 1;
  voidEvent(last.id);
  // El de reemplazo queda como el último del día: el siguiente "−" lo sigue bajando de uno en uno.
  const rest = glasses > 1 ? addEvent('water.logged', { glasses: glasses - 1 }, { localDate: date }) : null;
  undoToast('Quitaste un vaso de agua', () => giveBackGlass(date, last.id, rest?.id));
}

/**
 * "Deshacer" de un "−": regresa exactamente el vaso que quitó. Los avisos se apilan y cada uno trae su "Deshacer",
 * así que se pueden tocar en cualquier orden: si otro "−" ya bajó el reemplazo, restaurar el original sumaría de
 * más (8 + 6 = 14 en vez de 7), y entonces solo se registra un vaso.
 */
function giveBackGlass(date: string, originalId: string, restId: string | undefined) {
  const active = (id: string) => getEvents().some((e) => e.id === id && !e.voidedAt);
  if (active(originalId)) {
    // El original ya se restauró por otro lado (p. ej. "Restaurar" en la hoja del día): solo sobra el reemplazo.
    if (restId && active(restId)) voidEvent(restId);
    return;
  }
  if (!restId) return restoreEvent(originalId);
  if (active(restId)) {
    // Nadie más tocó el reemplazo: se cambia de vuelta por el registro original, tal cual.
    voidEvent(restId);
    restoreEvent(originalId);
    return;
  }
  addEvent('water.logged', { glasses: 1 }, { localDate: date });
}

export function logSteps(steps: number, date?: string) {
  const ev = addChecked('steps.logged', { steps: Math.round(steps) }, date, 'los pasos');
  if (!ev) return null;
  undoToast(`${Math.round(steps).toLocaleString('es-MX')} pasos`, () => voidEvent(ev.id));
  return ev;
}

export function logReadiness(p: { energy: number; soreness: number; pain: BodyArea[]; note?: string }) {
  const ev = addChecked('coach.readiness', { energy: p.energy, soreness: p.soreness, pain: p.pain, note: clip(p.note, MAX_TEXT) }, undefined, 'cómo te sientes');
  if (!ev) return null;
  undoToast('Anotado: tu sesión de hoy se ajustó', () => voidEvent(ev.id));
  return ev;
}

export function logCheckin(p: { weekStart: string; effort: number; energy: number; mood: number; pain: BodyArea[]; wins?: string; struggles?: string }) {
  const ev = addChecked('coach.checkin', { ...p, wins: clip(p.wins, MAX_NOTE), struggles: clip(p.struggles, MAX_NOTE) }, undefined, 'el check-in');
  if (!ev) return null;
  sfx.coin();
  undoToast('Check-in guardado', () => voidEvent(ev.id));
  return ev;
}

export function logSleep(hours: number) {
  const ev = addChecked('checkin.morning', { sleepHours: Math.round(hours * 10) / 10 }, undefined, 'el sueño');
  if (!ev) return null;
  undoToast(`Dormiste ${Math.round(hours * 10) / 10} h`, () => voidEvent(ev.id));
  return ev;
}

export function logMeasures(p: { weightKg?: number; waistCm?: number; bodyFatPct?: number; note?: string }) {
  const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => (typeof v === 'number' ? v > 0 : !!v))) as typeof p;
  if (!Object.keys(clean).length) return null;
  const ev = addChecked('body.logged', clean, undefined, 'tus medidas');
  if (!ev) return null;
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
