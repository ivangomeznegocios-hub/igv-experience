import { useEffect, useMemo, useState } from 'react';
import {
  REPEATABLE_KINDS,
  addDays,
  buildVoiceContext,
  type EventPayload,
  type GameEvent,
  type GameState,
  type VoiceContext,
  type VoiceProposal,
} from '@igv/core';
import { api, ApiError, type CoachAction } from '../data/api';
import { addEvent, deleteEntity, getSyncInfo, sync, useGame, voidEvent } from '../data/store';
import { complete, saveTodo, writeLesson } from './actions';
import { uploadSnapshotNow } from './aiSnapshot';

/**
 * Voz y registro automático (lado de la app): aplicar propuestas, guardar notas y hablar con el Coach en modo
 * dictado. El análisis sin IA vive en @igv/core (`parseDictation`).
 */

// ---------------------------------------------------------------------------------------------
// Contexto del analizador
// ---------------------------------------------------------------------------------------------

/** Contexto para `parseDictation` (catálogo, personas, historial). `asOf` = día de referencia (notas viejas). */
export function useVoiceContext(asOf?: string): VoiceContext {
  const { events, entities, state } = useGame();
  const day = asOf ?? state.today;
  return useMemo(() => buildVoiceContext(events, entities, day), [events, entities, day]);
}

// ---------------------------------------------------------------------------------------------
// Aplicar propuestas
// ---------------------------------------------------------------------------------------------

/** Lo que una propuesta guardó (para "Deshacer"). */
export interface Applied {
  events: string[];
  entities: string[];
}

export function applyProposal(p: VoiceProposal): Applied {
  const opts = { localDate: p.date };
  switch (p.kind) {
    case 'mission': {
      const ev = complete({ missionId: p.missionId, title: p.title, size: p.size, attribute: p.attribute, kind: p.missionKind, mainQuestId: p.mainQuestId ?? null }, p.date, { silent: true });
      return { events: [ev.id], entities: [] };
    }
    case 'income':
      return { events: [addEvent('income.recorded', { amount: p.amount, concept: p.concept, category: p.category || undefined }, opts).id], entities: [] };
    case 'expense':
      return { events: [addEvent('expense.recorded', { amount: p.amount, concept: p.concept, category: p.category || undefined }, opts).id], entities: [] };
    case 'sleep':
      return { events: [addEvent('checkin.morning', { sleepHours: p.hours }, opts).id], entities: [] };
    case 'weight':
      return { events: [addEvent('body.logged', { weightKg: p.kg, workout: p.workout || undefined }, opts).id], entities: [] };
    case 'rest':
      return { events: [addEvent('rest_day.marked', {}, opts).id], entities: [] };
    case 'person': {
      // `channel` lo agrega el sistema de personas; si este servidor aún no lo conoce, simplemente se ignora.
      const payload = { npcId: p.npcId, note: p.note || undefined, ...(p.channel ? { channel: p.channel } : {}) } as EventPayload<'npc.interaction'>;
      return { events: [addEvent('npc.interaction', payload, opts).id], entities: [] };
    }
    case 'lesson':
      return { events: [writeLesson(p.text, null, p.date).id], entities: [] };
    case 'todo':
      return { events: [], entities: [saveTodo({ title: p.title, size: p.size, attribute: p.attribute, date: p.date }).id] };
    case 'goal':
      return { events: [addEvent('goal.progress', { goalId: p.goalId, amount: p.amount }, opts).id], entities: [] };
  }
}

export function undoApplied(a: Applied) {
  a.events.forEach((id) => voidEvent(id));
  a.entities.forEach((id) => deleteEntity(id));
}

/** Si ya está registrado (para no duplicar), por qué. */
export function duplicateReason(p: VoiceProposal, state: GameState, events: GameEvent[]): string | null {
  if (p.kind === 'mission') {
    const c = state.missions.completions[p.missionId];
    if (!c) return null;
    if (REPEATABLE_KINDS.has(p.missionKind)) return c.dates.includes(p.date) ? 'Ya estaba registrada ese día' : null;
    return c.count > 0 ? 'Ya la habías completado' : null;
  }
  if (p.kind === 'rest') return events.some((e) => !e.voidedAt && e.type === 'rest_day.marked' && e.localDate === p.date) ? 'Ya estaba marcado' : null;
  if (p.kind === 'person') return events.some((e) => !e.voidedAt && e.type === 'npc.interaction' && e.localDate === p.date && e.payload?.npcId === p.npcId) ? 'Ya estaba registrado ese día' : null;
  return null;
}

