import type { GameConfigInput } from '../../config/game';
import type { Ctx } from '../context';
import { entitiesOf, ofType } from '../context';
import type { AttributeId, Entity, GameEvent, LearningItemData, LearningResult, LearningTestSource, LearningTopicData, MissionSize } from '../../types';
import { LEARNING_TEST_SOURCE_NAMES } from '../../types';
import { addDays, diffDays } from '../../util/dates';
import { learningErrorKey } from '../learning-text';

/**
 * Aprendizaje (idiomas y temas).
 * - Tarjetas con repaso espaciado (Leitner): cada `learning.reviewed` mueve la tarjeta de caja. "Bien" sube una caja
 *   solo si ya tocaba repasarla (repasar antes de tiempo no acelera ni mueve la fecha); "dudé" la deja donde está (y
 *   nunca en "Lo sé"); "mal" la regresa a la caja 1. Desde `learning.masteredBox` cuenta como "Lo sé".
 * - "Dominadas alguna vez" (para los hitos): una tarjeta queda dominada cuando la respondiste "bien" en
 *   `masteredBox` días separados por los intervalos de Leitner (1, 2 y 4 días). Es la misma condición que llegar a
 *   "Lo sé" sin tropiezos, pero ignora los "mal": así agregar cualquier repaso (aunque sea de otra fecha o de otro
 *   dispositivo) nunca deshace un hito ya ganado. Regla de oro: la XP nunca se resta.
 * - Tests (`learning.test_taken`: IA, tarjetas o voz): historial de calificaciones y "errores que repites".
 * - XP: un test o sesión da la XP de una misión de `learning.sessionSize`, una vez por día y tema; y cada hito de
 *   cosas dominadas (`masteryMilestones`) da `learning.masteryXp`, una vez.
 */

export type LearningStatus = 'nuevo' | 'aprendiendo' | 'lo_se';

export interface LearningCard {
  itemId: string;
  /** 0 = nueva (nunca repasada), 1–5 = caja de Leitner. */
  box: number;
  status: LearningStatus;
  reviews: number;
  /** Total de respuestas "mal". */
  lapses: number;
  /** Últimos resultados (más reciente al final). */
  recent: LearningResult[];
  lastReview: string | null;
  /** Fecha en que toca repasarla (null si es nueva). */
  due: string | null;
  struggling: boolean;
  /** Día en que quedó dominada por primera vez (repasos "bien" espaciados), o null. */
  masteredOn: string | null;
  /** Día del primer repaso. */
  firstReview: string | null;
}

export interface LearningTest {
  eventId: string;
  date: string;
  source: LearningTestSource;
  score: number;
  total: number;
  pct: number;
  level: string | null;
  errors: number;
}

export interface LearningError {
  key: string;
  tag: string;
  correction: string;
  /** Última vez: qué se preguntó, qué respondió y la explicación. */
  prompt: string;
  answer: string;
  explanation: string | null;
  source: LearningTestSource;
  /** En cuántos tests apareció. */
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** Tests del mismo tipo hechos después de la última vez que apareció. */
  testsSince: number;
  /** Lo repetiste (2+ tests). */
  repeated: boolean;
  /** Ya no aparece en los últimos `errorClearTests` tests del mismo tipo. */
  improving: boolean;
}

export interface LearningTopicState {
  id: string;
  counts: { total: number; nuevo: number; aprendiendo: number; teCuesta: number; loSe: number };
  /** Ids de tarjetas por estado (listas disjuntas). */
  known: string[];
  learning: string[];
  struggling: string[];
  fresh: string[];
  /** Tarjetas ya vistas a las que hoy les toca repaso (incluye atrasadas), las más urgentes primero. */
  due: string[];
  /** Tarjetas nuevas que empezaste hoy (para no pasar de `learning.newPerSession` al día). */
  newToday: number;
  tests: LearningTest[];
  lastTest: LearningTest | null;
  bestPct: number | null;
  /** Nivel estimado en el último test que lo traía. */
  estimatedLevel: string | null;
  /** Todos los errores agrupados; primero los que repites. */
  errors: LearningError[];
  studyDays: string[];
  streak: number;
  bestStreak: number;
  studiedToday: boolean;
  /** Ya hubo test o sesión hoy (la XP de práctica del día ya contó). */
  sessionToday: boolean;
}

export interface LearningMilestone {
  count: number;
  date: string | null;
}

