import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { APP_GUIDE, ASSISTANT_TOOLS, renderOverview, runAssistantTool, toolInputSchema } from '@igv/core';
import type { AppEnv } from './env';
import { getAiSettings } from './ai/credentials';
import { D1AssistantStore, recordActivity } from './ai/store';
import { countingD1, type QueryCounter } from './ai/budget';

/**
 * Fase 4 (opcional): Coach IA (rutas /api/gm/*; el nombre de la ruta se conserva).
 * Conversa contigo con tu estado a la vista y puede ACTUAR por ti con las mismas herramientas del servidor
 * MCP (registrar misiones, dinero, metas, agenda…). Cada acción queda en la bitácora con "Deshacer".
 * Usa tu propia clave de la API de Claude, guardada como secreto ANTHROPIC_API_KEY del Worker.
 */
export const gmRoute = new Hono<AppEnv>();

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 8;

const SYSTEM = `Eres el Coach de "IGV EXPERIENCE", la app con la que Iván mide y mejora su vida real: misiones, XP, niveles, racha, oro y premios.
Eres un coach de rendimiento personal: directo, cálido y práctico, como un buen entrenador que lo conoce y le habla de tú.
Tu trabajo: leer su progreso, proponerle misiones concretas, accionables y medibles, y HACER cosas por él en la app cuando te lo pida.

Reglas del sistema que nunca rompes:
- La XP nunca se resta. Descansar no quita XP. Un día de descanso marcado no rompe la racha.
- La XP se gana por acciones y resultados, no por horas.
- Una lección escrita tras un fracaso da 30 XP.
- El dinero real y la XP son sistemas separados.
- Tamaños de misión: chica 10 XP, media 30, grande 100, épica 300.
- Atributos: Fuerza física, Inteligencia, Carisma, Finanzas, Disciplina, Relaciones, Creatividad.
- Con energía de 50 o menos, propón solo misiones chicas y de recuperación.

Herramientas:
- Tienes herramientas para consultar (ver_*) y para registrar u organizar en su app. Úsalas cuando él te pida hacer algo
  ("registra que fui al gym", "agéndame llamar al contador el viernes", "crea una meta…") o cuando necesites datos que no tienes.
- Registra solo lo que él dijo; no inventes montos, fechas ni personas. Si falta un dato importante, pregunta antes.
- Antes de borrar algo o canjear un premio, confirma con él. Si te equivocas, usa anular_registro.
- Después de actuar, confirma en una línea qué quedó (y cuánta XP dio). No repitas el texto de las herramientas.
- Si solo te pide ideas o un plan, propón sin registrar nada.

Cómo respondes:
- En español de México, casual y directo, cálido y sin sermones. Nada infantil.
- Habla de la vida real, no de fantasía: nada de jefes, batallas, NPCs, reinos, héroes ni lenguaje medieval o de RPG.
  En la app los "jefes" se llaman "grandes retos" y los NPCs son "personas" / "mi gente".
- Cuando propongas misiones (sin registrarlas), usa una lista. Cada misión en una línea con este formato:
  • [Tamaño · Atributo] Nombre de la misión: por qué importa ahora (una frase)
- Prioriza la misión principal en foco de la temporada, los grandes retos cerca de completarse y los atributos más bajos.
- Si algo va mal (racha rota, reto estancado, persona clave olvidada), dilo con claridad y propone el siguiente paso más pequeño.
- Sé breve: máximo ~250 palabras salvo que te pidan más.

Cómo funciona la app:
${APP_GUIDE}`;

/**
 * Modo dictado (botón "Hablar" de la app): Iván dicta lo que hizo y el Coach lo registra solo, sin conversar.
 * Va como segundo bloque de sistema para no romper la caché del primero.
 */
