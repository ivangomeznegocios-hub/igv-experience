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
  /** Presupuesto mensual por categoría de gasto (dinero real; no da XP). */
  budgets?: Record<string, number>;
  /** Logros que el avatar muestra como insignias (máx. 3). */
  avatarBadges?: string[];
  /** Compañero de cuentas: a quién le mandas tu resumen semanal (WhatsApp opcional, solo dígitos con lada). */
  partner?: { name: string; phone?: string };
  /** Estilo de color de la app (`skin`). `aura` y `emblem` son de una versión anterior y ya no se usan. */
  equipped?: { aura?: string; emblem?: string; skin?: string };
  /** Estatura en cm (para el personaje 3D y el IMC). */
  heightCm?: number;
  /** Personaje 3D: apariencia y ropa. La forma del cuerpo NO va aquí: sale de los registros `body.logged`. */
  character?: CharacterData;
}

// ---------- Personaje 3D ----------

export const HAIR_STYLES = ['calvo', 'rapado', 'corto', 'copete', 'volumen', 'lado', 'chino'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export const BEARD_STYLES = ['ninguna', 'sombra', 'corta', 'completa', 'candado', 'bigote'] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];
export const TOP_STYLES = ['ninguna', 'playera', 'manga-larga', 'camisa', 'sudadera'] as const;
export type TopStyle = (typeof TOP_STYLES)[number];
export const BOTTOM_STYLES = ['short', 'jeans', 'pantalon', 'jogger'] as const;
export type BottomStyle = (typeof BOTTOM_STYLES)[number];
export const SHOE_STYLES = ['tenis', 'zapato'] as const;
export type ShoeStyle = (typeof SHOE_STYLES)[number];

/**
 * Rasgos del rostro, cada uno de −1 a 1 (0 = promedio). Pensados para afinarse a partir de fotos:
 * `jaw` mandíbula angosta ↔ ancha · `chin` mentón angosto ↔ ancho · `fullness` cara afilada ↔ llena ·
 * `faceLength` cara corta ↔ larga · `midFace` de los ojos a la nariz corto ↔ largo ·
 * `lowerFace` de la nariz al mentón corto ↔ largo · `cheeks` pómulos · `crown` cráneo bajo ↔ alto ·
 * `forehead` frente corta ↔ amplia (altura del nacimiento del pelo) · `nose` nariz chica ↔ grande ·
 * `noseWidth` nariz fina ↔ ancha · `brows` cejas delgadas ↔ pobladas · `browHeight` cejas bajas ↔ altas ·
 * `eyes` ojos chicos ↔ grandes · `eyeOpen` ojos entrecerrados ↔ abiertos · `eyeSpacing` ojos juntos ↔ separados · `lips` labios delgados ↔ gruesos ·
 * `mouthWidth` boca chica ↔ ancha · `ears` orejas pegadas ↔ salidas.
 */
export const FACE_TRAITS = [
  'jaw',
  'chin',
  'fullness',
  'faceLength',
  'midFace',
  'lowerFace',
  'cheeks',
  'crown',
  'forehead',
  'nose',
  'noseWidth',
  'brows',
  'browHeight',
  'eyes',
  'eyeOpen',
  'eyeSpacing',
  'lips',
  'mouthWidth',
  'ears',
] as const;
export type FaceTrait = (typeof FACE_TRAITS)[number];

export interface CharacterLook {
  /** Colores en hexadecimal (#rrggbb). */
  skin: string;
  hair: HairStyle;
  hairColor: string;
  beard: BeardStyle;
  eyeColor: string;
  glasses: boolean;
  face?: Partial<Record<FaceTrait, number>>;
  /** Volumen del cabello (−1 a 1): arriba, al frente y a los lados. */
  hairShape?: { top?: number; front?: number; sides?: number };
  /** Qué tan cerrada se ve la sombra de barba (−1 apenas visible ↔ 1 marcada). */
  beardTone?: number;
  /** Ajuste fino de proporciones (−1 a 1): hombros angostos ↔ anchos, piernas cortas ↔ largas. */
  build?: { shoulders?: number; legs?: number };
}

export interface CharacterOutfit {
  top: TopStyle;
  topColor: string;
  bottom: BottomStyle;
  bottomColor: string;
  shoes: ShoeStyle;
  shoesColor: string;
  watch: boolean;
  cap: boolean;
  capColor: string;
}

export interface CharacterData {
  look: CharacterLook;
  outfit: CharacterOutfit;
}

/**
 * Apariencia por defecto = la del usuario, afinada contra una foto suya (ver "Parecido con el usuario" en
 * CLAUDE.md). Lo que guarde en Perfil → Apariencia / Ropa (`settings.character`) gana sobre esto.
 */
