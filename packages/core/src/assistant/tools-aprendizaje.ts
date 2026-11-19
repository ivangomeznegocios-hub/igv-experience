import { z } from 'zod';
import { GAME_CONFIG } from '../config/game';
import { computeLearning, type LearningTopicState } from '../engine/modules/learning';
import { learningErrorKey, normalizeLearningText } from '../engine/learning-text';
import {
  CEFR_LEVELS,
  LEARNING_ITEM_TYPES,
  LEARNING_TEST_SOURCE_NAMES,
  LEARNING_TOPIC_KIND_NAMES,
  LEARNING_TOPIC_KINDS,
  type Entity,
  type GameEvent,
  type LearningItemData,
  type LearningTestSource,
  type LearningTopicData,
  type MissionSize,
} from '../types';
import { fmtDay } from './format';
import type { AssistantSnapshot } from './snapshot';
import { ToolError, find, list, makeEvent, newEntityId, ok, pastDate, tool, upsert, zAttr, zFecha, zId, zText, type AssistantStore, type AssistantTool } from './toolkit';

/**
 * Herramientas de IA del sistema de Aprendizaje (idiomas y temas): consultar lo que sabe y lo que le cuesta,
 * agregar frases, crear o editar temas y guardar un test que la IA le hizo en el chat.
 */

const LEARNING_TYPES = ['learning.reviewed', 'learning.test_taken'];
const sessionXp = () => GAME_CONFIG.missionXp[GAME_CONFIG.learning.sessionSize as MissionSize];

/** Lo que la foto para la IA lleva de aprendizaje (lo arma buildSnapshot). */
export interface LearningSnapshot {
  mastered: number;
  masteredEver: number;
  nextMilestone: number | null;
  streak: number;
  studiedToday: boolean;
  topics: {
    id: string;
    name: string;
    kind: string;
    level: string | null;
    estimatedLevel: string | null;
    goal: string | null;
    total: number;
    known: number;
    learning: number;
    struggling: number;
    fresh: number;
    due: number;
    streak: number;
    sessionToday: boolean;
    lastScores: { date: string; pct: number; score: number; total: number; source: string }[];
    errors: { tag: string; answer: string; correction: string; count: number; lastSeen: string; improving: boolean }[];
    /** Frases que le cuestan (texto). */
    struggles: string[];
  }[];
}

const sourceName = (s: string) => LEARNING_TEST_SOURCE_NAMES[s as LearningTestSource] ?? s;
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Líneas de aprendizaje para el panorama (ver_resumen y el Coach). */
export function renderLearningOverview(s: AssistantSnapshot): string[] {
  const a = s.aprendizaje;
  if (!a?.topics.length) return [];
  const L = ['', '## Aprendizaje'];
  for (const t of a.topics) {
    const lvl = [t.level ? `nivel ${t.level}` : '', t.estimatedLevel && t.estimatedLevel !== t.level ? `la IA lo estimó en ${t.estimatedLevel}` : ''].filter(Boolean).join(', ');
    L.push(
      `- ${t.name} [${t.id}]${lvl ? ` (${lvl})` : ''}: ${t.known} lo sabe · ${t.learning} aprendiendo · ${t.struggling} le cuestan · ${t.fresh} nuevas · ${t.due} por repasar hoy · racha ${t.streak} ${t.streak === 1 ? 'día' : 'días'}${t.sessionToday ? ' · ya practicó hoy' : ''}.`,
    );
    if (t.lastScores.length) L.push(`  Últimos tests: ${t.lastScores.map((x) => `${x.pct}% (${x.date}, ${sourceName(x.source)})`).join('; ')}.`);
    if (t.errors.length) L.push(`  Errores que repite: ${t.errors.map((e) => `"${short(e.answer, 50)}" → "${short(e.correction, 60)}" (${e.tag}, ${e.count}×${e.improving ? ', mejorando' : ''})`).join('; ')}.`);
    if (t.struggles.length) L.push(`  Le cuestan: ${t.struggles.map((x) => `"${short(x, 60)}"`).join('; ')}.`);
  }
  L.push(`"Lo sé" hoy: ${a.mastered} · dominadas alguna vez: ${a.masteredEver}${a.nextMilestone ? ` (siguiente hito: ${a.nextMilestone})` : ''}.`);
  return L;
}

