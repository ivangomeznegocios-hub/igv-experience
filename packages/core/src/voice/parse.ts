import { GAME_CONFIG } from '../config/game';
import { quickMissionId } from '../engine/reports';
import { isInRoutine, type AttributeId, type CompletionKind, type Entity, type GameEvent, type MissionData, type MissionSize, type NpcData, type SettingsData, type TodoData } from '../types';
import { addDays, weekday } from '../util/dates';
import { inferMission, type MissionHistoryItem, type MissionInference } from './infer';
import { capitalize, contentStems, findNumber, norm, readFraction, readNumber, similarity, tokenize, WEAK_STEMS, type NumberMatch, type Token } from './text';

/**
 * Registro por voz SIN IA: convierte lo que dices ("ayer fui al gym, gasté 200 en comida y hablé con mi mamá")
 * en propuestas de registro que confirmas con un toque. Es puro y corre en el dispositivo (funciona sin
 * conexión). Cuando el Coach está disponible, la app le manda el texto a él; esto es el respaldo.
 */

// ---------------------------------------------------------------------------------------------
// Contexto y resultado
// ---------------------------------------------------------------------------------------------

export interface VoiceMission {
  id: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  kind: CompletionKind;
  mainQuestId?: string | null;
  /** Diaria que le toca hoy. */
  routine?: boolean;
}

export interface VoicePerson {
  id: string;
  name: string;
  /** Papel en tu vida ("pareja", "hija", "mamá"…), si la ficha lo tiene. */
  role?: string | null;
  circle?: string | null;
}

export interface VoiceContext {
  today: string;
  /** Misiones que se pueden completar: diarias, secundarias y eventos sin completar, y pendientes de la agenda. */
  missions: VoiceMission[];
  people: VoicePerson[];
  /** Lo que ya registraste (para reutilizar tamaño y atributo). */
  history: MissionHistoryItem[];
  /** Conceptos de dinero anteriores (para adivinar la categoría). */
  money?: { type: 'income' | 'expense'; concept: string; category?: string }[];
  /** Categorías de gasto que ya usas (presupuestos e historial). */
  categories?: string[];
}

interface Base {
  /** Id local de la propuesta (para la lista). */
  key: string;
  date: string;
  /** Frase de la que salió. */
  source: string;
}
export interface MissionProposal extends Base {
  kind: 'mission';
  missionId: string;
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  missionKind: CompletionKind;
  mainQuestId?: string | null;
  /** Viene de tu catálogo (diaria, secundaria, agenda…). */
  matched: boolean;
  inferred?: MissionInference['source'];
}
export interface MoneyProposal extends Base {
  kind: 'income' | 'expense';
  amount: number;
  concept: string;
  category?: string;
}
export interface SleepProposal extends Base {
  kind: 'sleep';
  hours: number;
}
export interface WeightProposal extends Base {
  kind: 'weight';
  /** Peso en kg (si lo dijiste). */
  kg?: number;
  /** Entrenamiento que mencionaste (solo desde el Coach). */
  workout?: string;
}
export interface GoalProposal extends Base {
  kind: 'goal';
  goalId: string;
  title: string;
  amount: number;
  unit: string;
}
export interface RestProposal extends Base {
  kind: 'rest';
}
export type VoiceChannel = 'persona' | 'llamada' | 'mensaje' | 'videollamada';
export interface PersonProposal extends Base {
  kind: 'person';
  npcId: string;
  name: string;
  channel?: VoiceChannel;
  note?: string;
  /** Otras personas que también encajan (p. ej. dos "hijas"). */
  alternatives: { id: string; name: string }[];
}
export interface LessonProposal extends Base {
  kind: 'lesson';
  text: string;
}
export interface TodoProposal extends Base {
  kind: 'todo';
  title: string;
  size: MissionSize;
  attribute: AttributeId;
}
export type VoiceProposal = MissionProposal | MoneyProposal | SleepProposal | WeightProposal | RestProposal | PersonProposal | LessonProposal | TodoProposal | GoalProposal;

export interface DictationResult {
  proposals: VoiceProposal[];
  /** Frases que no se entendieron (siguen guardadas en la nota). */
  unknown: string[];
}

// ---------------------------------------------------------------------------------------------
// Contexto desde los datos de la app
// ---------------------------------------------------------------------------------------------

/** Arma el contexto del analizador con el catálogo y el historial (mismo código en la app y en pruebas). */
export function buildVoiceContext(events: GameEvent[], entities: Entity[], today: string): VoiceContext {
  const active = entities.filter((e) => !e.deletedAt).sort((a, b) => a.sort - b.sort);
  const from = addDays(today, -GAME_CONFIG.voz.historyDays);
  const doneIds = new Set<string>();
  const hist = new Map<string, MissionHistoryItem & { last: string }>();
  const money: NonNullable<VoiceContext['money']> = [];
  const cats: string[] = [];
  for (const e of events) {
    if (e.voidedAt || e.localDate > today) continue;
    const p = (e.payload ?? {}) as Record<string, any>;
    if (e.type === 'mission.completed') {
      doneIds.add(String(p.missionId));
      if (e.localDate < from || !p.title) continue;
      const k = norm(String(p.title));
      const cur = hist.get(k);
      if (!cur) hist.set(k, { title: String(p.title), size: p.size, attribute: p.attribute, count: 1, last: e.localDate });
      else {
        cur.count = (cur.count ?? 0) + 1;
        if (e.localDate >= cur.last) Object.assign(cur, { title: String(p.title), size: p.size, attribute: p.attribute, last: e.localDate });
      }
    } else if ((e.type === 'income.recorded' || e.type === 'expense.recorded') && e.localDate >= from) {
      const category = typeof p.category === 'string' && p.category.trim() ? p.category.trim() : undefined;
      money.push({ type: e.type === 'income.recorded' ? 'income' : 'expense', concept: String(p.concept ?? ''), category });
      if (category && e.type === 'expense.recorded') cats.push(category);
    }
  }
  const wd = weekday(today);
  const missions: VoiceMission[] = [];
  for (const m of active) {
    if (m.module === 'missions' && ['daily', 'side', 'event'].includes(m.kind)) {
      const d = m.data as MissionData;
      if (m.kind !== 'daily' && doneIds.has(m.id)) continue;
      missions.push({ id: m.id, title: d.title, size: d.size, attribute: d.attribute, kind: m.kind as CompletionKind, mainQuestId: d.mainQuestId ?? null, routine: m.kind === 'daily' && isInRoutine(d, wd) });
    } else if (m.module === 'planner' && m.kind === 'todo' && !doneIds.has(m.id)) {
      const d = m.data as TodoData;
      missions.push({ id: m.id, title: d.title, size: d.size, attribute: d.attribute, kind: 'todo' });
    }
  }
  const people: VoicePerson[] = active
    .filter((e) => e.module === 'npcs' && e.kind === 'npc')
    .map((e) => {
      const d = e.data as NpcData & { role?: unknown; circle?: unknown };
      return { id: e.id, name: d.name, role: typeof d.role === 'string' ? d.role : null, circle: typeof d.circle === 'string' ? d.circle : null };
    });
  const history: MissionHistoryItem[] = [
    ...[...hist.values()].map(({ title, size, attribute, count }) => ({ title, size, attribute, count })),
    ...missions.filter((m) => m.kind !== 'todo').map((m) => ({ title: m.title, size: m.size, attribute: m.attribute, count: 0 })),
  ];
  const settings = (active.find((e) => e.id === 'settings')?.data ?? {}) as Partial<SettingsData>;
  const categories = [...new Set([...Object.keys(settings.budgets ?? {}), ...cats])];
  return { today, missions, people, history, money, categories };
}