export const DICTADO_SYSTEM = `MODO DICTADO. Iván te dictó por voz (sin revisar) lo que hizo. Tu trabajo es REGISTRARLO en la app, no conversar.
- Registra todo lo que puedas con tus herramientas SIN pedir confirmación. Pregunta solo si falta algo esencial que no puedes deducir (p. ej. el monto de un gasto); en ese caso registra lo demás y di qué faltó.
- El texto viene de reconocimiento de voz: corrige por contexto palabras mal transcritas ("jim" = gym, "la lus" = la luz) y nombres parecidos a los de sus personas.
- Usa la herramienta más específica que exista (entrenamientos, visitas a lugares, contacto con personas, tiempo dedicado, salud, sueño, peso, dinero…) antes que una misión rápida genérica. Si algo coincide con una misión de su catálogo (rutina, agenda), complétala con su id.
- Fechas: "ayer", "antier", "el lunes"… son relativas a hoy. Lo que piensa hacer después ("mañana tengo que…") va a la agenda.
- No registres lo que NO hizo ("no fui al gym"). Una lección tras algo que salió mal va con registrar_leccion.
- No dupliques: si algo ya está registrado ese día, no lo vuelvas a registrar.
- Responde muy corto, sin saludo ni consejos, con este formato:
Registré:
• (una línea por registro)
No entendí:
• (lo que no pudiste registrar; omite esta sección si todo quedó)`;

const askSchema = z.object({
  question: z.string().min(1).max(4000),
  /** Datos extra que manda una pantalla (p. ej. el reporte de una semana). El estado general se lee en el servidor. */
  context: z.string().max(30000).optional(),
  /** Solo consultar (p. ej. para escribir un resumen): no se le dan herramientas que escriben. */
  readOnly: z.boolean().optional(),
  /** `dictado`: registrar lo dictado sin conversar (ver DICTADO_SYSTEM). */
  mode: z.enum(['chat', 'dictado']).optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(20)
    .default([]),
});

gmRoute.get('/status', (c) => c.json({ enabled: !!c.env.ANTHROPIC_API_KEY, model: c.env.ANTHROPIC_MODEL || DEFAULT_MODEL }));

export interface CoachAction {
  tool: string;
  summary: string;
  activityId: string;
}

/** El plan gratis permite 50 consultas a D1 por invocación: se deja margen para registrar la bitácora. */
const D1_QUERY_LIMIT = 50;
const QUERY_BUDGET = 40;
const MAX_TOOL_CALLS = 12;
/**
 * Peor caso de una herramienta que escribe: lo fijo (catálogo, foto recalculada, lecturas y la bitácora) más una
 * consulta por elemento de cada lista que recibe (personas, frases, ejercicios…). Si no cabe en lo que queda, no
 * se empieza: pasar el límite a media escritura dejaría registros guardados sin bitácora ni "Deshacer".
 */
const WRITE_RESERVE = 12;
function writeQueryCost(input: unknown): number {
  let n = WRITE_RESERVE;
  if (input && typeof input === 'object') for (const v of Object.values(input)) if (Array.isArray(v)) n += v.length;
  return n;
}
const WRITE_TOOLS = new Set(ASSISTANT_TOOLS.filter((t) => t.writes).map((t) => t.name));