export interface LearningState {
  cards: Record<string, LearningCard>;
  topics: Record<string, LearningTopicState>;
  /** Tarjetas en "Lo sé" hoy (de elementos que siguen en el catálogo). */
  mastered: number;
  /** Tarjetas dominadas alguna vez (nunca baja; mide los hitos). */
  masteredEver: number;
  milestones: LearningMilestone[];
  nextMilestone: number | null;
  studyDays: string[];
  streak: number;
  bestStreak: number;
  studiedToday: boolean;
}

export interface LearningInput {
  /** Eventos `learning.*` válidos (no anulados, ≤ today). Se ordenan aquí. */
  events: GameEvent[];
  topics: Entity<LearningTopicData>[];
  items: Entity<LearningItemData>[];
  today: string;
  cfg: GameConfigInput;
}

type ReviewPayload = { itemId: string; result: LearningResult };
type TestPayload = {
  topicId: string;
  source: LearningTestSource;
  score: number;
  total: number;
  level?: string;
  errors?: { tag: string; prompt: string; answer: string; correction: string; explanation?: string }[];
};

const byTime = (a: GameEvent, b: GameEvent) =>
  a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function newCard(itemId: string): LearningCard {
  return { itemId, box: 0, status: 'nuevo', reviews: 0, lapses: 0, recent: [], lastReview: null, due: null, struggling: false, masteredOn: null, firstReview: null };
}

/** Un paso de Leitner (función pura). Devuelve la caja nueva. */
export function leitnerBox(box: number, result: LearningResult, isDue: boolean, cfg: GameConfigInput): number {
  const max = cfg.learning.intervals.length;
  if (result === 'mal') return 1;
  if (result === 'dude') return Math.max(1, Math.min(box, cfg.learning.masteredBox - 1));
  return box === 0 || isDue ? Math.min(max, box + 1) : Math.max(1, box);
}

function statusOf(box: number, cfg: GameConfigInput): LearningStatus {
  return box === 0 ? 'nuevo' : box >= cfg.learning.masteredBox ? 'lo_se' : 'aprendiendo';
}

/** Racha de días seguidos que termina hoy (o ayer: hoy nunca la rompe) y la mejor racha. */
export function learningStudyStreak(days: string[], today: string): { current: number; best: number } {
  const sorted = [...new Set(days)].filter((d) => d <= today).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const last = sorted.at(-1);
  const current = last && diffDays(last, today) <= 1 ? run : 0;
  return { current, best };
}

/**
 * Estado de aprendizaje a partir de eventos y catálogo (puro). Lo usan el motor, las herramientas de IA y la foto
 * para la IA. No da XP: eso lo hace `reduceLearning` con lo que devuelve aquí.
 */
