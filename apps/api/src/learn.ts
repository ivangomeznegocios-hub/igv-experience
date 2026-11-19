import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CEFR_LEVELS, LEARNING_TAGS, LEARNING_TOPIC_KINDS, normalizeLearningText } from '@igv/core';
import type { AppEnv } from './env';

/**
 * Aprendizaje: tests con IA (rutas /api/learn/*, detrás de Access como /api/gm).
 * - POST /quiz  → la IA arma un test corto a su nivel (mezcla de ejercicios, contexto de negocios) que repasa sus
 *                 errores frecuentes y lo que está aprendiendo.
 * - POST /grade → la IA califica sus respuestas: correcta o no, corrección, explicación corta en español, etiqueta del
 *                 error y frases sugeridas para agregar. La calificación final se cuenta aquí (no se confía en el modelo).
 * El resultado lo guarda la app como evento `learning.test_taken` (XP una vez por día y tema). Sin estado en el servidor.
 * Salida estructurada (`output_config.format`) y esfuerzo bajo para gastar pocos tokens.
 */
export const learnRoute = new Hono<AppEnv>();

const DEFAULT_MODEL = 'claude-opus-5-5';
const NO_KEY = 'Los tests con IA no están activados: falta el secreto ANTHROPIC_API_KEY en el Worker. Puedes seguir practicando con tarjetas y en voz alta.';

export const QUESTION_TYPES = ['traducir', 'completar', 'opcion', 'corregir', 'responder'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const TAG_ENUM = { type: 'string', enum: [...LEARNING_TAGS] };

// ---------------------------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------------------------

const topicSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(LEARNING_TOPIC_KINDS).default('idioma'),
  level: z.string().trim().max(20).nullish(),
  goal: z.string().trim().max(300).nullish(),
});

const short = (n: number) => z.string().trim().max(n);

const quizBody = z.object({
  topic: topicSchema,
  count: z.number().int().min(3).max(10).default(6),
  /** Enfoque elegido (negociación, juntas, presentaciones, small talk, "mis errores"…). */
  focus: short(200).nullish(),
  known: z.array(short(200)).max(40).default([]),
  learning: z.array(short(200)).max(40).default([]),
  errors: z
    .array(z.object({ tag: short(40), answer: short(200), correction: short(200), count: z.number().int().min(1).max(9999) }))
    .max(15)
    .default([]),
});

const questionIn = z.object({
  id: short(20).min(1),
  type: z.enum(QUESTION_TYPES),
  instruction: short(300),
  prompt: short(600),
  options: z.array(short(200)).max(6).nullish(),
  expected: short(600).nullish(),
  answer: z.string().max(600),
});

const gradeBody = z.object({
  topic: topicSchema,
  questions: z.array(questionIn).min(1).max(12),
  /** Sus errores frecuentes: si vuelve a cometer uno, se reutiliza la misma etiqueta y corrección. */
  knownErrors: z.array(z.object({ tag: short(40), correction: short(200) })).max(20).default([]),
  /** Textos que ya tiene en su lista (para no sugerirlos otra vez). */
  existing: z.array(short(200)).max(150).default([]),
});

// ---------------------------------------------------------------------------------------------
// Salidas (JSON Schema para la API + zod para validar)
// ---------------------------------------------------------------------------------------------

const QUIZ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'questions'],
  properties: {
    title: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'instruction', 'prompt', 'options', 'expected', 'tag'],
        properties: {
          type: { type: 'string', enum: [...QUESTION_TYPES] },
          instruction: { type: 'string' },
          prompt: { type: 'string' },
          options: nullable({ type: 'array', items: { type: 'string' } }),
          expected: { type: 'string' },
          tag: TAG_ENUM,
        },
      },
    },
  },
} as const;

const quizOut = z.object({
  title: z.string().max(200),
  questions: z
    .array(
      z.object({
        type: z.enum(QUESTION_TYPES),
        instruction: z.string().min(1).max(300),
        prompt: z.string().min(1).max(600),
        options: z.array(z.string().max(200)).max(6).nullable(),
        expected: z.string().max(600),
        tag: z.string().max(40),
      }),
    )
    .min(1),
});

