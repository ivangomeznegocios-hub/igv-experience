/**
 * Utilidades de texto en español (México) para el registro por voz: normalizar, partir en palabras,
 * raíces ligeras para comparar títulos y números dichos con palabras ("mil quinientos", "seis y media").
 * Todo es puro (sin DOM ni red).
 */

/** Minúsculas y sin acentos (para comparar). */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primera letra en mayúscula. */
export function capitalize(s: string): string {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export interface Token {
  /** Texto tal cual (con acentos y mayúsculas). */
  raw: string;
  /** Normalizado (minúsculas, sin acentos, sin "$"). */
  n: string;
  /** Posición en el texto original. */
  start: number;
  end: number;
}

const TOKEN_RE = /\$?\d+(?:[.,:]\d+)*|[a-záéíóúüñ]+/gi;

/** Parte un texto en palabras y números ("$1,500", "82.5", "7:30" quedan enteros). */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    out.push({ raw, n: norm(raw.replace(/^\$/, '')), start: m.index ?? 0, end: (m.index ?? 0) + raw.length });
  }
  return out;
}

/** Palabras vacías: no cuentan para comparar títulos. */
export const STOPWORDS = new Set(
  'de del la el los las lo un una unos unas en a al con sin mi mis tu tus su sus por para y e o u que me te se le les nos hoy ayer antier anoche ya muy mas bien rato poco mucho como sobre este esta estos estas ese esa eso es son fue era hay mal otra otro todo toda todos todas tambien luego despues ademas pues bueno entonces aqui alla ahi cuando donde porque pero si no casi algo algun alguna'.split(
    ' ',
  ),
);

/** Unidades y cantidades: si un título las trae, no se exigen al comparar. */
const SOFT_WORDS = new Set('min mins minuto minutos hora horas hr hrs h km kms kilometro kilometros pagina paginas pag pags vez veces litro litros l rep reps repeticiones series dia dias semana semanas'.split(' '));

/** Formas irregulares o cortas que conviene llevar a su infinitivo. */
const IRREGULAR: Record<string, string> = {
  fui: 'ir',
  fue: 'ir',
  fuimos: 'ir',
  fuiste: 'ir',
  voy: 'ir',
  vamos: 'ir',
  hice: 'hacer',
  hizo: 'hacer',
  hicimos: 'hacer',
  lei: 'leer',
  leo: 'leer',
  leyendo: 'leer',
  lee: 'leer',
  tuve: 'tener',
  tengo: 'tener',
  estuve: 'estar',
  estoy: 'estar',
  vi: 'ver',
  vimos: 'ver',
  di: 'dar',
  dimos: 'dar',
  puse: 'poner',
  pude: 'poder',
  vine: 'venir',
  dije: 'decir',
  traje: 'traer',
  supe: 'saber',
  // Sinónimos de actividad: "fui al gym" = "hice ejercicio" = "entrené".
  gym: 'entren',
  gimnasio: 'entren',
  gim: 'entren',
  ejercicio: 'entren',
  ingles: 'ingles',
  english: 'ingles',
};

/** Verbos "débiles": compartirlos no basta para decir que dos títulos son lo mismo. */
export const WEAK_STEMS = new Set(['ir', 'hacer', 'tener', 'estar', 'ser', 'dar', 'poner', 'poder', 'ver']);

const SUFFIXES = ['iendo', 'ando', 'arme', 'erme', 'irme', 'arse', 'erse', 'irse', 'aron', 'ieron', 'amos', 'imos', 'aste', 'iste', 'aba', 'ar', 'er', 'ir', 'es', 'as', 'os', 'e', 'o', 'a', 'i', 's'];

