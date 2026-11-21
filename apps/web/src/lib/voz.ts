import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  buildVoiceContext,
  voiceDuplicate,
  type EventPayload,
  type GameEvent,
  type GameState,
  type VoiceContext,
  type VoiceProposal,
} from '@igv/core';
import { api, ApiError, AuthError, type CoachAction } from '../data/api';
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

/** Si ya está registrado (para no duplicar), por qué. La regla vive en @igv/core (`voiceDuplicate`). */
export function duplicateReason(p: VoiceProposal, state: GameState, events: GameEvent[]): string | null {
  return voiceDuplicate(p, state, events);
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

// Solo se guardan las respuestas del servidor (10 min); un fallo nunca se guarda: se vuelve a preguntar.
let coachCache: { enabled: boolean; at: number } | null = null;
const cachedCoach = () => (coachCache && Date.now() - coachCache.at < 10 * 60_000 ? coachCache.enabled : null);

/**
 * ¿Está activo el Coach con IA en el servidor? `true` / `false` = lo que respondió el servidor; `'cargando'` mientras
 * pregunta; `'sin-conexion'` si no se pudo preguntar (sin señal, error del servidor o sesión vencida). Tras un fallo
 * vuelve a preguntar al montarse otra vez y cuando regresa la conexión.
 */
export type CoachAvailability = boolean | 'cargando' | 'sin-conexion';

export function useCoachAvailability(): CoachAvailability {
  const [status, setStatus] = useState<CoachAvailability>(() => cachedCoach() ?? 'cargando');
  useEffect(() => {
    let alive = true;
    const check = () => {
      const known = cachedCoach();
      if (known !== null) return setStatus(known);
      api
        .gmStatus()
        .then((s) => {
          coachCache = { enabled: s.enabled, at: Date.now() };
          if (alive) setStatus(s.enabled);
        })
        .catch(() => {
          if (alive) setStatus('sin-conexion');
        });
    };
    check();
    const w = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
    w?.addEventListener('online', check);
    return () => {
      alive = false;
      w?.removeEventListener('online', check);
    };
  }, []);
  return status;
}

/** ¿El Coach está activado en el servidor? null = no se sabe (sin conexión o cargando). */
export function useCoachEnabled(): boolean | null {
  const s = useCoachAvailability();
  return typeof s === 'boolean' ? s : null;
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
  /**
   * `partial` = lo que el Coach alcanzó a registrar. `uncertain` = la respuesta se perdió y no se pudo revisar la
   * bitácora: puede que el Coach sí haya registrado algo.
   */
  constructor(message: string, public readonly partial: CoachAction[] = [], public readonly uncertain = false) {
    super(message);
  }
}

/** Acciones del Coach que esta app ya mostró (para no confundirlas con las de un dictado que se cortó). */
const shownCoachActions = new Set<string>();
/** Margen por si el reloj del teléfono y el del servidor no coinciden. */
const CLOCK_MARGIN_MS = 120_000;

/**
 * La respuesta del Coach se perdió (sin conexión, la app pasó a segundo plano, error de Cloudflare), pero cada
 * herramienta guarda en cuanto corre: lo que alcanzó a registrar se busca en la bitácora. null = no se pudo revisar.
 */
async function recoverCoachActions(since: number): Promise<CoachAction[] | null> {
  try {
    const { items } = await api.aiActivity();
    const found = items
      .filter((i) => i.source === 'Coach' && !i.undoneAt && i.at >= since - CLOCK_MARGIN_MS && !shownCoachActions.has(i.id))
      .reverse() // la bitácora viene de lo más reciente a lo más viejo
      .map((i) => ({ tool: i.tool, summary: i.summary, activityId: i.id }));
    found.forEach((a) => shownCoachActions.add(a.activityId));
    await sync();
    return found;
  } catch {
    return null;
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
  const startedAt = Date.now();
  try {
    await uploadSnapshotNow(state, entities);
    const res = await api.gmAsk({ question: question.slice(0, 4000), history: [], mode: 'dictado', context: coachCatalog(ctx) });
    const actions = res.actions ?? [];
    actions.forEach((a) => shownCoachActions.add(a.activityId));
    if (actions.length) await sync();
    return { answer: res.answer, actions };
  } catch (e) {
    // fetch falla con TypeError ("Failed to fetch" / "Load failed") cuando se cae la conexión.
    const network = e instanceof TypeError && /fetch|load failed|network/i.test(e.message);
    const message = network ? 'Se cortó la conexión' : e instanceof Error ? e.message : 'No pude hablar con el Coach.';
    // El servidor respondió con su lista de lo que alcanzó a registrar: esa es la buena.
    const listed = e instanceof ApiError ? (e.body as { actions?: unknown } | undefined)?.actions : undefined;
    if (Array.isArray(listed)) {
      const partial = listed as CoachAction[];
      partial.forEach((a) => shownCoachActions.add(a.activityId));
      if (partial.length) await sync();
      throw new CoachUnavailable(message, partial);
    }
    // Sin sesión de Access la petición ni llegó al Coach.
    if (e instanceof AuthError) throw new CoachUnavailable(message);
    const recovered = await recoverCoachActions(startedAt);
    throw new CoachUnavailable(message, recovered ?? [], recovered === null);
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