/** Datos mínimos para guardar la propuesta. */
export function proposalReady(p: VoiceProposal): boolean {
  switch (p.kind) {
    case 'mission':
    case 'todo':
      return p.title.trim().length > 0;
    case 'income':
    case 'expense':
      return p.amount > 0;
    case 'sleep':
      return p.hours > 0 && p.hours <= 24;
    case 'weight':
      return (p.kg ?? 0) > 0 || !!p.workout?.trim();
    case 'lesson':
      return p.text.trim().length >= 3;
    case 'goal':
      return p.amount > 0;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Notas (lo que dijiste, tal cual)
// ---------------------------------------------------------------------------------------------

export function captureNote(text: string, source: 'voz' | 'texto', handled: 'coach' | 'local' | 'pendiente', date?: string): GameEvent {
  return addEvent('note.captured', { text: text.trim().slice(0, 4000), source, handled }, date ? { localDate: date } : {});
}

export function markNote(noteId: string, via: 'coach' | 'local' | 'descartada'): GameEvent {
  return addEvent('note.processed', { noteId, via });
}

// ---------------------------------------------------------------------------------------------
// Coach en modo dictado
// ---------------------------------------------------------------------------------------------

let coachCache: { enabled: boolean; at: number } | null = null;

/** ¿El Coach está activado en el servidor? null = no se sabe (sin conexión o cargando). */
export function useCoachEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(coachCache && Date.now() - coachCache.at < 10 * 60_000 ? coachCache.enabled : null);
  useEffect(() => {
    if (coachCache && Date.now() - coachCache.at < 10 * 60_000) return;
    let alive = true;
    api
      .gmStatus()
      .then((s) => {
        coachCache = { enabled: s.enabled, at: Date.now() };
        if (alive) setEnabled(s.enabled);
      })
      .catch(() => {
        if (alive) setEnabled(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

/** ¿Hay conexión con el servidor ahora? */
export function isOnline(): boolean {
  const s = getSyncInfo().status;
  return (typeof navigator === 'undefined' || navigator.onLine !== false) && s !== 'offline' && s !== 'auth';
}

/** Catálogo compacto para que el Coach no tenga que consultarlo (ahorra una vuelta). */
export function coachCatalog(ctx: VoiceContext): string {
  return [
    'Misiones que puede completar (id | título | tamaño | atributo):',
    ...ctx.missions.slice(0, 80).map((m) => `${m.id} | ${m.title} | ${m.size} | ${m.attribute}${m.routine ? ' | rutina de hoy' : ''}`),
    '',
    'Personas (id | nombre | papel):',
    ...ctx.people.slice(0, 120).map((p) => `${p.id} | ${p.name}${p.role ? ` | ${p.role}` : ''}`),
  ].join('\n');
}

export interface CoachDictationResult {
  answer: string;
  actions: CoachAction[];
}

export class CoachUnavailable extends Error {
  constructor(message: string, public readonly partial: CoachAction[] = []) {
    super(message);
  }
}

/**
 * Manda lo dictado al Coach para que lo registre solo. Si falla, lanza `CoachUnavailable` (con lo que alcanzó
 * a registrar, si algo) para que la app caiga al análisis local.
 */
export async function sendDictationToCoach(text: string, ctx: VoiceContext, state: GameState, entities: Parameters<typeof uploadSnapshotNow>[1], noteDate?: string): Promise<CoachDictationResult> {
  const question =
    noteDate && noteDate !== state.today
      ? `(Nota del ${noteDate}: "hoy", "ayer" y similares son relativos a ese día, no a hoy.)\n${text}`
      : text;
  try {
    await uploadSnapshotNow(state, entities);
    const res = await api.gmAsk({ question: question.slice(0, 4000), history: [], mode: 'dictado', context: coachCatalog(ctx) });
    if (res.actions?.length) await sync();
    return { answer: res.answer, actions: res.actions ?? [] };
  } catch (e) {
    const partial = e instanceof ApiError ? ((e.body as { actions?: CoachAction[] } | undefined)?.actions ?? []) : [];
    if (partial.length) await sync();
    throw new CoachUnavailable(e instanceof Error ? e.message : 'No pude hablar con el Coach.', partial);
  }
}

/** "hoy" / "ayer" / "antier" / "mañana" / "19 nov". */
export function relDay(date: string, today: string, fmt: (d: string) => string): string {
  if (date === today) return 'hoy';
  if (date === addDays(today, -1)) return 'ayer';
  if (date === addDays(today, -2)) return 'antier';
  if (date === addDays(today, 1)) return 'mañana';
  return fmt(date);
}