const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results', 'estimatedLevel', 'feedback', 'suggestions'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'correct', 'corrected', 'wrong', 'fix', 'tag', 'explanation'],
        properties: {
          id: { type: 'string' },
          correct: { type: 'boolean' },
          corrected: nullable({ type: 'string' }),
          wrong: nullable({ type: 'string' }),
          fix: nullable({ type: 'string' }),
          tag: nullable(TAG_ENUM),
          explanation: nullable({ type: 'string' }),
        },
      },
    },
    estimatedLevel: nullable({ type: 'string', enum: [...CEFR_LEVELS] }),
    feedback: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'meaning', 'example', 'tags'],
        properties: {
          text: { type: 'string' },
          meaning: { type: 'string' },
          example: nullable({ type: 'string' }),
          tags: { type: 'array', items: TAG_ENUM },
        },
      },
    },
  },
} as const;

const gradeOut = z.object({
  results: z.array(
    z.object({
      id: z.string().max(20),
      correct: z.boolean(),
      corrected: z.string().max(600).nullable(),
      wrong: z.string().max(300).nullable(),
      fix: z.string().max(300).nullable(),
      tag: z.string().max(40).nullable(),
      explanation: z.string().max(600).nullable(),
    }),
  ),
  estimatedLevel: z.enum(CEFR_LEVELS).nullable().catch(null),
  feedback: z.string().max(1200),
  suggestions: z.array(z.object({ text: z.string().min(1).max(300), meaning: z.string().max(300), example: z.string().max(500).nullable(), tags: z.array(z.string().max(40)).max(6) })),
});

export type QuizResponse = { title: string; questions: { id: string; type: QuestionType; instruction: string; prompt: string; options: string[] | null; expected: string; tag: string }[] };
export interface GradeResponse {
  score: number;
  total: number;
  estimatedLevel: string | null;
  feedback: string;
  results: { id: string; correct: boolean; corrected: string | null; wrong: string | null; fix: string | null; tag: string | null; explanation: string | null }[];
  /** Listos para el evento `learning.test_taken`. */
  errors: { tag: string; prompt: string; answer: string; correction: string; explanation?: string }[];
  suggestions: { text: string; meaning: string; example: string | null; tags: string[] }[];
}

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------

const QUIZ_SYSTEM = `Eres el examinador de "IGV EXPERIENCE", la app con la que Iván (emprendedor mexicano) mide su progreso real.
Armas tests cortos para medir cómo va en un tema (sobre todo inglés para negociar, presentar y conversar de negocios) y si sigue cometiendo los mismos errores.

Cómo armas el test:
- Exactamente el número de preguntas que se pide, adaptadas a su nivel (A1–C2 en idiomas): ni triviales ni imposibles.
- Mezcla tipos: "traducir" (del español al idioma que aprende), "completar" (frase con un espacio ___), "opcion" (3 o 4 opciones, una correcta), "corregir" (una frase con un error que debe corregir) y "responder" (una pregunta corta que contesta con una frase, en una situación de trabajo).
- Contexto real de negocios: negociaciones, juntas, presentaciones, correos, llamadas con clientes y small talk profesional. Si hay un enfoque elegido, úsalo en la mayoría.
- Si tiene errores frecuentes, al menos un tercio de las preguntas los vuelve a poner a prueba (sin dar la respuesta). Usa también frases que está aprendiendo, en contextos nuevos.
- "instruction": la indicación en español, corta ("Traduce al inglés", "Completa el espacio", "Elige la opción correcta", "Corrige la frase", "Responde en inglés").
- "prompt": el ejercicio en sí. En "traducir", la frase en español. En los demás, el texto en el idioma que aprende.
- "options": solo en "opcion" (la correcta incluida, en orden aleatorio); en los demás, null.
- "expected": una respuesta correcta de referencia (en "opcion", el texto exacto de la opción correcta).
- "tag": qué mide la pregunta (gramática, vocabulario, preposiciones, tiempos verbales, phrasal verbs, negociación…).
- "title": un título corto y sobrio en español para el test.
- Para temas que no son idiomas, todo va en español y las preguntas miden comprensión de conceptos (usa "responder", "opcion", "completar" o "corregir").
Tono sobrio, nada infantil ni de fantasía.`;

