# Sistema: habilidades (lo que sabes hacer, tu tiempo y biblioteca)

Responde lo que Iván pidió: qué sabe hacer, de qué vive, a qué le dedica su tiempo ("¿cuánto estuviste en la
oficina?"), qué está leyendo, qué ya leyó y qué aprendió. Tres pantallas conectadas por una barra común
(`HubNav`): **Sabes hacer** (`/habilidades`) · **Tu tiempo** (`/tiempo`) · **Biblioteca** (`/biblioteca`).

## Reglas de XP (no cambian las de oro)

- **El tiempo NO da XP** (regla de oro 3: XP por acciones y resultados, no por horas). `time.logged` es solo
  registro; `reduceTime` nunca llama a `ctx.addXp`. Hay prueba: agregar registros de tiempo no cambia el libro de
  XP, los atributos ni el oro.
- Rangos de habilidad: igual que siempre (Aprendiz → Experto → Maestro, en orden, con evidencia escrita,
  `rewards.skillRank` = 100 XP al atributo de la habilidad).
- Biblioteca: terminar un libro sigue dando la XP de una misión de su tamaño, una vez por libro. El **avance**
  (`library.progress`) y las **notas** (`library.note`) **no dan XP** (decisión: evitar XP por "anotar mucho";
  el resultado es terminarlo).

## Eventos (packages/core/src/events.ts, bajo `[[habilidades]]`)

| Tipo | Payload | Notas |
|---|---|---|
| `time.logged` | `{ minutes: int 1–1440, area, skillId?: string \| null, note?: string (≤1000), start?: "HH:MM" }` | Contrato compartido: otros sistemas (revisión diaria) lo leen. `area` ∈ `TIME_AREAS`. La oficina es `trabajo` (el lugar va en `note`). `start` = hora local de inicio, para la línea del día. |
| `library.progress` | `{ bookId, page?: int, percent?: 0–100 }` (al menos uno) | La última versión gana (orden cronológico). Con `BookData.pages` la página se vuelve %. |
| `library.note` | `{ bookId, title?: string, text, page?: int }` | "Lo que aprendí". `title` = título del libro en ese momento (si luego se borra el libro, la nota sigue en "Lo aprendido"). |

`TIME_AREAS` (types.ts): trabajo, estudio, lectura, proyecto, ejercicio, familia, pareja, amigos, casa, traslado,
ocio, otro. Grupos para "en qué se te va el tiempo" (`TIME_AREA_GROUP`): Construir (trabajo, estudio, lectura,
proyecto), Cuerpo (ejercicio), Tu gente (familia, pareja, amigos), Lo demás. El schema repite la lista porque
events.ts no puede importar aquí; una prueba verifica que coincidan. Si agregas un área, agrégala en ambos.

## Entidades (sin módulos nuevos; cambios compatibles hacia atrás)

- `skills/skill` (`SkillData`): + `category?` (`SKILL_CATEGORIES`: negocio, oficio, idioma, tecnologia, deporte,
  arte, hogar, social, otro), `livelihood?` ("De esto vivo"), `notes?` ("Lo que sé de esto"). Las habilidades
  viejas sin categoría se deducen con `skillCategory()` → `guessSkillCategory(nombre, atributo)` (pistas por
  palabra, luego por atributo). Agregar en una línea ("Sé hacer…") usa `SKILL_DEFAULT_RANKS` y
  `SKILL_CATEGORY_ATTRIBUTE`.
- `library/book` (`BookData`): + `pages?`, `skillId?` (la habilidad a la que aporta), `rating?` (1–5, editable).

## Estado derivado

- `state.time` (`engine/modules/time.ts`, `TimeState`): `entries` (todos los registros válidos, en orden de día y
  hora), `byDate`, `todayMinutes`, `todayByArea`, `weekByArea`, `weekMinutes`.
- `state.skills[id]` (`reduceSkills`) ahora existe para TODAS las habilidades y suma: `category`, `minutes`,
  `minutesThisWeek`, `sessions`, `lastPractice` (último registro de tiempo o rango).
- `state.library`: + `progress[bookId]` (`page`, `percent`, `date`, `startedOn`, `updates`), `notes` (más reciente
  primero), `notesByBook`, y `finished[bookId].rating`.

## Funciones puras (`engine/habilidades.ts`, exportadas en `@igv/core`)

`timeEntries(src, from?, to?)`, `timeByArea`, `timeBySkill`, `timeByDay`, `timeByGroup`, `topAreas`,
`dayTimeline(src, date)`, `timeWeekCompare(src, today)` (esta semana, la pasada completa y la pasada "a estas
alturas"), `timeAverages(src, today, días)` (días completos hasta ayer; incluye duración media de un día de
trabajo), `timeInsights(src, today)` ("en qué se te va el tiempo", máx. 5 frases), `fmtHoursMinutes` ("8 h 20
min"), `splitTimerSpan(inicio, fin, tz)` (parte el cronómetro por día local si cruza la medianoche),
`localClock`, `skillCategory`, `guessSkillCategory`, `groupSkillsByCategory`, `bookPercent`. Aceptan eventos
crudos o `TimeEntry` ya convertidos. Números en `config/game.ts` → `timeLog` (máx. por registro, horas para pedir
revisar el cronómetro, días de promedio, % de traslados para avisar).

## Pantallas (apps/web)

- `screens/Habilidades.tsx`: "A qué te dedicas" (de qué vives, top 3 áreas de la semana, qué lees), agregar en
  una línea, habilidades agrupadas por categoría (rango en 3 barritas, tiempo, última práctica, libros). La ficha
  (hoja) conserva el árbol visual de 3 nodos, requisitos y evidencia, más tiempo invertido, "Practicar ahora"
  (cronómetro con la habilidad), "Registrar práctica" (`/tiempo?habilidad=<id>&area=<área>`), "Lo que sé", libros
  ligados y prioridad dentro de la categoría.
- `screens/Tiempo.tsx` (`/tiempo`): cronómetro con atajos ("Llegué a la oficina"…), semana contra semana (por
  área, por habilidad, por día), línea del día con quitar/deshacer, "en qué se te va el tiempo" y promedios.
  `?registrar=1` abre el formulario.
- `screens/Biblioteca.tsx`: Leyendo (barra de avance, última nota, Avance · Anotar · Terminé), Pendientes,
  Terminados por año (estrellas e idea principal) y "Lo aprendido" (todas las notas + ideas principales, con
  búsqueda). Ficha del libro con calificación, habilidad ligada y notas (quitar = anular, con deshacer).
- `ui/quick/TimeQuick.tsx` (`TimeQuick`, props `{ date, setDate, today, onDone }` + opcionales `initialArea`,
  `initialSkillId`): formulario rápido "Tiempo" para el "+"; también arranca el cronómetro.
- Cronómetro: `lib/timeTimer.ts` (localStorage `igv-time-timer-v1`, sobrevive a cerrar la app y se sincroniza
  entre pestañas). `logTimeSpan(inicio, fin, { area, skillId, note })` lo guarda partido por día; Modo enfoque u
  otro sistema puede usarlo. Mientras corre, `ui/habilidades/TimerPill.tsx` (global) muestra el reloj arriba a
  la izquierda en cualquier pantalla menos `/tiempo`. Si lleva más de `timeLog.timerReviewHours`, al detenerlo
  pide revisar la duración.
- Estilos en `styles/habilidades.css` (tokens del tema; prefijo `hab-`).

## Herramientas de IA (`assistant/tools-habilidades.ts`)

`registrar_tiempo` (no duplica el mismo registro, no acepta horas que aún no pasan hoy), `ver_tiempo` (semana vs.
semana, por habilidad, promedios, "en qué se te va", hoy; o un `dia`; o `desde`/`hasta`), `ver_habilidades`,
`guardar_habilidad` (crea/edita con categoría; no permite nombres repetidos), `subir_rango_habilidad` (con
evidencia; no antes del rango anterior), `nota_de_libro`, `avance_de_libro` (un pendiente pasa a "leyendo"),
`ver_biblioteca`. Se editaron en tools.ts: `terminar_libro` (+ `calificacion`, también para uno ya terminado) y
`guardar_libro` (+ `paginas`, `habilidad_id`, `calificacion`). La foto (`snapshot.ts`) suma `time` y amplía
`skills` (categoría, de qué vive, minutos, última práctica) y `library` (avance, notas); el panorama agrega la
sección "Tiempo, habilidades y lectura" y la guía una línea del sistema.

## Pruebas

`packages/core/test/habilidades.test.ts`: validación de eventos, agregaciones de tiempo, línea del día, semana
vs. semana, promedios, cronómetro que cruza medianoche, tiempo sin XP, categorías y agrupación, estado de
habilidades, avance y notas de libros, herramientas de IA con `memoryAssistantStore`, foto y panorama.

## Pendiente para integrar

- Agregar "Tiempo" al menú del "+" (`QuickAdd.tsx`) con `<TimeQuick … />` y una tarjeta "Tu tiempo" en
  `Menus.tsx` (Más) apuntando a `/tiempo` (hoy se llega desde la barra de Habilidades/Biblioteca).
- Revisión diaria: leer `time.logged` con `timeEntries(state.time.entries, día, día)` o `dayTimeline`.
- Opcional: al terminar Modo enfoque, `logTimeSpan(...)` para guardar el tiempo de la sesión.
- Opcional: categoría `tiempo` en `HISTORY_CATEGORIES` de `ver_historial`.