export function computeLearning(input: LearningInput): LearningState & { sessions: { topicId: string; date: string; source: LearningTestSource; eventId: string }[] } {
  const { today, cfg } = input;
  const L = cfg.learning;
  const events = input.events.filter((e) => e.localDate <= today).sort(byTime);
  const itemById = new Map(input.items.map((i) => [i.id, i]));

  // ---- Tarjetas (Leitner), en orden cronológico ----
  const cards = new Map<string, LearningCard>();
  /** Cadena de "bien" espaciados por tarjeta (para "dominadas alguna vez"). */
  const chains = new Map<string, { step: number; last: string }>();
  let masteredEver = 0;
  const milestoneDates = new Map<number, string>();
  const studyByTopic = new Map<string, Set<string>>();
  const studyAll = new Set<string>();
  const markStudy = (topicId: string | undefined, date: string) => {
    studyAll.add(date);
    if (!topicId) return;
    if (!studyByTopic.has(topicId)) studyByTopic.set(topicId, new Set());
    studyByTopic.get(topicId)!.add(date);
  };

  const tests = new Map<string, LearningTest[]>();
  const errorAgg = new Map<string, Map<string, LearningError & { lastIdx: number }>>();
  const sessions: { topicId: string; date: string; source: LearningTestSource; eventId: string }[] = [];
  const sessionKeys = new Set<string>();

  for (const e of events) {
    if (e.type === 'learning.reviewed') {
      const p = e.payload as ReviewPayload;
      if (!p?.itemId) continue;
      const c = cards.get(p.itemId) ?? newCard(p.itemId);
      const isDue = !c.due || e.localDate >= c.due;
      const early = p.result === 'bien' && !isDue && c.box > 0;
      c.box = leitnerBox(c.box, p.result, isDue, cfg);
      c.reviews++;
      c.firstReview ??= e.localDate;
      if (p.result === 'mal') c.lapses++;
      c.recent = [...c.recent, p.result].slice(-Math.max(1, L.strugglingWindow));
      c.lastReview = e.localDate;
      if (!early) c.due = addDays(e.localDate, L.intervals[c.box - 1] ?? 1);
      c.status = statusOf(c.box, cfg);
      cards.set(p.itemId, c);
      // Dominada alguna vez: "bien" en días separados por los intervalos (elige siempre el primer día que cumple).
      if (p.result === 'bien' && !c.masteredOn) {
        const ch = chains.get(p.itemId);
        if (!ch) chains.set(p.itemId, { step: 1, last: e.localDate });
        else if (diffDays(ch.last, e.localDate) >= (L.intervals[ch.step - 1] ?? 1)) {
          ch.step++;
          ch.last = e.localDate;
        }
        if ((chains.get(p.itemId)?.step ?? 0) >= L.masteredBox) {
          c.masteredOn = e.localDate;
          masteredEver++;
          for (const m of L.masteryMilestones) if (m <= masteredEver && !milestoneDates.has(m)) milestoneDates.set(m, e.localDate);
        }
      }
      markStudy(itemById.get(p.itemId)?.data.topicId, e.localDate);
    } else if (e.type === 'learning.test_taken') {
      const p = e.payload as TestPayload;
      if (!p?.topicId || !(p.total > 0)) continue;
      const list = tests.get(p.topicId) ?? [];
      const idx = list.length;
      const errs = p.errors ?? [];
      list.push({
        eventId: e.id,
        date: e.localDate,
        source: p.source,
        score: p.score,
        total: p.total,
        pct: Math.round((Math.min(p.score, p.total) / p.total) * 100),
        level: p.level?.trim() || null,
        errors: errs.length,
      });
      tests.set(p.topicId, list);
      markStudy(p.topicId, e.localDate);
      const sk = `${p.topicId}|${e.localDate}`;
      if (!sessionKeys.has(sk)) {
        sessionKeys.add(sk);
        sessions.push({ topicId: p.topicId, date: e.localDate, source: p.source, eventId: e.id });
      }
      if (!errorAgg.has(p.topicId)) errorAgg.set(p.topicId, new Map());
      const agg = errorAgg.get(p.topicId)!;
      for (const er of errs) {
        const key = learningErrorKey(er.tag, er.correction);
        if (!key.split('|')[1]) continue;
        const prev = agg.get(key);
        if (prev && prev.lastIdx === idx) continue; // mismo error dos veces en un test: cuenta una
        agg.set(key, {
          key,
          tag: er.tag.trim(),
          correction: er.correction.trim(),
          prompt: er.prompt,
          answer: er.answer,
          explanation: er.explanation?.trim() || null,
          source: p.source,
          count: (prev?.count ?? 0) + 1,
          firstSeen: prev?.firstSeen ?? e.localDate,
          lastSeen: e.localDate,
          testsSince: 0,
          repeated: false,
          improving: false,
          lastIdx: idx,
        });
      }
    }
  }

  // "Te cuesta": varias "mal" recientes (y no está en "Lo sé").
  for (const c of cards.values()) {
    const mal = c.recent.filter((r) => r === 'mal').length;
    c.struggling = c.status !== 'lo_se' && mal >= L.strugglingMal;
  }

  // ---- Temas ----
  const topics: Record<string, LearningTopicState> = {};
  const topicIds = new Set<string>([...input.topics.map((t) => t.id), ...tests.keys()]);
  const itemsByTopic = new Map<string, Entity<LearningItemData>[]>();
  for (const it of input.items) {
    if (!itemsByTopic.has(it.data.topicId)) itemsByTopic.set(it.data.topicId, []);
    itemsByTopic.get(it.data.topicId)!.push(it);
  }
  for (const id of topicIds) {
    const items = itemsByTopic.get(id) ?? [];
    const known: string[] = [];
    const learning: string[] = [];
    const struggling: string[] = [];
    const fresh: string[] = [];
    const due: { id: string; due: string; box: number }[] = [];
    let newToday = 0;
    for (const it of items) {
      const c = cards.get(it.id);
      if (c?.firstReview === today) newToday++;
      if (!c || c.status === 'nuevo') fresh.push(it.id);
      else if (c.status === 'lo_se') known.push(it.id);
      else if (c.struggling) struggling.push(it.id);
      else learning.push(it.id);
      if (c && c.due && c.status !== 'nuevo' && c.due <= today) due.push({ id: it.id, due: c.due, box: c.box });
    }
    due.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.box - b.box));
    const tl = tests.get(id) ?? [];
    const errs = [...(errorAgg.get(id)?.values() ?? [])].map(({ lastIdx, ...er }) => {
      const testsSince = tl.slice(lastIdx + 1).filter((t) => t.source === er.source).length;
      return { ...er, testsSince, repeated: er.count >= 2, improving: testsSince >= L.errorClearTests };
    });
    errs.sort(
      (a, b) =>
        Number(b.repeated && !b.improving) - Number(a.repeated && !a.improving) ||
        b.count - a.count ||
        (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0),
    );
    const days = [...(studyByTopic.get(id) ?? [])].sort();
    const st = learningStudyStreak(days, today);
    const withLevel = [...tl].reverse().find((t) => t.level);
    topics[id] = {
      id,
      counts: { total: items.length, nuevo: fresh.length, aprendiendo: learning.length, teCuesta: struggling.length, loSe: known.length },
      known,
      learning,
      struggling,
      fresh,
      due: due.map((d) => d.id),
      newToday,
      tests: tl,
      lastTest: tl.at(-1) ?? null,
      bestPct: tl.length ? Math.max(...tl.map((t) => t.pct)) : null,
      estimatedLevel: withLevel?.level ?? null,
      errors: errs,
      studyDays: days,
      streak: st.current,
      bestStreak: st.best,
      studiedToday: days.includes(today),
      sessionToday: sessionKeys.has(`${id}|${today}`),
    };
  }

  const all = learningStudyStreak([...studyAll], today);
  const mastered = input.items.filter((i) => cards.get(i.id)?.status === 'lo_se').length;
  const milestones = L.masteryMilestones.map((count) => ({ count, date: milestoneDates.get(count) ?? null }));
  return {
    cards: Object.fromEntries(cards),
    topics,
    mastered,
    masteredEver,
    milestones,
    nextMilestone: L.masteryMilestones.find((m) => m > masteredEver) ?? null,
    studyDays: [...studyAll].sort(),
    streak: all.current,
    bestStreak: all.best,
    studiedToday: studyAll.has(today),
    sessions,
  };
}

