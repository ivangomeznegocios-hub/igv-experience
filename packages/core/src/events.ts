import { z } from 'zod';
import { ATTRIBUTE_IDS, COMPLETION_KINDS, DAILY_SLOTS, MISSION_SIZES, PLACE_STATUSES } from './types';
import { isDateString } from './util/dates';
import { BODY_MEASURE_KEYS } from './engine/physique';

const attr = z.enum(ATTRIBUTE_IDS);
const size = z.enum(MISSION_SIZES);
const date = z.string().refine(isDateString, 'Fecha inválida (YYYY-MM-DD)');
const id = z.string().min(1).max(100);
/** Contorno medido con cinta, en cm. */
const girth = z.number().positive().max(300);

/**
 * Catálogo de tipos de evento. Cada módulo registra aquí los suyos.
 * Para agregar un sistema nuevo: agrega su(s) tipo(s) de evento y su reductor en engine/.
 */
export const EVENT_SCHEMAS = {
  // --- Personaje ---
  'profile.attributes_rated': z.object({
    values: z.record(attr, z.number().int().min(0).max(100)),
  }),
  'checkin.morning': z.object({ sleepHours: z.number().min(0).max(24) }),
  'rest_day.marked': z.object({}).passthrough(),

  // --- Misiones ---
  'daily.selected': z.object({ slot: z.enum(DAILY_SLOTS), missionId: id }),
  'weekly.selected': z.object({ missionId: id }),
  'mission.completed': z.object({
    missionId: id,
    title: z.string().min(1).max(300),
    size,
    attribute: attr,
    kind: z.enum(COMPLETION_KINDS),
    mainQuestId: id.nullish(),
    npcId: id.nullish(),
  }),
  'lesson.written': z.object({
    text: z.string().min(3).max(4000),
    missionId: id.nullish(),
    attribute: attr,
  }),

  // --- Dinero (sistema separado: no da XP) ---
  'income.recorded': z.object({
    amount: z.number().positive(),
    concept: z.string().max(300).default(''),
    category: z.string().max(100).optional(),
  }),
  'expense.recorded': z.object({
    amount: z.number().positive(),
    concept: z.string().max(300).default(''),
    category: z.string().max(100).optional(),
  }),

  // --- Progresión ---
  'boss.phase_completed': z.object({ bossId: id, phaseIndex: z.number().int().min(0), note: z.string().max(2000).optional() }),
  'boss.recurring_defeated': z.object({ bossId: id, note: z.string().min(1).max(4000) }),
  'achievement.unlocked': z.object({ achievementId: id, note: z.string().max(2000).optional() }),
  'skill.rank_unlocked': z.object({
    skillId: id,
    rank: z.number().int().min(1).max(3),
    evidence: z.string().trim().min(3).max(4000),
  }),
  'journal.weekly': z.object({
    weekStart: date,
    happened: z.string().max(2000),
    learned: z.string().max(2000),
    next: z.string().max(2000),
  }),
  'season.review': z.object({
    seasonId: id,
    phase: z.enum(['start', 'end']),
    text: z.string().max(8000),
  }),

  // --- Mundo ---
  /** Contacto con una persona (uno por persona). Sin canal = sin especificar: cuenta como contacto, no como convivencia en persona. */
  'npc.interaction': z.object({
    npcId: id,
    note: z.string().max(2000).optional(),
    /** Igual que CONTACT_CHANNELS en types.ts. */
    channel: z.enum(['persona', 'llamada', 'videollamada', 'mensaje']).optional(),
    /** Dónde convivieron (lugar del mapa). Con lugar, cuenta como en persona. */
    placeId: id.optional(),
  }),
  'map.status_changed': z.object({ placeId: id, status: z.enum(PLACE_STATUSES), note: z.string().max(2000).optional() }),

  // --- Inmersión ---
  /** Cierre del día: una línea de reflexión. No da XP. */
  'day.closed': z.object({ note: z.string().max(2000).default(''), mood: z.number().int().min(1).max(5).optional() }),
  /** Misión sorpresa del día (se sortea en el dispositivo y se guarda para que el historial no cambie). */
  'bounty.drawn': z.object({ missionId: id, title: z.string().min(1).max(300), size, attribute: attr }),
  /** Canje de un premio real en la tienda (se paga con oro, nunca con XP). */
  'reward.redeemed': z.object({ rewardId: id, name: z.string().min(1).max(300), cost: z.number().int().positive() }),

  // --- Metas, hábitos, biblioteca, cuerpo y ahorro ---
  'goal.progress': z.object({ goalId: id, amount: z.number().positive().max(1e9), note: z.string().max(2000).optional() }),
  'vice.relapse': z.object({ viceId: id, note: z.string().max(2000).optional() }),
  'library.finished': z.object({ bookId: id, title: z.string().min(1).max(300), size, attribute: attr, note: z.string().max(4000).optional() }),
  /** Cuerpo: peso, % de grasa y contornos (dan forma al personaje 3D), entrenamiento o nota. No da XP. */
  'body.logged': z
    .object({
      weightKg: z.number().positive().max(500).optional(),
      bodyFatPct: z.number().min(2).max(70).optional(),
      neckCm: girth.optional(),
      shouldersCm: girth.optional(),
      chestCm: girth.optional(),
      waistCm: girth.optional(),
      hipsCm: girth.optional(),
      armCm: girth.optional(),
      forearmCm: girth.optional(),
      thighCm: girth.optional(),
      calfCm: girth.optional(),
      workout: z.string().max(300).optional(),
      note: z.string().max(2000).optional(),
    })
    .refine((p) => BODY_MEASURE_KEYS.some((k) => p[k] !== undefined) || !!p.workout?.trim() || !!p.note?.trim(), 'Registra una medida, entrenamiento o nota'),
  // --- Planear, retos y compromisos ---
  /** Las (máx. 3) cosas que planeas para un día. La última versión para ese día gana. No da XP. */
  'plan.set': z.object({
    forDate: date,
    items: z
      .array(z.object({ missionId: id, title: z.string().min(1).max(300), size, attribute: attr, kind: z.enum(COMPLETION_KINDS) }))
      .max(3),
  }),
  /** Empieza (o reinicia tras fallar) un reto de N días seguidos. */
  'challenge.started': z.object({ challengeId: id }),
  /** Marca un día del reto como cumplido. */
  'challenge.checked': z.object({ challengeId: id }),
  /** Compromiso: apuestas oro a que cumples algo antes de una fecha. */
  'pledge.made': z.object({ pledgeId: id, title: z.string().min(1).max(300), stake: z.number().int().positive().max(100000), deadline: date }),
  /** Resultado de un compromiso (cuenta el primero). */
  'pledge.resolved': z.object({ pledgeId: id, kept: z.boolean() }),
  /** Movimiento a una meta de ahorro (positivo = aportar, negativo = retirar). Dinero real: no da XP. */
  'savings.moved': z.object({ goalId: id, amount: z.number().refine((n) => n !== 0 && Math.abs(n) < 1e12, 'Monto inválido') }),

  // ---- Sistemas nuevos: cada uno agrega sus eventos DEBAJO de su ancla (no borres ni muevas las anclas) ----
  // [[voz]]

  // [[entreno]]

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]
  /**
   * Tiempo dedicado a algo ("8 h 20 min de trabajo"). Puro registro: NO da XP (regla de oro 3: XP por
   * acciones y resultados, no por horas). `area` = una de TIME_AREAS (types.ts; la oficina es `trabajo`).
   * `skillId` liga el tiempo a una habilidad; `start` es la hora local de inicio (HH:MM) para la línea del día.
   */
  'time.logged': z.object({
    minutes: z.number().int().min(1).max(1440),
    area: z.enum(['trabajo', 'estudio', 'lectura', 'proyecto', 'ejercicio', 'familia', 'pareja', 'amigos', 'casa', 'traslado', 'ocio', 'otro']),
    skillId: id.nullish(),
    note: z.string().max(1000).optional(),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)').optional(),
  }),
  /** Avance de un libro o curso (página o %). La última versión gana. No da XP. */
  'library.progress': z
    .object({
      bookId: id,
      page: z.number().int().min(0).max(100000).optional(),
      percent: z.number().min(0).max(100).optional(),
    })
    .refine((p) => p.page !== undefined || p.percent !== undefined, 'Indica la página o el porcentaje'),
  /** "Lo que aprendí": una idea de un libro o curso. `title` = título del libro en ese momento. No da XP. */
  'library.note': z.object({
    bookId: id,
    title: z.string().max(300).optional(),
    text: z.string().trim().min(2).max(4000),
    page: z.number().int().min(0).max(100000).optional(),
  }),

  // [[aprendizaje]]
  /** Repaso de una tarjeta (Leitner): bien, dudé o mal. No da XP por sí solo. */
  'learning.reviewed': z.object({ itemId: id, result: z.enum(['bien', 'dude', 'mal']) }),
  /** Test o sesión de práctica de un tema (IA, tarjetas o voz). Da XP una vez por día y tema. */
  'learning.test_taken': z
    .object({
      topicId: id,
      source: z.enum(['ia', 'tarjetas', 'voz']),
      score: z.number().int().min(0).max(200),
      total: z.number().int().min(1).max(200),
      level: z.string().trim().max(12).optional(),
      errors: z
        .array(
          z.object({
            tag: z.string().trim().min(1).max(40),
            prompt: z.string().max(500),
            answer: z.string().max(500),
            correction: z.string().trim().min(1).max(500),
            explanation: z.string().max(500).optional(),
          }),
        )
        .max(50)
        .default([]),
    })
    .refine((p) => p.score <= p.total, 'score no puede ser mayor que total'),

  // [[salud]]
  /** Salud: hiciste un chequeo preventivo. XP de misión de su tamaño, una vez por chequeo por día. Guarda nombre y tamaño del momento. */
  'health.checkup_done': z.object({
    checkupId: id,
    name: z.string().trim().min(1).max(200).optional(),
    size: size.optional(),
    note: z.string().trim().max(2000).optional(),
    result: z.string().trim().max(2000).optional(),
  }),
  /** Salud: una medición (presión, glucosa, colesterol, pulso en reposo u otra). Solo registro: no da XP. */
  'health.metric': z
    .object({
      kind: z.enum(['presion', 'glucosa', 'colesterol', 'frecuencia_reposo', 'otro']),
      value: z.number().positive().max(100000),
      value2: z.number().positive().max(100000).optional(),
      unit: z.string().trim().max(20).optional(),
      label: z.string().trim().max(80).optional(),
      note: z.string().trim().max(2000).optional(),
    })
    .refine((p) => p.kind !== 'presion' || (p.value2 !== undefined && p.value2 < p.value), 'La presión lleva sistólica y diastólica (la diastólica es menor)')
    .refine((p) => p.kind !== 'otro' || !!p.label, 'Ponle nombre a la medición'),

  // [[habitos]]
  /** "¿Cómo fue tu día?": no había nada que registrar en una revisión (p. ej., "No gasté nada"). No da XP. */
  'day.check_skipped': z.object({ checkId: id, label: z.string().max(100).optional() }),

} as const;