export const APRENDIZAJE_GUIDE = `Aprendizaje (idiomas y temas; su tema principal es Inglés para negociar y presentar): frases y palabras como tarjetas de repaso espaciado (Nuevo → Aprendiendo → Lo sé; "le cuesta" = varias veces mal). Tests (con IA, tarjetas o en voz alta) guardan su calificación y los "errores que repite". Practicar o hacer un test da ${sessionXp()} XP una vez por día y tema; cada hito de cosas dominadas (${GAME_CONFIG.learning.masteryMilestones.slice(0, 3).join(', ')}…) da ${GAME_CONFIG.learning.masteryXp} XP. Para hacerle un test en el chat: ver_aprendizaje → 5 a 8 preguntas a su nivel en contexto de negocios (traducir, completar, corregir, responder), incluyendo sus errores frecuentes → califica con explicaciones cortas en español → registrar_test con sus errores (etiqueta y corrección mínima, p. ej. "depend on") → ofrece agregar_frase con lo que falló.`;

// ---------------------------------------------------------------------------------------------

async function loadLearning(store: AssistantStore) {
  const [catalog, events] = await Promise.all([store.catalog(), store.events({ types: LEARNING_TYPES, order: 'asc' })]);
  const topics = list<LearningTopicData>(catalog, 'learning', 'topic');
  const items = list<LearningItemData>(catalog, 'learning', 'item');
  const state = computeLearning({ events, topics, items, today: store.today, cfg: GAME_CONFIG });
  return { catalog, events, topics, items, state };
}

/** Tema indicado, o el único activo, o el de Inglés. */
function resolveTopic(topics: Entity<LearningTopicData>[], id?: string): Entity<LearningTopicData> {
  if (id) {
    const t = topics.find((x) => x.id === id);
    if (!t) throw new ToolError(`No encontré el tema "${id}". Temas: ${topics.map((x) => `${x.data.name} [${x.id}]`).join(', ') || 'ninguno (crea uno con guardar_tema)'}.`);
    return t;
  }
  const active = topics.filter((t) => !t.data.archived);
  if (active.length === 1) return active[0];
  const en = active.find((t) => /^(ingles|english)\b/.test(normalizeLearningText(t.data.name)));
  if (en) return en;
  if (!active.length) throw new ToolError('No hay temas de aprendizaje. Crea uno con guardar_tema (p. ej. nombre "Inglés", tipo idioma, nivel B1).');
  throw new ToolError(`Indica tema_id. Temas: ${active.map((x) => `${x.data.name} [${x.id}]`).join(', ')}.`);
}

function topicLines(t: Entity<LearningTopicData>, st: LearningTopicState | undefined, items: Map<string, Entity<LearningItemData>>, withItems: boolean): string[] {
  const L: string[] = [];
  const d = t.data;
  L.push(`# ${d.name} [${t.id}] · ${LEARNING_TOPIC_KIND_NAMES[d.topicKind] ?? d.topicKind}${d.level ? ` · nivel ${d.level}` : ''}${d.archived ? ' · archivado' : ''}`);
  if (d.goal) L.push(`Meta: ${d.goal}`);
  if (!st) {
    L.push('Sin frases ni tests todavía.');
    return L;
  }
  const c = st.counts;
  L.push(`Frases: ${c.total} · lo sabe ${c.loSe} · aprendiendo ${c.aprendiendo} · le cuestan ${c.teCuesta} · nuevas ${c.nuevo} · por repasar hoy ${st.due.length}.`);
  L.push(`Racha de práctica: ${st.streak} ${st.streak === 1 ? 'día' : 'días'} (mejor ${st.bestStreak}) · ${st.sessionToday ? 'ya practicó hoy' : 'hoy todavía no practica'}.`);
  if (st.estimatedLevel) L.push(`Nivel estimado en su último test: ${st.estimatedLevel}.`);
  if (st.tests.length) {
    L.push(`Tests (${st.tests.length}; mejor ${st.bestPct}%): ${st.tests
      .slice(-8)
      .map((x) => `${x.date} ${x.score}/${x.total} = ${x.pct}% (${sourceName(x.source)}${x.level ? `, ${x.level}` : ''})`)
      .join('; ')}.`);
  } else L.push('Todavía no hace tests.');
  const rep = st.errors.filter((e) => e.repeated);
  const once = st.errors.filter((e) => !e.repeated);
  if (rep.length) {
    L.push('Errores que repite:');
    for (const e of rep.slice(0, 10))
      L.push(`- [${e.tag}] "${short(e.answer, 80)}" → "${short(e.correction, 80)}" · ${e.count} veces, última ${e.lastSeen}${e.improving ? ` · MEJORANDO (no aparece en sus últimos ${e.testsSince} tests)` : ''}${e.explanation ? ` · ${short(e.explanation, 100)}` : ''}`);
  }
  if (once.length) L.push(`Errores recientes (una vez): ${once.slice(0, 8).map((e) => `"${short(e.correction, 60)}" (${e.tag})`).join('; ')}.`);
  const fmt = (ids: string[]) =>
    ids
      .slice(0, 40)
      .map((id) => items.get(id))
      .filter((x): x is Entity<LearningItemData> => !!x)
      .map((x) => `"${short(x.data.text, 90)}"${x.data.meaning ? ` = ${short(x.data.meaning, 70)}` : ''} [${x.id}]`)
      .join('; ') + (ids.length > 40 ? ` (y ${ids.length - 40} más)` : '');
  if (st.struggling.length) L.push(`Le cuestan: ${fmt(st.struggling)}.`);
  if (withItems) {
    if (st.known.length) L.push(`Lo que ya sabe decir: ${fmt(st.known)}.`);
    if (st.learning.length) L.push(`Aprendiendo: ${fmt(st.learning)}.`);
    if (st.fresh.length) L.push(`Nuevas (sin repasar): ${fmt(st.fresh)}.`);
  }
  return L;
}

