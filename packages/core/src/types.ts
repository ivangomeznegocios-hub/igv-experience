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
  /** Desde qué día cuenta el puntaje del día y el impulso (lo fija el arranque). Antes de esa fecha nada se juzga. */
  scoreStart?: string;
  /**
   * Tu "mínimo" para un día malo: si lo haces, el día queda salvado (no se gana, pero conserva el impulso).
   * Sin definir, cualquier misión completada salva el día.
   */
  dayMinimum?: { missionId: string; title: string };
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
    skin: '#d6a08f',
    hair: 'copete',
    hairColor: '#1c1716',
    beard: 'sombra',
    beardTone: -0.15,
    eyeColor: '#2f1f1a',
    glasses: false,
    face: {
      jaw: 0.25,
      chin: 0.15,
      fullness: 0.22,
      faceLength: -0.3,
      midFace: -0.8,
      lowerFace: 0.25,
      cheeks: 0.5,
      crown: -0.2,
      forehead: 0.3,
      nose: 0.1,
      noseWidth: 0.1,
      brows: 0.2,
      browHeight: 0.1,
      eyes: 0.35,
      eyeOpen: 0,
      eyeSpacing: 0.2,
      lips: 0.5,
      mouthWidth: 0.3,
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
  /** Categoría en "Lo que sabes hacer". Sin ella se deduce con `skillCategory()` (habilidades viejas). */
  category?: SkillCategory;
  /** "De esto vivo": forma parte de a qué te dedicas. */
  livelihood?: boolean;
  /** Lo que sabes de esto: métodos, recursos, cómo lo aprendiste (texto libre). */
  notes?: string;
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

/**
 * Categorías de un lugar del mapa. `lugar`, `experiencia` y `comunidad` vienen de la primera versión (siguen
 * valiendo). Las de la capa empresa están en EMPRESA_PLACE_TYPES (ver la sección [[mapa]] al final).
 */
export const PLACE_TYPES = [
  'lugar',
  'experiencia',
  'comunidad',
  'restaurante',
  'cafe',
  'bar',
  'parque',
  'naturaleza',
  'museo',
  'cultura',
  'deporte',
  'compras',
  'evento',
  'pueblo',
  'playa',
  'viaje',
  'oficina',
  'sucursal',
  'cliente',
  'proveedor',
  'zona',
] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];
/** Estados internos (en pantalla: por conocer / conocido / habitual). */
export const PLACE_STATUSES = ['inexplorado', 'descubierto', 'dominado'] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

export interface PlaceData {
  name: string;
  placeType: PlaceType;
  notes?: string;
  /** Capa del mapa (por defecto 'vida'). */
  layer?: PlaceLayer;
  /** Ciudad o municipio (Guadalajara, Zapopan, Tlaquepaque…). Texto libre. */
  city?: string;
  /** Colonia o zona (Centro, Americana, Providencia…). */
  zone?: string;
  /** Coordenadas aproximadas (grados). Sin ellas, el lugar sale en la lista pero no en el mapa. */
  lat?: number | null;
  lng?: number | null;
  /** Lugar del catálogo de Jalisco al que corresponde (cuenta para sus colecciones). */
  catalogId?: string | null;
  /** Personas ligadas al lugar (en la capa empresa: los contactos del cliente o proveedor). */
  npcIds?: string[];
  /** Capa empresa: false = ya no opera ahí (sigue en el historial). */
  active?: boolean;
  /** Capa empresa: desde cuándo opera ahí (YYYY-MM-DD). */
  since?: string | null;
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
  /** Páginas (o lecciones) en total: con ellas el avance por página se vuelve porcentaje. */
  pages?: number | null;
  /** Habilidad a la que aporta (aparece en su ficha). */
  skillId?: string | null;
  /** Calificación de 1 a 5 (normalmente al terminarlo). */
  rating?: number | null;
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
  training: ['exercise', 'routine', 'settings'],

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]
  learning: ['topic', 'item'],

  // [[salud]]
  health: ['checkup', 'profile'],

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
// ---------- Entrenamiento (ver engine/training.ts y docs/sistemas/entreno.md) ----------

/**
 * Grupos musculares (ids estables: los usan los registros, el mapa del cuerpo y, más adelante, el personaje 3D).
 * `lumbar` = espalda baja (erectores), `isquios` = isquiotibiales, `espalda` = dorsales y espalda alta.
 */