/** Raíz ligera de una palabra normalizada ("entrené" → "entren", "entrenar" → "entren"). */
export function stem(word: string): string {
  const w = norm(word);
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/^\d/.test(w)) return w;
  for (const s of SUFFIXES) {
    if (w.length - s.length >= 3 && w.endsWith(s)) {
      const r = w.slice(0, -s.length);
      // Cambios de ortografía del pretérito: pagué → pag(ar), marqué → marc(ar), organicé → organiz(ar).
      if (s === 'e' && r.endsWith('gu')) return r.slice(0, -1);
      if (s === 'e' && r.endsWith('qu')) return `${r.slice(0, -2)}c`;
      if (s === 'e' && r.endsWith('c')) return `${r.slice(0, -1)}z`;
      return r;
    }
  }
  return w;
}

/** Raíces con contenido de un texto (sin palabras vacías, números ni unidades). */
export function contentStems(text: string, opts: { keepNumbers?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const t of tokenize(text)) {
    if (STOPWORDS.has(t.n) || SOFT_WORDS.has(t.n)) continue;
    if (/^\d/.test(t.n) && !opts.keepNumbers) continue;
    if (t.n.length < 2) continue;
    const s = stem(t.n);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Parecido entre dos textos (coeficiente de Dice sobre raíces con contenido, 0–1). */
export function similarity(a: string, b: string): number {
  const A = contentStems(a);
  const B = contentStems(b);
  if (!A.length || !B.length) return 0;
  const common = A.filter((x) => B.includes(x)).length;
  return (2 * common) / (A.length + B.length);
}

// ---------------------------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Record<string, number> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};
/** Multiplicadores después de un número ("15 mil", "5 lucas", "2 millones", "3k"). */
const MULTIPLIERS: Record<string, number> = { mil: 1000, k: 1000, luca: 1000, lucas: 1000, millon: 1e6, millones: 1e6 };

const isNumberWord = (w: string) => w in UNITS || w in TENS || w in HUNDREDS || w === 'mil' || w === 'millon' || w === 'millones';

/** "1,500" → 1500 · "82.5" → 82.5 · "82,5" → 82.5 · "7:30" → 7.5 (horas). */
export function parseDigits(s: string): number | null {
  const t = s.replace(/^\$/, '');
  if (/^\d+:\d{2}$/.test(t)) {
    const [h, m] = t.split(':').map(Number);
    return h + m / 60;
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(t)) return Number(t.replace(/\./g, ''));
  if (/^\d+,\d{1,2}$/.test(t)) return Number(t.replace(',', '.'));
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

export interface NumberMatch {
  value: number;
  /** Índices de tokens [start, end). */
  start: number;
  end: number;
  /** Fue una sola palabra "un/una/uno" (poco confiable como monto). */
  bareOne: boolean;
  /** Llevaba signo de pesos. */
  dollar: boolean;
}

/** Lee un número que empieza en el token `i` (dígitos o palabras). */
export function readNumber(tokens: Token[], i: number): NumberMatch | null {
  const t0 = tokens[i];
  if (!t0) return null;
  // Dígitos (con multiplicador opcional: "15 mil", "1.5 millones", "5 lucas", "2 mil 500")
  const d = parseDigits(t0.raw);
  if (d !== null) {
    let value = d;
    let j = i + 1;
    const mult = tokens[j] ? MULTIPLIERS[tokens[j].n] : undefined;
    if (mult) {
      value = d * mult;
      j++;
      // "2 mil 500" / "2 mil quinientos"
      if (mult === 1000 && tokens[j]) {
        const rest = parseDigits(tokens[j].raw);
        if (rest !== null && rest < 1000 && Number.isInteger(rest)) {
          value += rest;
          j++;
        } else if (isNumberWord(tokens[j].n) && tokens[j].n !== 'mil') {
          const w = readWords(tokens, j);
          if (w && w.value < 1000) {
            value += w.value;
            j = w.end;
          }
        }
      }
    }
    // "82 punto 5"
    if (!mult && tokens[j]?.n === 'punto' && tokens[j + 1] && /^\d+$/.test(tokens[j + 1].n)) {
      value = Number(`${Math.trunc(d)}.${tokens[j + 1].n}`);
      j += 2;
    }
    return { value, start: i, end: j, bareOne: false, dollar: t0.raw.startsWith('$') };
  }
  const w = readWords(tokens, i);
  if (!w) return null;
  // "cinco lucas", "dos k"
  let value = w.value;
  let end = w.end;
  const mult = tokens[end] ? MULTIPLIERS[tokens[end].n] : undefined;
  if (mult && mult !== 1e6 && tokens[end].n !== 'mil') {
    value *= mult;
    end++;
  }
  return { value, start: i, end, bareOne: w.bareOne && end === w.end, dollar: false };
}

/** Número dicho con palabras: "mil quinientos", "ochenta y dos punto cinco", "doscientos cincuenta mil". */
function readWords(tokens: Token[], i: number): { value: number; end: number; bareOne: boolean } | null {
  let total = 0;
  let current = 0;
  let j = i;
  let used = 0;
  let lastTens = false;
  while (j < tokens.length) {
    const w = tokens[j].n;
    if (w in UNITS) {
      current += UNITS[w];
      lastTens = false;
    } else if (w in TENS) {
      current += TENS[w];
      lastTens = true;
    } else if (w in HUNDREDS) {
      current += HUNDREDS[w];
      lastTens = false;
    } else if (w === 'mil') {
      total += (current || 1) * 1000;
      current = 0;
      lastTens = false;
    } else if ((w === 'millon' || w === 'millones') && used > 0) {
      total = (total + (current || 1)) * 1e6;
      current = 0;
      lastTens = false;
    } else if (w === 'y' && lastTens && tokens[j + 1] && tokens[j + 1].n in UNITS && UNITS[tokens[j + 1].n] < 10) {
      j++;
      continue;
    } else break;
    used++;
    j++;
  }
  if (!used) return null;
  let value = total + current;
  const bareOne = used === 1 && (tokens[i].n === 'un' || tokens[i].n === 'una' || tokens[i].n === 'uno');
  // Decimales: "punto cinco", "punto veinticinco", "punto 5"
  if (tokens[j]?.n === 'punto' && tokens[j + 1]) {
    const nx = tokens[j + 1];
    let dec: { value: number; end: number } | null = null;
    if (/^\d+$/.test(nx.n)) dec = { value: Number(`0.${nx.n}`), end: j + 2 };
    else {
      const dw = readWords(tokens, j + 1);
      if (dw && dw.value < 100) dec = { value: dw.value / (dw.value >= 10 ? 100 : 10), end: dw.end };
    }
    if (dec) {
      value += dec.value;
      j = dec.end;
    }
  }
  return { value, end: j, bareOne };
}

/** Busca el primer número desde el token `from` (opcionalmente hasta `to`). */
export function findNumber(tokens: Token[], from = 0, to = tokens.length): NumberMatch | null {
  for (let i = from; i < to; i++) {
    const m = readNumber(tokens, i);
    if (m) return m;
  }
  return null;
}

/** Primer número de un texto, con dígitos o palabras ("mil quinientos" → 1500, "$1,500" → 1500, "seis y media" → 6.5). */
export function parseSpanishNumber(text: string): number | null {
  const toks = tokenize(text);
  const m = findNumber(toks);
  if (!m) return null;
  const fr = readFraction(toks, m.end);
  return m.value + (fr?.value ?? 0);
}

/** Fracción que sigue a un número: "y media" (0.5), "y cuarto" (0.25), "y tres cuartos" (0.75). */
export function readFraction(tokens: Token[], i: number, skip: string[] = []): { value: number; end: number } | null {
  let j = i;
  while (tokens[j] && skip.includes(tokens[j].n)) j++;
  if (tokens[j]?.n !== 'y') return null;
  const a = tokens[j + 1]?.n;
  if (a === 'media' || a === 'medio') return { value: 0.5, end: j + 2 };
  if (a === 'cuarto') return { value: 0.25, end: j + 2 };
  if (a === 'tres' && tokens[j + 2]?.n === 'cuartos') return { value: 0.75, end: j + 3 };
  return null;
}