/**
 * Tarjetas por repasar hoy, solo de los temas activos del catálogo: las de un tema archivado (o borrado) no se pueden
 * repasar desde Aprendizaje, así que no deben pedir atención.
 */
export function learningDueCount(state: Pick<LearningState, 'topics'>, topics: readonly Entity<LearningTopicData>[]): number {
  return topics.filter((t) => !t.data.archived).reduce((s, t) => s + (state.topics[t.id]?.due.length ?? 0), 0);
}

/** Reductor del motor: estado de aprendizaje + XP (práctica del día por tema e hitos de "Lo sé"). */
export function reduceLearning(ctx: Ctx): LearningState {
  const topicsAll = entitiesOf<LearningTopicData>(ctx, 'learning', 'topic');
  const { sessions, ...state } = computeLearning({
    events: [...ofType(ctx, 'learning.reviewed'), ...ofType(ctx, 'learning.test_taken')],
    topics: topicsAll,
    items: entitiesOf<LearningItemData>(ctx, 'learning', 'item'),
    today: ctx.today,
    cfg: ctx.cfg,
  });
  const L = ctx.cfg.learning;
  const defaultAttr = L.attribute as AttributeId;
  const topicById = new Map(topicsAll.map((t) => [t.id, t]));
  for (const s of sessions) {
    const t = topicById.get(s.topicId);
    ctx.addXp({
      date: s.date,
      amount: ctx.cfg.missionXp[L.sessionSize as MissionSize] ?? 0,
      source: 'learning',
      label: `${LEARNING_TEST_SOURCE_NAMES[s.source] ?? 'Práctica'}: ${t?.data.name ?? 'Aprendizaje'}`,
      attribute: t?.data.attribute ?? defaultAttr,
      eventId: s.eventId,
      refId: s.topicId,
    });
  }
  for (const m of state.milestones) {
    if (!m.date) continue;
    ctx.addXp({ date: m.date, amount: L.masteryXp, source: 'learning', label: `Aprendizaje: ${m.count} cosas dominadas`, attribute: defaultAttr, refId: `learning-mastery-${m.count}` });
  }
  return state;
}