export const DEFAULT_CHARACTER: CharacterData = {
  look: {
    skin: '#d8a58e',
    hair: 'copete',
    hairColor: '#1a1514',
    beard: 'sombra',
    beardTone: -0.5,
    eyeColor: '#2f1f1a',
    glasses: false,
    face: {
      jaw: 0.3,
      chin: 0,
      fullness: 0.3,
      faceLength: -0.3,
      midFace: -0.8,
      lowerFace: 0.25,
      cheeks: 0.5,
      crown: -0.2,
      forehead: 0.3,
      nose: -0.3,
      noseWidth: 0.05,
      brows: 0.2,
      browHeight: 0.1,
      eyes: 0.35,
      eyeOpen: 0.3,
      eyeSpacing: 0.2,
      lips: 0.7,
      mouthWidth: 0.5,
      ears: 0,
    },
    hairShape: { top: -0.1, front: 0, sides: 0.5 },
  },
  outfit: {
    top: 'camisa',
    topColor: '#f1efe9',
    bottom: 'pantalon',
    bottomColor: '#23272f',
    shoes: 'zapato',
    shoesColor: '#3b2416',
    watch: true,
    cap: false,
    capColor: '#23272f',
  },
};

/** Completa lo que falte con los valores por defecto (para ajustes guardados con versiones anteriores). */
export function resolveCharacter(c: Partial<CharacterData> | null | undefined): CharacterData {
  return {
    look: { ...DEFAULT_CHARACTER.look, ...(c?.look ?? {}) },
    outfit: { ...DEFAULT_CHARACTER.outfit, ...(c?.outfit ?? {}) },
  };
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
  /** Solo diarias: forma parte de la rutina (aparece sola cada día). Por defecto, sí. */
  routine?: boolean;
  /** Solo diarias: días de la semana en que aparece (0 = lunes … 6 = domingo). Vacío = todos. */
  days?: number[];
}

export type MissionKind = 'main' | 'chapter' | 'side' | 'daily' | 'event';
/** Tipos que puede llevar un evento `mission.completed` (incluye misiones sin catálogo). */
export const COMPLETION_KINDS = ['main', 'chapter', 'side', 'daily', 'event', 'npc', 'quick', 'todo'] as const;
export type CompletionKind = (typeof COMPLETION_KINDS)[number];

/** Una diaria aparece hoy si está en la rutina y le toca este día de la semana. */
export function isInRoutine(m: Pick<MissionData, 'routine' | 'days'>, weekdayIndex: number): boolean {
  if (m.routine === false) return false;
  return !m.days || m.days.length === 0 || m.days.includes(weekdayIndex);
}

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

/** Tipo de persona de la primera versión. Se sigue guardando (derivado del círculo) para versiones anteriores de la app. */
export const NPC_TYPES = ['party', 'aliado', 'mentor', 'cliente', 'rival'] as const;
export type NpcType = (typeof NPC_TYPES)[number];

// ---------- Mi gente ----------

/** Círculo de vida de una persona (categoría fija; los grupos `npcs/guild` son otra cosa). */
export const PEOPLE_CIRCLES = ['familia', 'pareja', 'amigos', 'trabajo', 'clientes', 'comunidad', 'conocidos'] as const;
export type PeopleCircle = (typeof PEOPLE_CIRCLES)[number];
export const CIRCLE_NAMES: Record<PeopleCircle, string> = {
  familia: 'Familia',
  pareja: 'Pareja',
  amigos: 'Amigos',
  trabajo: 'Trabajo',
  clientes: 'Clientes',
  comunidad: 'Comunidad',
  conocidos: 'Conocidos',
};

