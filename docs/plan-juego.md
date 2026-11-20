# Plan único: IGV EXPERIENCE como juego que sí se juega

## Contexto

La app ya tiene las mecánicas (XP, niveles, racha, oro, retos, logros), pero se siente "como un check": la
pantalla diaria es un formulario de 20 tarjetas, las recompensas son chicas y lejanas, no hay nada en juego ni
nada nuevo al abrirla, y la cuenta está vacía. Arreglar eso solo da un tablero más bonito. Para que siga viva
en la semana 4, 8 y 12 hace falta lo que tiene un juego:

1. **Decisiones** (elegir con un recurso limitado, no solo palomear).
2. **Algo tuyo que crece** (una posesión, no un número).
3. **Novedad programada** (la semana 3 no puede ser igual a la 1).
4. **Que volver convenga** (fallar unos días no puede ser el final).

### Lo que decidiste

| Dijiste | Consecuencia en el diseño |
|---|---|
| Te atrapa **construir y administrar** | El centro es una ciudad que levantas con recursos, tiempos de obra y decisiones |
| Te atrapa **armar tu personaje** | Las mejoras se eligen (una de dos), no suben solas |
| Te atrapa **historia y mundo abierto** | Capítulos con final, episodio semanal, tu mapa real como mundo |
| No elegiste competir | Sin ligas ni marcador de ganados contra perdidos |
| Lo dejas cuando **fallas unos días y ya no regresas** | Regla número uno: volver es el mejor momento del juego |
| La tendrías **abierta todo el día**; mitad computadora, mitad celular (Android) | Pantalla principal = mesa viva de escritorio, con versión de celular |
| **Dinero real** en juego | El oro vale pesos de tu presupuesto para gustos |
| **Sin avisos** y sin WhatsApp | El regreso lo provocan obras por inaugurar y almacenes por recoger |
| El Coach con IA **ya tiene llave** | El Coach narra, propone y genera el contenido que rota |

## El juego en una frase

**Construyes la ciudad de tu vida.** Cada cosa real que haces produce materiales del distrito al que pertenece.
Con ellos levantas edificios que tardan días y te dan ventajas que tú eliges. La ciudad muestra de un vistazo
dónde estás construyendo tu vida y dónde no. Lo que ganas cada día vale pesos para tus gustos.

### Tres monedas, cada una con un solo papel

| Moneda | Se gana con | Sirve para | ¿Se pierde? |
|---|---|---|---|
| **XP** | Acciones y resultados (como hoy) | Nivel: abre mecánicas nuevas | Nunca |
| **Materiales** (uno por distrito) | 1 por cada XP de ese atributo + producción diaria de tus edificios | Construir y mejorar la ciudad | Solo al gastarlos |
| **Oro = pesos para gustos** | Puntaje del día × impulso | Gustos reales, premios, compromisos | Al gastarlo o al perder una apuesta que aceptaste |

Los materiales nunca son XP ni oro. Registrar dinero nunca da ni quita XP. Nada resta XP.

### El ciclo

- **Minutos** — haces algo real → materiales de ese distrito + oro; la mesa lo muestra al momento.
- **Día** — eliges en qué obra gastar, recoges lo que produjo la ciudad, cierras el día y ves tu resultado.
- **2–5 días** — termina una obra y la inauguras.
- **Semana** — evento de la semana (cambia una regla 7 días) y episodio de tu historia.
- **13 semanas** — capítulo con título, objetivo real, gran obra y final.

## Fallas y huecos que hay hoy (se corrigen en J0 y a lo largo del plan)

