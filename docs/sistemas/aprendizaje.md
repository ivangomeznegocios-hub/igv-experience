# Aprendizaje (idiomas y temas)

Mide cómo va Iván en lo que aprende (sobre todo **inglés para hablar, negociar y presentar**): qué ya sabe decir,
qué está aprendiendo, qué le cuesta, **qué errores repite** y cómo suben sus calificaciones. Se practica con
tarjetas de repaso espaciado (sin conexión), en voz alta (reconocimiento de voz en inglés) y con tests de IA que
lo califican. Navegación mínima: una sola pantalla por tema y sesiones a pantalla completa.

## Eventos y entidades

| Qué | Dónde | Notas |
|---|---|---|
| `learning/topic` | `LearningTopicData` (`types.ts`) | `name`, `topicKind` (`idioma`/`materia`/`otro`), `level` (A1–C2 en idiomas, texto en otros), `goal`, `lang` (voz, `en-US`), `attribute` opcional, `archived`. |
| `learning/item` | `LearningItemData` | `topicId`, `itemType` (`frase`/`palabra`/`concepto`), `text` (en el idioma), `meaning` (español), `example`, `tags`, `origin` (`manual`/`inicial`/`test`/`ia`). |
| `learning.reviewed` | `{ itemId, result: 'bien'\|'dude'\|'mal' }` | Un repaso de tarjeta. No da XP por sí solo. |
| `learning.test_taken` | `{ topicId, source: 'ia'\|'tarjetas'\|'voz', score, total, level?, errors[] }` | `score ≤ total ≤ 200`, máx. 50 errores. Cada error: `tag`, `prompt`, `answer` (lo mínimo que dijo mal), `correction` (corrección mínima, p. ej. "depend on"), `explanation?`. |

Sin columnas nuevas en D1 (catálogo JSON).

## Motor (`engine/modules/learning.ts`, puro, con pruebas)

`computeLearning({ events, topics, items, today, cfg })` → `LearningState` (lo usan `project()`, las herramientas de
IA y la foto). `reduceLearning(ctx)` agrega la XP. Texto en `engine/learning-text.ts` (normalizar, similitud, diff).

- **Leitner** (cajas 1–5, intervalos `learning.intervals` = 1/2/4/8/16 días). "Bien" sube una caja **solo si ya
  tocaba** (repasar antes no acelera ni mueve la fecha); "dudé" se queda (y nunca queda en "Lo sé"); "mal" → caja 1.
  Estados: Nuevo (caja 0) · Aprendiendo · **Lo sé** (caja ≥ `masteredBox` = 4, mínimo ~7 días). **Te cuesta** =
  `strugglingMal` (2) "mal" en los últimos `strugglingWindow` (5) repasos. Listas por estado disjuntas.
  `due` = vistas a las que hoy toca repaso; nuevas máximo `newPerSession` (10) al día (`newToday`).
- **Errores que repites**: se agrupan por `etiqueta + corrección` normalizadas (`learningErrorKey`: minúsculas, sin
  acentos ni puntuación, contracciones expandidas). Cuentan una vez por test. `repeated` = 2+ tests; `improving` = no
  apareció en los siguientes `errorClearTests` (2) tests **del mismo tipo** (las tarjetas no "curan" un error de IA).
- Por tema: historial de tests (pct), mejor, último, nivel estimado (último test que lo trae), racha de días de
  estudio (repasos o tests; hoy nunca la rompe).

## XP (reglas de oro)

- Un test o sesión (`learning.test_taken`, cualquier fuente) = acción → XP de misión `learning.sessionSize` (chica,
  10) **una vez por día y tema**, al atributo del tema o `learning.attribute` (Inteligencia). Fuente `learning`.
- **Hitos de dominadas** (`masteryMilestones` 25/100/250/500/1000 → `masteryXp` 50 c/u, una vez). "Dominada" = la
  respondió "bien" en 4 días separados por los intervalos (la cadena de Leitner sin tropiezos) e **ignora los "mal"**:
  así agregar cualquier repaso (aunque sea de otra fecha u otro dispositivo) nunca deshace un hito. Borrar la frase
  tampoco. `masteredEver` nunca baja; `mastered` es "Lo sé" hoy.
- Prueba de propiedades: agregar cualquier evento de aprendizaje nunca baja XP, atributos ni `masteredEver`.

## Tests con IA (`apps/api/src/learn.ts`, `/api/learn/*`, detrás de Access)

- `GET /status` → `{ enabled }`. Sin `ANTHROPIC_API_KEY`: 503 con mensaje en español.
- `POST /quiz` `{ topic, count 3–10, focus?, known[], learning[], errors[] }` → `{ title, questions[] }` (tipos
  `traducir`, `completar`, `opcion`, `corregir`, `responder`; contexto de negocios; ≥⅓ repasa sus errores).