export const MUSCLE_IDS = [
  'pecho',
  'espalda',
  'trapecio',
  'hombro_frontal',
  'hombro_lateral',
  'hombro_posterior',
  'biceps',
  'triceps',
  'antebrazo',
  'abdomen',
  'oblicuos',
  'lumbar',
  'gluteos',
  'cuadriceps',
  'isquios',
  'aductores',
  'pantorrillas',
] as const;
export type MuscleId = (typeof MUSCLE_IDS)[number];

/** Tipo de entrenamiento. */
export const WORKOUT_KINDS = ['fuerza', 'cardio', 'movilidad', 'deporte', 'clase', 'caminata', 'otro'] as const;
export type WorkoutKind = (typeof WORKOUT_KINDS)[number];
export const WORKOUT_KIND_NAMES: Record<WorkoutKind, string> = {
  fuerza: 'Fuerza',
  cardio: 'Cardio',
  movilidad: 'Movilidad',
  deporte: 'Deporte',
  clase: 'Clase',
  caminata: 'Caminata',
  otro: 'Otro',
};

/** Dónde entrenaste (opcionalmente con un lugar del mapa: `placeId`). */
export const WORKOUT_PLACES = ['gym', 'casa', 'parque', 'calle', 'alberca', 'cancha', 'otro'] as const;
export type WorkoutPlace = (typeof WORKOUT_PLACES)[number];
export const WORKOUT_PLACE_NAMES: Record<WorkoutPlace, string> = {
  gym: 'Gym',
  casa: 'Casa',
  parque: 'Parque',
  calle: 'Calle',
  alberca: 'Alberca',
  cancha: 'Cancha',
  otro: 'Otro',
};

/** Cómo se mide un ejercicio: peso (reps × kg), corporal (reps), tiempo (segundos) o distancia (min / km). */
export const EXERCISE_MEASURES = ['peso', 'corporal', 'tiempo', 'distancia'] as const;
export type ExerciseMeasure = (typeof EXERCISE_MEASURES)[number];

export const EQUIPMENT = ['barra', 'mancuerna', 'maquina', 'polea', 'corporal', 'kettlebell', 'banda', 'cardio'] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export const EQUIPMENT_NAMES: Record<Equipment, string> = {
  barra: 'Barra',
  mancuerna: 'Mancuernas',
  maquina: 'Máquina',
  polea: 'Polea',
  corporal: 'Peso corporal',
  kettlebell: 'Kettlebell',
  banda: 'Banda',
  cardio: 'Cardio',
};

/** Una serie: reps × kg (fuerza), segundos (isométricos) o minutos / km (cardio). */
export interface WorkoutSet {
  reps?: number;
  kg?: number;
  sec?: number;
  min?: number;
  km?: number;
}

export interface WorkoutExercise {
  /** Id de la biblioteca (`press-banca`) o de un ejercicio propio (`ex-…`). */
  exerciseId: string;
  name: string;
  /** Solo ejercicios propios: músculos del momento (por si después se borra el ejercicio). */
  primary?: MuscleId[];
  secondary?: MuscleId[];
  sets: WorkoutSet[];
}

/** Payload del evento `workout.logged`. */
export interface WorkoutPayload {
  kind: WorkoutKind;
  title?: string;
  where?: WorkoutPlace;
  placeId?: string | null;
  minutes?: number;
  /** Esfuerzo percibido 1–10. */
  rpe?: number;
  note?: string;
  routineId?: string | null;
  /** La `mission.completed` que se registró junto con este entrenamiento (para anular ambos). */
  missionEventId?: string | null;
  exercises: WorkoutExercise[];
}

/** Ejercicio propio (`training/exercise`). */
export interface ExerciseData {
  name: string;
  primary: MuscleId[];
  secondary?: MuscleId[];
  equipment?: Equipment;
  measure: ExerciseMeasure;
  notes?: string;
}

/** Rutina guardada (`training/routine`): lista de ejercicios con series y reps sugeridas. */
export interface RoutineData {
  name: string;
  kind?: WorkoutKind;
  exercises: { exerciseId: string; name: string; sets: number; reps?: number }[];
  notes?: string;
}