| Hallazgo | Dónde |
|---|---|
| Se recalcula todo el juego una vez **por componente** (20+ veces por toque en Hoy) | `useGame()`, `apps/web/src/data/store.ts:330-342` |
| El "Reto del día" tipo "Prueba relámpago" nunca se marca como hecho (el id no quita el acento) | `apps/web/src/lib/narrator.ts:278` vs `quickMissionId`, `packages/core/src/engine/reports.ts:165` |
| La hoja "Bienvenido" reaparece en cada visita a Hoy si no guardas la fecha | `apps/web/src/screens/Hoy.tsx:118` |
| Los botones flotantes (micrófono y "+") tapan botones | `.fab` `apps/web/src/styles.css:588`, `.vz-fab` `apps/web/src/styles/voz.css:4` |
| La temporada se puede "cerrar" desde el día 1 y cobrar el logro | `apps/web/src/screens/Temporadas.tsx:65`, `packages/core/src/engine/modules/seasons.ts:41` |
| La misión sorpresa promete oro extra que con misión chica es 0 | `Hoy.tsx:454` |
| El bono de cierre se calcula distinto en dos pantallas | `Hoy.tsx:721`, `apps/web/src/screens/Dia.tsx:208` |
| El "% del día" mide cuánto registraste, no cómo te fue | `packages/core/src/engine/day-review.ts:477` |
| Los 7 atributos no sirven para nada | `packages/core/src/engine/modules/attributes.ts` |
| Tienda vacía y premios por nivel sin definir | `screens/Tienda.tsx:79`, `settings.levelRewards` |
| Hoy no hay temporada (empieza el 23-nov); la diaria "misión en foco" no tiene foco | `packages/core/src/seed/index.ts`, `Temporadas.tsx:197` |
| El gran reto de Hoy es $0 / $100,000: inalcanzable al inicio | `Hoy.tsx:473` |
| Nombres de fantasía sembrados ("El Dragón Financiero", "La Torre del Inglés", "La Parálisis", "Leyenda", "Maestro") | `seed/index.ts:63-111`, `config/game.ts:62`, `types.ts:318` |
| Un compromiso vencido queda abierto para siempre con el oro apartado | `engine/modules/gold.ts:108`, `screens/Retos.tsx:197` |
| No hay recorrido de primer uso; 17 sistemas a la vista en "Más" | `Hoy.tsx:66-75`, `screens/Menus.tsx` |

## Etapas (cada una se entrega y se usa sola)

### J0 · Arreglos y base
1. `useGame()`: una sola proyección por cambio (caché a nivel de módulo por `version + today`).
2. `reduceGold`: `earnedThrough` (`gold.ts:102-106`) pasa a barrido cronológico con acumulado.
3. Reto del día: comparar con `quickMissionId(picked.title)`.
4. Hoja de bienvenida: recordar el cierre en `lib/prefs.ts` (luego la reemplaza el arranque, J4).
5. Fin de temporada: solo en los últimos 7 días (`season.endReviewWindowDays`; regla en `modules/seasons.ts`).
6. Misión sorpresa: prometer oro solo si lo hay.
7. Bono de cierre: un selector `closeBonusOf(state, date)` sobre `state.gold.bonuses`.
8. Botones flotantes: en celular un `ui/ActionDock.tsx` horizontal que se oculta al bajar y con hojas abiertas; en
   computadora, al pie del menú lateral.

### J1 · El día y el regreso
**Motor** — `packages/core/src/engine/modules/days.ts` (`reduceDays`, después de hábitos y antes de logros;
estado `state.days`). Reutiliza `isInRoutine`, `isDailyDone`, `habitSince`, `quickMissionId` y los `DAY_CHECKS`
de `day-review.ts`; no llama `reviewDay` por día.

- **Puntaje del día 0–100** = rutina que tocaba 50 · tus 3 del plan 25 · registro 15 (sueño, gastos, gente,
  tiempo, hábitos a dejar) · cierre 10. Pesos y umbral en `config/game.ts` (`dayScore`, ancla `// [[marcador]]`).
  Sin rutina o sin plan, ese peso se reparte. **Día ganado** con ≥ 70.