/** Cómo fue un contacto (`npc.interaction.channel`). Sin canal = sin especificar (no cuenta como en persona). */
export const CONTACT_CHANNELS = ['persona', 'llamada', 'videollamada', 'mensaje'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const CHANNEL_NAMES: Record<ContactChannel, string> = {
  persona: 'En persona',
  llamada: 'Llamada',
  videollamada: 'Videollamada',
  mensaje: 'Mensaje',
};

/** Escalera de nombres de nivel: familia y pareja, amistades, y relaciones de trabajo. */
export type RelationTrack = 'familia' | 'social' | 'profesional';

/** Tipo de rol: decide el orden en "Familia" y la frecuencia esperada (config `gente.roleCadence`). */
export const ROLE_GROUPS = ['pareja', 'hijo', 'padres', 'hermano', 'abuelo', 'familia', 'mejorAmigo', 'amigo', 'trabajo', 'cliente', 'mentor', 'vecino', 'conocido'] as const;
export type RoleGroup = (typeof ROLE_GROUPS)[number];

export interface PersonRole {
  label: string;
  group: RoleGroup;
  circle: PeopleCircle;
  /** Rol en femenino (para que el nombre del nivel concuerde: "Amiga cercana"). */
  fem?: boolean;
}

/** Roles sugeridos (el rol es texto libre: cualquier otro también vale). */
export const PERSON_ROLES: readonly PersonRole[] = [
  { label: 'Pareja', group: 'pareja', circle: 'pareja' },
  { label: 'Novia', group: 'pareja', circle: 'pareja', fem: true },
  { label: 'Novio', group: 'pareja', circle: 'pareja' },
  { label: 'Esposa', group: 'pareja', circle: 'pareja', fem: true },
  { label: 'Esposo', group: 'pareja', circle: 'pareja' },
  { label: 'Hija', group: 'hijo', circle: 'familia', fem: true },
  { label: 'Hijo', group: 'hijo', circle: 'familia' },
  { label: 'Mamá', group: 'padres', circle: 'familia', fem: true },
  { label: 'Papá', group: 'padres', circle: 'familia' },
  { label: 'Hermana', group: 'hermano', circle: 'familia', fem: true },
  { label: 'Hermano', group: 'hermano', circle: 'familia' },
  { label: 'Abuela', group: 'abuelo', circle: 'familia', fem: true },
  { label: 'Abuelo', group: 'abuelo', circle: 'familia' },
  { label: 'Tía', group: 'familia', circle: 'familia', fem: true },
  { label: 'Tío', group: 'familia', circle: 'familia' },
  { label: 'Prima', group: 'familia', circle: 'familia', fem: true },
  { label: 'Primo', group: 'familia', circle: 'familia' },
  { label: 'Sobrina', group: 'familia', circle: 'familia', fem: true },
  { label: 'Sobrino', group: 'familia', circle: 'familia' },
  { label: 'Suegra', group: 'familia', circle: 'familia', fem: true },
  { label: 'Suegro', group: 'familia', circle: 'familia' },
  { label: 'Cuñada', group: 'familia', circle: 'familia', fem: true },
  { label: 'Cuñado', group: 'familia', circle: 'familia' },
  { label: 'Mejor amiga', group: 'mejorAmigo', circle: 'amigos', fem: true },
  { label: 'Mejor amigo', group: 'mejorAmigo', circle: 'amigos' },
  { label: 'Amiga', group: 'amigo', circle: 'amigos', fem: true },
  { label: 'Amigo', group: 'amigo', circle: 'amigos' },
  { label: 'Socia', group: 'trabajo', circle: 'trabajo', fem: true },
  { label: 'Socio', group: 'trabajo', circle: 'trabajo' },
  { label: 'Colega', group: 'trabajo', circle: 'trabajo' },
  { label: 'Jefa', group: 'trabajo', circle: 'trabajo', fem: true },
  { label: 'Jefe', group: 'trabajo', circle: 'trabajo' },
  { label: 'Empleada', group: 'trabajo', circle: 'trabajo', fem: true },
  { label: 'Empleado', group: 'trabajo', circle: 'trabajo' },
  { label: 'Mentora', group: 'mentor', circle: 'trabajo', fem: true },
  { label: 'Mentor', group: 'mentor', circle: 'trabajo' },
  { label: 'Clienta', group: 'cliente', circle: 'clientes', fem: true },
  { label: 'Cliente', group: 'cliente', circle: 'clientes' },
  { label: 'Compañera', group: 'amigo', circle: 'comunidad', fem: true },
  { label: 'Compañero', group: 'amigo', circle: 'comunidad' },
  { label: 'Vecina', group: 'vecino', circle: 'comunidad', fem: true },
  { label: 'Vecino', group: 'vecino', circle: 'comunidad' },
  { label: 'Conocida', group: 'conocido', circle: 'conocidos', fem: true },
  { label: 'Conocido', group: 'conocido', circle: 'conocidos' },
];

export interface NpcData {
  name: string;
  /** Tipo de la primera versión; se guarda derivado del círculo (ver `legacyNpcType`). */
  npcType: NpcType;
  /** Relación 0–5 de la primera versión (ya no se muestra). */
  relation: number;
  /** Persona clave: si pasa mucho sin contacto, aparece la misión "Escribirle a X". */
  key: boolean;
  /** Grupo (`npcs/guild`). */
  guildId?: string | null;
  notes?: string;
  /** Última interacción registrada a mano al crear la ficha. */
  lastContact?: string | null;
  /** Círculo. Sin él (fichas viejas) se deduce de `npcType`. */
  circle?: PeopleCircle;
  /** Rol: texto libre ("Novia", "Hija", "Amigo de la prepa"…); los de PERSON_ROLES se reconocen. */
  role?: string | null;
  /** Dónde se conocieron (texto) y, opcional, el lugar del mapa. */
  metWhere?: string | null;
  metPlaceId?: string | null;
  /** Cuándo se conocieron: 'YYYY', 'YYYY-MM' o 'YYYY-MM-DD'. */
  metOn?: string | null;
  /** Cumpleaños: 'MM-DD' o 'YYYY-MM-DD' (con año se calcula cuántos cumple). */
  birthday?: string | null;
  phone?: string | null;
  /** Punto de partida (1–5): lo cercana que ya era la relación antes de la app. Solo cambia el nivel que se muestra; no da XP. */
  startLevel?: number;
  /** Cada cuántos días quieres tener contacto. Sin valor = automático por rol/círculo; 0 = sin meta. */
  cadenceDays?: number | null;
}

/** Grupo de personas (equipo, generación, club…). En pantalla: "Grupos". */
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

// ---------- Sistemas de la fase 5 ----------

/** Algo planeado para un día (agenda). Se completa una sola vez. */
export interface TodoData {
  title: string;
  size: MissionSize;
  attribute: AttributeId;
  /** Día planeado (YYYY-MM-DD). */
  date: string;
  /** Misión del catálogo de la que viene (opcional). */
  missionId?: string | null;
  notes?: string;
}

/** Premio real que se compra con oro en la tienda. */
export interface ShopRewardData {
  name: string;
  cost: number;
  icon?: string;
  notes?: string;
}

/** Meta con contador ("Leer 12 libros en 2027"). */
export interface GoalData {
  title: string;
  target: number;
  unit: string;
  attribute: AttributeId;
  /** Tamaño de la recompensa al cumplirla (misma XP que una misión). */
  size: MissionSize;
  deadline?: string | null;
  notes?: string;
  /** Archivada (solo las cumplidas; su XP se conserva). */
  archived?: boolean;
}

/** Mal hábito ("enemigo"): se cuenta la racha de días sin caer. No da ni quita XP. */
export interface ViceData {
  name: string;
  /** Desde cuándo se cuenta. */
  startDate: string;
  notes?: string;
}

/** Meta de ahorro (dinero real; no da XP). */
export interface SavingsData {
  name: string;
  target: number;
}

/** Reto de N días seguidos ("30 días leyendo"). Se inicia con `challenge.started` y se marca con `challenge.checked`. */
export interface ChallengeData {
  title: string;
  /** Duración en días (por defecto 30). */
  days: number;
  attribute: AttributeId;
  /** Tamaño de la recompensa al completarlo (misma XP que una misión). */
  size: MissionSize;
  /** Oculto de la lista (su XP se conserva). */
  archived?: boolean;
}

export const BOOK_TYPES = ['libro', 'curso', 'audiolibro'] as const;
export const BOOK_STATUSES = ['pendiente', 'leyendo'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

export interface BookData {
  title: string;
  author?: string;
  bookType: (typeof BOOK_TYPES)[number];
  /** Estado manual; "terminado" se deriva del evento `library.finished`. */
  status: BookStatus;
  attribute: AttributeId;
  size: MissionSize;
  notes?: string;
}

/** Hito de vida (mudanza, empresa, viaje…) que se marca en Mi vida en semanas. */
export interface MilestoneData {
  title: string;
  date: string;
  icon?: string;
  notes?: string;
}

/** Tipos de entidad permitidos por módulo (la API rechaza cualquier otro). */
export const ENTITY_KINDS: Record<string, readonly string[]> = {
  profile: ['settings'],
  missions: ['main', 'chapter', 'side', 'daily', 'event'],
  bosses: ['boss', 'recurring'],
  achievements: ['achievement'],
  skills: ['skill'],
  seasons: ['season'],
  inventory: ['tool', 'knowledge'],
  npcs: ['npc', 'guild'],
  map: ['place'],
  planner: ['todo'],
  shop: ['reward'],
  goals: ['goal'],
  habits: ['vice'],
  finance: ['savings'],
  library: ['book'],
  life: ['milestone'],
  challenges: ['challenge'],

  // [[voz]]

  // [[entreno]]

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]

  // [[salud]]

  // [[habitos]]

};

export function isValidEntityKind(module: string, kind: string): boolean {
  return !!ENTITY_KINDS[module]?.includes(kind);
}

// =============================================================================================
// Sistemas nuevos: cada uno agrega sus tipos DEBAJO de su ancla (no borres ni muevas las anclas).
// =============================================================================================

// [[voz]]

// [[entreno]]

// [[gente]]

// [[mapa]]

// [[habilidades]]

// [[aprendizaje]]

// [[salud]]

// [[habitos]]