/** Ajustes de entrenamiento (`training/settings`, id `training-settings`). */
export interface TrainingSettingsData {
  /** Diaria del catálogo que se completa al registrar un entrenamiento. Sin ella: misión rápida "Entrenar". */
  missionId?: string | null;
  /** Dónde entrenas normalmente. */
  where?: WorkoutPlace | null;
  /** Tu entrenador personal (plan semanal, sesión del día, nutrición). Ver engine/coach.ts. */
  coach?: CoachSettings;
}

// [[coach]]
// ---------- Entrenador personal y nutrición (ver engine/coach.ts y docs/sistemas/coach.md) ----------

/** Objetivo principal del plan. */
export const COACH_GOALS = ['salud', 'perder_grasa', 'ganar_musculo', 'fuerza', 'condicion'] as const;
export type CoachGoal = (typeof COACH_GOALS)[number];
export const COACH_GOAL_NAMES: Record<CoachGoal, string> = {
  salud: 'Salud y energía',
  perder_grasa: 'Bajar grasa',
  ganar_musculo: 'Ganar músculo',
  fuerza: 'Más fuerza',
  condicion: 'Más condición',
};

/** De dónde arrancas (lo dices tú; el plan avanza solo con las semanas que entrenas). */
export const COACH_LEVELS = ['sedentario', 'principiante', 'intermedio', 'avanzado'] as const;
export type CoachLevel = (typeof COACH_LEVELS)[number];
export const COACH_LEVEL_NAMES: Record<CoachLevel, string> = {
  sedentario: 'Sedentario (casi no me muevo)',
  principiante: 'Principiante (menos de 6 meses)',
  intermedio: 'Intermedio (1–3 años)',
  avanzado: 'Avanzado (3+ años)',
};

/** Zonas del cuerpo con molestias o lesiones: el plan evita los ejercicios que las cargan. */
export const BODY_AREAS = ['rodilla', 'espalda_baja', 'hombro', 'cuello', 'codo', 'muneca', 'cadera', 'tobillo'] as const;
export type BodyArea = (typeof BODY_AREAS)[number];
export const BODY_AREA_NAMES: Record<BodyArea, string> = {
  rodilla: 'Rodilla',
  espalda_baja: 'Espalda baja',
  hombro: 'Hombro',
  cuello: 'Cuello',
  codo: 'Codo',
  muneca: 'Muñeca',
  cadera: 'Cadera',
  tobillo: 'Tobillo',
};

/** Ajustes del entrenador (`training-settings.coach`). Cambiarlos recalcula el plan; nunca toca el historial. */
export interface CoachSettings {
  /** Ya pasó por "Arma tu plan". */
  on?: boolean;
  /** Nombre de tu entrenador (por defecto "Coach"). */
  name?: string;
  goal?: CoachGoal;
  level?: CoachLevel;
  /** Días de fuerza (0 = lunes … 6 = domingo). Vacío = los elige el plan. */
  days?: number[];
  /** Minutos por sesión de fuerza (20–120). */
  sessionMinutes?: number;
  limitations?: BodyArea[];
  /** Semana 1 del plan (YYYY-MM-DD). */
  startDate?: string;
  /** Meta de pasos fija (si no, la calcula el plan con tu historial). */
  stepsGoal?: number | null;
  /** Peso al que quieres llegar (kg). */
  targetWeightKg?: number | null;
  /** Para el gasto calórico (fórmula de Mifflin-St Jeor). Por defecto hombre. */
  sex?: 'hombre' | 'mujer';
  /** Ejercicio que elegiste para un patrón del plan (`sentadilla` → `prensa`…). */
  swaps?: Record<string, string>;
}

/** Comida del día. */
export const MEAL_KINDS = ['desayuno', 'comida', 'cena', 'colacion'] as const;
export type MealKind = (typeof MEAL_KINDS)[number];
export const MEAL_KIND_NAMES: Record<MealKind, string> = { desayuno: 'Desayuno', comida: 'Comida', cena: 'Cena', colacion: 'Colación' };

/**
 * Qué llevaba la comida (hábitos, no calorías): las de arriba suman, las de `limit` restan. La lista se repite en
 * events.ts (`meal.logged`); hay prueba de que coinciden.
 */