export type EventType = keyof typeof EVENT_SCHEMAS;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_SCHEMAS)[T]>;

export const EVENT_LABELS: Record<EventType, string> = {
  'profile.attributes_rated': 'Atributos iniciales calificados',
  'checkin.morning': 'Check-in de la mañana',
  'rest_day.marked': 'Día de descanso',
  'daily.selected': 'Diaria elegida',
  'weekly.selected': 'Misión de la semana elegida',
  'mission.completed': 'Misión completada',
  'lesson.written': 'Lección escrita',
  'income.recorded': 'Ingreso registrado',
  'expense.recorded': 'Gasto registrado',
  'boss.phase_completed': 'Fase de jefe completada',
  'boss.recurring_defeated': 'Jefe recurrente vencido',
  'achievement.unlocked': 'Logro desbloqueado (manual)',
  'skill.rank_unlocked': 'Rango de habilidad desbloqueado',
  'journal.weekly': 'Diario semanal',
  'season.review': 'Revisión de temporada',
  'npc.interaction': 'Interacción con NPC',
  'map.status_changed': 'Cambio en el mapa',
  'day.closed': 'Cierre del día',
  'bounty.drawn': 'Misión sorpresa del día',
  'reward.redeemed': 'Premio canjeado',
  'goal.progress': 'Avance de meta',
  'vice.relapse': 'Recaída',
  'library.finished': 'Libro o curso terminado',
  'body.logged': 'Registro de cuerpo',
  'savings.moved': 'Movimiento de ahorro',
  'plan.set': 'Plan del día',
  'challenge.started': 'Reto iniciado',
  'challenge.checked': 'Día de reto cumplido',
  'pledge.made': 'Compromiso hecho',
  'pledge.resolved': 'Compromiso resuelto',

  // [[voz]]

  // [[entreno]]

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]
  'time.logged': 'Tiempo registrado',
  'library.progress': 'Avance de lectura',
  'library.note': 'Nota de libro',

  // [[aprendizaje]]
  'learning.reviewed': 'Repaso de tarjeta',
  'learning.test_taken': 'Test de aprendizaje',

  // [[salud]]
  'health.checkup_done': 'Chequeo de salud hecho',
  'health.metric': 'Medición de salud',

  // [[habitos]]
  'day.check_skipped': 'Nada que registrar',

};

export const eventEnvelopeSchema = z.object({
  id: z.string().min(8).max(64),
  type: z.string(),
  occurredAt: z.string().datetime({ offset: true }),
  localDate: date,
  payload: z.unknown(),
});

export type ValidationResult =
  | { ok: true; event: { id: string; type: EventType; occurredAt: string; localDate: string; payload: unknown } }
  | { ok: false; error: string };

/** Valida un evento entrante (lo usan la API y el cliente). */
export function validateEvent(input: unknown): ValidationResult {
  const env = eventEnvelopeSchema.safeParse(input);
  if (!env.success) return { ok: false, error: env.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const schema = (EVENT_SCHEMAS as Record<string, z.ZodTypeAny>)[env.data.type];
  if (!schema) return { ok: false, error: `Tipo de evento desconocido: ${env.data.type}` };
  const p = schema.safeParse(env.data.payload ?? {});
  if (!p.success) return { ok: false, error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, event: { ...env.data, type: env.data.type as EventType, payload: p.data } };
}
