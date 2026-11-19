import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AppEnv } from './env';

/**
 * Fase 4 (opcional): Coach IA (rutas /api/gm/*; el nombre de la ruta se conserva).
 * Lee un resumen de tu progreso (lo arma el cliente con el motor del juego) y propone misiones.
 * Usa tu propia clave de la API de Claude, guardada como secreto ANTHROPIC_API_KEY del Worker.
 */
export const gmRoute = new Hono<AppEnv>();

const DEFAULT_MODEL = 'claude-opus-5-5';

const SYSTEM = `Eres el Coach de "IGV EXPERIENCE", la app con la que Iván mide y mejora su vida real: misiones, XP, niveles, racha, oro y premios.
Eres un coach de rendimiento personal: directo, cálido y práctico, como un buen entrenador que lo conoce y le habla de tú.
Tu trabajo: leer su progreso y proponerle misiones concretas, accionables y medibles para los próximos días.

Reglas del sistema que nunca rompes:
- La XP nunca se resta. Descansar no quita XP. Un día de descanso marcado no rompe la racha.
- La XP se gana por acciones y resultados, no por horas.
- Una lección escrita tras un fracaso da 30 XP.
- El dinero real y la XP son sistemas separados.
- Tamaños de misión: chica 10 XP, media 30, grande 100, épica 300.
- Atributos: Fuerza física, Inteligencia, Carisma, Finanzas, Disciplina, Relaciones, Creatividad.
- Con energía de 50 o menos, propón solo misiones chicas y de recuperación.

Cómo respondes:
- En español de México, casual y directo, cálido y sin sermones. Nada infantil.
- Habla de la vida real, no de fantasía: nada de jefes, batallas, NPCs, reinos, héroes ni lenguaje medieval o de RPG.
  En la app los "jefes" se llaman "grandes retos" y los NPCs son "personas" / "mi gente".
- Cuando propongas misiones, usa una lista. Cada misión en una línea con este formato:
  • [Tamaño · Atributo] Nombre de la misión: por qué importa ahora (una frase)
- Prioriza la misión principal en foco de la temporada, los grandes retos cerca de completarse y los atributos más bajos.
- Si algo va mal (racha rota, reto estancado, persona clave olvidada), dilo con claridad y propone el siguiente paso más pequeño.
- Sé breve: máximo ~250 palabras salvo que te pidan más.`;

const askSchema = z.object({
  question: z.string().min(1).max(4000),
  context: z.string().max(30000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(20)
    .default([]),
});

gmRoute.get('/status', (c) => c.json({ enabled: !!c.env.ANTHROPIC_API_KEY, model: c.env.ANTHROPIC_MODEL || DEFAULT_MODEL }));

gmRoute.post('/ask', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'El Coach no está activado: falta el secreto ANTHROPIC_API_KEY.' }, 503);
  const parsed = askSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const { question, context, history } = parsed.data;

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `Este es mi estado actual en la app:\n\n${context}` },
    { role: 'assistant', content: 'Entendido. Tengo tu estado a la vista. ¿Qué necesitas?' },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ];

  try {
    const response = await client.beta.messages.create({
      model: c.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'medium' },
      // Si un filtro de seguridad rechaza la solicitud, la API reintenta con un modelo de respaldo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    });
    if (response.stop_reason === 'refusal') {
      return c.json({ answer: 'No pude responder a eso. Intenta reformular la pregunta.' });
    }
    const answer = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return c.json({ answer: answer || 'Sin respuesta.' });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return c.json({ error: 'La clave de la API de Claude no es válida.' }, 502);
    if (err instanceof Anthropic.RateLimitError) return c.json({ error: 'Límite de uso alcanzado. Intenta en un momento.' }, 429);
    if (err instanceof Anthropic.APIError) return c.json({ error: `Error de la API de Claude (${err.status ?? '?'})` }, 502);
    throw err;
  }
});

// ---------- Registrar escribiendo como hablas ----------