- `POST /grade` `{ topic, questions[] (con answer), knownErrors[], existing[] }` → `{ score, total, estimatedLevel,
  feedback, results[], errors[], suggestions[] }`. **La calificación se cuenta en el servidor** (en blanco = mal).
  `errors` sale listo para el evento. Se pide a la IA reutilizar la etiqueta y corrección de sus errores frecuentes
  para poder contarlos como repetidos. Las sugerencias que ya tiene se filtran.
- SDK oficial, modelo `ANTHROPIC_MODEL` o `claude-opus-5-5`, `output_config.format` (JSON Schema) con esfuerzo
  `low`, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), system con `cache_control`. Sin estado: el
  cliente guarda el resultado como `learning.test_taken`.

## Pantalla (`/aprendizaje`, `screens/Aprendizaje.tsx` + `screens/aprendizaje/Sesiones.tsx`)

- Primer uso: elegir nivel CEFR y "Empezar con Inglés" (casilla opcional: paquete de 32 frases de negocios,
  `seed/learning-starter.ts`, ids fijos `<tema>-ini-NN`, no duplica).
- Hub por tema: nivel, racha, "Ya lo dices / Aprendiendo / Te cuesta", barra al siguiente hito, XP de hoy;
  botones **Repasar tarjetas**, **Test con IA**, **En voz alta**; registro rápido en una línea `frase = significado`;
  "Errores que repites" (badge N× o "Mejorando"); gráfica de tests con IA (escala fija 0–100); lista de frases por estado
  con "Escuchar" (síntesis de voz). Varios temas → pestañas; archivar/reactivar.
- Tarjetas: español → inglés (se puede invertir), Mal/Dudé/Bien (teclas 1/2/3), deshacer el último, al terminar o
  cerrar guarda la sesión (`source: 'tarjetas'`).
- Test con IA: preguntas, enfoque (negociación, juntas, presentaciones, small talk, mis errores); responde escribiendo
  o **dictando en inglés**; resultados con corrección, explicación, "Error repetido: van N veces" y "Agregar a tus
  frases"; guarda `source: 'ia'` con "Deshacer".
- En voz alta: frase en español → la dice en inglés (`lib/vozIdioma.ts`, `en-US`, resultados parciales); similitud
  normalizada (`learningSimilarity`: 70 % palabras, 30 % letras; `voicePass` 0.85, `voiceClose` 0.6) y diff palabra
  por palabra. Cuenta el primer intento (repaso bien/dudé/mal); los fallos se guardan como errores
  (`pronunciación` o `vocabulario`). Sin reconocimiento de voz: se escribe.
- Estilos en `styles/aprendizaje.css` (solo tokens). Cliente HTTP en `data/aprendizajeApi.ts`.

## Herramientas de IA (`assistant/tools-aprendizaje.ts`)

`ver_aprendizaje` (consultar: lo que sabe, le cuesta, errores que repite, últimos tests, racha; `ver_frases` lista
ids), `agregar_frase` (1–25, no duplica; tema por defecto el único activo o Inglés), `guardar_tema` (CEFR validado,
no duplica nombre, `archivar`), `registrar_test` (para tests hechos en el chat: XP una vez por día, avisa errores
repetidos). Foto: `snapshot.aprendizaje` (opcional; fotos viejas no lo traen) y sección "## Aprendizaje" del panorama.
Línea en la guía (`APRENDIZAJE_GUIDE`) que explica cómo hacerle un test en el chat.

## Pruebas

`packages/core/test/aprendizaje.test.ts` (Leitner, Te cuesta, errores repetidos y "mejorando", XP por día y tema,
hitos que nunca se pierden, propiedad de XP, texto/voz, paquete inicial, herramientas con el almacén en memoria) y
`apps/api/test/learn.test.ts` (API de Claude simulada: 503, Access, salida estructurada y respaldo, recorte, errores
502/422/429, calificación contada en el servidor, sugerencias filtradas).

## Pendiente de integrar

- Acceso en `screens/Menus.tsx` (p. ej. en Progreso o Más: `<Tile to="/aprendizaje" icon="translate" title="Aprendizaje" … />`)
  y `'/aprendizaje'` en `PROGRESS` o `WORLD` de `App.tsx`.
- No hace falta subir `SNAPSHOT_SCHEMA`: `aprendizaje` es opcional y la huella de `config/game.ts` ya cambió (las fotos viejas se recalculan).
- Opcional: categoría `aprendizaje` en `HISTORY_CATEGORIES` de `ver_historial` y `learning` en `DELETABLE` de `borrar_elemento`.
