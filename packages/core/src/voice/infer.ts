import { GAME_CONFIG } from '../config/game';
import type { AttributeId, MissionSize } from '../types';
import { norm, similarity, stem, tokenize } from './text';

/** Algo que ya registraste antes (misión rápida, diaria o del catálogo): su tamaño y atributo se reutilizan. */
export interface MissionHistoryItem {
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  /** Cuántas veces lo registraste (desempata entre parecidos). */
  count?: number;
}

export interface MissionInference {
  size: MissionSize;
  attribute: AttributeId;
  /**
   * De dónde salió: `historial` = ya registraste ese mismo título · `parecido` = algo muy parecido ·
   * `diccionario` = palabras clave · `defecto` = no hubo pistas (chica · Disciplina).
   */
  source: 'historial' | 'parecido' | 'diccionario' | 'defecto';
  /** Título del historial que se usó (si aplica). */
  match?: string;
}

type Entry = { attr: AttributeId; words: string[]; weight?: number };

/**
 * Diccionario de palabras clave → atributo. Una palabra con `*` al final cuenta como prefijo
 * ("entren*" = entrené, entrenar, entrenamiento); sin `*` debe coincidir la palabra o su raíz.
 * Pesos: actividades físicas claras (gym, correr) 2 · personas 1.5 · el resto 1 · verbos genéricos 0.5.
 * Así "le escribí a mi mamá" es Relaciones y "fui al gym con mi novia" es Fuerza física.
 */
const DICTIONARY: Entry[] = [
  {
    attr: 'fuerza',
    weight: 2,
    words: ['gym', 'entren*', 'ejercicio*', 'corr', 'pesas', 'yoga', 'pilates', 'cardio', 'crossfit', 'box', 'boxeo', 'futbol', 'nadar', 'nade', 'natacion', 'maraton*', 'spinning'],
  },
  {
    attr: 'fuerza',
    words: [
      'carrera', 'bici*', 'ciclismo', 'pierna*', 'pecho', 'espalda', 'brazo*', 'hombro*', 'camin*', 'fut', 'basquet', 'basket', 'tenis', 'padel', 'sentadilla*',
      'lagartija*', 'abdominal*', 'km', 'kms', 'kilometro*', 'estir*', 'deporte*', 'partido', 'trot*', 'senderismo', 'hiking', 'cerro', 'escal*', 'funcional',
    ],
  },
  {
    attr: 'inteligencia',
    words: [
      'leer', 'libro*', 'lectura', 'pagina*', 'estudi*', 'curso*', 'clase*', 'aprend*', 'ingles', 'idioma*', 'frances', 'investig*', 'podcast', 'documental',
      'tarea', 'examen', 'tesis', 'program*', 'codigo', 'tutorial', 'certific*', 'webinar', 'duolingo', 'matematica*', 'automatiz*', 'analiz*', 'audiolibro',
    ],
  },
  {
    attr: 'carisma',
    words: ['presentacion*', 'present', 'expuse', 'expos*', 'discurso', 'pitch', 'networking', 'conferencia', 'prospect*', 'contact*', 'junta*', 'reunion*', 'negoci*', 'entrevista*', 'llamada*'],
  },
  {
    attr: 'finanzas',
    words: [
      'ahorr*', 'deuda*', 'tarjeta*', 'invert*', 'inversion*', 'presupuesto*', 'finanz*', 'factur*', 'cobr*', 'cotiz*', 'banco', 'impuesto*', 'sat', 'contador',
      'venta', 'ventas', 'vend', 'vendi', 'cliente*', 'precio*', 'pag', 'dinero', 'gasto*', 'contabilidad', 'nomina', 'credito', 'prestamo',
    ],
  },
  {
    attr: 'disciplina',
    words: ['madrug*', 'levant*', 'temprano', 'medit*', 'ayun*', 'agua', 'rutina', 'limpi*', 'orden', 'ordene', 'tend*', 'cama', 'organiz*', 'planee', 'planear', 'agenda*', 'puntual*', 'celular', 'redes', 'vitamina*', 'regadera', 'journal*'],
  },
  {
    attr: 'relaciones',
    weight: 1.5,
    words: [
      'familia*', 'novia', 'novio', 'esposa', 'esposo', 'pareja', 'hija', 'hijo', 'hijos', 'hijas', 'mama', 'papa', 'papas', 'padres', 'madre', 'padre', 'herman*',
      'abuel*', 'tio', 'tia', 'tios', 'primo', 'prima', 'primos', 'sobrin*', 'suegr*', 'amig*', 'cuate*', 'compa', 'compas', 'cita', 'cumple*', 'convivi*', 'boda', 'bebe',
    ],
  },
  { attr: 'relaciones', weight: 0.5, words: ['llam', 'visit*', 'platiq*', 'platic*'] },
  {
    attr: 'creatividad',
    words: [
      'disen*', 'escrib*', 'crear', 'cree', 'dibuj*', 'pint*', 'music*', 'guitarr*', 'piano', 'cant', 'foto*', 'video*', 'edit*', 'grab*', 'contenido', 'post', 'posts',
      'blog', 'idea*', 'compus*', 'compon*', 'cocin*', 'manualidad*', 'tiktok', 'reel*', 'instagram', 'youtube', 'logo*', 'arte', 'poema', 'cuento', 'public*',
    ],
  },
];