- Estados de un día: ganado · **salvado** (hiciste tu "mínimo", una sola cosa que tú defines: no gana, pero
  conserva el impulso) · descanso (neutro, tope de 2 por semana) · **pausa** (dos o más días seguidos sin
  registrar: neutros, sin pendientes) · no ganado. Hoy nunca cuenta como no ganado.
- Solo contadores que suben: "días ganados en el capítulo" y mejor seguidilla. La racha sigue, sin protagonismo.
- Empieza en `settings.scoreStart` (lo fija el arranque). `day.closed` guarda qué diarias tocaban (`routine: id[]`)
  para que editar la rutina no cambie días ya jugados.
- `packages/core/src/engine/next-play.ts`, `nextPlay(state, entities, { hour })`: jugada de regreso → obra por
  inaugurar → almacén por recoger → compromiso vencido → sueño → elegir tus 3 → el pendiente que más suma →
  cerrar el día → planear mañana.

**La mesa** — `Hoy.tsx` se divide (`screens/hoy/cards.tsx`, `screens/hoy/sheets.tsx`):
- Computadora (≥1000 px), tres columnas: el día (`ui/DayRing.tsx` con puntaje, impulso y pesos de hoy; reutiliza
  `ScoreRing` de `ui/HabitBits.tsx:23`; `ui/NextPlay.tsx`; `ui/TodayTiles.tsx`, mosaicos de un toque con tus 3
  primero) · el centro (la ciudad desde J2; antes, el capítulo y la semana) · obras, almacenes, evento y
  compromisos. Requiere `main.wide` y `--main-w` (hoy hay `434px` fijo en `styles.css:189`).
- Celular: anillo, siguiente jugada y mosaicos; lo demás en pestañas **Hoy · Ciudad · Semana · Todo**.
- A "Todo" se van las tarjetas actuales que no son del día (`Hero` completo, `DailyEncounterCard`, `NpcMissions`,
  `PeopleTodayCard`, `FavoritesSection`, `VicesMini`, lección).
- **Título e ícono de la pestaña** cambian con lo que hay ("● Obra lista", "2 por recoger").

**Registrar en 30 segundos** — `ui/DayDeck.tsx` (`openDayDeck({ date })`): una tarjeta a la vez con lo que falta,
usando los `Inline` de `ui/dayCheckActions.tsx` o el formulario del registro rápido (`getQuickEntry(mode)`
exportado de `ui/QuickAdd.tsx`). La última tarjeta es el cierre.

**Resultado del día** — `ui/DayResult.tsx` con `ui/CountUp.tsx` y `ui/ClosureForm.tsx`: puntaje contando →
veredicto → desglose → materiales y oro del día → impulso de mañana → qué obra queda lista mañana → "Planear
mañana" (`openPlanSheet`).

**Pantalla de regreso** — tras una pausa, lo primero que ves es lo que ganaste (almacenes, obras listas) y una
**jugada de regreso**: una acción chica que recupera el escalón de impulso. Nunca una lista de lo que faltó.

### J2 · Tu ciudad
Sistema nuevo `city`, con la receta "Cómo agregar un sistema nuevo" de `CLAUDE.md`.

- **7 distritos = 7 atributos**: Centro (Disciplina), Distrito financiero (Finanzas), Parque deportivo (Fuerza
  física), Campus (Inteligencia), Plaza (Carisma), Barrio (Relaciones), Taller (Creatividad).
- **Edificio principal** por distrito, niveles 1–10: cuesta materiales de su distrito y tarda de 1 a 7 días.
  Cada nivel da +2 % de oro en misiones de ese atributo y produce materiales cada día.
- **Un equipo de obra** al inicio: hay que elegir qué va primero. El segundo se desbloquea.
- **Recolección** de un toque; los almacenes acumulan hasta 3 días.
- **Inaugurar** cuando la obra termina: su momento propio, con postal en "Mi historia".
- Código: eventos `city.build_started`, `city.inaugurated`, `city.collected`, `city.choice` en
  `packages/core/src/events.ts`; catálogo `packages/core/src/engine/city-catalog.ts` (patrón de
  `engine/map-catalog.ts`); números en `config/game.ts` (ancla `// [[ciudad]]`); reductor
  `engine/modules/city.ts` (`reduceCity`, después de atributos; materiales = `AttributeState.xp` + producción con
  tope − gastado; todo por día para seguir siendo derivado); efectos hacia el oro con una función pura
  `cityEffects(city)`, nunca por `ctx.addXp`.