const verAprendizaje = tool({
  name: 'ver_aprendizaje',
  title: 'Ver aprendizaje',
  group: 'consultar',
  writes: false,
  description:
    'Aprendizaje (idiomas y temas, p. ej. Inglés): nivel, qué sabe decir, qué está aprendiendo, qué le cuesta, errores que repite (y si va mejorando), calificaciones de sus últimos tests y racha. Úsala antes de hacerle un test o de proponerle qué practicar.',
  input: z.object({
    tema_id: zId.optional().describe('Un tema en particular. Sin id, todos los temas activos.'),
    ver_frases: z.boolean().optional().describe('Incluir la lista completa de frases por estado (lo sabe, aprendiendo, nuevas) con su id.'),
  }),
  async run({ tema_id, ver_frases }, store) {
    const { topics, items, state } = await loadLearning(store);
    if (!topics.length) return { text: 'Todavía no hay temas de aprendizaje. Crea uno con guardar_tema (p. ej. "Inglés", tipo idioma, nivel B1) y agrega frases con agregar_frase.' };
    const shown = tema_id ? [resolveTopic(topics, tema_id)] : topics.filter((t) => !t.data.archived);
    const byId = new Map(items.map((i) => [i.id, i]));
    const L: string[] = [];
    for (const t of shown) L.push(...topicLines(t, state.topics[t.id], byId, !!tema_id || !!ver_frases), '');
    L.push(
      `En total: ${state.mastered} en "Lo sé" hoy · ${state.masteredEver} dominadas alguna vez${state.nextMilestone ? ` (al llegar a ${state.nextMilestone} gana ${GAME_CONFIG.learning.masteryXp} XP)` : ''} · racha de estudio ${state.streak} ${state.streak === 1 ? 'día' : 'días'}.`,
    );
    return { text: L.join('\n').trim() };
  },
});

const zLevel = z.string().trim().max(12);