/** Resultados grandes (conservador: casi todo es chica o media; épica nunca se infiere sola). */
const BIG = [
  /\bcerr\w* (?:(?:una?|el|la|mi) )?(?:venta|trato|contrato|cliente|negocio|deal)/,
  /\b(?:termine|acabe|entregue|lance|publique|presente) (?:(?:el|la|mi|un|una) )?(?:proyecto|curso|libro|app|aplicacion|pagina web|sitio|tesis|lanzamiento)/,
  /\bmaraton\b/,
  /\b(?:aprobe|pase) (?:(?:el|mi) )?examen/,
  /\b(?:consegui|firme) (?:(?:un|una|el|la) )?(?:cliente|contrato|trabajo|chamba|inversion)/,
];
/** Esfuerzo real (~1 hora o más). */
const MEDIUM = [
  /\b(?:gym|gimnasio|clase|curso|junta|reunion|presentacion|propuesta|cotizacion|proyecto)\b/,
  /\bestudie\b/,
  /\blimpie (?:toda )?la casa\b/,
  /\b(?:una|1) hora\b|\bhora y media\b|\b(?:[2-9]|dos|tres|cuatro|cinco) (?:horas|hrs)\b/,
  /\b(?:corri|trote|nade|camine|rode|pedalee) (?:(?:[5-9]|\d{2})|cinco|seis|siete|ocho|nueve|diez|quince|veinte) (?:km|kms|kilometros)\b/,
];

function attrFromDictionary(text: string): AttributeId | null {
  const toks = tokenize(text).map((t) => ({ n: t.n, s: stem(t.n) }));
  const score = new Map<AttributeId, { points: number; first: number }>();
  toks.forEach((t, idx) => {
    for (const e of DICTIONARY) {
      const hit = e.words.some((w) => (w.endsWith('*') ? w.length > 4 && t.n.startsWith(w.slice(0, -1)) : t.n === w || t.s === w));
      if (!hit) continue;
      const cur = score.get(e.attr) ?? { points: 0, first: idx };
      cur.points += e.weight ?? 1;
      score.set(e.attr, cur);
    }
  });
  let best: AttributeId | null = null;
  let bestScore = { points: 0, first: Infinity };
  for (const [attr, s] of score) {
    if (s.points > bestScore.points || (s.points === bestScore.points && s.first < bestScore.first)) {
      best = attr;
      bestScore = s;
    }
  }
  return best;
}

function sizeFromDictionary(text: string): MissionSize {
  const n = norm(text);
  if (BIG.some((r) => r.test(n))) return 'grande';
  if (MEDIUM.some((r) => r.test(n))) return 'media';
  return 'chica';
}

/**
 * Tamaño y atributo para algo que hiciste, a partir del título.
 * 1) Si ya registraste ese mismo título (o uno muy parecido), se reutiliza lo que elegiste entonces.
 * 2) Si no, se infiere con un diccionario de palabras clave en español.
 * 3) Sin pistas: chica · Disciplina.
 */
export function inferMission(title: string, history: MissionHistoryItem[] = [], opts: { minSimilarity?: number } = {}): MissionInference {
  const t = norm(title);
  if (t) {
    const exact = history.filter((h) => norm(h.title) === t).sort((a, b) => (b.count ?? 1) - (a.count ?? 1))[0];
    if (exact) return { size: exact.size, attribute: exact.attribute, source: 'historial', match: exact.title };
    const min = opts.minSimilarity ?? GAME_CONFIG.voz.historyMatch;
    let best: { item: MissionHistoryItem; sim: number } | null = null;
    for (const h of history) {
      const sim = similarity(title, h.title);
      if (sim < min) continue;
      if (!best || sim > best.sim || (sim === best.sim && (h.count ?? 1) > (best.item.count ?? 1))) best = { item: h, sim };
    }
    if (best) return { size: best.item.size, attribute: best.item.attribute, source: 'parecido', match: best.item.title };
  }
  const attribute = attrFromDictionary(title);
  const size = sizeFromDictionary(title);
  if (attribute) return { size, attribute, source: 'diccionario' };
  return { size, attribute: 'disciplina', source: size === 'chica' ? 'defecto' : 'diccionario' };
}
