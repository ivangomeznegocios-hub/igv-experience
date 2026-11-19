import { z } from 'zod';
import { ATTRIBUTE_IDS, DAILY_SLOTS, MISSION_SIZES, PLACE_STATUSES } from './types';
import { isDateString } from './util/dates';

const attr = z.enum(ATTRIBUTE_IDS);
const size = z.enum(MISSION_SIZES);
const date = z.string().refine(isDateString, 'Fecha inválida (YYYY-MM-DD)');
const id = z.string().min(1).max(100);

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
    kind: z.enum(['main', 'chapter', 'side', 'daily', 'event', 'npc']),
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
  'npc.interaction': z.object({ npcId: id, note: z.string().max(2000).optional() }),
  'map.status_changed': z.object({ placeId: id, status: z.enum(PLACE_STATUSES), note: z.string().max(2000).optional() }),
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
