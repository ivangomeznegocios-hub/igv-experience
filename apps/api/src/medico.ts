import { Hono, type Context } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  CHECKUP_CATEGORIES,
  DOCTOR_ACTION_TYPES,
  HEALTH_FILE_MAX_BYTES,
  HEALTH_FILE_MIMES,
  HEALTH_METRIC_KINDS,
  HEALTH_RECORD_TYPES,
  HEALTH_SUGGESTIONS,
  isDateString,
} from '@igv/core';
import type { AppEnv } from './env';

/**
 * Tu médico IA (rutas /api/medico/*, detrás de Access como /api/gm).
 * - Archivos de Salud: se guardan en D1 (tablas `health_files` + `health_file_chunks`, base64 en trozos) y NUNCA se
 *   sincronizan: la app guarda la referencia en `health/record` y baja el archivo al abrirlo.
 * - POST /read    → la IA lee un estudio (PDF o fotos) y regresa sus datos y valores (la app los confirma).
 * - POST /consult → revisión del médico con el expediente que arma la app (`buildHealthDossier`): qué te quiere decir,
 *                   acciones y datos que faltan. La app la guarda como `health/consult`.
 * - POST /ask     → preguntarle algo (con el expediente y, si quieres, los archivos de un estudio).
 * Sin estado en el servidor salvo los archivos. Usa la clave ANTHROPIC_API_KEY del Coach.
 */
export const medicoRoute = new Hono<AppEnv>();
type C = Context<AppEnv>;

const DEFAULT_MODEL = 'claude-opus-5-5';
const NO_KEY = 'Tu médico IA no está activado: falta el secreto ANTHROPIC_API_KEY en el Worker (el mismo del Coach).';
/** Caracteres de base64 por fila (D1 permite ~2 MB por fila). */
export const CHUNK_CHARS = 900_000;
const MAX_B64 = Math.ceil(HEALTH_FILE_MAX_BYTES / 3) * 4;
/** Lo que se manda a la IA de una vez (la API acepta hasta 32 MB por solicitud). */
const MAX_B64_PER_CALL = 24_000_000;
const MAX_FILES_PER_CALL = 8;

const modelOf = (c: C) => c.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const clip = (n: number) => z.string().transform((s) => s.slice(0, n));
const clipList = <T extends z.ZodTypeAny>(item: T, n: number) => z.array(item).transform((a) => a.slice(0, n));

// ---------------------------------------------------------------------------------------------
// Archivos
// ---------------------------------------------------------------------------------------------

/** Firma del inicio de cada tipo en base64 (para no guardar algo que no es lo que dice ser). */
const MAGIC: Record<string, string[]> = {
  'application/pdf': ['JVBERi'],
  'image/jpeg': ['/9j/'],
  'image/png': ['iVBORw0KGgo'],
  'image/webp': ['UklGR'],
  'image/gif': ['R0lGOD'],
};

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  chunks: number;
}

const b64Size = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

medicoRoute.get('/status', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM health_files').first<{ n: number; bytes: number }>();
  return c.json({ enabled: !!c.env.ANTHROPIC_API_KEY, model: modelOf(c), files: row?.n ?? 0, bytes: row?.bytes ?? 0, maxBytes: HEALTH_FILE_MAX_BYTES });
});

