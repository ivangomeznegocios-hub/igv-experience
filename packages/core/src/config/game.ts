/**
 * ★ CONFIGURACIÓN DEL JUEGO ★
 * Todos los números del juego viven aquí. Si cambias uno, el historial completo
 * se recalcula automáticamente (la XP se deriva de los eventos, nunca se guarda).
 *
 * Reglas de oro (no se rompen, hay pruebas que lo verifican):
 *  - La XP nunca se resta. Descansar no quita XP.
 *  - Un "Día de descanso" marcado no rompe la racha.
 *  - XP por acciones y resultados, no por horas.
 *  - Una lección escrita tras un fracaso da 30 XP.
 *  - El dinero real y la XP son sistemas separados.
 */
export const GAME_CONFIG = {
  /** Zona horaria que define "qué día es hoy". */
  timezone: 'America/Mexico_City',

  /** XP por tamaño de misión. */
  missionXp: {
    chica: 10,
    media: 30,
    grande: 100,
    epica: 300,
  },

  /** Racha: el día n seguido da min(perDay × n, maxPerDay) XP extra. */
  streak: {
    perDay: 5,
    maxPerDay: 35,
    /** El bono de racha suma a este atributo. */
    attribute: 'disciplina',
    /** Días de descanso permitidos por semana (lunes a domingo). */
    restDaysPerWeek: 2,
  },

  /** Recompensas fijas. */
  rewards: {
    achievement: 50,
    skillRank: 100,
    bossPhase: 300,
    recurringBoss: 30,
    discovery: 30,
    lesson: 30,
  },

  /** Atributo por defecto de cada recompensa cuando no hay otro más específico. */
  defaultAttributes: {
    lesson: 'inteligencia',
    discovery: 'creatividad',
    npcContact: 'relaciones',
  },

  /**
   * Niveles: XP para pasar del nivel n al n+1 = factor × n.
   * XP acumulada para llegar al nivel L = factor × L × (L − 1) / 2.
   * (nivel 2 = 250, nivel 5 = 2,500, nivel 10 = 11,250)
   */
  levels: {
    factor: 250,
  },

  /** Títulos por nivel mínimo. */
  titles: [
    { level: 1, title: 'Aprendiz' },
    { level: 5, title: 'Explorador' },
    { level: 10, title: 'Constructor' },
    { level: 15, title: 'Estratega' },
    { level: 20, title: 'Leyenda' },
  ],

  /** Cada cuántos niveles hay un premio real (definido por ti en Ajustes). */
  rewardEveryLevels: 5,

  /** Atributos: cada xpPerPoint XP de atributo = +1 punto, con tope. */
  attributes: {
    xpPerPoint: 100,
    min: 0,
    max: 100,
  },

  /** Energía diaria por horas dormidas (se evalúa de arriba hacia abajo). */
  energy: {
    rules: [
      { minHours: 7, energy: 100 },
      { minHours: 6, energy: 75 },
      { minHours: 0, energy: 50 },
    ],
    /** Con energía menor o igual a esto, solo se sugieren misiones chicas y de recuperación. */
    lowThreshold: 50,
  },

  /** Mi vida en semanas. */
  life: {
    years: 90,
    weeksPerYear: 52,
  },

  /** Temporadas. */
  season: {
    weeks: 13,
  },

  /** NPCs: días sin contacto para generar la misión "escribirle". */
  npc: {
    keyContactDays: 30,
    contactMissionSize: 'chica',
  },

  /** Oro: moneda del juego, separada de la XP. Se gana al ganar XP y se gasta en la tienda de premios. */
  gold: {
    /** 1 de oro por cada `xpPerGold` XP ganada (por cada entrada de XP, redondeando hacia abajo). */
    xpPerGold: 10,
  },

  /** Misión sorpresa del día: bono sobre la XP normal de la misión si la completas ese mismo día. */
  bounty: {
    bonusPercent: 50,
  },

  /** Meta mensual inicial del Dragón Financiero (MXN). Editable en la app. */
  defaultMonthlyGoal: 100_000,
} as const;

export type GameConfig = typeof GAME_CONFIG;

/** Config con tipos "anchos" para que las pruebas puedan sobreescribir números. */
export type GameConfigInput = DeepWiden<GameConfig>;
type DeepWiden<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends readonly (infer U)[]
      ? readonly DeepWiden<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: DeepWiden<T[K]> }
        : T;