// ---------------------------------------------------------------------------------------------
// Partir en frases
// ---------------------------------------------------------------------------------------------

/** Minúsculas sin acentos conservando la longitud (para que los índices sirvan en el texto original). */
function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

const LESSON_RE = /\b(?:aprendi que|la leccion (?:es|fue|de hoy)|leccion:|me quedo claro que|me di cuenta de que|para la proxima (?:vez )?(?:debo|tengo que|voy a))/;
/** Conectores que separan acciones. "y" se decide después (ver `standalone`). */
const SOFT_SPLIT_RE = /,(?!\d)|\s+(?:y\s+)?(?:luego|despues(?!\s+de\b)|ademas|tambien|aparte|pero)\s+|\s+y\s+/g;

interface Fragment {
  text: string;
  /** Texto con el que se unía a la frase anterior (para volver a unirla). */
  joiner: string;
}

const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9';

/** Parte en oraciones por signos fuertes (. ; ! ? y saltos de línea), sin cortar "82.5". */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '.' && isDigit(text[i - 1]) && isDigit(text[i + 1])) {
      cur += ch;
      continue;
    }
    if ('.;!?¡¿\n'.includes(ch)) {
      if (cur.trim()) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Algo que salió mal: si va justo antes de "aprendí que…", forma parte de la lección. */
const FAIL_RE = /\b(?:me fue mal|nos fue mal|salio mal|me equivoque|fracase|falle|la regue|perdi|no funciono|no salio|no se logro|no cerre)\b/;

export interface Clause {
  text: string;
  /** Es una lección ("aprendí que…"): no se parte. */
  lesson: boolean;
}

/** Parte el texto en frases con una acción cada una. */
export function splitClauses(text: string): Clause[] {
  const out: Clause[] = [];
  for (const sentence of splitSentences(text)) {
    const f = fold(sentence);
    const lm = LESSON_RE.exec(f);
    const head = lm ? sentence.slice(0, lm.index) : sentence;
    let lesson = lm ? sentence.slice(lm.index) : '';
    const frags: Fragment[] = [];
    if (head.trim()) {
      const fh = fold(head);
      let last = 0;
      let joiner = '';
      for (const m of fh.matchAll(SOFT_SPLIT_RE)) {
        const idx = m.index ?? 0;
        frags.push({ text: head.slice(last, idx), joiner });
        joiner = head.slice(idx, idx + m[0].length);
        last = idx + m[0].length;
      }
      frags.push({ text: head.slice(last), joiner });
    }
    // Sin puntuación (así llega el dictado): "fui al gym gasté 200 en comida" → dos acciones.
    const cutFrags: Fragment[] = [];
    for (const fr of frags) cutAtVerbs(fr.text).forEach((t, i) => cutFrags.push({ text: t, joiner: i === 0 ? fr.joiner : ' ' }));
    frags.splice(0, frags.length, ...cutFrags);
    // Une lo que no es una acción por sí mismo ("y media", "y José", "mi mamá y mi hermano").
    const merged: Fragment[] = [];
    for (const fr of frags) {
      const prev = merged.at(-1);
      if (prev && !standalone(fr, prev)) prev.text = `${prev.text}${fr.joiner}${fr.text}`;
      else merged.push({ ...fr });
    }
    const clean = (t: string) => t.replace(/^[\s,]+|[\s,]+$/g, '').replace(/[\s,]+(?:y|e|pero|luego|entonces)$/i, '').trim();
    if (lesson.trim()) {
      // "Me fue mal en la junta y aprendí que…": el tropiezo va con la lección.
      const prev = merged.at(-1);
      if (prev && FAIL_RE.test(fold(prev.text))) {
        lesson = `${clean(prev.text)}${/[\s,]y\s*$/i.test(prev.text) ? ' y ' : ', '}${lesson}`;
        merged.pop();
      }
    }
    for (const m of merged) {
      const t = clean(m.text);
      if (t) out.push({ text: t, lesson: false });
    }
    if (lesson.trim()) out.push({ text: clean(lesson), lesson: true });
  }
  return out;
}

/** Verbos que no inician una acción nueva al partir texto sin puntuación (copulativos, presente, 3.ª persona). */
const CUT_EXCLUDE = new Set('fue fueron era estuvo peso costo salio cobraron hay estoy ando tengo voy debo necesito hago entreno leo corro depositaron transfirieron cayeron entraron pagaron'.split(' '));
const SUBORD = new Set('que cuando donde como porque si quien mientras aunque cual pero para sin hasta desde lo'.split(' '));
const CLITICS = new Set('me te le se lo la nos les'.split(' '));

/** ¿En el token i empieza otra acción ("…gym gasté…", "…mamá le marqué…")? */
function startsAction(tokens: Token[], i: number): boolean {
  const t = tokens[i];
  if (/^[A-ZÁÉÍÓÚÑ]/.test(t.raw)) return false;
  if (NOT_VERBS.has(t.n) || CUT_EXCLUDE.has(t.n)) return false;
  if (VERB_WORDS.has(t.n)) return true;
  const low = t.raw.toLowerCase();
  if (low.length >= 3 && /[éí]$/.test(low)) return true;
  if (t.n.length >= 5 && /(amos|imos)$/.test(t.n)) return true;
  if (t.n.length >= 6 && /(aron|ieron)$/.test(t.n) && ['me', 'nos'].includes(tokens[i - 1]?.n ?? '')) return true;
  return false;
}

/** ¿En el token i empieza un pendiente ("mañana…", "tengo que…", "no olvidar…")? */
function startsTodo(tokens: Token[], i: number): boolean {
  const w = tokens[i].n;
  const next = tokens[i + 1]?.n ?? '';
  const prev = tokens[i - 1]?.n ?? '';
  if (w === 'manana') return !['la', 'de', 'en', 'por', 'esta', 'una', 'cada'].includes(prev);
  if (w === 'pasado') return next === 'manana';
  if (['tengo', 'hay', 'tenemos'].includes(w)) return next === 'que';
  if (w === 'no') return ['olvidar', 'olvides', 'se'].includes(next);
  return ['recuerdame', 'agendame', 'pendiente'].includes(w);
}

/** Corta un fragmento donde empieza otro verbo conjugado (cuando ya hubo uno antes). */
function cutAtVerbs(text: string): string[] {
  const toks = tokenize(text);
  const cuts: number[] = [];
  let seenVerb = false;
  let lastCut = 0;
  for (let i = 0; i < toks.length; i++) {
    if (i > 0 && seenVerb && startsTodo(toks, i) && i - lastCut >= 2 && !SUBORD.has(toks[i - 1].n)) {
      // "…le marqué a mi novia mañana tengo que llamar al banco": lo de mañana es otra cosa.
      cuts.push(toks[i].start);
      lastCut = i;
      seenVerb = false;
      continue;
    }
    if (i > 0 && seenVerb && startsAction(toks, i)) {
      const at = CLITICS.has(toks[i - 1].n) ? i - 1 : i;
      const before = toks[at - 1]?.n ?? '';
      if (at > 0 && at - lastCut >= 2 && !SUBORD.has(before) && !CLITICS.has(before)) {
        cuts.push(toks[at].start);
        lastCut = at;
      }
    }
    if (verbLike(toks[i], i === 0)) seenVerb = true;
  }
  if (!cuts.length) return [text];
  const out: string[] = [];
  let from = 0;
  for (const c of cuts) {
    out.push(text.slice(from, c));
    from = c;
  }
  out.push(text.slice(from));
  return out;
}

const VERB_WORDS = new Set(
  (
    'fui fue fuimos hice hizo tuve estuve di vi puse pude vine dije traje supe lei comi cene desayune almorce sali corri nade camine entrene medite estudie trabaje ' +
    'hable platique llame marque escribi mande envie pague gaste compre cobre vendi facture cerre termine acabe empece aprendi dormi descanse jugue visite converse ' +
    'lave limpie cocine organice prepare revise ahorre inverti deposite transferi pese peso tengo voy debo necesito hay hago entreno leo corro estoy ando ' +
    'practique avance logre consegui firme entregue lance publique grabe edite disene dibuje pinte toque cante bese abrace felicite salude ayude lleve recogi ' +
    'pagaron depositaron transfirieron cayeron entraron gane recibi costo salio cobraron'
  ).split(' '),
);
const NOT_VERBS = new Set('cafe jose bebe pure comite chale consomme aqui ahi alli asi si mi ti tu esqui rubi bisturi colibri mani aji domino primos ramos animos rene noe'.split(' '));
const FILLERS = new Set('y e pues bueno este entonces luego despues ademas tambien aparte ya ah eh ok okey oye mira igual osea ahorita'.split(' '));

/** ¿Parece un verbo conjugado (algo que hiciste)? */
function verbLike(t: Token, allowCapital: boolean): boolean {
  if (!allowCapital && /^[A-ZÁÉÍÓÚÑ]/.test(t.raw)) return false;
  if (NOT_VERBS.has(t.n)) return false;
  if (VERB_WORDS.has(t.n)) return true;
  const low = t.raw.toLowerCase();
  if (low.length >= 3 && /[éíó]$/.test(low)) return true;
  if (t.n.length >= 6 && /(aron|ieron)$/.test(t.n)) return true;
  if (t.n.length >= 5 && /(amos|imos)$/.test(t.n)) return true;
  return false;
}

function hasVerb(tokens: Token[], sentenceStart: boolean): boolean {
  return tokens.some((t, i) => verbLike(t, sentenceStart && i === 0));
}

const NUMBER_TAIL = /(?:^|\s)(?:\d[\d.,]*|uno?|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|mil|horas?|hrs?|kilos?|kg|km|minutos?|min)\s*$/;

const TENS_TAIL = /(?:^|\s)(?:treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s*$/;
const UNIT_WORDS = new Set(['un', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']);

/** ¿El fragmento es una acción propia o completa a la anterior? */
function standalone(fr: Fragment, prev: Fragment): boolean {
  const toks = tokenize(fr.text);
  const meaningful = toks.filter((t) => !FILLERS.has(t.n));
  if (!meaningful.length) return false;
  const first = meaningful[0];
  // "treinta y cinco", "seis horas y media", "82 y medio": es la continuación de un número.
  if (TENS_TAIL.test(fold(prev.text)) && UNIT_WORDS.has(first.n)) return false;
  if (NUMBER_TAIL.test(fold(prev.text))) {
    const n = readNumber(meaningful, 0);
    if (n && n.end >= meaningful.length) return false;
    if (['media', 'medio', 'cuarto'].includes(first.n)) return false;
  }
  if (hasVerb(meaningful, false)) return true;
  // "…200 en comida y 150 de uber": un monto con concepto es otro registro.
  const num = readNumber(meaningful, 0);
  if (num && !num.bareOne && meaningful.length > num.end) return true;
  if (/\b(?:manana|pasado manana|descanso|tengo que|hay que|pendiente)\b/.test(fold(fr.text))) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Fechas habladas
// ---------------------------------------------------------------------------------------------

type DateMarker = { kind: 'offset'; days: number; anoche?: boolean } | { kind: 'weekday'; wd: number };

const WEEKDAYS: Record<string, number> = { lunes: 0, martes: 1, miercoles: 2, jueves: 3, viernes: 4, sabado: 5, domingo: 6 };
const NUM_SMALL: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

/** Encuentra "hoy", "ayer", "antier", "anoche", "mañana", "hace 3 días", "el lunes"… y los índices de esas palabras. */
function findDateMarker(tokens: Token[]): { marker: DateMarker; drop: Set<number> } | null {
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].n;
    const drop = new Set<number>([i]);
    if (w === 'hoy') return { marker: { kind: 'offset', days: 0 }, drop };
    if (w === 'ayer') return { marker: { kind: 'offset', days: -1 }, drop };
    if (w === 'antier' || w === 'anteayer' || w === 'antenoche') return { marker: { kind: 'offset', days: -2 }, drop };
    if (w === 'anoche') return { marker: { kind: 'offset', days: -1, anoche: true }, drop };
    if (w === 'pasado' && tokens[i + 1]?.n === 'manana') return { marker: { kind: 'offset', days: 2 }, drop: new Set([i, i + 1]) };
    // "mañana" como día (no "en la mañana" / "por la mañana" / "de la mañana")
    if (w === 'manana' && tokens[i - 1]?.n !== 'la') return { marker: { kind: 'offset', days: 1 }, drop };
    if (w === 'hace' && tokens[i + 1]) {
      const n = /^\d+$/.test(tokens[i + 1].n) ? Number(tokens[i + 1].n) : NUM_SMALL[tokens[i + 1].n];
      if (n && /^dias?$/.test(tokens[i + 2]?.n ?? '')) return { marker: { kind: 'offset', days: -n }, drop: new Set([i, i + 1, i + 2]) };
      if (tokens[i + 1].n === 'una' && tokens[i + 2]?.n === 'semana') return { marker: { kind: 'offset', days: -7 }, drop: new Set([i, i + 1, i + 2]) };
    }
    if (w in WEEKDAYS && (tokens[i - 1]?.n === 'el' || tokens[i - 1]?.n === 'este')) {
      return { marker: { kind: 'weekday', wd: WEEKDAYS[w] }, drop: new Set([i - 1, i]) };
    }
  }
  return null;
}

function resolveDate(marker: DateMarker | null, today: string, purpose: 'past' | 'future' | 'sleep'): string {
  if (!marker) return today;
  if (marker.kind === 'offset') {
    if (purpose === 'sleep' && marker.anoche) return today;
    const d = addDays(today, marker.days);
    if (purpose === 'future') return d < today ? today : d;
    return d > today ? today : d;
  }
  const wd = weekday(today);
  if (purpose === 'future') {
    const ahead = (marker.wd - wd + 7) % 7 || 7;
    return addDays(today, ahead);
  }
  const back = (wd - marker.wd + 7) % 7 || 7;
  return addDays(today, -back);
}

// ---------------------------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------------------------

/** Grupos de palabras para el papel de una persona (todas normalizadas). */
const ROLE_GROUPS: string[][] = [
  ['pareja', 'novia', 'novio', 'esposa', 'esposo', 'prometida', 'prometido', 'mujer', 'marido', 'amor', 'vieja', 'viejo'],
  ['mama', 'madre', 'mami', 'ma', 'jefecita'],
  ['papa', 'padre', 'papi', 'pa', 'jefecito'],
  ['hijo'],
  ['hija'],
  ['hermano', 'carnal'],
  ['hermana'],
  ['abuelo'],
  ['abuela'],
  ['tio'],
  ['tia'],
  ['primo'],
  ['prima'],
  ['suegro'],
  ['suegra'],
  ['cunado'],
  ['cunada'],
  ['sobrino'],
  ['sobrina'],
  ['amigo', 'cuate', 'compa', 'bro', 'mejor amigo'],
  ['amiga', 'mejor amiga'],
  ['socio'],
  ['socia'],
  ['jefe', 'jefa'],
  ['mentor', 'mentora', 'coach'],
  ['cliente', 'clienta'],
];
const PLURAL_ROLES: Record<string, string[]> = {
  papas: ['papa', 'mama'],
  padres: ['papa', 'mama'],
  hijos: ['hijo', 'hija'],
  hermanos: ['hermano', 'hermana'],
  abuelos: ['abuelo', 'abuela'],
  tios: ['tio', 'tia'],
  primos: ['primo', 'prima'],
  suegros: ['suegro', 'suegra'],
  amigos: ['amigo', 'amiga'],
  amigas: ['amiga'],
  socios: ['socio', 'socia'],
};
const roleGroupOf = (w: string) => ROLE_GROUPS.find((g) => g.includes(w)) ?? null;

const SOCIAL_RE =
  /\b(?:hable|platique|comi|cene|desayune|almorce|sali|estuve|converse|jugue|pase (?:el dia|tiempo|la tarde|la noche)|me vi|nos vimos|vi a|visite|fui a ver|llame|marque|escribi|mande|whats|mensaje|videollamada|llamada|felicite|salude|abrace|convivi|acompane|ayude|lleve|recogi|me llamo|me marco|me escribio|vino)\b/;

function channelOf(f: string): VoiceChannel | undefined {
  if (/\b(?:videollamada|zoom|facetime|meet)\b/.test(f)) return 'videollamada';
  if (/\b(?:llame|marque|me llamo|me marco|llamada|por telefono|telefono)\b/.test(f)) return 'llamada';
  if (/\b(?:escribi|mande|mensaje|whats|whatsapp|texto|correo|me escribio)\b/.test(f)) return 'mensaje';
  if (/\b(?:comi|cene|desayune|almorce|sali|estuve|me vi|nos vimos|vi a|visite|fui a ver|abrace|convivi|acompane|jugue|pase|vino|platique)\b/.test(f)) return 'persona';
  return undefined;
}

interface PersonHit {
  people: VoicePerson[];
  /** Palabra de papel ("papá") o nombre con el que se mencionó. */
  word: string;
  group: string[] | null;
}

/** Personas mencionadas en una frase: por nombre o por su papel ("mi papá", "mis papás"). */
function findPeople(tokens: Token[], people: VoicePerson[]): { hits: PersonHit[]; unresolved: string[] } {
  const hits: PersonHit[] = [];
  const unresolved: string[] = [];
  const used = new Set<string>();
  const ftext = ` ${tokens.map((t) => t.n).join(' ')} `;
  const INTRO = new Set(['con', 'a', 'le', 'mi', 'de', 'y', 'al']);
  // Por nombre
  for (const p of people) {
    const full = norm(p.name);
    const first = full.split(' ')[0];
    if (!first || first.length < 2) continue;
    const fullHit = full.includes(' ') && ftext.includes(` ${full} `);
    const firstIdx = tokens.findIndex((t, i) => t.n === first && (/^[A-ZÁÉÍÓÚÑ]/.test(t.raw) || INTRO.has(tokens[i - 1]?.n ?? '')));
    if (fullHit || firstIdx >= 0) {
      hits.push({ people: [p], word: first, group: null });
      used.add(p.id);
    }
  }
  // Por papel ("mi papá", "con mi novia", "a mis papás")
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].n;
    const prev = tokens[i - 1]?.n ?? '';
    if (!['mi', 'mis', 'con', 'a', 'al', 'tu', 'su'].includes(prev)) continue;
    const words = PLURAL_ROLES[w] ?? (roleGroupOf(w) ? [w] : []);
    for (const word of words) {
      const group = roleGroupOf(word)!;
      const matches = people.filter((p) => {
        const role = norm(p.role ?? '');
        const name = norm(p.name);
        return (role && group.some((g) => role === g || role.split(/[\s/,]+/).includes(g))) || group.some((g) => name === g || name.split(' ').includes(g));
      });
      const fresh = matches.filter((m) => !used.has(m.id));
      if (fresh.length) {
        hits.push({ people: fresh, word, group });
        fresh.slice(0, 1).forEach((m) => used.add(m.id));
      } else if (!matches.length) unresolved.push(word);
    }
  }
  return { hits, unresolved };
}

// ---------------------------------------------------------------------------------------------
// Dinero
// ---------------------------------------------------------------------------------------------

const EXPENSE_RE = /\b(?:gaste|me gaste|pague|compre|me costo|costo|costaron|salio en|me salio|me cobraron|cobraron|se fue|se fueron|se me fue|se me fueron|done|di de)\b/;
const INCOME_RE =
  /\b(?:cobre|me pagaron|pagaron|me depositaron|depositaron|me transfirieron|transfirieron|me cayeron|cayeron|vendi|facture|gane|me entraron|entraron|recibi|ingresaron|cerre (?:una venta|un trato|un contrato|un negocio|un cliente)|me dieron)\b/;
const CURRENCY = new Set(['peso', 'pesos', 'varo', 'varos', 'baro', 'baros', 'mxn', 'mx', 'dolares', 'dolar', 'usd', 'lucas', 'luca']);
const NOT_MONEY_UNITS = new Set(['hora', 'horas', 'hrs', 'hr', 'h', 'kilo', 'kilos', 'kg', 'km', 'kms', 'kilometros', 'minuto', 'minutos', 'min', 'mins', 'vez', 'veces', 'personas', 'dias', 'dia', 'paginas', 'pagina', 'litros', 'piezas', 'cajas', 'semanas', 'meses', 'anos', 'repeticiones', 'series']);
const EDGE_WORDS = new Set(['en', 'de', 'del', 'para', 'por', 'la', 'el', 'los', 'las', 'un', 'una', 'mi', 'mis', 'a', 'al', 'que', 'como', 'y', 'me', 'se', 'le', 'lo', 'unos', 'unas', 'fue', 'fueron', 'son', 'total']);

/** Categorías de gasto comunes (con sinónimos para usar tu propio nombre si ya lo tienes). */
const EXPENSE_CATEGORIES: { label: string; aliases: string[]; words: string[] }[] = [
  {
    label: 'Comida',
    aliases: ['comida', 'comidas', 'alimentos', 'alimentacion', 'restaurante', 'restaurantes', 'super', 'despensa'],
    words: ['comida', 'comer', 'comi', 'cena', 'desayuno', 'almuerzo', 'tacos', 'taco', 'restaurante', 'super', 'supermercado', 'despensa', 'mandado', 'cafe', 'starbucks', 'pizza', 'hamburguesa', 'tortas', 'antojo', 'oxxo', 'rappi', 'didi food', 'uber eats', 'sushi', 'pollo', 'carne', 'fruta', 'verdura', 'walmart', 'costco', 'soriana', 'chedraui'],
  },
  {
    label: 'Transporte',
    aliases: ['transporte', 'gasolina', 'auto', 'coche', 'carro', 'movilidad'],
    words: ['gasolina', 'gas del carro', 'uber', 'didi', 'taxi', 'camion', 'metro', 'estacionamiento', 'caseta', 'casetas', 'peaje', 'verificacion', 'llantas', 'taller', 'mecanico', 'carro', 'coche', 'auto', 'vuelo', 'avion', 'autobus'],
  },
  {
    label: 'Casa',
    aliases: ['casa', 'hogar', 'servicios', 'vivienda', 'renta'],
    words: ['renta', 'luz', 'agua', 'gas', 'internet', 'telefono', 'celular', 'cfe', 'predial', 'mantenimiento', 'limpieza', 'muebles', 'hipoteca', 'plan del cel', 'telmex', 'izzi', 'totalplay', 'megacable'],
  },
  {
    label: 'Salud',
    aliases: ['salud', 'medico', 'medicina', 'farmacia'],
    words: ['doctor', 'medico', 'medicina', 'medicinas', 'farmacia', 'dentista', 'consulta', 'analisis', 'laboratorio', 'terapia', 'psicologo', 'gym', 'gimnasio', 'suplementos', 'proteina', 'vitaminas', 'seguro'],
  },
  {
    label: 'Entretenimiento',
    aliases: ['entretenimiento', 'ocio', 'diversion', 'salidas', 'suscripciones'],
    words: ['cine', 'netflix', 'spotify', 'disney', 'hbo', 'max', 'youtube', 'videojuego', 'juego', 'concierto', 'boletos', 'bar', 'antro', 'fiesta', 'chelas', 'cerveza', 'salida', 'viaje', 'hotel', 'airbnb'],
  },
  {
    label: 'Negocio',
    aliases: ['negocio', 'trabajo', 'empresa', 'oficina'],
    words: ['publicidad', 'anuncios', 'ads', 'facebook ads', 'dominio', 'hosting', 'software', 'licencia', 'contador', 'papeleria', 'oficina', 'cowork', 'proveedor', 'mercancia', 'inventario', 'herramienta'],
  },
  { label: 'Educación', aliases: ['educacion', 'escuela', 'cursos', 'libros', 'colegiatura'], words: ['curso', 'libro', 'libros', 'colegiatura', 'escuela', 'clase', 'clases', 'diplomado', 'udemy', 'platzi', 'inscripcion'] },
  { label: 'Ropa', aliases: ['ropa', 'vestido', 'compras'], words: ['ropa', 'tenis', 'zapatos', 'camisa', 'playera', 'pantalon', 'chamarra', 'sudadera'] },
  { label: 'Deudas', aliases: ['deudas', 'deuda', 'tarjeta', 'tarjetas', 'creditos'], words: ['tarjeta', 'deuda', 'credito', 'prestamo', 'mensualidad', 'abono'] },
];

function guessCategory(concept: string, type: 'income' | 'expense', ctx: VoiceContext): string | undefined {
  const c = norm(concept);
  if (!c) return undefined;
  // 1) Lo mismo (o casi) que ya registraste
  const past = (ctx.money ?? []).filter((m) => m.type === type && m.category);
  const exact = past.find((m) => norm(m.concept) === c);
  if (exact) return exact.category;
  const near = past.find((m) => similarity(m.concept, concept) >= 0.67);
  if (near) return near.category;
  if (type !== 'expense') return undefined;
  // 2) Diccionario, con tu propio nombre de categoría si ya la usas
  const padded = ` ${c} `;
  const cat = EXPENSE_CATEGORIES.find((k) => k.words.some((w) => padded.includes(` ${w} `)));
  if (!cat) return undefined;
  const mine = (ctx.categories ?? []).find((x) => cat.aliases.includes(norm(x)) || norm(x) === norm(cat.label));
  return mine ?? cat.label;
}

/** Primer número que parece monto (no "2 kilos", "3 horas" ni "un"). */
function findAmount(tokens: Token[]): NumberMatch | null {
  for (let i = 0; i < tokens.length; i++) {
    const m = readNumber(tokens, i);
    if (!m) continue;
    const next = tokens[m.end]?.n ?? '';
    if (NOT_MONEY_UNITS.has(next)) {
      i = m.end - 1;
      continue;
    }
    if (m.bareOne && !CURRENCY.has(next)) continue;
    if (m.value > 0) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Misiones
// ---------------------------------------------------------------------------------------------

const KIND_ORDER: Record<string, number> = { daily: 0, todo: 1, side: 2, event: 3 };

/** Misión de tu catálogo que mejor encaja con la frase (o null). */
export function matchMission(text: string, missions: VoiceMission[], threshold: number = GAME_CONFIG.voz.missionMatch): VoiceMission | null {
  const cs = contentStems(text);
  if (!cs.length) return null;
  let best: { m: VoiceMission; cov: number; common: number } | null = null;
  for (const m of missions) {
    // "Caminar o estirar 20 min": basta con una de las opciones.
    for (const part of fold(m.title).split(/\s+o\s+/)) {
      const all = contentStems(part);
      const strong = all.filter((s) => !WEAK_STEMS.has(s));
      const ts = strong.length ? strong : all;
      if (!ts.length) continue;
      const common = ts.filter((s) => cs.includes(s));
      if (!common.length) continue;
      const cov = common.length / ts.length;
      if (cov < threshold) continue;
      const better =
        !best ||
        cov > best.cov ||
        (cov === best.cov && (Number(!!m.routine) > Number(!!best.m.routine) ||
          (!!m.routine === !!best.m.routine && ((KIND_ORDER[m.kind] ?? 9) < (KIND_ORDER[best.m.kind] ?? 9) || ((KIND_ORDER[m.kind] ?? 9) === (KIND_ORDER[best.m.kind] ?? 9) && common.length > best.common)))));
      if (better) best = { m, cov, common: common.length };
    }
  }
  return best?.m ?? null;
}

const LEAD_RE = /^(?:(?:y|e|pues|bueno|este|entonces|luego|despues(?: de eso)?|ademas|tambien|aparte|ya|ah|eh|ok|okey|oye|mira|igual|o sea|ahorita|hoy|ayer|antier|anoche|en la (?:manana|tarde|noche)|por la (?:manana|tarde|noche)|en la manana de hoy)[\s,]+)+/;
const TRAIL_RE = /(?:[\s,]+(?:y ya|nada mas|y eso|eso es todo|es todo|hoy|ayer|antier|en la (?:manana|tarde|noche)|por la (?:manana|tarde|noche)))+$/;

/** Limpia una frase para usarla como título ("hoy fui al gym y ya" → "Fui al gym"). */
export function cleanTitle(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  for (let k = 0; k < 3; k++) {
    const f = fold(t);
    const lead = LEAD_RE.exec(f);
    if (lead) t = t.slice(lead[0].length);
    const trail = TRAIL_RE.exec(fold(t));
    if (trail) t = t.slice(0, trail.index);
  }
  // Fechas en medio ("fui ayer al gym") y signos sueltos
  t = t
    .replace(/(^|\s)(?:hoy|ayer|antier|anteayer|anoche)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');
  return capitalize(t).slice(0, 300);
}

// ---------------------------------------------------------------------------------------------
// Analizador
// ---------------------------------------------------------------------------------------------

const NEGATIVE_RE = /^(?:no|nunca|ni|tampoco)\b|\b(?:no pude|no fui|no hice|no alcance|no me dio tiempo|se me olvido|olvide)\b|\b(?:me fue mal|nos fue mal|salio mal|me equivoque|fracase|falle|la regue)\b/;
const TODO_RE =
  /^(?:(?:manana|pasado manana)\s+)?(?:tengo que|hay que|debo(?: de)?|necesito|me falta|voy a|vamos a|pendiente:?|recordar|recuerdame|recuerda|no olvidar|no se me olvide|no olvides|que no se me olvide|agendar|agendame|agenda|apunta|anota)\s+(?:que\s+|de\s+)?/;
const REST_RE = /\bdia de descanso\b|\bme (?:tomo|tome) el dia\b|^(?:(?:hoy|ayer|antier) )?(?:fue |es |sera )?(?:mi |un )?(?:dia de )?descans(?:o|e|ando)(?: todo el dia| hoy| ayer)?$|^descanso(?: hoy)?$/;
const SLEEP_WORDS = new Set(['dormi', 'dormido', 'dormimos', 'durmiendo']);
const WEIGHT_WORDS = new Set(['peso', 'pese', 'pesaba', 'pesando', 'bascula']);
const KG_WORDS = new Set(['kilos', 'kilo', 'kg', 'kgs', 'kilogramos']);
/** Palabras que no van en el concepto de un gasto o ingreso. */
const MONEY_NOISE = new Set(['me', 'pague', 'gaste', 'cerre', 'cerramos', 'cobre']);
const DEAL_RE = /\bcerr\w* (?:(?:una?|el|la) )?(?:venta|trato|contrato|negocio|cliente)\b/;

export interface ParseOptions {
  /** Umbral de parecido para reconocer misiones (0–1). */
  missionMatch?: number;
}

/**
 * Analiza lo que dijiste y devuelve propuestas de registro.
 * No registra nada: la app las muestra y tú confirmas.
 */
export function parseDictation(text: string, ctx: VoiceContext, opts: ParseOptions = {}): DictationResult {
  const proposals: VoiceProposal[] = [];
  const unknown: string[] = [];
  let marker: DateMarker | null = null;
  let lastMoney: 'income' | 'expense' | null = null;
  let n = 0;
  const key = () => `v${++n}`;
  const threshold = opts.missionMatch ?? GAME_CONFIG.voz.missionMatch;

  const pushMission = (m: VoiceMission, date: string, source: string) =>
    proposals.push({ key: key(), kind: 'mission', date, source, missionId: m.id, title: m.title, size: m.size, attribute: m.attribute, missionKind: m.kind, mainQuestId: m.mainQuestId ?? null, matched: true });
  const pushQuick = (title: string, date: string, source: string) => {
    const inf = inferMission(title, ctx.history);
    proposals.push({ key: key(), kind: 'mission', date, source, missionId: quickMissionId(title), title, size: inf.size, attribute: inf.attribute, missionKind: 'quick', matched: false, inferred: inf.source });
  };

  for (const { text: clause, lesson } of splitClauses(text)) {
    const tokens = tokenize(clause);
    if (!tokens.length) continue;
    const prevMarker = marker;
    const dm = findDateMarker(tokens);
    if (dm) marker = dm.marker;
    const f = fold(clause);
    const body = tokens.filter((_, i) => !dm?.drop.has(i));
    // Título sin las palabras de fecha ("el lunes fui al cine" → "Fui al cine")
    const title = cleanTitle(withoutTokens(clause, tokens, dm?.drop));
    const bodyF = fold(title);
    const past = resolveDate(marker, ctx.today, 'past');
    const before = proposals.length;

    // 1) Lección ("aprendí que…", "me fue mal en la junta y aprendí que…")
    if (lesson) {
      const t = capitalize(clause.trim());
      if (t.length >= 3) proposals.push({ key: key(), kind: 'lesson', date: past, source: clause, text: t.slice(0, 4000) });
      continue;
    }

    // 2) Pendiente para después ("mañana tengo que…", "no olvidar…", "el viernes junta con Ana")
    const todo = TODO_RE.exec(bodyF);
    const futureMarker = !!dm && ((dm.marker.kind === 'offset' && dm.marker.days > 0) || dm.marker.kind === 'weekday');
    if (todo || (futureMarker && !hasPastVerb(body))) {
      const t = todo ? capitalize(title.slice(todo[0].length)) : title;
      if (t.length >= 2) {
        const inf = inferMission(t, ctx.history);
        proposals.push({ key: key(), kind: 'todo', date: resolveDate(marker, ctx.today, 'future'), source: clause, title: t, size: inf.size, attribute: inf.attribute });
      } else unknown.push(clause);
      // La fecha de un pendiente no se queda pegada a lo que sigue.
      if (dm) marker = prevMarker;
      continue;
    }

    // 3) Negaciones y tropiezos: no se registra lo que NO hiciste.
    if (NEGATIVE_RE.test(bodyF)) {
      unknown.push(clause);
      continue;
    }

    // 4) Día de descanso
    if (REST_RE.test(bodyF) || REST_RE.test(f)) {
      proposals.push({ key: key(), kind: 'rest', date: past, source: clause });
      continue;
    }

    // 5) Sueño ("dormí seis horas y media", "anoche dormí 7 horas")
    const si = body.findIndex((t) => SLEEP_WORDS.has(t.n));
    if (si >= 0) {
      const num = findNumber(body, si + 1, Math.min(body.length, si + 6));
      const afterLas = num && ['las', 'la'].includes(body[num.start - 1]?.n ?? '');
      if (num && !afterLas) {
        let hours = num.value;
        const fr = readFraction(body, num.end, ['horas', 'hora', 'hrs', 'hr', 'h']);
        if (fr) hours += fr.value;
        if (hours >= 1 && hours <= 16) {
          proposals.push({ key: key(), kind: 'sleep', date: resolveDate(marker, ctx.today, 'sleep'), source: clause, hours: Math.round(hours * 100) / 100 });
          continue;
        }
      }
      unknown.push(clause);
      continue;
    }

    // 6) Peso ("peso 82.5", "pesé 82 kilos", "amanecí en 81 kilos")
    const lead = body.findIndex((t) => !FILLERS.has(t.n) && t.n !== 'yo' && t.n !== 'me');
    const wi = body.findIndex((t, i) => WEIGHT_WORDS.has(t.n) && (i === lead || ['la', 'mi', 'ya', 'me'].includes(body[i - 1]?.n ?? '')));
    const kgIdx = body.findIndex((t, i) => KG_WORDS.has(t.n) && i > 0);
    if (wi >= 0 || (kgIdx > 0 && !EXPENSE_RE.test(f) && !INCOME_RE.test(f))) {
      const num = wi >= 0 ? findNumber(body, wi + 1, Math.min(body.length, wi + 5)) : findNumber(body, Math.max(0, kgIdx - 6), kgIdx);
      if (num && !CURRENCY.has(body[num.end]?.n ?? '')) {
        let kg = num.value;
        const fr = readFraction(body, num.end, ['kilos', 'kilo', 'kg', 'kgs']);
        if (fr) kg += fr.value;
        if (kg >= 30 && kg <= 300) {
          proposals.push({ key: key(), kind: 'weight', date: past, source: clause, kg: Math.round(kg * 10) / 10 });
          continue;
        }
      }
    }

    // 7) Dinero ("gasté 200 en comida", "me pagaron 5 mil", "$350 de gasolina", "…y 150 de uber")
    let money: 'income' | 'expense' | null = null;
    if (/\b(?:me cobraron|cobraron)\b/.test(f)) money = 'expense';
    else if (INCOME_RE.test(f)) money = 'income';
    else if (EXPENSE_RE.test(f)) money = 'expense';
    const amount = findAmount(body);
    if (!money && amount) {
      const first = body.findIndex((t) => !FILLERS.has(t.n));
      const hasCurrency = amount.dollar || CURRENCY.has(body[amount.end]?.n ?? '');
      if (lastMoney && amount.start === first) money = lastMoney;
      else if (hasCurrency) money = 'expense';
    }
    if (money && amount) {
      const drop = new Set<number>();
      for (let i = amount.start; i < amount.end; i++) drop.add(i);
      if (CURRENCY.has(body[amount.end]?.n ?? '')) drop.add(amount.end);
      const verbRe = money === 'income' ? INCOME_RE : EXPENSE_RE;
      const conceptTokens = body.filter((t, i) => !drop.has(i) && !verbRe.test(t.n) && !FILLERS.has(t.n) && !CURRENCY.has(t.n) && !MONEY_NOISE.has(t.n));
      let words = conceptTokens.map((t) => t.raw);
      // "una venta de con Grupo Norte" → "venta con Grupo Norte"
      for (let i = 0; i < words.length - 1; i++) {
        if (['de', 'por', 'en', 'como'].includes(norm(words[i])) && ['con', 'de', 'del', 'para', 'a', 'al', 'en', 'por'].includes(norm(words[i + 1]))) {
          words.splice(i, 1);
          i--;
        }
      }
      while (words.length && EDGE_WORDS.has(norm(words[0]))) words = words.slice(1);
      while (words.length && EDGE_WORDS.has(norm(words[words.length - 1]))) words = words.slice(0, -1);
      const concept = capitalize(words.join(' ')).slice(0, 300);
      proposals.push({ key: key(), kind: money, date: past, source: clause, amount: Math.round(amount.value * 100) / 100, concept, category: guessCategory(concept, money, ctx) });
      lastMoney = money;
      // Cerrar una venta también es un resultado (XP por la acción; el dinero va aparte).
      if (money === 'income' && DEAL_RE.test(f)) {
        const t = capitalize(
          title
            .replace(/\s*(?:de|por)\s+\$?[\d.,]+(?:\s*(?:mil|pesos|k|lucas))?/i, '')
            .replace(/\$?[\d.,]+\s*(?:mil|pesos|k|lucas)?/g, '')
            .replace(/\s+/g, ' ')
            .trim(),
        );
        const m = matchMission(t, ctx.missions, threshold);
        if (m) pushMission(m, past, clause);
        else if (t) pushQuick(t, past, clause);
      }
      continue;
    }
    lastMoney = null;

    // 8) Personas ("hablé con Ana", "comí con mi papá", "le marqué a mi novia")
    const social = SOCIAL_RE.test(f);
    const { hits, unresolved } = findPeople(body, ctx.people);
    if (hits.length) {
      const channel = channelOf(f);
      for (const h of hits) {
        const [first, ...rest] = h.people;
        proposals.push({
          key: key(),
          kind: 'person',
          date: past,
          source: clause,
          npcId: first.id,
          name: first.name,
          channel,
          note: title.length > 3 ? title.slice(0, 2000) : undefined,
          alternatives: rest.map((p) => ({ id: p.id, name: p.name })),
        });
      }
    }
    // Diaria ligada a esa persona ("estuve con mi hijo" → "Tiempo de calidad con mi hijo")
    const linkWords = [...hits.flatMap((h) => h.group ?? [norm(h.word)]), ...unresolved.flatMap((w) => roleGroupOf(w) ?? [w])];
    const linked = linkWords.length ? ctx.missions.find((m) => m.kind === 'daily' && fold(m.title).split(/[^a-z0-9]+/).some((w) => linkWords.includes(w))) : undefined;
    if (linked) {
      pushMission(linked, past, clause);
      continue;
    }
    if (social && hits.length) continue;

    // 9) Misión del catálogo o misión rápida (solo si suena a algo que hiciste)
    const m = matchMission(title, ctx.missions, threshold);
    if (m) {
      pushMission(m, past, clause);
      continue;
    }
    const words = contentStems(title);
    if (title && words.length && words.length <= 14 && (hasActionVerb(body) || social || inferMission(title, ctx.history).source !== 'defecto')) {
      pushQuick(title, past, clause);
      continue;
    }
    if (proposals.length === before && contentStems(clause).length) unknown.push(clause);
  }

  return { proposals: dedupe(proposals), unknown };
}

/** El texto sin ciertas palabras (por índice de token). */
function withoutTokens(text: string, tokens: Token[], drop?: Set<number>): string {
  if (!drop?.size) return text;
  let out = '';
  let last = 0;
  tokens.forEach((t, i) => {
    if (!drop.has(i)) return;
    out += text.slice(last, t.start);
    last = t.end;
  });
  return (out + text.slice(last)).replace(/\s+/g, ' ').trim();
}

const PRESENT = new Set(['tengo', 'voy', 'debo', 'necesito', 'hay', 'hago', 'entreno', 'leo', 'corro', 'estoy', 'ando', 'peso']);
/** Verbos que por sí solos no son una misión ("le conté", "fue un buen día"). */
const LOW_VALUE = new Set('fue fueron era estuvo estuve tuve conte dije comente pregunte explique pense senti quede vi oi supe paso salio'.split(' '));

/** ¿Tiene un verbo en pasado (algo que ya hiciste)? */
function hasPastVerb(tokens: Token[]): boolean {
  return tokens.some((t, i) => !PRESENT.has(t.n) && verbLike(t, i === 0));
}

/** ¿Tiene un verbo en pasado que por sí mismo suena a algo que hiciste? */
function hasActionVerb(tokens: Token[]): boolean {
  return tokens.some((t, i) => !PRESENT.has(t.n) && !LOW_VALUE.has(t.n) && verbLike(t, i === 0));
}

/** Quita repetidos: misma misión el mismo día, misma persona el mismo día, un descanso por día. */
function dedupe(list: VoiceProposal[]): VoiceProposal[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k =
      p.kind === 'mission'
        ? `m:${p.missionId}:${p.date}`
        : p.kind === 'person'
          ? `p:${p.npcId}:${p.date}`
          : p.kind === 'rest'
            ? `r:${p.date}`
            : p.kind === 'sleep'
              ? `s:${p.date}`
              : p.kind === 'weight'
                ? `w:${p.date}`
                : `${p.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