- **La maqueta**: `apps/web/src/city/CityView.tsx` (con `lazy`; `three`, cámara ortográfica, bloques claros,
  grafito y acentos en oro; obras con andamio y días restantes), con el dibujo solo-al-cambiar de
  `apps/web/src/character/stage.ts`. Sin WebGL: lista de distritos y obras. Pantalla
  `apps/web/src/screens/Ciudad.tsx` (`/ciudad`) y columna central de la mesa.
- IA: `packages/core/src/assistant/tools-ciudad.ts` (`ver_ciudad`, `construir`, `recoger`, `inaugurar`).

**Prueba de juego**: al terminar J2 juegas dos semanas de verdad; costos, días de obra y producción se ajustan
con lo que pase antes de seguir.

### J3 · Dinero real
- **Impulso** (en `days.ts`): multiplicador de **oro, nunca de XP**. Días ganados seguidos 0/2/4/7/14 → ×1 / 1.25
  / 1.5 / 1.75 / 2 (`config.momentum`). Un día no ganado baja un escalón; descanso y día salvado lo mantienen;
  una pausa completa baja un solo escalón en total. El multiplicador de un día sale de los días anteriores, así
  que nunca reduce oro ya ganado. En `reduceGold`: `GoldBonus.source: 'momentum'`.
- **Cuenta de gustos (oro = pesos)**: `settings.treats = { pesosPerGold, monthlyCap }`. Un gusto es un
  `expense.recorded` con `treat: { rate }` (un solo registro, con el tipo de cambio guardado). Siempre cuenta: si
  gastas de más queda **deuda** visible (`gold.debt`) que se paga con lo siguiente que ganes. Tope mensual
  obligatorio en la práctica. Entrada "Gusto" en el "+", tarjeta en Semana y en `screens/Tienda.tsx`.
- **Compromisos con dinero**: `pledge.made` gana `pesos` y `payTo` (`stake` 0 permitido si hay pesos), evento
  `pledge.paid`, estado "vencido sin resolver", botones "Ya pagué" y "Avisarle a {compañero}" por WhatsApp
  (`lib/partner.ts`, sacado de `ui/WeekShare.tsx:123`). **El dinero nunca se pierde por ausencia**: solo por una
  apuesta que aceptaste o por gastar de más.
- **Regla de oro 5, nueva redacción**: registrar dinero nunca da ni quita XP; el oro es el único puente y va en
  un solo sentido (desempeño → oro → permiso de gasto, con tope).
- IA e historial: `SNAPSHOT_SCHEMA` 3 → 4 (`assistant/snapshot.ts`), `assistant/tools-marcador.ts`
  (`ver_marcador`), `registrar_dinero` con `gusto`, `cerrar_dia` con `routine`, `describeEvent` y categorías del
  historial. App y servidor MCP se despliegan juntos.

### J4 · Arranque y primeros 90 días
- **Día 0** — `apps/web/src/screens/Arranque.tsx` (`/arranque`, mientras no exista `settings.scoreStart`;
  reemplaza `BirthDatePrompt` y el banner de atributos). Cada paso guarda al momento:
  1. Tú: nombre, fecha de nacimiento, a qué te dedicas.
  2. Punto de partida: los 7 atributos (formulario de `screens/Personaje.tsx:132-167` extraído a
     `ui/AttributeRating.tsx`).
  3. Tu rutina: de las 7 diarias eliges 3–5; y tu "mínimo" para un día malo.
  4. Tu reto principal con un primer hito alcanzable este mes.
  5. Tu dinero para gustos: "¿cuánto gastas al mes?" → tipo de cambio y tope; 3 premios de un toque y el premio
     del nivel 5.
  6. Compañero de cuentas (opcional).
  7. Primera jugada: marcas algo que ya hiciste hoy → primer XP, primeros materiales y **tu primera obra**.
  La temporada 1 se ajusta para empezar ese día.
