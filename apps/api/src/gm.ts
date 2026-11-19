import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AppEnv } from './env';

/**
 * Fase 4 (opcional): Game Master IA.
 * Lee un resumen de tu progreso (lo arma el cliente con el motor del juego) y propone misiones.
 * Usa tu propia clave de la API de Claude, guardada como secreto ANTHROPIC_API_KEY del Worker.
 */
export const gmRoute = new Hono<AppEnv>();

const DEFAULT_MODEL = 'claude-opus-5-5';

const SYSTEM = `Eres el Game Master de "IGV EXPERIENCE", el tablero con el que Iván juega su vida real como un RPG.
Tu trabajo: leer su progreso y proponerle misiones concretas, accionables y medibles para los próximos días.

Reglas del juego que nunca rompes:
- La XP nunca se resta. Descansar no quita XP. Un día de descanso marcado no rompe la racha.
- La XP se gana por acciones y resultados, no por horas.
- Una lección escrita tras un fracaso da 30 XP.
- El dinero real y la XP son sistemas separados.
- Tamaños de misión: chica 10 XP, media 30, grande 100, épica 300.
- Atributos: Fuerza física, Inteligencia, Carisma, Finanzas, Disciplina, Relaciones, Creatividad.
- Con energía de 50 o menos, propón solo misiones chicas y de recuperación.

Cómo respondes:
- En español de México, directo, cálido y sin sermones. Nada infantil.
- Cuando propongas misiones, usa una lista. Cada misión en una línea con este formato:
  • [Tamaño · Atributo] Nombre de la misión: por qué importa ahora (una frase)
- Prioriza la misión principal en foco de la temporada, los jefes cerca de caer y los atributos más bajos.
- Si algo va mal (racha rota, jefe estancado, NPC clave olvidado), dilo con claridad y propone el siguiente paso más pequeño.
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
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'El Game Master no está activado: falta el secreto ANTHROPIC_API_KEY.' }, 503);
  const parsed = askSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const { question, context, history } = parsed.data;

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `Este es mi estado actual en el juego:\n\n${context}` },
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