/** Subir un archivo: el cuerpo es el base64 (texto plano); nombre y tipo van en la URL. */
medicoRoute.post('/files', async (c) => {
  const name = (c.req.query('name') ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || 'archivo';
  const mime = c.req.query('mime') ?? '';
  if (!(HEALTH_FILE_MIMES as readonly string[]).includes(mime)) return c.json({ error: 'Tipo de archivo no permitido: sube un PDF o una imagen (JPG, PNG o WEBP).' }, 400);
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_B64 + 4096) return c.json({ error: `El archivo pesa más de ${Math.round(HEALTH_FILE_MAX_BYTES / 1024 / 1024)} MB.` }, 413);
  const b64 = (await c.req.text()).replace(/\s+$/, '');
  if (!b64) return c.json({ error: 'Archivo vacío' }, 400);
  if (b64.length > MAX_B64) return c.json({ error: `El archivo pesa más de ${Math.round(HEALTH_FILE_MAX_BYTES / 1024 / 1024)} MB.` }, 413);
  // Validación barata (sin recorrer los megas completos): largo, inicio, final y firma del tipo.
  const okChars = (s: string) => /^[A-Za-z0-9+/]*={0,2}$/.test(s);
  if (b64.length % 4 !== 0 || !okChars(b64.slice(0, 4096).replace(/=+$/, '')) || !okChars(b64.slice(-4096))) return c.json({ error: 'Archivo inválido (base64).' }, 400);
  if (!MAGIC[mime].some((m) => b64.startsWith(m))) return c.json({ error: 'El contenido no coincide con el tipo de archivo.' }, 400);
  const id = `hf-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const parts: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_CHARS) parts.push(b64.slice(i, i + CHUNK_CHARS));
  const size = b64Size(b64);
  const DB = c.env.DB;
  await DB.batch([
    DB.prepare('INSERT INTO health_files (id, name, mime, size, chunks, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, mime, size, parts.length, Date.now()),
    ...parts.map((d, i) => DB.prepare('INSERT INTO health_file_chunks (file_id, idx, data) VALUES (?, ?, ?)').bind(id, i, d)),
  ]);
  return c.json({ id, name, mime, size });
});

async function fileMeta(DB: D1Database, id: string): Promise<StoredFile | null> {
  return DB.prepare('SELECT id, name, mime, size, chunks FROM health_files WHERE id = ?').bind(id).first<StoredFile>();
}

/** El base64 completo de un archivo (un trozo por consulta, en un solo lote). */
async function fileData(DB: D1Database, f: StoredFile): Promise<string> {
  if (!f.chunks) return '';
  const res = await DB.batch(Array.from({ length: f.chunks }, (_, i) => DB.prepare('SELECT data FROM health_file_chunks WHERE file_id = ? AND idx = ?').bind(f.id, i)));
  return res.map((r) => ((r.results?.[0] as { data?: string } | undefined)?.data ?? '')).join('');
}

medicoRoute.get('/files/:id', async (c) => {
  const f = await fileMeta(c.env.DB, c.req.param('id'));
  if (!f) return c.json({ error: 'Archivo no encontrado' }, 404);
  const data = await fileData(c.env.DB, f);
  return c.json({ id: f.id, name: f.name, mime: f.mime, size: f.size, data });
});

medicoRoute.delete('/files/:id', async (c) => {
  const id = c.req.param('id');
  const DB = c.env.DB;
  await DB.batch([DB.prepare('DELETE FROM health_file_chunks WHERE file_id = ?').bind(id), DB.prepare('DELETE FROM health_files WHERE id = ?').bind(id)]);
  return c.json({ ok: true });
});

/** Bloques de contenido para la IA (PDF como documento, fotos como imagen). Valida tamaños. */
async function fileBlocks(c: C, ids: string[]): Promise<{ blocks: Anthropic.Beta.BetaContentBlockParam[]; names: string[] } | { error: string; status: 400 | 404 | 413 }> {
  const uniq = [...new Set(ids)].slice(0, MAX_FILES_PER_CALL);
  const metas: StoredFile[] = [];
  for (const id of uniq) {
    const m = await fileMeta(c.env.DB, id);
    if (!m) return { error: 'No encontré uno de los archivos (¿se borró?).', status: 404 };
    metas.push(m);
  }
  const totalB64 = metas.reduce((t, m) => t + Math.ceil(m.size / 3) * 4, 0);
  if (totalB64 > MAX_B64_PER_CALL) return { error: 'Los archivos juntos pesan demasiado para leerlos de una vez. Léelos por separado.', status: 413 };
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const m of metas) {
    const data = await fileData(c.env.DB, m);
    if (m.mime === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: m.name });
    else blocks.push({ type: 'image', source: { type: 'base64', media_type: m.mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data } });
  }
  return { blocks, names: metas.map((m) => m.name) };
}

// ---------------------------------------------------------------------------------------------
// Errores de la API de Claude
// ---------------------------------------------------------------------------------------------

function claudeError(c: C, err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return c.json({ error: 'La clave de la API de Claude no es válida.' }, 502);
  if (err instanceof Anthropic.RateLimitError) return c.json({ error: 'Límite de uso alcanzado. Intenta en un momento.' }, 429);
  if (err instanceof Anthropic.BadRequestError) return c.json({ error: 'La IA no pudo procesar el archivo (¿está dañado, protegido con contraseña o es muy grande?).' }, 502);
  if (err instanceof Anthropic.APIError) return c.json({ error: `Error de la API de Claude (${err.status ?? '?'})` }, 502);
  throw err;
}

const textOf = (r: Anthropic.Beta.BetaMessage) =>
  r.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

/** Llamada con salida estructurada; devuelve el JSON ya validado o un error para la app. */
async function structured<T>(c: C, req: { system: string; effort: 'low' | 'medium' | 'high'; schema: Record<string, unknown>; content: Anthropic.Beta.BetaContentBlockParam[] }, out: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: modelOf(c),
      max_tokens: 16000,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: req.content }],
    });
  } catch (err) {
    return { ok: false, res: claudeError(c, err) };
  }
  if (response.stop_reason === 'refusal') return { ok: false, res: c.json({ error: 'La IA no pudo procesar esto. Intenta de otra forma.' }, 422) };
  if (response.stop_reason === 'max_tokens') return { ok: false, res: c.json({ error: 'La respuesta salió demasiado larga. Intenta de nuevo.' }, 502) };
  let json: unknown;
  try {
    json = JSON.parse(textOf(response));
  } catch {
    return { ok: false, res: c.json({ error: 'La IA respondió en un formato inesperado. Intenta de nuevo.' }, 502) };
  }
  const parsed = out.safeParse(json);
  if (!parsed.success) return { ok: false, res: c.json({ error: 'La IA respondió en un formato inesperado. Intenta de nuevo.' }, 502) };
  return { ok: true, data: parsed.data };
}

// ---------------------------------------------------------------------------------------------
// Leer un estudio
// ---------------------------------------------------------------------------------------------

const KNOWN_KINDS = HEALTH_METRIC_KINDS.filter((k) => k !== 'otro');
const SUGGESTION_IDS = HEALTH_SUGGESTIONS.map((s) => s.id);

export const READ_SYSTEM = `Eres el médico de cabecera (asistente de IA) dentro de la app de salud de Iván, un hombre adulto en México. Te comparte un documento médico suyo (análisis de laboratorio, consulta, receta, estudio de imagen, comprobante…). Léelo con exactitud y extrae sus datos SIN inventar nada.

- title: nombre corto del estudio o consulta ("Química sanguínea de 6 elementos", "Consulta con dermatólogo").
- type: laboratorio, consulta, imagen (rayos X, ultrasonido, tomografía…), receta, vacuna, dental u otro.
- date: fecha de toma de muestra, del estudio o de la consulta (YYYY-MM-DD). null si no viene.
- place / doctor: laboratorio o clínica, y médico, tal como vienen. null si no vienen.
- cost: total pagado solo si el documento lo trae (número, sin símbolos). null si no.
- values: TODOS los resultados que traiga, cada uno con:
  · name: como viene ("Colesterol HDL").
  · value: número con punto decimal (sin < ni >); si el resultado no es número o viene como "<5", value = null y pon el resultado en text.
  · value2: solo para presión arterial (la diastólica).
  · unit y ref: tal como vienen; low y high: los límites numéricos del rango de referencia (null si no hay).
  · flag: "alto" o "bajo" si está fuera del rango de referencia, "anormal" si el documento lo marca así sin ser numérico; null si está en rango.
  · kind: su clave SOLO si es una de estas mediciones y viene en esta unidad: presion (mmHg), glucosa en ayunas (mg/dL), colesterol total (mg/dL), trigliceridos (mg/dL), hdl (mg/dL), ldl (mg/dL), hba1c (%), acido_urico (mg/dL), creatinina sérica (mg/dL), tsh (mUI/L o µUI/mL), vitamina_d 25-OH (ng/mL), hemoglobina (g/dL), saturacion (%), frecuencia_reposo (lpm). Si no, null.
- summary: 2 a 4 frases claras para él, de tú, en español de México: qué estudio es y qué es lo más importante del resultado. Sin alarmismo, pero si algo amerita ir al médico pronto, dilo.
- findings: hallazgos relevantes (valores fuera de rango, diagnósticos o notas que el documento menciona), uno por elemento.
- recommendations: lo que el documento indica ("repetir en 3 meses") o lo que conviene platicar con su médico. Nunca recetes medicamentos ni dosis.
- checkup: si este documento cuenta como uno de sus chequeos preventivos, su id (${SUGGESTION_IDS.join(', ')}); si no, null.
Si no es un documento médico o no se alcanza a leer, regresa values vacío y explícalo en summary.`;

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'type', 'date', 'place', 'doctor', 'cost', 'summary', 'findings', 'values', 'recommendations', 'checkup'],
  properties: {
    title: { type: 'string' },
    type: { type: 'string', enum: [...HEALTH_RECORD_TYPES] },
    date: nullable({ type: 'string' }),
    place: nullable({ type: 'string' }),
    doctor: nullable({ type: 'string' }),
    cost: nullable({ type: 'number' }),
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    values: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'value', 'value2', 'text', 'unit', 'ref', 'low', 'high', 'flag'],
        properties: {
          name: { type: 'string' },
          kind: nullable({ type: 'string', enum: [...KNOWN_KINDS] }),
          value: nullable({ type: 'number' }),
          value2: nullable({ type: 'number' }),
          text: nullable({ type: 'string' }),
          unit: nullable({ type: 'string' }),
          ref: nullable({ type: 'string' }),
          low: nullable({ type: 'number' }),
          high: nullable({ type: 'number' }),
          flag: nullable({ type: 'string', enum: ['alto', 'bajo', 'anormal'] }),
        },
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
    checkup: nullable({ type: 'string', enum: SUGGESTION_IDS }),
  },
} as const;

const finite = z.number().refine(Number.isFinite);
export const readOut = z.object({
  title: clip(200),
  type: z.enum(HEALTH_RECORD_TYPES).catch('otro'),
  date: z
    .string()
    .nullable()
    .transform((d) => (d && isDateString(d) ? d : null)),
  place: clip(200).nullable(),
  doctor: clip(200).nullable(),
  cost: finite.nullable().transform((n) => (n !== null && n > 0 && n < 10_000_000 ? n : null)),
  summary: clip(2000),
  findings: clipList(clip(300), 20),
  values: clipList(
    z.object({
      name: clip(80),
      kind: z.enum(KNOWN_KINDS as [string, ...string[]]).nullable().catch(null),
      value: finite.nullable(),
      value2: finite.nullable(),
      text: clip(200).nullable(),
      unit: clip(20).nullable(),
      ref: clip(80).nullable(),
      low: finite.nullable(),
      high: finite.nullable(),
      flag: z.enum(['alto', 'bajo', 'anormal']).nullable().catch(null),
    }),
    80,
  ),
  recommendations: clipList(clip(300), 10),
  checkup: z.string().nullable().transform((s) => (s && SUGGESTION_IDS.includes(s) ? s : null)),
});
export type ReadResult = z.infer<typeof readOut>;

const short = (n: number) => z.string().trim().max(n);
const readBody = z.object({
  fileIds: z.array(short(64).min(1)).min(1).max(MAX_FILES_PER_CALL),
  today: z.string().refine(isDateString),
  /** "Hombre, 34 años" (para leer rangos por edad). */
  profile: short(300).optional(),
  hint: z.object({ title: short(200).nullish(), type: short(20).nullish(), date: short(10).nullish(), notes: short(2000).nullish() }).optional(),
});

medicoRoute.post('/read', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: NO_KEY }, 503);
  const parsed = readBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const { fileIds, today, profile, hint } = parsed.data;
  const files = await fileBlocks(c, fileIds);
  if ('error' in files) return c.json({ error: files.error }, files.status);
  const lines = [
    `Hoy es ${today}.${profile ? ` Paciente: ${profile}.` : ''}`,
    files.names.length > 1 ? `Son ${files.names.length} archivos del MISMO estudio o consulta (${files.names.join(', ')}): júntalos en un solo resultado.` : `Archivo: ${files.names[0]}.`,
    hint?.title ? `Él lo llamó: "${hint.title}".` : '',
    hint?.date ? `Fecha que anotó: ${hint.date}.` : '',
    hint?.notes ? `Sus notas: ${hint.notes}` : '',
  ].filter(Boolean);
  const r = await structured(c, { system: READ_SYSTEM, effort: 'medium', schema: READ_SCHEMA as unknown as Record<string, unknown>, content: [...files.blocks, { type: 'text', text: lines.join('\n') }] }, readOut);
  if (!r.ok) return r.res;
  return c.json(r.data);
});

// ---------------------------------------------------------------------------------------------
// Revisión del médico
// ---------------------------------------------------------------------------------------------

const DOCTOR_BASE = `Eres el médico de cabecera de Iván dentro de su app de salud: un asistente de IA con criterio de médico internista y de medicina familiar, que lo conoce por su expediente. Le hablas de tú, en español de México: directo, cálido, claro y práctico, como un buen médico que tiene tiempo para él. Nada de lenguaje de fantasía ni de videojuego, nada de sermones.

Cómo trabajas:
- Lees su expediente completo (datos generales, ficha médica, antecedentes, chequeos, mediciones con su evolución, estudios, sueño, entrenamiento y hábitos) y relacionas los datos entre sí (p. ej. peso y cintura con triglicéridos y glucosa; sueño con presión; entrenamiento con pulso en reposo).
- Te basas en guías reconocidas (USPSTF, ADA, AHA/ACC, OMS, NOM y PrevenIMSS en México) y en SUS números: cuando cites uno, di cuál es y de qué fecha.
- Si faltan datos para orientarlo, pídelos en concreto (qué estudio, qué medición, qué dato) y explica en una frase por qué importan. No saques conclusiones de lo que no hay.

Límites que nunca rompes:
- No eres su médico tratante: no das diagnósticos en firme, no recetas medicamentos, suplementos con dosis ni cambios de tratamiento. Puedes decir "esto puede indicar X; confírmalo con tu médico".
- Si algo es de alarma (presión de 180/120 o más, glucosa de 250 o más, saturación menor a 92 %, dolor de pecho, falta de aire, síntomas neurológicos, sangrado importante…), dilo primero y claro: que busque atención médica hoy.
- Nunca inventes datos que no están en el expediente.`;

export const CONSULT_SYSTEM = `${DOCTOR_BASE}

Tu tarea ahora: escribirle su revisión periódica (la ve como "Tu médico te quiere decir algo" al abrir la app).
- Enfócate en lo NUEVO desde tu última revisión (viene marcado como NUEVO) y da seguimiento a lo que le pediste antes: si ya lo hizo, reconócelo; si no, insiste sin regañar.
- Si casi no hay datos, es la revisión de arranque: dile qué necesitas primero (análisis de sangre básicos, presión, peso y cintura, antecedentes familiares) y por qué.
- title: una línea (máx. ~80 caracteres) con lo principal ("Tu presión va mejor; falta tu perfil de lípidos").
- message: lo que le quieres decir, en 2 a 4 párrafos cortos separados por una línea en blanco (máx. ~180 palabras).
- status: "bien" (todo en orden), "atencion" (algo que vigilar o datos importantes que faltan) o "importante" (algo que debe atender pronto).
- highlights: 2 a 6 puntos cortos con tono "bien" (lo que va bien), "atencion" (lo que hay que vigilar) o "pendiente" (lo que quedó pendiente).
- actions: 1 a 5 acciones concretas y medibles, de la más importante a la menos. type: chequeo (un chequeo preventivo que debe activar o hacer; llena checkup con nombre, categoría y cada cuántos meses), medicion (medirse algo en casa o farmacia; llena metric), estudio (hacerse un análisis o estudio; puede llevar checkup si es periódico), consulta (ir con su médico o un especialista), habito (sueño, actividad, alimentación…), dato (registrar en la app un dato que falta). priority: alta, media o baja. why: por qué, en una frase.
- missing: datos que te faltan, en frases cortas (vacío si tienes lo necesario).
- nextReviewDays: en cuántos días quieres volver a revisarlo (7 a 90).`;

const CONSULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'message', 'status', 'highlights', 'actions', 'missing', 'nextReviewDays'],
  properties: {
    title: { type: 'string' },
    message: { type: 'string' },
    status: { type: 'string', enum: ['bien', 'atencion', 'importante'] },
    highlights: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['tone', 'text'], properties: { tone: { type: 'string', enum: ['bien', 'atencion', 'pendiente'] }, text: { type: 'string' } } },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'why', 'type', 'priority', 'checkup', 'metric'],
        properties: {
          text: { type: 'string' },
          why: { type: 'string' },
          type: { type: 'string', enum: [...DOCTOR_ACTION_TYPES] },
          priority: { type: 'string', enum: ['alta', 'media', 'baja'] },
          checkup: nullable({
            type: 'object',
            additionalProperties: false,
            required: ['name', 'category', 'everyMonths'],
            properties: { name: { type: 'string' }, category: { type: 'string', enum: [...CHECKUP_CATEGORIES] }, everyMonths: { type: 'integer' } },
          }),
          metric: nullable({ type: 'string', enum: [...KNOWN_KINDS] }),
        },
      },
    },
    missing: { type: 'array', items: { type: 'string' } },
    nextReviewDays: { type: 'integer' },
  },
} as const;

export const consultOut = z.object({
  title: z.string().min(1).transform((s) => s.slice(0, 160)),
  message: z.string().min(1).transform((s) => s.slice(0, 4000)),
  status: z.enum(['bien', 'atencion', 'importante']).catch('atencion'),
  highlights: clipList(z.object({ tone: z.enum(['bien', 'atencion', 'pendiente']).catch('atencion'), text: clip(300) }), 8),
  actions: clipList(
    z.object({
      text: z.string().min(1).transform((s) => s.slice(0, 300)),
      why: clip(400),
      type: z.enum(DOCTOR_ACTION_TYPES).catch('habito'),
      priority: z.enum(['alta', 'media', 'baja']).catch('media'),
      checkup: z
        .object({ name: clip(200), category: z.enum(CHECKUP_CATEGORIES).catch('otro'), everyMonths: z.number().int().transform((n) => Math.max(0, Math.min(240, n))) })
        .nullable()
        .catch(null),
      metric: z.enum(KNOWN_KINDS as [string, ...string[]]).nullable().catch(null),
    }),
    6,
  ),
  missing: clipList(clip(300), 10),
  nextReviewDays: z
    .number()
    .int()
    .catch(30)
    .transform((n) => Math.max(7, Math.min(90, n))),
});
export type ConsultResult = z.infer<typeof consultOut>;

const consultBody = z.object({
  dossier: z.string().min(20).max(60000),
  today: z.string().refine(isDateString),
  kind: z.enum(['auto', 'pedida', 'inicial']).default('pedida'),
  /** Algo en particular que quiere que revise. */
  focus: short(1000).optional(),
});

medicoRoute.post('/consult', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: NO_KEY }, 503);
  const parsed = consultBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const { dossier, today, kind, focus } = parsed.data;
  const intro =
    kind === 'inicial'
      ? 'Es tu PRIMERA revisión: preséntate en una frase y arranca con lo que ves y lo que necesitas.'
      : kind === 'auto'
        ? 'Es su revisión periódica automática.'
        : 'Él pidió esta revisión.';
  const text = `Hoy es ${today}. ${intro}${focus ? `\nQuiere que revises en particular: ${focus}` : ''}\n\n${dossier}`;
  const r = await structured(c, { system: CONSULT_SYSTEM, effort: 'high', schema: CONSULT_SCHEMA as unknown as Record<string, unknown>, content: [{ type: 'text', text }] }, consultOut);
  if (!r.ok) return r.res;
  return c.json(r.data);
});

// ---------------------------------------------------------------------------------------------
// Preguntarle
// ---------------------------------------------------------------------------------------------

export const ASK_SYSTEM = `${DOCTOR_BASE}

Ahora él te hace una pregunta. Respóndela con base en su expediente (y en el estudio que te adjunte, si lo hace).
- Ve directo a la respuesta, en máx. ~220 palabras, en párrafos cortos o viñetas con "•". Sin títulos ni tablas.
- Si la pregunta no es de salud, respóndela breve y regresa a lo suyo.
- Termina, si aplica, con el siguiente paso concreto.`;

const askBody = z.object({
  dossier: z.string().min(20).max(60000),
  today: z.string().refine(isDateString),
  question: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(20)
    .default([]),
  fileIds: z.array(short(64).min(1)).max(MAX_FILES_PER_CALL).default([]),
});

medicoRoute.post('/ask', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: NO_KEY }, 503);
  const parsed = askBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Solicitud inválida' }, 400);
  const { dossier, today, question, history, fileIds } = parsed.data;
  let attached: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (fileIds.length) {
    const files = await fileBlocks(c, fileIds);
    if ('error' in files) return c.json({ error: files.error }, files.status);
    attached = files.blocks;
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `Hoy es ${today}. Este es mi expediente:\n\n${dossier}` },
    { role: 'assistant', content: 'Listo, tengo tu expediente a la vista. ¿Qué quieres saber?' },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: attached.length ? [...attached, { type: 'text' as const, text: question }] : question },
  ];
  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.create({
      model: modelOf(c),
      max_tokens: 16000,
      system: [{ type: 'text', text: ASK_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    });
    if (response.stop_reason === 'refusal') return c.json({ answer: 'No pude responder a eso. Intenta preguntarlo de otra forma.' });
    return c.json({ answer: textOf(response) || 'Sin respuesta.' });
  } catch (err) {
    return claudeError(c, err);
  }
});