export const MEAL_TAGS = ['proteina', 'verduras', 'fruta', 'integrales', 'legumbres', 'grasas_buenas', 'lacteos', 'ultraprocesado', 'frito', 'azucar', 'refresco', 'alcohol'] as const;
export type MealTag = (typeof MEAL_TAGS)[number];
export const MEAL_TAG_NAMES: Record<MealTag, string> = {
  proteina: 'Proteína',
  verduras: 'Verduras',
  fruta: 'Fruta',
  integrales: 'Integrales / maíz',
  legumbres: 'Frijol / lenteja',
  grasas_buenas: 'Grasas buenas',
  lacteos: 'Lácteos',
  ultraprocesado: 'Ultraprocesado',
  frito: 'Frito',
  azucar: 'Postre / pan dulce',
  refresco: 'Refresco / jugo',
  alcohol: 'Alcohol',
};
/** Etiquetas que conviene limitar. */
export const MEAL_LIMIT_TAGS: readonly MealTag[] = ['ultraprocesado', 'frito', 'azucar', 'refresco', 'alcohol'];

// [[gente]]

// [[mapa]]
/** Capas del mapa: tu vida (lugares que conoces) y tu empresa (dónde opera, clientes, proveedores). */
export const PLACE_LAYERS = ['vida', 'empresa'] as const;
export type PlaceLayer = (typeof PLACE_LAYERS)[number];
export const PLACE_LAYER_NAMES: Record<PlaceLayer, string> = { vida: 'Vida', empresa: 'Empresa' };
export const VIDA_PLACE_TYPES = ['restaurante', 'cafe', 'bar', 'parque', 'naturaleza', 'museo', 'cultura', 'deporte', 'compras', 'evento', 'experiencia', 'comunidad', 'pueblo', 'playa', 'viaje', 'lugar'] as const satisfies readonly PlaceType[];
export const EMPRESA_PLACE_TYPES = ['oficina', 'sucursal', 'cliente', 'proveedor', 'zona'] as const satisfies readonly PlaceType[];
export const PLACE_TYPE_NAMES: Record<PlaceType, string> = {
  lugar: 'Otro lugar',
  experiencia: 'Experiencia',
  comunidad: 'Comunidad',
  restaurante: 'Restaurante',
  cafe: 'Café',
  bar: 'Bar',
  parque: 'Parque',
  naturaleza: 'Naturaleza',
  museo: 'Museo',
  cultura: 'Cultura',
  deporte: 'Deporte',
  compras: 'Compras',
  evento: 'Evento',
  pueblo: 'Pueblo',
  playa: 'Playa',
  viaje: 'Ciudad / viaje',
  oficina: 'Oficina',
  sucursal: 'Sucursal',
  cliente: 'Cliente',
  proveedor: 'Proveedor',
  zona: 'Zona de operación',
};
export const PLACE_STATUS_NAMES: Record<PlaceStatus, string> = { inexplorado: 'Por conocer', descubierto: 'Conocido', dominado: 'Habitual' };
/** Con quién fuiste (evento `place.visited`). */
export const VISIT_COMPANIES = ['solo', 'pareja', 'familia', 'amigos', 'trabajo', 'otro'] as const;
export type VisitCompany = (typeof VISIT_COMPANIES)[number];
export const VISIT_COMPANY_NAMES: Record<VisitCompany, string> = {
  solo: 'Solo',
  pareja: 'En pareja',
  familia: 'En familia',
  amigos: 'Con amigos',
  trabajo: 'Por trabajo',
  otro: 'Con alguien más',
};
/** Capa de un lugar (los guardados antes de las capas son de 'vida'). */
export function placeLayer(d: Pick<PlaceData, 'layer' | 'placeType'> | null | undefined): PlaceLayer {
  if (d?.layer === 'empresa' || d?.layer === 'vida') return d.layer;
  return (EMPRESA_PLACE_TYPES as readonly string[]).includes(d?.placeType ?? '') ? 'empresa' : 'vida';
}

// [[habilidades]]
// ---- Habilidades, tiempo y biblioteca (sistema "habilidades") ----