const guardarTema = tool({
  name: 'guardar_tema',
  title: 'Crear o editar tema de aprendizaje',
  group: 'organizar',
  writes: true,
  description:
    'Crea o edita un tema de aprendizaje: un idioma (con nivel A1–C2 autoevaluado), una materia u otro. Para archivarlo (se conserva su XP) manda archivar=true.',
  input: z.object({
    id: zId.optional().describe('Para EDITAR un tema existente, su id. Sin id, se crea uno nuevo.'),
    nombre: zText(80).optional().describe('Obligatorio al crear ("Inglés", "Finanzas corporativas").'),
    tipo: z.enum(LEARNING_TOPIC_KINDS).optional().describe('idioma, materia u otro. Por defecto, idioma.'),
    nivel: zLevel.nullable().optional().describe('Idiomas: A1, A2, B1, B2, C1 o C2. Otros temas: texto corto (básico, intermedio…).'),
    meta: z.string().trim().max(300).optional().describe('Para qué lo aprende ("Negociar y presentar en inglés").'),
    idioma_voz: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Usa un código como en-US').optional().describe('Idiomas: código para practicar en voz alta (en-US por defecto).'),
    atributo: zAttr.optional().describe('Atributo al que suma la XP de practicar (por defecto Inteligencia).'),
    archivar: z.boolean().optional(),
  }),
  async run(i, store) {
    const catalog = await store.catalog();
    const topics = list<LearningTopicData>(catalog, 'learning', 'topic');
    const prev = i.id ? (find<LearningTopicData>(catalog, i.id, 'learning', ['topic'], 'el tema') as Entity<LearningTopicData>) : null;
    const name = i.nombre ?? prev?.data.name;
    if (!name) throw new ToolError('Falta "nombre".');
    if (!prev) {
      const dup = topics.find((t) => normalizeLearningText(t.data.name) === normalizeLearningText(name));
      if (dup) throw new ToolError(`Ya existe el tema "${dup.data.name}" [${dup.id}]. Para editarlo manda su id.`);
    }
    const kind = i.tipo ?? prev?.data.topicKind ?? 'idioma';
    let level = i.nivel === undefined ? (prev?.data.level ?? null) : i.nivel;
    if (level && kind === 'idioma') {
      const up = level.toUpperCase();
      if (!(CEFR_LEVELS as readonly string[]).includes(up)) throw new ToolError(`Nivel inválido para un idioma: usa ${CEFR_LEVELS.join(', ')}.`);
      level = up;
    }
    const data: LearningTopicData = {
      ...(prev?.data ?? {}),
      name,
      topicKind: kind,
      level: level || null,
      goal: i.meta ?? prev?.data.goal,
      lang: kind === 'idioma' ? (i.idioma_voz ?? prev?.data.lang ?? (/ingl|english/i.test(name) ? 'en-US' : undefined)) : undefined,
      attribute: i.atributo ?? prev?.data.attribute,
      archived: i.archivar ?? prev?.data.archived ?? false,
    };
    const { saved, ref } = await upsert(store, prev, { id: prev?.id ?? newEntityId(store, 'lt'), module: 'learning', kind: 'topic', data });
    return ok(
      `${prev ? 'Tema actualizado' : 'Tema creado'}: ${data.name} (${LEARNING_TOPIC_KIND_NAMES[data.topicKind]}${data.level ? `, nivel ${data.level}` : ''})${data.archived ? ' · archivado' : ''}. Id [${saved.id}].`,
      `${prev ? 'Editó' : 'Creó'} el tema "${data.name}"`,
      { entities: [ref] },
    );
  },
});

const agregarFrase = tool({
  name: 'agregar_frase',
  title: 'Agregar frases a aprender',
  group: 'organizar',
  writes: true,
  description:
    'Agrega una o varias frases, palabras o conceptos a un tema de aprendizaje (quedan como tarjetas nuevas para repasar). Úsala con lo que falló en un test o con expresiones útiles para él. No duplica las que ya tiene.',
  input: z.object({
    tema_id: zId.optional().describe('Tema (por defecto, el único activo o el de Inglés).'),
    frases: z
      .array(
        z.object({
          texto: zText(300).describe('En el idioma que aprende ("Let me get back to you on that").'),
          significado: zText(300).describe('Traducción o significado en español.'),
          ejemplo: z.string().trim().max(500).optional(),
          etiquetas: z.array(z.string().trim().min(1).max(40)).max(6).optional().describe('p. ej. negociación, juntas, phrasal verbs, gramática, vocabulario.'),
          tipo: z.enum(LEARNING_ITEM_TYPES).optional().describe('frase (por defecto), palabra o concepto.'),
        }),
      )
      .min(1)
      .max(25),
  }),
  async run({ tema_id, frases }, store) {
    const catalog = await store.catalog();
    const topic = resolveTopic(list<LearningTopicData>(catalog, 'learning', 'topic'), tema_id);
    const have = new Map(list<LearningItemData>(catalog, 'learning', 'item').filter((x) => x.data.topicId === topic.id).map((x) => [normalizeLearningText(x.data.text), x]));
    const refs = [];
    const added: string[] = [];
    const skipped: string[] = [];
    let n = 0;
    for (const f of frases) {
      const key = normalizeLearningText(f.texto);
      const dup = have.get(key);
      if (!key || dup) {
        skipped.push(`"${short(f.texto, 60)}"${dup ? ` [${dup.id}]` : ''}`);
        continue;
      }
      const data: LearningItemData = {
        topicId: topic.id,
        itemType: f.tipo ?? 'frase',
        text: f.texto,
        meaning: f.significado,
        example: f.ejemplo || undefined,
        tags: [...new Set((f.etiquetas ?? []).map((t) => t.toLowerCase()))],
        origin: 'ia',
      };
      const { saved, ref } = await upsert(store, null, { id: newEntityId(store, 'li'), module: 'learning', kind: 'item', data, sort: store.now().getTime() + n++ });
      have.set(key, saved as Entity<LearningItemData>);
      refs.push(ref);
      added.push(`"${short(f.texto, 60)}" [${saved.id}]`);
    }
    if (!added.length) return { text: `No agregué nada: ya estaban en ${topic.data.name}: ${skipped.join('; ')}.` };
    return ok(
      `Agregué ${added.length} a ${topic.data.name} (quedan como nuevas para repasar): ${added.join('; ')}.${skipped.length ? ` Ya estaban: ${skipped.join('; ')}.` : ''}`,
      added.length === 1 ? `Agregó ${added[0].replace(/ \[.*\]$/, '')} a ${topic.data.name}` : `Agregó ${added.length} frases a ${topic.data.name}`,
      { entities: refs },
    );
  },
});