const GRADE_SYSTEM = `Eres el evaluador de "IGV EXPERIENCE". Calificas las respuestas de Iván a un test de un tema que está aprendiendo (normalmente inglés de negocios).

Para cada pregunta (usa el mismo "id"):
- "correct": true si la respuesta comunica bien la idea y es correcta en ese contexto. Acepta variantes naturales aunque no sean idénticas a la respuesta de referencia; no castigues mayúsculas ni puntuación. La respuesta pudo dictarse por voz: ignora errores típicos del reconocimiento de voz si la frase es correcta al decirla.
- "corrected": la respuesta correcta completa (la de él corregida, lo más parecida posible a lo que escribió). null si estuvo bien.
- "wrong": el fragmento mínimo que estuvo mal ("depend of"). null si estuvo bien.
- "fix": el fragmento mínimo corregido ("depend on"), escrito como se escribe normalmente y sin punto final. null si estuvo bien.
- "tag": el tipo de error. null si estuvo bien.
- "explanation": una explicación en español de máximo 25 palabras, directa. null si estuvo bien.
- Si el error coincide con uno de sus errores frecuentes, usa EXACTAMENTE la misma etiqueta y la misma corrección ("fix") que aparecen en la lista, para poder contarlo como repetido.
"estimatedLevel": el nivel A1–C2 que muestran sus respuestas (null si el tema no es un idioma o no se puede saber).
"feedback": 1 o 2 frases en español de México, como un buen coach: qué mejoró o qué sigue fallando y qué practicar. Sin sermones ni lenguaje de fantasía.
"suggestions": hasta 5 frases útiles para su lista, sacadas de sus errores (la versión correcta, natural y reutilizable en negocios). "text" en el idioma que aprende, "meaning" en español, "example" opcional. No sugieras frases que ya tiene.`;

function topicLine(t: z.infer<typeof topicSchema>): string {
  return `Tema: ${t.name} (${t.kind}${t.level ? `, nivel ${t.level}` : ''})${t.goal ? `. Meta: ${t.goal}` : ''}.`;
}

function toText(response: Anthropic.Beta.BetaMessage): string {
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

async function callClaude(key: string, model: string, system: string, schema: Record<string, unknown>, content: string): Promise<{ refused: true } | { refused: false; json: unknown }> {
  const client = new Anthropic({ apiKey: key });
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    // Si un filtro de seguridad rechaza la solicitud, la API reintenta con un modelo de respaldo.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') return { refused: true };
  try {
    return { refused: false, json: JSON.parse(toText(response)) };
  } catch {
    return { refused: false, json: null };
  }
}

function apiError(err: unknown): { body: { error: string }; status: 502 | 429 } | null {
  if (err instanceof Anthropic.AuthenticationError) return { body: { error: 'La clave de la API de Claude no es válida.' }, status: 502 };
  if (err instanceof Anthropic.RateLimitError) return { body: { error: 'Límite de uso alcanzado. Intenta en un momento.' }, status: 429 };
  if (err instanceof Anthropic.APIError) return { body: { error: `Error de la API de Claude (${err.status ?? '?'})` }, status: 502 };
  return null;
}

const BAD_FORMAT = 'La IA respondió en un formato inesperado. Intenta de nuevo.';

// ---------------------------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------------------------

learnRoute.get('/status', (c) => c.json({ enabled: !!c.env.ANTHROPIC_API_KEY }));

learnRoute.post('/quiz', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: NO_KEY }, 503);
  const parsed = quizBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const b = parsed.data;
  const L = [topicLine(b.topic), `Número de preguntas: ${b.count}.`];
  if (b.focus) L.push(`Enfoque elegido: ${b.focus}.`);
  if (b.errors.length) L.push('', 'Sus errores frecuentes (lo que escribió → lo correcto):', ...b.errors.map((e) => `- [${e.tag}] "${e.answer}" → "${e.correction}" (${e.count} veces)`));
  if (b.learning.length) L.push('', 'Frases que está aprendiendo:', ...b.learning.map((x) => `- ${x}`));
  if (b.known.length) L.push('', 'Frases que ya domina (úsalas poco, solo en contextos nuevos):', ...b.known.map((x) => `- ${x}`));
  try {
    const r = await callClaude(c.env.ANTHROPIC_API_KEY, c.env.ANTHROPIC_MODEL || DEFAULT_MODEL, QUIZ_SYSTEM, QUIZ_SCHEMA as unknown as Record<string, unknown>, L.join('\n'));
    if (r.refused) return c.json({ error: 'No pude armar ese test. Intenta con otro enfoque.' }, 422);
    const out = quizOut.safeParse(r.json);
    if (!out.success) return c.json({ error: BAD_FORMAT }, 502);
    const questions = out.data.questions.slice(0, b.count).map((q, i) => ({
      id: `q${i + 1}`,
      ...q,
      options: q.type === 'opcion' && q.options?.length ? q.options : null,
      tag: q.tag || 'otro',
    }));
    const res: QuizResponse = { title: out.data.title || `Test de ${b.topic.name}`, questions };
    return c.json(res);
  } catch (err) {
    const e = apiError(err);
    if (e) return c.json(e.body, e.status);
    throw err;
  }
});

