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

  // [[coach]]
  /**
   * Entrenador personal (engine/coach.ts): plan progresivo, sesión del día, cardio, pasos, sueño y nutrición. Solo
   * planea y aconseja: nunca da ni quita XP (la XP sigue saliendo de la misión de entrenar y de los récords).
   * Evidencia: ACSM (progresión para principiantes: 2–3 días de cuerpo completo, 8–15 reps, cerca pero no al fallo),
   * Schoenfeld 2017 (10+ series por músculo a la semana), OMS 2020 (150–300 min de actividad moderada), Paluch 2022
   * (beneficio de los pasos hasta ~8,000–10,000 al día), Morton 2018 (proteína 1.6 g/kg, hasta 2.2), Mifflin-St Jeor
   * (gasto en reposo), Watson 2015 (7+ h de sueño).
   */
  coach: {
    /**
     * Fases por "semanas entrenadas" (semanas con al menos `advanceMinSessions` sesiones; las semanas sin entrenar
     * no avanzan y, después de `detrainAfterWeeks` vacías, cada una regresa una semana). `from` = semana entrenada
     * (0 = la primera) en que empieza la fase. `rir` = repeticiones que te dejas en reserva.
     */
    phases: {
      adaptacion: { from: 0, name: 'Adaptación', sets: 2, accessorySets: 2, compoundReps: [10, 12], reps: [12, 15], rir: [3, 4], restSec: 75, accessoryRestSec: 60, maxStrengthDays: 3, cardioMinutes: 90, maxExercises: 5 },
      base: { from: 2, name: 'Base', sets: 3, accessorySets: 2, compoundReps: [8, 12], reps: [10, 15], rir: [2, 3], restSec: 105, accessoryRestSec: 75, maxStrengthDays: 4, cardioMinutes: 150, maxExercises: 6 },
      progreso: { from: 6, name: 'Progreso', sets: 3, accessorySets: 3, compoundReps: [6, 10], reps: [10, 15], rir: [1, 2], restSec: 150, accessoryRestSec: 75, maxStrengthDays: 5, cardioMinutes: 150, maxExercises: 7 },
      descarga: { from: -1, name: 'Descarga', sets: 2, accessorySets: 1, compoundReps: [8, 10], reps: [10, 12], rir: [4, 5], restSec: 90, accessoryRestSec: 60, maxStrengthDays: 3, cardioMinutes: 120, maxExercises: 5 },
    },
    /** De dónde arranca cada nivel (semanas entrenadas que ya "trae"). */
    levelStartWeeks: { sedentario: 0, principiante: 2, intermedio: 6, avanzado: 6 },
    /** Una semana cuenta como entrenada con estas sesiones. */
    advanceMinSessions: 2,
    /** Semanas vacías seguidas que se toleran; desde ahí cada semana sin entrenar resta una semana entrenada. */
    detrainAfterWeeks: 1,
    /** En la fase de progreso, una semana de descarga cada tantas semanas entrenadas. */
    deloadEvery: 6,
    /** Días de fuerza por defecto según el nivel (0 = lunes). */
    defaultDays: { sedentario: [0, 2, 4], principiante: [0, 2, 4], intermedio: [0, 1, 3, 4], avanzado: [0, 1, 3, 4] },
    defaultSessionMinutes: 45,
    /** Segundos que dura una serie (sin el descanso) y minutos de calentamiento + estiramiento: para ajustar la sesión a tu tiempo. */
    setSeconds: 45,
    warmupMinutes: 8,
    /** Ajustes por objetivo: cardio extra a la semana y pasos extra al día. */
    goalCardioBonus: { salud: 0, perder_grasa: 60, ganar_musculo: 0, fuerza: 0, condicion: 90 },
    goalStepsBonus: { salud: 0, perder_grasa: 1000, ganar_musculo: 0, fuerza: 0, condicion: 1000 },
    /** Fuerza: en la fase de progreso, los multiarticulares van más pesados y con más descanso. */
    strengthCompoundReps: [4, 6],
    strengthRestSec: 180,
    /** Sobrecarga progresiva (doble progresión): cuánto subir cuando llegas al tope del rango en todas las series. */
    increments: { torso: 2.5, pierna: 5, mancuerna: 2, aislado: 1, aisladoMaquina: 2.5 },
    /** Segundos por serie de los isométricos (plancha) según la fase. */
    holdSeconds: { adaptacion: [20, 30], base: [30, 45], progreso: [40, 60], descarga: [20, 30] },
    /** Si no has hecho un ejercicio en estos días, el plan baja el peso un poco. */
    staleDays: 21,
    stalePct: 0.9,
    /** Pasos al día: tu promedio + `stepsStep`, entre `stepsMin` y `stepsMax`; sin datos, `stepsDefault`. */
    steps: { min: 5000, max: 10000, step: 1000, default: 7000, averageDays: 7 },
    /** Sueño: meta y lo que se considera dormir mal (afecta la sesión del día). */
    sleep: { target: 7, low: 6, veryLow: 5 },
    /** ¿Cómo te sientes? (1–5): con esto o menos, la sesión se aligera; con `restEnergy` o menos, mejor caminar. */
    readiness: { lightEnergy: 2, restEnergy: 1 },
    /**
     * Si a los músculos clave de la sesión les faltan más de estas horas para recuperarse, hoy toca cardio y la sesión
     * se recorre al día en que ya se pueda (el mismo umbral).
     */
    readyWithinHours: 12,
    /**
     * Hora local desde la que ya es tarde para entrenar: la sesión se puede acortar y, si los músculos apenas se
     * recuperan a esa hora o después, la sesión se recorre al día siguiente.
     */
    lateHour: 20,
    /** Medidas: cada cuántos días toca pesarte y medirte la cintura. */
    measureEveryDays: 7,
    /** Ritmo sano de cambio de peso por semana (% del peso). */
    weightRatePct: { perder: [0.5, 1], ganar: [0.25, 0.5] },
    nutrition: {
      /** Proteína (g por kg): base, al bajar grasa y al ganar músculo. Con sobrepeso (IMC ≥ 25) se usa tu peso meta o el de IMC 25. */
      proteinPerKg: { base: 1.6, perder_grasa: 2.0, ganar_musculo: 1.8, fuerza: 1.8 },
      /** Factor de actividad por días de entrenamiento a la semana (0–1, 2–3, 4–5, 6+). */
      activity: [1.2, 1.375, 1.55, 1.725],
      /** Ajuste de calorías: bajar grasa −20% (máximo −500), ganar músculo +10% (máximo +300). */
      deficitPct: 0.2,
      maxDeficit: 500,
      surplusPct: 0.1,
      maxSurplus: 300,
      /** Agua para beber: ml por kg de peso (la comida aporta el resto); un vaso son `glassMl`. */
      waterMlPerKg: 30,
      glassMl: 250,
      fiberG: 30,
      /** Un día de comida bien llevado: proteína en N comidas, verdura en N, fruta 1 vez, sin lo que conviene limitar. */
      proteinMeals: 3,
      veggieMeals: 2,
      fruitMeals: 1,
    },
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

  // [[ciudad]]
  /**
   * Tu ciudad: materiales = 1 por cada XP del atributo del distrito (desde que empezaste) + lo que producen tus
   * edificios. Nunca da XP ni oro. `levels[n-1]` = costo en materiales y días de obra para llegar al nivel n.
   */
  city: {
    levels: [
      { cost: 50, days: 1 },
      { cost: 120, days: 1 },
      { cost: 220, days: 2 },
      { cost: 360, days: 2 },
      { cost: 540, days: 3 },
      { cost: 780, days: 3 },
      { cost: 1080, days: 4 },
      { cost: 1450, days: 5 },
      { cost: 1900, days: 6 },
      { cost: 2500, days: 7 },
    ],
    /** Distrito con el que empiezas (nivel 1, sin obra). */
    startDistrict: 'disciplina',
    /** Materiales por día que produce cada nivel del edificio de un distrito. */
    productionPerLevel: 4,
    /** El almacén de cada distrito guarda hasta N días de producción (luego se llena y deja de juntar). */
    storageDays: 3,
    /** Equipos de obra: uno al inicio y otro más desde este nivel de jugador. */
    crews: 1,
    extraCrewAtLevel: 7,
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
