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

/**
 * Modo entrenador (pantalla Entrenamiento → "Tu coach"): un entrenador personal y de nutrición basado en evidencia,
 * con el plan del entrenador de la app a la vista y búsqueda web para revisar la evidencia cuando hace falta.
 * Va como segundo bloque de sistema para no romper la caché del primero.
 */
export const ENTRENADOR_SYSTEM = `MODO ENTRENADOR PERSONAL. Ahora eres el entrenador personal y de nutrición de Iván dentro de la app. Lo acompañas para que, poco a poco, gane condición, fuerza y un cuerpo sano, sin lesionarse.

Cómo trabajas:
- Antes de recomendar qué entrenar o comer, revisa ver_plan_entrenador (fase, sesión de hoy con pesos objetivo, molestias, sueño, metas) y, si hablan de comida, ver_nutricion. El plan de la app ya aplica la evidencia: respétalo y explícalo; si propones cambiarlo, hazlo con ajustar_entrenador.
- Si te cuenta lo que entrenó ("hoy hice 3 series de 10 sentadillas con 20 kg…"), regístralo con registrar_entrenamiento (ejercicios y series tal cual; no inventes pesos). Si te dice lo que comió, usa registrar_comida (estima proteína y calorías de forma conservadora). Pasos, agua, cómo se siente hoy y el check-in semanal también tienen herramienta.
- Si nunca ha armado su plan, hazle 4 preguntas cortas (objetivo, días que puede, minutos por sesión, si algo le duele o tiene alguna lesión) y guárdalo con ajustar_entrenador.
- "¿Cómo estuvo tu semana?": pregunta qué tan pesado se sintió el plan (1–5), energía, ánimo y molestias; regístralo con registrar_checkin_semanal y dile qué cambia la próxima semana.
- Si no tiene peso, estatura o fecha de nacimiento, pídelos (peso con registrar_cuerpo; estatura y fecha se ponen en Ajustes).

Principios (basados en evidencia):
- Progresión gradual: Iván viene de ser sedentario. Nada de "sin dolor no hay ganancia". Cerca del fallo pero no al fallo (2–4 repeticiones en reserva al inicio), técnica primero, sobrecarga progresiva (doble progresión), 10+ series por músculo a la semana a mediano plazo, cada músculo 2 veces por semana, 48–72 h de recuperación.
- Cardio 150–300 min a la semana (OMS), pasos 7,000–10,000 al día, sueño 7–9 h, proteína 1.6–2.2 g/kg, verdura y fruta diario, agua, limitar ultraprocesados y bebidas azucaradas. Comida mexicana real, sin dietas extremas ni suplementos milagro (creatina monohidratada 3–5 g y proteína en polvo son opciones con buena evidencia si las pide).
- Seguridad: no eres médico. Con dolor de pecho, falta de aire anormal, mareo, desmayo, dolor articular punzante o que dura más de 1–2 semanas, dile que pare y vea a un médico o fisioterapeuta. No diagnostiques.

Investigar:
- Tienes búsqueda web. Úsala cuando te pregunte por evidencia, técnica, un ejercicio, un suplemento o algo que no sepas con certeza, o para revisar si una recomendación sigue vigente. Prefiere fuentes serias (revisiones y metaanálisis en PubMed, ACSM, NSCA, OMS, Examine) y menciona la fuente en una línea. No busques para cosas que ya sabes bien.

Cómo hablas:
- Como un buen entrenador que lo conoce: cercano, directo, motivador sin exagerar, en español de México, de tú. Cero lenguaje de fantasía.
- Corto y accionable: lo que hay que hacer hoy, con números (series × repeticiones, peso, descanso, minutos, gramos). Máximo ~200 palabras salvo que pida más detalle.
- Cuando le des la sesión, usa una lista: "• Ejercicio: 3×8–12 @ 20 kg · descanso 90 s" y al final una frase de ánimo.`;