- **Desbloqueos por nivel** — `packages/core/src/engine/unlocks.ts` (`unlocksFor(level)`, tabla en config; la app
  solo oculta lo que aún no toca):

  | Cuándo (aprox.) | Se abre |
  |---|---|
  | Día 0 | El Centro y tu primera obra |
  | Nivel 2 · día 2 | Primer distrito a elegir y recolección diaria |
  | Nivel 3 · día 5 | Impulso y oro en pesos |
  | Nivel 4 · día 10 | Compromisos con dinero y segundo distrito |
  | Nivel 5 · día 16 | Primer edificio de ventaja y tu primer premio real |
  | Nivel 6 · día 23 | Eventos de la semana y expediciones (justo en la semana 3–4) |
  | Nivel 7 · día 31 | Segundo equipo de obra |
  | Nivel 8 · día 40 | Guardarropa y más distritos |
  | Nivel 9 · día 50 | Contratos semanales con el Coach |
  | Nivel 10 · día 68 | La gran obra del capítulo |
  | Semana 13 | Final de capítulo; el siguiente empieza con una regla nueva |

- **Nombres sobrios**: en `packages/core/src/seed/index.ts` y, para la base que ya existe, una migración nueva en
  `packages/db` que solo renombra si el nombre sigue siendo el original. Propuesta (editable en el paso 4):
  Libertad financiera · Empresa de 100 millones · Papá presente · En forma · Inglés fluido · Decidir rápido ·
  Entregar al 70 %. "Leyenda" → "Referente"; "Maestro" → "Dominio".

### J5 · Tu historia
- **Capítulos**: la temporada de 13 semanas tiene título, objetivo real y una **gran obra** que solo se termina si
  cumples el objetivo. `reduceSeasons` calcula la XP del capítulo y sus escalones
  (`config.season.pass = { tiers: 40, xpPerTier: 350 }`, uno cada ~2 días); cada escalón paga materiales u oro y
  en 10/20/30/40 van premios grandes definidos por ti (`SeasonData.prizes`). Al final: recuento y foto de la ciudad.
- **Eventos de la semana**: `packages/core/src/engine/weekly-events.ts` (tabla + `pickForDate` de
  `engine/reports.ts:177`): una regla que cambia 7 días ("Semana de ventas: Plaza produce doble"). El Coach
  elige de la tabla; sin IA, sale por fecha.
- **Coach como narrador**: `POST /api/gm/brief` en `apps/api/src/gm.ts` (salida estructurada, patrón de `/parse`;
  foto del estado con `readSnapshot`, `apps/api/src/ai/store.ts:37`). **Mañana**: hasta 3 jugadas con el porqué y
  "Aceptar como mis 3" (`savePlan`, `apps/web/src/lib/plan.ts:7`). **Noche**: dos líneas en el resultado.
  **Semana**: episodio de tu historia, evento siguiente y un contrato (compromiso con dinero). Se guarda como
  evento `coach.brief` (el primero del día por tipo gana); máximo 3 llamadas al día; modelo en
  `ANTHROPIC_MODEL_BRIEF`; si falla, resumen local (`buildDailyBriefing`, `lib/narrator.ts:164`). La IA nunca da XP.
- **Mundo abierto**: una expedición por semana a un lugar del catálogo o de una colección
  (`engine/map-catalog.ts`); conocerlo da materiales del Taller y una postal.
- **Mi historia**: línea de tiempo que se llena sola con inauguraciones, primeras veces, niveles y finales
  (`life/milestone`, ya existe).