/** Categorías de "Lo que sabes hacer". */
export const SKILL_CATEGORIES = ['negocio', 'oficio', 'idioma', 'tecnologia', 'deporte', 'arte', 'hogar', 'social', 'otro'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
export const SKILL_CATEGORY_NAMES: Record<SkillCategory, string> = {
  negocio: 'Negocio y ventas',
  oficio: 'Oficio y profesión',
  idioma: 'Idiomas',
  tecnologia: 'Tecnología',
  deporte: 'Deporte',
  arte: 'Arte y música',
  hogar: 'Hogar',
  social: 'Social',
  otro: 'Otro',
};
/** Atributo sugerido al crear una habilidad de una categoría (se puede cambiar). */
export const SKILL_CATEGORY_ATTRIBUTE: Record<SkillCategory, AttributeId> = {
  negocio: 'finanzas',
  oficio: 'disciplina',
  idioma: 'inteligencia',
  tecnologia: 'inteligencia',
  deporte: 'fuerza',
  arte: 'creatividad',
  hogar: 'disciplina',
  social: 'carisma',
  otro: 'inteligencia',
};
/** Requisitos de rango por defecto para una habilidad agregada en una línea ("Sé hacer…"). */
export const SKILL_DEFAULT_RANKS: [string, string, string] = [
  'Ya lo hice de verdad, con un resultado concreto',
  'Lo hago bien y sin ayuda, con resultados repetidos',
  'Me pagan por hacerlo o se lo enseño a otros',
];

/**
 * Áreas del tiempo ("¿A qué te dedicas?"). La oficina cuenta como `trabajo` (el lugar va en la nota).
 * Si agregas una, agrégala también al schema de `time.logged` en events.ts (hay una prueba que lo verifica).
 */
export const TIME_AREAS = ['trabajo', 'estudio', 'lectura', 'proyecto', 'ejercicio', 'familia', 'pareja', 'amigos', 'casa', 'traslado', 'ocio', 'otro'] as const;
export type TimeArea = (typeof TIME_AREAS)[number];
export const TIME_AREA_NAMES: Record<TimeArea, string> = {
  trabajo: 'Trabajo',
  estudio: 'Estudio',
  lectura: 'Lectura',
  proyecto: 'Proyecto propio',
  ejercicio: 'Ejercicio',
  familia: 'Familia',
  pareja: 'Pareja',
  amigos: 'Amigos',
  casa: 'Casa',
  traslado: 'Traslados',
  ocio: 'Ocio',
  otro: 'Otro',
};
/** Grupos para "en qué se te va el tiempo". */
export const TIME_GROUPS = ['construir', 'cuerpo', 'gente', 'resto'] as const;
export type TimeGroup = (typeof TIME_GROUPS)[number];
export const TIME_GROUP_NAMES: Record<TimeGroup, string> = { construir: 'Construir', cuerpo: 'Cuerpo', gente: 'Tu gente', resto: 'Lo demás' };
export const TIME_AREA_GROUP: Record<TimeArea, TimeGroup> = {
  trabajo: 'construir',
  estudio: 'construir',
  lectura: 'construir',
  proyecto: 'construir',
  ejercicio: 'cuerpo',
  familia: 'gente',
  pareja: 'gente',
  amigos: 'gente',
  casa: 'resto',
  traslado: 'resto',
  ocio: 'resto',
  otro: 'resto',
};

// [[aprendizaje]]

// ---------- Aprendizaje (idiomas y temas) ----------

export const LEARNING_TOPIC_KINDS = ['idioma', 'materia', 'otro'] as const;
export type LearningTopicKind = (typeof LEARNING_TOPIC_KINDS)[number];
export const LEARNING_TOPIC_KIND_NAMES: Record<LearningTopicKind, string> = { idioma: 'Idioma', materia: 'Materia', otro: 'Otro' };
/** Niveles del Marco Común Europeo (idiomas). */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];
export const LEARNING_ITEM_TYPES = ['frase', 'palabra', 'concepto'] as const;
export type LearningItemType = (typeof LEARNING_ITEM_TYPES)[number];
export const LEARNING_RESULTS = ['bien', 'dude', 'mal'] as const;
export type LearningResult = (typeof LEARNING_RESULTS)[number];
export const LEARNING_RESULT_NAMES: Record<LearningResult, string> = { bien: 'Bien', dude: 'Dudé', mal: 'Mal' };
/** De dónde viene un test: generado por IA, sesión de tarjetas o práctica en voz alta. */
export const LEARNING_TEST_SOURCES = ['ia', 'tarjetas', 'voz'] as const;
export type LearningTestSource = (typeof LEARNING_TEST_SOURCES)[number];
export const LEARNING_TEST_SOURCE_NAMES: Record<LearningTestSource, string> = { ia: 'Test con IA', tarjetas: 'Tarjetas', voz: 'En voz alta' };
/** Etiquetas sugeridas (de frases y de errores). Se aceptan otras. */
export const LEARNING_TAGS = [
  'vocabulario',
  'gramática',
  'tiempos verbales',
  'preposiciones',
  'artículos',
  'phrasal verbs',
  'orden de palabras',
  'falsos amigos',
  'ortografía',
  'pronunciación',
  'registro',
  'negocios',
  'negociación',
  'juntas',
  'presentaciones',
  'small talk',
  'concepto',
  'otro',
] as const;

