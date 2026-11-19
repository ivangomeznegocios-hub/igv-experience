export const ATTRIBUTE_IDS = [
  'fuerza',
  'inteligencia',
  'carisma',
  'finanzas',
  'disciplina',
  'relaciones',
  'creatividad',
] as const;
export type AttributeId = (typeof ATTRIBUTE_IDS)[number];

export const ATTRIBUTE_NAMES: Record<AttributeId, string> = {
  fuerza: 'Fuerza física',
  inteligencia: 'Inteligencia',
  carisma: 'Carisma',
  finanzas: 'Finanzas',
  disciplina: 'Disciplina',
  relaciones: 'Relaciones',
  creatividad: 'Creatividad',
};

export const MISSION_SIZES = ['chica', 'media', 'grande', 'epica'] as const;
export type MissionSize = (typeof MISSION_SIZES)[number];
export const MISSION_SIZE_NAMES: Record<MissionSize, string> = {
  chica: 'Chica',
  media: 'Media',
  grande: 'Grande',
  epica: 'Épica',
};

export const DAILY_SLOTS = ['trabajo', 'cuerpo', 'libre'] as const;
export type DailySlot = (typeof DAILY_SLOTS)[number];

/** Un evento: un hecho con fecha. Nunca se modifica; solo se puede anular (voidedAt). */
export interface GameEvent<P = any> {
  id: string;
  type: string;
  /** Momento exacto (ISO 8601). */
  occurredAt: string;
  /** Día local del jugador (YYYY-MM-DD) al que pertenece el evento. */
  localDate: string;
  payload: P;
  voidedAt?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

/** Un elemento del catálogo editable (misión, jefe, NPC, lugar…). */
export interface Entity<D = any> {
  id: string;
  module: string;
  kind: string;
  data: D;
  sort: number;
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number | null;
}

// ---------- Datos de cada tipo de entidad ----------

export interface SettingsData {
  name: string;
  className: string;
  birthDate: string | null;
  monthlyGoal: number;
  currency: string;
  /** Premio real por nivel (5, 10, 15, 20…). */
  levelRewards: Record<string, string>;
}

export interface MainQuestData {
  code: string;
  title: string;
  goal: string;
  attribute: AttributeId;
}

export interface MissionData {
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  mainQuestId?: string | null;
  notes?: string;
  /** Solo diarias: categoría del menú. */
  category?: DailySlot;
  /** Solo diarias: misión de recuperación (sugerida con energía baja). */
  recovery?: boolean;
  /** Solo capítulos: número de capítulo. */
  number?: number;
  /** Solo eventos: fecha opcional. */
  date?: string | null;
}

export type MissionKind = 'main' | 'chapter' | 'side' | 'daily' | 'event';

export type PhaseMetric =
  | { type: 'manual' }
  | { type: 'month_income'; amount: number }
  | { type: 'consecutive_months_income'; amount: number; months: number }
  | { type: 'weekly_streak'; missionIds: string[]; perWeek: number; weeks: number };

export interface BossPhase {
  title: string;
  metric: PhaseMetric;
}

export interface BossData {
  name: string;
  description: string;
  mainQuestId?: string | null;
  /** Atributo al que suman las fases si no hay misión principal ligada. */
  attribute?: AttributeId | null;
  lockedUntilBossId?: string | null;
  phases: BossPhase[];
}

export interface RecurringBossData {
  name: string;
  description: string;
  defeatCondition: string;
  attribute: AttributeId;
}

export type AchievementCondition =
  | { type: 'manual' }
  | { type: 'missions_completed'; count: number }
  | { type: 'streak'; days: number }
  | { type: 'lessons'; count: number }
  | { type: 'recurring_defeats'; bossId: string; count: number }
  | { type: 'boss_phase'; bossId: string; phase: number }
  | { type: 'month_income_goal' }
  | { type: 'discoveries'; count: number }
  | { type: 'season_completed' };

export interface AchievementData {
  name: string;
  description: string;
  icon: string;
  condition: AchievementCondition;
}

export interface SkillData {
  name: string;
  attribute: AttributeId;
  /** Requisito de cada rango: [Aprendiz, Experto, Maestro]. */
  ranks: [string, string, string];
}

export const SKILL_RANK_NAMES = ['Aprendiz', 'Experto', 'Maestro'] as const;

export interface SeasonData {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  focusMainQuestId?: string | null;
}

export interface ItemData {
  name: string;
  notes?: string;
  link?: string;
}

export const NPC_TYPES = ['party', 'aliado', 'mentor', 'cliente', 'rival'] as const;
export type NpcType = (typeof NPC_TYPES)[number];

export interface NpcData {
  name: string;
  npcType: NpcType;
  relation: number;
  key: boolean;
  guildId?: string | null;
  notes?: string;
  /** Última interacción registrada a mano al crear la ficha. */
  lastContact?: string | null;
}

export interface GuildData {
  name: string;
  description?: string;
}

export const PLACE_TYPES = ['lugar', 'experiencia', 'comunidad'] as const;
export const PLACE_STATUSES = ['inexplorado', 'descubierto', 'dominado'] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

export interface PlaceData {
  name: string;
  placeType: (typeof PLACE_TYPES)[number];
  notes?: string;
}