const PARSE_SYSTEM = `Eres el Coach de "IGV EXPERIENCE". Conviertes lo que Iván cuenta de su día en registros para su app de progreso personal.
Solo PROPONES registros; él los confirma con un toque. Nunca inventes cosas que no dijo.

Tipos de registro (campo "kind"):
- "mission": algo que hizo. Si coincide con una misión del catálogo, pon su id en "matchId" y usa su tamaño y atributo. Si no, inventa un título corto en infinitivo o pasado ("Fui al gym") y elige tamaño y atributo razonables.
  Tamaños: chica (10 XP, tareas de minutos), media (30, una hora o algo con esfuerzo), grande (100, un logro importante), epica (300, algo excepcional). Sé conservador: casi todo es chica o media.
  Atributos: fuerza, inteligencia, carisma, finanzas, disciplina, relaciones, creatividad.
- "income": dinero que ganó (amount en número, concept).
- "expense": dinero que gastó (amount, concept, category opcional).
- "npc": habló o convivió con una persona del catálogo de personas ("Mi gente"; matchId = id de la persona). Si la persona no está en el catálogo, conviértelo en "mission" de Relaciones.
- "lesson": algo que salió mal y de lo que aprendió (text con la lección, en primera persona).
- "body": peso (weightKg) o entrenamiento (workout) que mencionó.
- "goal": avance en una meta del catálogo (matchId = id de la meta, amount = cuánto avanzó en su unidad).
- "rest": dijo que hoy es su día de descanso.

"daysAgo": 0 si fue hoy, 1 si fue ayer, etc. (máximo 6).
"reply": una frase breve, cálida y directa en español de México (tono de coach, sin lenguaje de fantasía) resumiendo lo que propones (o pidiendo aclaración si no entendiste).
Los campos que no apliquen van en null.`;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'proposals'],
  properties: {
    reply: { type: 'string' },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'matchId', 'size', 'attribute', 'amount', 'concept', 'category', 'text', 'weightKg', 'workout', 'daysAgo'],
        properties: {
          kind: { type: 'string', enum: ['mission', 'income', 'expense', 'npc', 'lesson', 'body', 'goal', 'rest'] },
          title: nullable({ type: 'string' }),
          matchId: nullable({ type: 'string' }),
          size: nullable({ type: 'string', enum: ['chica', 'media', 'grande', 'epica'] }),
          attribute: nullable({ type: 'string', enum: ['fuerza', 'inteligencia', 'carisma', 'finanzas', 'disciplina', 'relaciones', 'creatividad'] }),
          amount: nullable({ type: 'number' }),
          concept: nullable({ type: 'string' }),
          category: nullable({ type: 'string' }),
          text: nullable({ type: 'string' }),
          weightKg: nullable({ type: 'number' }),
          workout: nullable({ type: 'string' }),
          daysAgo: { type: 'integer' },
        },
      },
    },
  },
} as const;

const proposalSchema = z.object({
  kind: z.enum(['mission', 'income', 'expense', 'npc', 'lesson', 'body', 'goal', 'rest']),
  title: z.string().max(300).nullable(),
  matchId: z.string().max(100).nullable(),
  size: z.enum(['chica', 'media', 'grande', 'epica']).nullable(),
  attribute: z.enum(['fuerza', 'inteligencia', 'carisma', 'finanzas', 'disciplina', 'relaciones', 'creatividad']).nullable(),
  amount: z.number().nullable(),
  concept: z.string().max(300).nullable(),
  category: z.string().max(100).nullable(),
  text: z.string().max(4000).nullable(),
  weightKg: z.number().nullable(),
  workout: z.string().max(300).nullable(),
  daysAgo: z.number().int().min(0).max(6).catch(0),
});
export const parseResultSchema = z.object({ reply: z.string().max(2000), proposals: z.array(proposalSchema).max(20) });
export type ParseResult = z.infer<typeof parseResultSchema>;

const parseBody = z.object({
  text: z.string().min(1).max(4000),
  today: z.string().max(20),
  catalog: z.string().max(20000),
});

gmRoute.post('/parse', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'El Coach no está activado: falta el secreto ANTHROPIC_API_KEY.' }, 503);
  const parsed = parseBody.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const { text, today, catalog } = parsed.data;
  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.create({
      model: c.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: PARSE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PARSE_SCHEMA as unknown as Record<string, unknown> } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: `Hoy es ${today}.\n\nCatálogo:\n${catalog}\n\nLo que cuento:\n${text}` }],
    });
    if (response.stop_reason === 'refusal') return c.json({ reply: 'No pude procesar eso. Intenta decirlo de otra forma.', proposals: [] });
    const raw = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return c.json({ error: 'El Coach respondió en un formato inesperado. Intenta de nuevo.' }, 502);
    }
    const result = parseResultSchema.safeParse(json);
    if (!result.success) return c.json({ error: 'El Coach respondió en un formato inesperado. Intenta de nuevo.' }, 502);
    return c.json(result.data);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return c.json({ error: 'La clave de la API de Claude no es válida.' }, 502);
    if (err instanceof Anthropic.RateLimitError) return c.json({ error: 'Límite de uso alcanzado. Intenta en un momento.' }, 429);
    if (err instanceof Anthropic.APIError) return c.json({ error: `Error de la API de Claude (${err.status ?? '?'})` }, 502);
    throw err;
  }
});