gmRoute.post('/ask', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'El Coach no está activado: falta el secreto ANTHROPIC_API_KEY.' }, 503);
  const parsed = askSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const { question, history, context, readOnly, mode } = parsed.data;
  const dictado = mode === 'dictado';
  if (dictado && readOnly) return c.json({ error: 'El modo dictado necesita poder registrar.' }, 400);

  const queries: QueryCounter = { count: 0 };
  const DB = countingD1(c.env.DB, queries);
  const allowWrites = !readOnly && (await getAiSettings(drizzle(DB))).allowWrites;
  if (dictado && !allowWrites) {
    // Sin permiso de escribir no hay nada que hacer: la app guarda la nota como pendiente y propone registros locales.
    return c.json({ error: 'El Coach está en solo lectura (Más → Conectar IA → Permisos). Tu nota quedó guardada para procesarla después.', code: 'read_only', actions: [] }, 409);
  }
  const store = new D1AssistantStore(DB);
  // Si la pantalla manda sus propios datos para una consulta de solo lectura (p. ej. el reporte de una semana),
  // se usan solos: el panorama de hoy mezclaría dos periodos.
  const intro =
    readOnly && context
      ? `Estos son los datos de la pantalla donde estoy:\n\n${context}\n\n(Solo consulta: no registres ni cambies nada.)`
      : `Este es mi estado actual en la app:\n\n${renderOverview(await store.snapshot(), store.now().toISOString())}${context ? `\n\nDatos de la pantalla donde estoy:\n${context}` : ''}${allowWrites ? '' : '\n\n(En esta conversación solo puedes consultar; no registres ni cambies nada.)'}`;
  const tools: Anthropic.Beta.BetaTool[] = ASSISTANT_TOOLS.filter((t) => allowWrites || !t.writes).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toolInputSchema(t) as Anthropic.Beta.BetaTool['input_schema'],
  }));

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: intro },
    { role: 'assistant', content: 'Entendido. Tengo tu estado a la vista. ¿Qué necesitas?' },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: dictado ? `Hoy es ${store.today}. Esto dicté:\n"""\n${question}\n"""` : question },
  ];
  const actions: CoachAction[] = [];
  let toolCalls = 0;

  /** Ejecuta una herramienta sin dejar que un error inesperado tumbe la conversación. */
  const runTool = async (use: Anthropic.Beta.BetaToolUseBlock): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
    const need = WRITE_TOOLS.has(use.name) ? writeQueryCost(use.input) : 0;
    if (++toolCalls > MAX_TOOL_CALLS || queries.count >= QUERY_BUDGET || queries.count + need > D1_QUERY_LIMIT) {
      return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Llegaste al límite de acciones por mensaje. Dile a Iván qué quedó hecho y que te pida el resto en otro mensaje.' };
    }
    let r: Awaited<ReturnType<typeof runAssistantTool>>;
    try {
      r = await runAssistantTool(use.name, use.input, store, { allowWrites });
    } catch (err) {
      console.error('coach tool', use.name, err);
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: true,
        content: 'Error interno a mitad de la herramienta: pudo haberse guardado en parte. Revisa con ver_dia o ver_historial antes de reintentar y dile a Iván qué pasó.',
      };
    }
    if (!r.isError && r.summary && r.refs) {
      try {
        const activityId = await recordActivity(DB, { source: 'Coach', tool: use.name, summary: r.summary, refs: r.refs });
        actions.push({ tool: use.name, summary: r.summary, activityId });
      } catch (err) {
        // Lo hecho se queda; solo no quedó en la bitácora (sin "Deshacer" desde ahí; se corrige en la app).
        console.error('coach activity', use.name, err);
        return { type: 'tool_result', tool_use_id: use.id, content: `${r.text} (Nota: no quedó en la bitácora de la app.)` };
      }
    }
    return { type: 'tool_result', tool_use_id: use.id, content: r.text, is_error: !!r.isError };
  };

  try {
    let answer = '';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model: c.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, ...(dictado ? [{ type: 'text' as const, text: DICTADO_SYSTEM }] : [])],
        tools,
        output_config: { effort: 'medium' },
        // Si un filtro de seguridad rechaza la solicitud, la API reintenta con un modelo de respaldo.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages,
      });
      if (response.stop_reason === 'refusal') {
        answer = 'No pude responder a eso. Intenta reformular la pregunta.';
        break;
      }
      answer = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !uses.length || round === MAX_TOOL_ROUNDS) break;

      // Se devuelve el contenido completo (incluye bloques de razonamiento) y luego todos los resultados juntos.
      messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) results.push(await runTool(use));
      messages.push({ role: 'user', content: results });
    }
    return c.json({ answer: answer || (actions.length ? 'Listo.' : 'Sin respuesta.'), actions });
  } catch (err) {
    // Lo que ya se registró se informa siempre (con su "Deshacer"), aunque la conversación falle.
    const done = actions.length ? ` (Alcancé a hacer: ${actions.map((a) => a.summary).join('; ')}.)` : '';
    if (err instanceof Anthropic.AuthenticationError) return c.json({ error: 'La clave de la API de Claude no es válida.' + done, actions }, 502);
    if (err instanceof Anthropic.RateLimitError) return c.json({ error: 'Límite de uso alcanzado. Intenta en un momento.' + done, actions }, 429);
    if (err instanceof Anthropic.APIError) return c.json({ error: `Error de la API de Claude (${err.status ?? '?'})` + done, actions }, 502);
    console.error('coach', err);
    return c.json({ error: 'Error interno del Coach.' + done, actions }, 500);
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