learnRoute.post('/grade', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: NO_KEY }, 503);
  const parsed = gradeBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const b = parsed.data;
  const L = [topicLine(b.topic), '', 'Preguntas y sus respuestas:'];
  for (const q of b.questions) {
    L.push(
      `[${q.id}] (${q.type}) ${q.instruction}: ${q.prompt}${q.options?.length ? ` | Opciones: ${q.options.join(' / ')}` : ''}${q.expected ? ` | Referencia: ${q.expected}` : ''}`,
      `Su respuesta: ${q.answer.trim() ? q.answer.trim() : '(en blanco)'}`,
    );
  }
  if (b.knownErrors.length) L.push('', 'Sus errores frecuentes (etiqueta → corrección):', ...b.knownErrors.map((e) => `- ${e.tag} → ${e.correction}`));
  if (b.existing.length) L.push('', `Frases que ya tiene (no las sugieras): ${b.existing.join(' · ')}`);
  try {
    const r = await callClaude(c.env.ANTHROPIC_API_KEY, c.env.ANTHROPIC_MODEL || DEFAULT_MODEL, GRADE_SYSTEM, GRADE_SCHEMA as unknown as Record<string, unknown>, L.join('\n'));
    if (r.refused) return c.json({ error: 'No pude calificar ese test. Intenta de nuevo.' }, 422);
    const out = gradeOut.safeParse(r.json);
    if (!out.success) return c.json({ error: BAD_FORMAT }, 502);
    const byId = new Map(out.data.results.map((x) => [x.id, x]));
    const results: GradeResponse['results'] = [];
    const errors: GradeResponse['errors'] = [];
    for (const q of b.questions) {
      const g = byId.get(q.id);
      // Sin calificación de la IA: en blanco cuenta como error; si no, no se puede saber (se cuenta como error sin detalle).
      const correct = !!g?.correct && !!q.answer.trim();
      const tag = (g?.tag || 'otro').toLowerCase();
      const fix = g?.fix?.trim() || g?.corrected?.trim() || q.expected?.trim() || '';
      results.push({
        id: q.id,
        correct,
        corrected: correct ? null : (g?.corrected ?? q.expected ?? null),
        wrong: correct ? null : (g?.wrong ?? null),
        fix: correct ? null : fix || null,
        tag: correct ? null : tag,
        explanation: correct ? null : (g?.explanation ?? null),
      });
      if (!correct && fix) {
        errors.push({
          tag,
          prompt: `${q.instruction}: ${q.prompt}`.slice(0, 500),
          // Lo mínimo que estuvo mal ("depends of") se lee mejor en "errores que repites"; si no, su respuesta completa.
          answer: (g?.wrong?.trim() || q.answer.trim() || '(en blanco)').slice(0, 500),
          correction: fix.slice(0, 500),
          ...(g?.explanation ? { explanation: g.explanation.slice(0, 500) } : {}),
        });
      }
    }
    const have = new Set(b.existing.map(normalizeLearningText));
    const seen = new Set<string>();
    const suggestions = out.data.suggestions
      .filter((s) => {
        const k = normalizeLearningText(s.text);
        if (!k || have.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 5);
    const res: GradeResponse = {
      score: results.filter((x) => x.correct).length,
      total: b.questions.length,
      estimatedLevel: b.topic.kind === 'idioma' ? out.data.estimatedLevel : null,
      feedback: out.data.feedback,
      results,
      errors,
      suggestions,
    };
    return c.json(res);
  } catch (err) {
    const e = apiError(err);
    if (e) return c.json(e.body, e.status);
    throw err;
  }
});
