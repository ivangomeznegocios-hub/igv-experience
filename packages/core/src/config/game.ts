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
    /** La revisión de fin solo completa la temporada si se escribe en sus últimos N días (o después). */
    endReviewWindowDays: 7,
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
  /** Voz y registro automático (no da XP): qué tan parecido debe ser lo que dictas para reconocerlo (0–1). */
  voz: {
    /** Para reconocer una misión de tu catálogo en una frase ("entrené" → "Entrenar 30 min"). */
    missionMatch: 0.6,
    /** Para reutilizar el tamaño y atributo de algo que ya registraste con un título parecido. */
    historyMatch: 0.6,
    /** Días de historial que se usan para inferir tamaño, atributo y categoría de gasto. */
    historyDays: 365,
  },

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
  /**
   * Mi gente: niveles de cercanía (1–5), temperatura y frecuencia esperada. Ver docs/sistemas/gente.md.
   * Requisitos ACUMULADOS para ganar cada nivel (el 1 es la base): días distintos con contacto, días en
   * persona, semanas distintas y meses distintos con contacto. Diez mensajes en un día cuentan como un día.
   * `xp` se da UNA vez, el día que se alcanza por primera vez (atributo `attribute`).
   */
  gente: {
    levels: [
      { level: 2, days: 3, inPerson: 1, weeks: 2, months: 1, xp: 20 },
      { level: 3, days: 8, inPerson: 3, weeks: 4, months: 2, xp: 30 },
      { level: 4, days: 20, inPerson: 8, weeks: 10, months: 4, xp: 50 },
      { level: 5, days: 50, inPerson: 20, weeks: 24, months: 8, xp: 100 },
    ],
    attribute: 'relaciones',
    /** Temperatura: cálida hasta frecuencia × warmFactor días sin contacto; tibia hasta × coolFactor; luego fría. */
    warmFactor: 1.5,
    coolFactor: 3,
    /** Frecuencia esperada (días entre contactos) por círculo, si su rol no dice otra cosa. 0 = sin meta. */
    circleCadence: { familia: 14, pareja: 1, amigos: 30, trabajo: 14, clientes: 30, comunidad: 60, conocidos: 0 },
    /** Frecuencia esperada por tipo de rol (gana sobre la del círculo). */
    roleCadence: { pareja: 1, hijo: 2, padres: 7, hermano: 14, abuelo: 14, familia: 60, mejorAmigo: 14, amigo: 30, trabajo: 14, cliente: 30, mentor: 60, vecino: 60, conocido: 0 },
    /**
     * Quién se acerca o se aleja: días con contacto en los últimos `trendDays` contra los `trendDays` anteriores.
     * Cuenta como cambio si la diferencia es de al menos `trendMinChange` días y `trendRatio` veces.
     */
    trendDays: 30,
    trendMinChange: 2,
    trendRatio: 1.5,
    /** Cumpleaños próximos que se muestran (días). */
    birthdayWindowDays: 30,
  },

  // [[mapa]]
  /**
   * Mapa: la primera visita a un lugar da `rewards.discovery` (una vez por lugar). Con `habitualVisits` visitas
   * se vuelve "habitual" (también se puede marcar a mano). Completar una colección del catálogo de Jalisco da
   * la XP de una misión de su tamaño (una vez). La capa empresa suma a `empresaAttribute`.
   */
  mapa: {
    habitualVisits: 5,
    empresaAttribute: 'finanzas',
  },

  // [[habilidades]]
  /**
   * Tiempo ("¿A qué te dedicas?"), habilidades y biblioteca. El tiempo NO da XP (regla de oro 3) y el avance
   * o las notas de un libro tampoco: solo terminarlo (XP de su tamaño, una vez) y los rangos de habilidad.
   */
  timeLog: {
    /** Máximo de minutos por registro (un día completo). */
    maxMinutesPerEntry: 1440,
    /** Cronómetro: al detenerlo con más de estas horas se pide revisar (¿se te olvidó detenerlo?). */
    timerReviewHours: 14,
    /** Días que se promedian en "Tu tiempo". */
    averageDays: 28,
    /** "En qué se te va el tiempo": avisar si los traslados pasan de este % de lo registrado en la semana. */
    commuteWarnPercent: 12,
  },

  // [[aprendizaje]]
  /** Aprendizaje (idiomas y temas): tarjetas con repaso espaciado (Leitner) y tests. */
  learning: {
    /** Días hasta el siguiente repaso según la caja (1 a 5). */
    intervals: [1, 2, 4, 8, 16],
    /** Desde esta caja una tarjeta cuenta como "Lo sé". */
    masteredBox: 4,
    /** Tarjetas nuevas por sesión de repaso. */
    newPerSession: 10,
    /** "Te cuesta": al menos `strugglingMal` respuestas "mal" en los últimos `strugglingWindow` repasos. */
    strugglingMal: 2,
    strugglingWindow: 5,
    /** Un error que repites pasa a "mejorando" si no aparece en los siguientes N tests del mismo tipo. */
    errorClearTests: 2,
    /** Un test o sesión da la XP de una misión de este tamaño, una vez por día y tema. */
    sessionSize: 'chica',
    /** Atributo por defecto de la XP de aprendizaje (cada tema puede tener el suyo). */
    attribute: 'inteligencia',
    /** Hitos de "Lo sé" (máximo alcanzado, nunca baja) y la XP de cada uno (como un logro). */
    masteryMilestones: [25, 100, 250, 500, 1000],
    masteryXp: 50,
    /** Práctica en voz alta: similitud mínima para "bien" y para "casi". */
    voicePass: 0.85,
    voiceClose: 0.6,
  },

  // [[salud]]
  /** Salud: hacer un chequeo preventivo da la XP de una misión de su tamaño (una vez por chequeo por día). */
  health: {
    /** Tamaño por defecto de un chequeo (cada chequeo puede tener otro; el registro guarda el del momento). */
    checkupSize: 'media',
    /** Atributo al que suma la XP de los chequeos (salud física = Fuerza física). */
    attribute: 'fuerza',
    /** Días antes de su fecha en que un chequeo pasa a "te toca pronto". */
    soonDays: 30,
  },

  // [[habitos]]
  /** Hábitos y "¿Cómo fue tu día?": solo análisis, nunca dan ni quitan XP. */
  habits: {
    /** Veredicto por cumplimiento en 30 días: ≥ goodRate "Vas muy bien", ≥ okRate "A medias", menos "Flojo". */
    goodRate: 0.8,
    okRate: 0.4,
    /** Días que le tocaban (en 30 días) para poder juzgarlo; con menos es "Recién empezado". */
    minDaysToJudge: 4,
    /** Tendencia: puntos (0–1) de diferencia contra los 30 días anteriores para "mejorando" / "empeorando". */
    trendDelta: 0.1,
    /** Días que le tocaban en los 30 días anteriores para poder comparar. */
    trendMinDays: 4,
    /** Patrón por día de la semana: semanas que se revisan y qué tan abajo de tu promedio es un día flojo. */
    weekdayWeeks: 8,
    weakDayGap: 0.25,
    /** "Hazlo hábito": algo fuera de tu rutina que registraste al menos N días en los últimos M días. */
    suggestMinTimes: 3,
    suggestLookbackDays: 14,
    /** Hábitos a dejar: recaídas en 30 días para "Vas muy bien" (≤ viceGoodMax) y "A medias" (≤ viceOkMax). */
    viceGoodMax: 0,
    viceOkMax: 2,
    /** Hábitos a dejar: recaídas por mes de diferencia contra los 30 días anteriores para marcar tendencia. */
    viceTrendDelta: 1,
  },

  // [[marcador]]
  /**
   * Puntaje del día (0–100): cómo te fue, no cuánto registraste. Cada parte pesa lo que dice `weights`; si una
   * parte no aplica ese día (sin rutina, sin plan, nada que registrar), su peso se reparte entre las demás.
   * No da XP: decide si el día se ganó (y, más adelante, cuánto oro multiplica el impulso).
   */
  dayScore: {
    weights: { routine: 50, plan: 25, log: 15, close: 10 },
    /** Puntaje mínimo para ganar el día. */
    winThreshold: 70,
    /** Revisiones de "¿Cómo fue tu día?" que cuentan como registro (lista fija para no recalcular el historial sin querer). */
    logChecks: ['sueno', 'gastos', 'gente', 'tiempo', 'habitos-dejar'],
    /** Días vacíos seguidos (ya terminados) a partir de los cuales es una pausa: neutra, sin pendientes. */
    pauseMinDays: 2,
  },
  /**
   * Impulso: multiplicador (en %) del oro por días ganados seguidos. Nunca toca la XP. Un día no ganado baja un
   * escalón (no a cero); descanso, día salvado y día libre lo mantienen; una pausa completa baja un solo escalón.
   */
  momentum: {
    steps: [
      { wins: 0, pct: 100 },
      { wins: 2, pct: 125 },
      { wins: 4, pct: 150 },
      { wins: 7, pct: 175 },
      { wins: 14, pct: 200 },
    ],
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