/** Tema que estás aprendiendo ("Inglés"). */
export interface LearningTopicData {
  name: string;
  topicKind: LearningTopicKind;
  /** Nivel autoevaluado: A1–C2 en idiomas; texto libre en otros temas. */
  level?: string | null;
  /** Para qué lo aprendes ("Negociar y presentar en inglés"). */
  goal?: string;
  /** Idioma para la voz (BCP-47, p. ej. "en-US"). Solo idiomas. */
  lang?: string;
  /** Atributo al que suma la XP de practicar (por defecto el de config). */
  attribute?: AttributeId;
  archived?: boolean;
  notes?: string;
}

/** Algo que quieres saber decir o entender: frase, palabra o concepto. */
export interface LearningItemData {
  topicId: string;
  itemType: LearningItemType;
  /** En el idioma que aprendes (o el concepto). */
  text: string;
  /** Traducción o significado (en español). */
  meaning: string;
  example?: string;
  tags: string[];
  notes?: string;
  /** De dónde salió: a mano, paquete inicial, error de un test o propuesta de la IA. */
  origin?: 'manual' | 'inicial' | 'test' | 'ia';
}

// [[salud]]

// ---------- Salud: chequeos preventivos, mediciones y ficha médica ----------

export const CHECKUP_CATEGORIES = ['estudios', 'consulta', 'dental', 'vista', 'piel', 'vacuna', 'otro'] as const;
export type CheckupCategory = (typeof CHECKUP_CATEGORIES)[number];
export const CHECKUP_CATEGORY_NAMES: Record<CheckupCategory, string> = {
  estudios: 'Estudios',
  consulta: 'Consulta',
  dental: 'Dental',
  vista: 'Vista',
  piel: 'Piel',
  vacuna: 'Vacuna',
  otro: 'Otro',
};

/** Chequeo preventivo (`health/checkup`). La fecha siguiente se deriva: última vez + `everyMonths`. */
export interface CheckupData {
  name: string;
  category: CheckupCategory;
  /** Cada cuántos meses toca (0 = una sola vez). */
  everyMonths: number;
  notes?: string;
  /** Activo = cuenta en "Ya te toca" y en tu puntaje de salud. */
  active: boolean;
  /** Tamaño de la XP al hacerlo (por defecto `health.checkupSize`). El registro guarda el del momento. */
  size?: MissionSize;
  /** Última vez aproximada, anotada a mano (no da XP). Un registro más reciente gana. */
  lastDone?: string | null;
  /** Recomendación de la que viene (HEALTH_SUGGESTIONS). */
  suggestionId?: string | null;
}

export const HEALTH_METRIC_KINDS = ['presion', 'glucosa', 'colesterol', 'frecuencia_reposo', 'otro'] as const;
export type HealthMetricKind = (typeof HEALTH_METRIC_KINDS)[number];

export const BLOOD_TYPES = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] as const;

/** Ficha médica (`health/profile`, id fijo HEALTH_PROFILE_ID): lo que hay que leer rápido en una emergencia. */
export interface HealthProfileData {
  bloodType?: string;
  allergies?: string;
  conditions?: string;
  medications?: string;
  doctorName?: string;
  doctorPhone?: string;
  insurer?: string;
  policyNumber?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  notes?: string;
}
export const HEALTH_PROFILE_ID = 'health-profile';

// [[habitos]]

