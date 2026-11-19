/**
 * Aprendizaje: utilidades de texto puras (sin DOM). Las usan el motor (errores que repites), la práctica en voz
 * alta (comparar lo que dijiste con lo esperado) y el registro rápido de frases.
 */

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bshan't\b/g, 'shall not'],
  [/\bain't\b/g, 'is not'],
  [/n't\b/g, ' not'],
  [/'ll\b/g, ' will'],
  [/'re\b/g, ' are'],
  [/'ve\b/g, ' have'],
  [/'m\b/g, ' am'],
  [/'d\b/g, ' would'],
  [/\blet's\b/g, 'let us'],
];

/**
 * Forma comparable de un texto: minúsculas, sin acentos ni puntuación, contracciones del inglés expandidas
 * ("I'll" = "I will") y espacios simples.
 */
export function normalizeLearningText(s: string): string {
  let t = (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`´]/g, "'");
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  return t
    .replace(/'/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Llave de un error para agruparlo con sus repeticiones: etiqueta + corrección normalizadas. */
export function learningErrorKey(tag: string, correction: string): string {
  return `${normalizeLearningText(tag)}|${normalizeLearningText(correction)}`;
}

function levenshtein<T>(a: readonly T[], b: readonly T[]): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function lcsTable(a: string[], b: string[]): number[][] {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  return t;
}

const words = (s: string) => normalizeLearningText(s).split(' ').filter(Boolean);

/**
 * Qué tanto se parece lo que dijiste a lo esperado (0 a 1). Pesa más las palabras (que dijiste la palabra
 * correcta) que las letras (errores menores del reconocimiento de voz).
 */
export function learningSimilarity(expected: string, said: string): number {
  const a = words(expected);
  const b = words(said);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const lcs = lcsTable(a, b)[0][0];
  const wordScore = (2 * lcs) / (a.length + b.length);
  const ca = a.join(' ');
  const cb = b.join(' ');
  const charScore = 1 - levenshtein([...ca], [...cb]) / Math.max(ca.length, cb.length);
  return Math.round((0.7 * wordScore + 0.3 * charScore) * 1000) / 1000;
}

export interface LearningDiffPart {
  word: string;
  /** ok = lo dijiste · missing = te faltó · extra = dijiste de más (o en lugar de otra). */
  op: 'ok' | 'missing' | 'extra';
}

/** Diferencia palabra por palabra entre lo esperado y lo que dijiste (en forma normalizada). */
export function learningWordDiff(expected: string, said: string): LearningDiffPart[] {
  const a = words(expected);
  const b = words(said);
  const t = lcsTable(a, b);
  const out: LearningDiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ word: a[i], op: 'ok' });
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) out.push({ word: a[i++], op: 'missing' });
    else out.push({ word: b[j++], op: 'extra' });
  }
  while (i < a.length) out.push({ word: a[i++], op: 'missing' });
  while (j < b.length) out.push({ word: b[j++], op: 'extra' });
  return out;
}

/**
 * Registro rápido en una línea: "frase = significado" (también acepta " | ", " — " o tabulador).
 * Sin separador, todo es la frase y el significado queda vacío.
 */
export function parseLearningLine(line: string): { text: string; meaning: string } {
  const s = (line ?? '').trim();
  const m = s.match(/^(.*?)\s*(?:=|\||\t|\s—\s|\s–\s|\s-\s)\s*(.*)$/);
  if (!m) return { text: s, meaning: '' };
  return { text: m[1].trim(), meaning: m[2].trim() };
}