- **Logros en escalera**: tipos nuevos en `AchievementCondition` (`types.ts:287`) y `evaluate()`
  (`modules/achievements.ts:30`): días ganados, seguidilla, nivel, oro, días cerrados, entrenos, obras
  inauguradas, escalón. De 12 a ~50 (I · II · III) con migración `INSERT OR IGNORE` y en el seed.

### J6 · Tu personaje
- **Edificios de ventaja**: en cada distrito, en niveles 3, 6 y 9 eliges **uno de dos** (Centro: "Comodín" o
  "Arranque rápido"; Distrito financiero: "+10 % de oro en Finanzas" o "tope de gustos más alto"). Cambian reglas
  de oro, impulso u obra, nunca de XP. Cambiar de opinión cuesta materiales y días.
- **Tu estilo** (el subtítulo "Estratega-Constructor") sale de tus dos distritos más desarrollados.
- **Personaje en la mesa**: `CharacterView` con `lazy` y `useMyBody()` (`ui/MuscleBody.tsx:58`); opción ligera
  nueva en `Stage` (`character/stage.ts:97`). Sin WebGL, el monograma.
- **Guardarropa**: prendas y colores que se ganan al inaugurar obras y cerrar capítulos (ids `wardrobe-*`, patrón
  de `lib/themes.ts`); saco y chamarra nuevos en `character/figure.ts`.
- **Dificultad que se ajusta**: dos semanas ganando casi todo → sube el umbral y lo que paga; varios días flojos
  → ofrece "semana ligera" con rutina reducida.

## Cómo se trabaja

- Rama `claude/nice-ride-cye860`; un grupo de commits por etapa; sin pull request salvo que lo pidas.
- Orden: J0 → J1 → J2 → **dos semanas de prueba** → J3 → J4 → J5 → J6. Con J0–J2 ya se puede jugar.
- Textos visibles en español de México, tono sobrio. Pantallas con la guía `frontend-design`; campos de texto
  con `TextInput` / `TextArea` de `ui/kit.tsx`.
- Sin cambios de esquema en D1: solo eventos, ajustes y config. Dos migraciones de datos nuevas (nombres y logros).
- Al cerrar cada etapa: `CLAUDE.md`, README y `docs/sistemas/` (`marcador.md`, `ciudad.md`).

## Verificación

- `pnpm test`, `pnpm typecheck` y `pnpm --filter @igv/web build` en cada etapa.
- `packages/core/test/marcador.test.ts`: reparto de pesos, descanso neutro, día salvado, hoy nunca perdido, pausa
  sin pendientes y con un solo escalón de impulso, escalera del impulso, rutina congelada, 10 años sintéticos.
- `packages/core/test/ciudad.test.ts`: los materiales nunca tocan XP ni oro; una obra no se inaugura antes de
  tiempo; tope de 3 días; prueba de propiedades con eventos aleatorios.
- `golden-rules.test.ts`: agregar gustos, compromisos con pesos, `pledge.paid`, cierre con rutina y eventos de
  ciudad; XP, nivel y atributos idénticos con y sin ellos; `balance ≥ 0`, `debt ≥ 0`, nunca los dos a la vez.
- **Simulación de 90 días** (`packages/core/test/ritmo.test.ts`) con tres jugadores: constante, irregular y uno
  que desaparece 5 días en la semana 3. Debe cumplirse: nunca más de 5 días sin algo que inaugurar o desbloquear;
  el que regresa encuentra recompensa y recupera su ritmo en ≤ 2 días; el oro mensual no pasa del tope.
- `apps/api/test/mcp.test.ts` y `coach.test.ts` para herramientas nuevas y `/api/gm/brief` (API de Claude simulada).
- En vivo, en local (`DEV_BYPASS_AUTH`, base D1 local, nunca la real): día 0 → primera obra → avanzar la fecha →
  inaugurar → ausencia de 5 días → pantalla de regreso. Capturas con Playwright en computadora y celular
  (Android), claro y oscuro.