const askSchema = z.object({
  question: z.string().min(1).max(4000),
  /** Datos extra que manda una pantalla (p. ej. el reporte de una semana). El estado general se lee en el servidor. */
  context: z.string().max(30000).optional(),
  /** Solo consultar (p. ej. para escribir un resumen): no se le dan herramientas que escriben. */
  readOnly: z.boolean().optional(),
  /** `dictado`: registrar lo dictado sin conversar (ver DICTADO_SYSTEM). `entrenador`: tu entrenador personal (ENTRENADOR_SYSTEM). */
  mode: z.enum(['chat', 'dictado', 'entrenador']).optional(),
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
/**
 * Búsquedas web por mensaje del entrenador. La API cuenta `max_uses` por turno, y todo un mensaje es un solo turno:
 * cada continuación es un `pause_turn` reanudado o un mensaje con solo `tool_result`. Pero las búsquedas que corren
 * desde code execution (el filtrado dinámico, valor por defecto de `web_search_20260209`) no cuentan entre requests:
 * con él, cada ronda traería 3 búsquedas nuevas (hasta 27 por mensaje). Por eso la herramienta va con
 * `allowed_callers: ['direct']`: así el tope de 3 sí vale para todo el mensaje (la API responde `max_uses_exceeded`).
 * A cambio no hay filtrado dinámico (entran resultados completos al contexto; con 3 búsquedas y la caché del
 * historial el costo queda acotado). No se quita ni se cambia la herramienta a media conversación: rompería la
 * reanudación de una búsqueda pendiente, el razonamiento preservado y la caché.
 */
const WEB_SEARCH_MAX_USES = 3;
const WRITE_TOOLS = new Set(ASSISTANT_TOOLS.filter((t) => t.writes).map((t) => t.name));

export interface CoachSource {
  title: string;
  url: string;
}

/**
 * Texto para Iván a partir de los bloques de un turno del modelo (los tramos pausados más el último).
 * Con búsqueda web las citas siempre están activas y la API parte el texto justo donde empieza y termina cada
 * cita; esos bloques ya traen sus espacios, así que los bloques de texto seguidos se pegan tal cual. Solo un bloque
 * que no es texto (búsqueda, resultados, razonamiento) separa párrafos. También junta las fuentes citadas, sin repetir.
 */
export function replyFromBlocks(content: readonly Anthropic.Beta.BetaContentBlock[]): { text: string; sources: CoachSource[] } {
  const paragraphs: string[] = [];
  const sources = new Map<string, string>();
  let current = '';
  for (const block of content) {
    if (block.type !== 'text') {
      paragraphs.push(current);
      current = '';
      continue;
    }
    current += block.text;
    for (const c of block.citations ?? []) {
      if (c.type === 'web_search_result_location' && c.url && !sources.has(c.url)) sources.set(c.url, c.title || c.url);
    }
  }
  paragraphs.push(current);
  return {
    text: paragraphs.map((p) => p.trim()).filter(Boolean).join('\n\n'),
    sources: [...sources].map(([url, title]) => ({ title, url })),
  };
}

gmRoute.post('/ask', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'El Coach no está activado: falta el secreto ANTHROPIC_API_KEY.' }, 503);
  const parsed = askSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const { question, history, context, readOnly, mode } = parsed.data;
  const dictado = mode === 'dictado';
  const entrenador = mode === 'entrenador';
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
  const tools: Anthropic.Beta.BetaToolUnion[] = ASSISTANT_TOOLS.filter((t) => allowWrites || !t.writes).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toolInputSchema(t) as Anthropic.Beta.BetaTool['input_schema'],
  }));
  // El entrenador puede investigar en la web (herramienta del servidor de Anthropic: no gasta consultas a D1).
  // Búsqueda directa para que el tope valga por mensaje (ver WEB_SEARCH_MAX_USES).
  if (entrenador) {
    tools.push({
      type: 'web_search_20260209',
      name: 'web_search',
      max_uses: WEB_SEARCH_MAX_USES,
      allowed_callers: ['direct'],
      user_location: { type: 'approximate', country: 'MX', timezone: 'America/Mexico_City' },
    });
  }

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
    let sources: CoachSource[] = [];
    /** Bloques del turno en curso: un `pause_turn` deja el turno a medias y la continuación solo trae lo nuevo. */
    let turn: Anthropic.Beta.BetaContentBlock[] = [];
    /**
     * Contenedor de code execution, si una respuesta trajo uno: cada continuación del turno (pausa o ronda de
     * herramientas) debe seguir en el mismo, o empieza en uno nuevo y pierde lo anterior. Con la búsqueda directa
     * normalmente no hay, pero se reenvía igual por si una herramienta del servidor lo usa.
     */
    let container: string | undefined;
    /**
     * Se acabaron las rondas con el turno todavía en pausa o con herramientas pendientes: la respuesta quedó incompleta
     * (lo que haya escrito es preámbulo, no la respuesta) y se avisa.
     */
    let cutOff = false;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model: c.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 16000,
        system: [
          { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
          ...(dictado ? [{ type: 'text' as const, text: DICTADO_SYSTEM }] : []),
          ...(entrenador ? [{ type: 'text' as const, text: ENTRENADOR_SYSTEM }] : []),
        ],
        tools,
        output_config: { effort: 'medium' },
        // Caché automática: el punto de caché avanza al último bloque, así cada ronda lee de caché el panorama, los
        // resultados de herramientas y de búsquedas de las anteriores (el bloque de sistema conserva su propio punto).
        cache_control: { type: 'ephemeral' },
        // Si un filtro de seguridad rechaza la solicitud, la API reintenta con un modelo de respaldo.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages,
        ...(container ? { container } : {}),
      });
      container = response.container?.id ?? container;
      if (response.stop_reason === 'refusal') {
        answer = 'No pude responder a eso. Intenta reformular la pregunta.';
        sources = [];
        break;
      }
      turn = [...turn, ...response.content];
      ({ text: answer, sources } = replyFromBlocks(turn));
      // La búsqueda web (herramienta del servidor) pudo pausar el turno: se reenvía tal cual y el servidor sigue solo.
      if (response.stop_reason === 'pause_turn') {
        if (round < MAX_TOOL_ROUNDS) {
          messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
          continue;
        }
        cutOff = true;
        break;
      }
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !uses.length) break;
      if (round === MAX_TOOL_ROUNDS) {
        cutOff = true;
        break;
      }
      // Lo que escribió antes de usar sus herramientas es preámbulo ("reviso tu plan…"): la respuesta es lo que sigue.
      turn = [];

      // Se devuelve el contenido completo (incluye bloques de razonamiento) y luego todos los resultados juntos.
      messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) results.push(await runTool(use));
      messages.push({ role: 'user', content: results });
    }
    const final = cutOff ? [answer, 'Me quedé a medias. Pregúntame otra vez y lo termino.'].filter(Boolean).join('\n\n') : answer || (actions.length ? 'Listo.' : 'Sin respuesta.');
    return c.json({ answer: final, actions, ...(sources.length ? { sources } : {}) });
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