const registrarTest = tool({
  name: 'registrar_test',
  title: 'Guardar resultado de un test',
  group: 'registrar',
  writes: true,
  description: `Guarda el resultado de un test o práctica que le hiciste en el chat (aciertos de total, nivel estimado y sus errores). La primera práctica del día de cada tema da ${sessionXp()} XP. Cada error: etiqueta (gramática, vocabulario, preposiciones, tiempos verbales, phrasal verbs, pronunciación…), la pregunta, lo que respondió y la corrección MÍNIMA (solo el fragmento correcto, p. ej. "depend on"), para detectar los errores que repite.`,
  input: z.object({
    tema_id: zId.optional().describe('Tema (por defecto, el único activo o el de Inglés).'),
    aciertos: z.number().int().min(0).max(200),
    total: z.number().int().min(1).max(200),
    fuente: z.enum(['ia', 'voz', 'tarjetas']).optional().describe('ia (por defecto) = test con preguntas; voz = práctica hablada; tarjetas = repaso.'),
    nivel: zLevel.optional().describe('Nivel que estimas con este test (A1–C2 en idiomas).'),
    errores: z
      .array(
        z.object({
          etiqueta: z.string().trim().min(1).max(40),
          pregunta: z.string().trim().max(500),
          respuesta: z.string().trim().max(500),
          correccion: zText(500),
          explicacion: z.string().trim().max(500).optional(),
        }),
      )
      .max(30)
      .optional(),
    fecha: zFecha,
  }),
  async run(i, store) {
    if (i.aciertos > i.total) throw new ToolError('"aciertos" no puede ser mayor que "total".');
    const date = pastDate(store, i.fecha);
    const { topics, state } = await loadLearning(store);
    const topic = resolveTopic(topics, i.tema_id);
    const st = state.topics[topic.id];
    const before = new Map((st?.errors ?? []).map((e) => [e.key, e]));
    const errors = (i.errores ?? []).map((e) => ({
      tag: e.etiqueta.toLowerCase(),
      prompt: e.pregunta,
      answer: e.respuesta,
      correction: e.correccion,
      explanation: e.explicacion || undefined,
    }));
    let level = i.nivel?.trim() || undefined;
    if (level && topic.data.topicKind === 'idioma' && (CEFR_LEVELS as readonly string[]).includes(level.toUpperCase())) level = level.toUpperCase();
    const ev: GameEvent = makeEvent(store, 'learning.test_taken', { topicId: topic.id, source: i.fuente ?? 'ia', score: i.aciertos, total: i.total, level, errors }, date);
    const sameDay = await store.events({ types: ['learning.test_taken'], match: { topicId: topic.id }, from: date, to: date, limit: 1 });
    await store.addEvents([ev]);
    const pct = Math.round((i.aciertos / i.total) * 100);
    const repeated = [...new Set(errors.map((e) => learningErrorKey(e.tag, e.correction)))].map((k) => before.get(k)).filter((e): e is NonNullable<typeof e> => !!e);
    const xp = sameDay.length ? ` (la XP de práctica de ${date === store.today ? 'hoy' : 'ese día'} ya contaba)` : ` · +${sessionXp()} XP`;
    const L = [`Test guardado en ${topic.data.name}${date === store.today ? '' : ` (${fmtDay(date)})`}: ${i.aciertos}/${i.total} = ${pct}%${level ? ` · nivel ${level}` : ''}${xp}.`];
    const last = st?.lastTest;
    if (last) L.push(`Su test anterior: ${last.pct}% (${last.date}).`);
    if (repeated.length) L.push(`Errores que ya había cometido: ${repeated.map((e) => `"${short(e.correction, 60)}" (ahora ${e.count + 1} veces)`).join('; ')}.`);
    if (errors.length) L.push('Si quiere practicarlos, ofrécele agregarlos con agregar_frase.');
    L.push(`Registro [${ev.id}].`);
    return ok(L.join(' '), `Test de ${topic.data.name}: ${i.aciertos}/${i.total} (${pct}%)`, { events: [ev.id] });
  },
});

export const APRENDIZAJE_TOOLS: AssistantTool[] = [verAprendizaje, agregarFrase, guardarTema, registrarTest];
