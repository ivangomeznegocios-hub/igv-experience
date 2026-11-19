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

  /** Bonos de oro (nunca XP). */
  goldBonus: {
    /** Cumplir las 3 cosas que planeaste la noche anterior. */
    planCompleted: 5,
    /** Bono sorpresa al cerrar un día con al menos una misión: se elige por fecha (no se puede "re-tirar"). */
    dayCloseOptions: [2, 3, 3, 4, 5, 5, 6, 8, 10, 15, 25],
  },

  /** Compromisos: apuestas oro a que cumples algo. Si cumples recibes stake × multiplier; si no, lo pierdes. */
  pledge: {
    payoutMultiplier: 2,
  },

  /** Retos de N días seguidos: duración por defecto y tamaño de la recompensa al completarlo. */
  challenge: {
    defaultDays: 30,
    defaultSize: 'grande',
  },

  /** Misión sorpresa del día: bono sobre la XP normal de la misión si la completas ese mismo día. */
  bounty: {
    bonusPercent: 50,
  },

  // ---- Sistemas nuevos: cada uno agrega su sección DEBAJO de su ancla ----
  // [[voz]]

  // [[entreno]]
  /**
   * Entrenamiento (engine/training.ts). Números basados en la evidencia de hipertrofia y salud:
   * 10–20 series duras por músculo a la semana (mínimo efectivo ~6), cada músculo ≥ 2 veces por semana,
   * 48 h de recuperación para músculos chicos y 72 h para grandes tras series duras, y 150–300 min de cardio
   * moderado por semana (OMS).
   */
  training: {
    /** Horas de recuperación tras una sesión con al menos `recoveryMinSets` series duras del músculo. */
    recoveryHours: { grande: 72, chico: 48 },
    /** Series efectivas de un músculo en una sesión para que necesite recuperarse (4 series de sentadilla = 2 de espalda baja: no). */
    recoveryMinSets: 3,
    /** Series duras por semana (lunes a domingo) para músculos principales. */
    weeklySets: { min: 6, target: 10, max: 20 },
    /** Músculos accesorios (trapecio, antebrazo, aductores, oblicuos): reciben trabajo indirecto, piden menos. */
    accessoryWeeklySets: { min: 3, target: 6, max: 16 },
    /** Una serie cuenta completa para el músculo principal y así para los secundarios. */
    secondaryFactor: 0.5,
    /** Veces por semana recomendadas por músculo. */
    minFrequency: 2,
    /** Días sin trabajar un músculo para considerarlo olvidado. */
    forgottenDays: 8,
    /** Cardio moderado por semana (minutos). */
    cardioMinutes: { min: 150, target: 300 },
    /** Días para medir el equilibrio empuje/jalón y torso/pierna, y cuánta diferencia es desequilibrio. */
    balanceDays: 14,
    balanceRatio: 1.5,
    /** Series mínimas del lado fuerte para hablar de desequilibrio (con menos, no hay datos suficientes). */
    balanceMinSets: 12,
    /** Sesión sugerida: series por ejercicio, máximo de ejercicios y de series duras. */
    suggestion: { setsPerExercise: 3, maxExercises: 6, sessionSets: 20 },
    /** Semanas seguidas: cuentan las semanas con al menos estas sesiones. */
    streakMinSessions: 2,
    /** La misión que se completa al registrar un entrenamiento si no elegiste una diaria en Ajustes. */
    mission: { title: 'Entrenar', size: 'media', attribute: 'fuerza' },
    /** Récord personal nuevo (mejor que todo lo anterior de ese ejercicio): XP de una misión de este tamaño. */
    record: { size: 'chica', attribute: 'fuerza', maxPerDay: 3 },
  },

  // [[gente]]

  // [[mapa]]

  // [[habilidades]]

  // [[aprendizaje]]

  // [[salud]]

  // [[habitos]]

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
