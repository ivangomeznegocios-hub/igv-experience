# Entrenador personal y nutrición (`coach`)

Tu entrenador dentro de la app: arma un plan **progresivo y basado en evidencia** con tus datos (peso, estatura, edad,
IMC, cintura, nivel, objetivo, días, minutos, lugar y molestias), te dice **qué hacer hoy** (ejercicios, series ×
repeticiones, peso objetivo, reserva, descanso, técnica, cardio y pasos), te habla con una carita según su ánimo y te
pregunta lo que necesita: cómo te sientes, cuánto dormiste, qué comiste, tus medidas y "¿Cómo estuvo tu semana?".
Funciona **sin IA** (todo se calcula en el dispositivo con `coachPlan`); con el Coach con IA activo, además platicas
con él (registra lo que le cuentas e investiga la evidencia en la web).

**Nunca da ni quita XP.** La XP del entreno sigue saliendo de la misión de entrenar y de los récords (ver `entreno.md`).

## Eventos y entidades (`events.ts`, ancla `[[coach]]`)

| Evento | Qué guarda | Regla |
|---|---|---|
| `meal.logged` | `meal` (desayuno/comida/cena/colación), `text?`, `tags[]` (= `MEAL_TAGS`), `proteinG?`, `kcal?` | Se suman en el día |
| `water.logged` | `glasses` (1 vaso = `coach.nutrition.glassMl`) | Se suman en el día |
| `steps.logged` | `steps` | El último del día gana |
| `coach.readiness` | `energy` 1–5, `soreness` 0–3, `pain[]` (= `BODY_AREAS`), `note?` | El último del día gana |
| `coach.checkin` | `weekStart`, `effort` 1–5 (qué tan pesado), `energy`, `mood`, `pain[]`, `wins?`, `struggles?` | El último de esa semana gana |

Ajustes en el catálogo: `training-settings.coach` (`CoachSettings` en `types.ts`): `on`, `name`, `goal`
(`COACH_GOALS`), `level` (`COACH_LEVELS`), `days` (0 = lunes), `sessionMinutes`, `limitations`, `startDate` (semana 1),
`stepsGoal`, `targetWeightKg`, `sex`, `swaps` (patrón → ejercicio). Cambiarlos recalcula el plan; el historial no cambia.
Se usan también `settings.heightCm`, `settings.birthDate`, `body.logged` (peso, cintura, grasa) y `checkin.morning` (sueño).

## Reglas (todos los números en `config/game.ts → coach`)

- **Fases por semanas ENTRENADAS** (≥ `advanceMinSessions` = 2 **días distintos** con entreno de cualquier tipo; fuerza y
  caminata el mismo día cuentan como uno), no por calendario:
  adaptación (semanas 1–2: 2 series, 10–15 reps, 3–4 en reserva, máx. 3 días de fuerza, 90 min de cardio) → base
  (3–6: 3 series, 8–12, reserva 2–3, máx. 4 días, 150 min) → progreso (7+: 6–10 en multiarticulares, reserva 1–2,
  máx. 5 días). En progreso, **descarga** cada `deloadEvery` (6) semanas. El nivel suma semanas de arranque
  (`levelStartWeeks`: sedentario 0, principiante 2, intermedio/avanzado 6).
- **Poco a poco**: una semana con 1 sesión no avanza; después de `detrainAfterWeeks` (1) semana vacía, cada semana sin
  entrenar resta una semana entrenada (al volver, el plan retoma suave). Un check-in con "demasiado" (5), energía ≤ 1
  o molestias no avanza esa semana, y uno con 5, energía ≤ 2 o molestias hace **ligera** la siguiente: la misma fase
  con una serie menos (mín. 1) y una rep más de reserva; conserva rangos, cardio, días y ejercicios. La **descarga**
  real usa sus propios números (`phases.descarga`).
- **Días**: los que elijas (`days`); si eliges más de los que permite la fase, se elige la combinación con más descanso
  entre días de fuerza (contando domingo → lunes; si empatan, la de menos días seguidos): Lun–Vie con máx. 3 = Lun/Mié/Vie;
  los demás son de cardio. Siempre queda al menos un día libre (domingo si no es de fuerza), que nunca se vuelve cardio
  ni recibe la sesión pendiente aunque vayas atrasado (la caminata ahí es opcional). La fila de hoy en la semana
  siempre dice lo que receta la sesión de hoy. Sesiones: 1–3 días = cuerpo completo A/B
  alternando entre semanas; 4 = torso/pierna ×2; 5 = torso, pierna, empuje, jalón, pierna; 6 = empuje/jalón/pierna ×2.
  Si entrenas otro día, la siguiente sesión es la que sigue en orden; la vista de la semana muestra hoy y lo que sigue
  en ese orden real (los días pasados quedan fijos).
- **Ejercicios por patrón de movimiento** (`PATTERNS`: sentadilla, bisagra, glúteo, zancada, press, jalón, remo…):
  primero lo que ya usas (favoritos), luego la lista para principiantes (más estable: goblet, máquina, jalón) o la
  estándar. Fuera del gym solo peso corporal, mancuernas, banda o kettlebell. **Molestias** (`limitations` o lo que te
  duela hoy o en el último check-in; zonas desconocidas se ignoran): se quitan los ejercicios de `JOINT_STRESS` de esa
  zona. Puedes cambiar un ejercicio de un patrón (`swaps`): solo se respeta si cabe en el lugar y tus molestias y no está
  ya en la sesión (las alternativas nunca incluyen lo que ya está en la sesión); si no, va la primera opción válida. La sesión cabe en tus minutos: calentamiento + Σ series × (45 s + descanso), con
  al menos 3 ejercicios.
- **Sobrecarga progresiva** (doble progresión, `progressionFor`): tope del rango en todas las series → sube
  (`increments`: torso 2.5 kg, pierna 5, mancuerna 2, aislados 1/2.5) y vuelve al mínimo del rango; abajo del tope →
  mismo peso y una rep más; muy abajo del rango → baja un escalón; más de `staleDays` (21) sin hacerlo → 90%; primera
  vez → por reserva. Isométricos: +5 s hasta el tope de la fase. Corporales: +1 rep; al tope, hazlo más difícil.
  En **descarga, semana ligera o día ligero** nunca sube: la descarga baja a ~90% (`stalePct`) y las otras conservan
  el peso, con como máximo las reps de la vez pasada (si la meta queda bajo el rango, el rango mostrado la incluye).
- **Hoy**: si dormiste < 5 h o tu energía es 1 → recuperación (caminata suave); < 6 h, energía ≤ 2 o muy adolorido →
  sesión ligera (una serie menos, una rep más de reserva y sin subir peso); si los músculos clave de la sesión siguen
  recuperándose (> `readyWithinHours` = 12 h para estar listos, `muscleStatus`) → cardio hoy y la sesión se recorre al
  primer día, desde que ya se puede, en que el motor receta fuerza (día del plan, u otro solo si ya irías atrasado;
  nunca al día libre). El texto ("mañana", "el viernes" o "a partir de las 5:20" si es más tarde hoy), `today.next` y la
  semana dicen ese mismo día; desde `lateHour` (20 h) pasa al día siguiente. Si cae en la semana que entra, va su
  primera sesión (con la fase de esa semana) y solo la retrasan los músculos de esa sesión. Pasadas las 20 h →
  "haz los 3 primeros". Dolor → aviso de ir a médico/fisio si es
  punzante o dura 1–2 semanas.
- **Cardio**: `phase.cardioMinutes` + bono por objetivo (bajar grasa +60, condición +90), tope 300; repartido en los
  días sin fuerza (20–60 min). Rodilla o tobillo → bajo impacto. Intensidad: zona 2 ("platicar sí, cantar no").
- **Pasos**: meta fija o automática = promedio de 7 días + 1,000 (+ bono por objetivo), entre 5,000 y 10,000;
  sin datos, 7,000.
- **Nutrición**: calorías con Mifflin-St Jeor × factor por días de entreno (1.2–1.725); bajar grasa −20% (máx. −500),
  ganar músculo +10% (máx. +300). Proteína 1.6 g/kg (bajar grasa 2.0, ganar músculo o fuerza 1.8); con sobrepeso
  (IMC ≥ 25) sobre tu peso meta o el de IMC 25. Agua 30 ml/kg (6–12 vasos). Día de comida 0–100 por hábitos:
  proteína 30 (cuenta el mejor de dos criterios: comidas con proteína —etiqueta o ≥ 20 g— o gramos ≥ 90% de la meta;
  anotar gramos nunca baja el día), verdura en 2 comidas 25, fruta 10, agua 20, sin ultraprocesados/refresco 15 (solo
  si hay al menos una comida registrada).
  Porciones con la mano (2 palmas de proteína, 2 puños de verdura…) e ideas de comida mexicana (`FOOD_IDEAS`).
- **Medidas**: toca medirse cada 7 días; tendencia de peso contra el ritmo sano (bajar 0.5–1% por semana, subir
  0.25–0.5%).
- **Check-in**: sábado y domingo (de esta semana) o lunes y martes (de la pasada). `weekReview` da cumplimiento
  (fuerza 40, cardio 20, pasos 15, comida 15, sueño 10) y veredicto subir / mantener / bajar.

## Código

- Core: `engine/modules/coach.ts` (`reduceCoach` → `state.coach`: comidas, agua, pasos, cómo te sientes, check-ins),
  `engine/coach.ts` (`coachProfile`, `planPhase`, `PATTERNS`, `SESSION_TEMPLATES`, `JOINT_STRESS`, `prescribeSession`,
  `progressionFor`, `cardioFor`, `stepsTarget`, `nutritionTargets`, `nutritionDay`, `FOOD_IDEAS`, `weightTrend`,
  `weekReview`, `coachPlan` → todo junto con `brief`: ánimo, saludo, mensaje, extras y acciones).
- IA: `assistant/tools-coach.ts` → `ver_plan_entrenador`, `ver_nutricion`, `ajustar_entrenador`, `registrar_comida`,
  `registrar_agua`, `registrar_pasos`, `registrar_como_me_siento`, `registrar_checkin_semanal`; `coachPlanLines` para la
  foto (`snapshot.coach.lines`; SNAPSHOT_SCHEMA 6, al unirse con los objetivos del mapa, que también subieron a 5) y la sección "## Entrenador personal" del panorama.
  Las herramientas leen el historial de entrenos, medidas y check-ins completo (como la app y la foto: misma fase,
  descargas, lugar habitual y "retoma con X kg"); comidas, agua, pasos, sueño y cómo te sientes, solo ~35 días. Las que
  escriben calculan su respuesta ANTES de guardar (si el Worker se corta no queda nada sin bitácora) y proyectan sin
  series los entrenos de antes de las 2 últimas semanas. `ajustar_entrenador` solo arma el plan con objetivo, nivel,
  días, minutos o `activar: true` ({} es error); `cambiar_ejercicio` reconoce el patrón por clave o nombre y solo acepta
  opciones del patrón que quepan en el lugar (el guardado o el de tus entrenos) y tus molestias, y además lo prueba
  contra la sesión de hoy como "Cambiar ejercicio" en la app: si hoy ese patrón quedaría con otro ejercicio (ya va en
  otro patrón de la sesión, o carga una zona que te molesta hoy o en el último check-in) no lo guarda y dice por qué.
  `registrar_checkin_semanal` acepta hasta un año atrás y no antes de la semana en que empezó el plan, y solo lee el
  registro diario de esa semana (y los días del promedio de pasos).
  Revisión del día: `comida` en `DAY_CHECKS` (solo con el coach activo y desde `coach.startDate`; no entra al puntaje
  del día). Los 5 eventos del coach van en el área "Cuerpo y sueño" (`EVENT_AREAS`) y el agua del día sale en un solo
  renglón.
- API: `/api/gm/ask` con `mode: 'entrenador'` (`ENTRENADOR_SYSTEM` en `apps/api/src/gm.ts`): segundo bloque de
  sistema y la herramienta del servidor `web_search_20260209` con `allowed_callers: ['direct']` (sin filtrado dinámico:
  así `max_uses` = 3 vale para todo el mensaje, porque la API suma las continuaciones del turno; con filtrado dinámico
  serían 3 por request, hasta 27). El bucle reanuda los turnos pausados (`pause_turn`) reenviando el turno tal cual y
  el `container`, conserva el texto de los tramos pausados, une los bloques de texto citados sin saltos a media frase
  (`replyFromBlocks`), usa caché automática del historial entre rondas y devuelve `sources: [{ title, url }]` con las
  fuentes citadas, que `CoachChat` muestra como "Fuentes". Si se acaban las rondas a media búsqueda o con herramientas
  pendientes, la respuesta agrega "Me quedé a medias…" (lo escrito era preámbulo, no la respuesta completa).
- Web: `lib/coach.ts` (`useCoachPlan`, `draftFromCoach`, registros de un toque, `openCoachSheet`), `ui/coach/`
  (`CoachFace` carita SVG con 5 ánimos, `CoachCard` para Hoy y Entrenamiento, `CoachTab`, `CoachSheets` hoja global:
  armar plan, cómo te sientes, check-in, comida, pasos, sueño, medidas y chat; `CoachChat`; `RestTimer`),
  `screens/Nutricion.tsx` (`/nutricion`), `ui/quick/MealQuick.tsx` ("+" → Comida), `styles/coach.css`. En el registro
  de entrenamiento cada ejercicio de la sesión del coach muestra la meta, la nota de progresión, la técnica y el
  cronómetro de descanso (`DraftExercise.coach`, no se guarda; el aviso suena con el audio compartido de `lib/sound.ts`).
  Grupos de botones (escalas, chips, − / +) van en `FieldGroup` de `ui/kit.tsx`, no en `Field` (un `<label>` le pasaría
  el toque de su título al primer botón). "Quitar un vaso" quita UN vaso (si el último registro trae varios, lo anula y
  registra uno con un vaso menos) y su "Deshacer" regresa exactamente ese vaso. Las medidas empiezan vacías ("Último: X")
  y solo se guarda lo que escribes. Los textos se recortan al límite del evento y se validan antes de guardar. Si el
  Coach con IA no responde se muestra "Sin conexión" y se vuelve a preguntar cada 30 s (`useCoachAvailability` en
  `lib/voz.ts`); un fallo al volver a preguntar no tapa lo que el servidor ya había respondido.
  `/entreno?tab=coach` abre la pestaña Coach (la usan el aviso de check-in de "Más" y "Ver tu plan").

## Pruebas

`packages/core/test/coach.test.ts`: esquemas, patrones y plantillas válidos, reductor, fases (adaptación → base,
sesiones sueltas, regresión por semanas vacías, check-in que detiene y aligera, descarga), sesión (adaptación, casa,
molestias en todas las plantillas, minutos, cambios y favoritos, día ligero), doble progresión, plan del día (sin
configurar, día de fuerza, ya entrenaste, sueño muy bajo y bajo, dolor, músculos en recuperación, cardio sin impacto,
metas, check-in y medidas), nutrición (Mifflin, proteína con referencia, día por hábitos), pasos, revisión semanal,
propiedad "registrar comida/agua/pasos/cómo te sientes/check-in nunca cambia XP ni atributos" y herramientas de IA.
Además: semana ligera y descarga sin subir peso, reparto de días, día libre, proteína mixta, días distintos, sesión
recorrida por recuperación (texto, siguiente y semana coinciden; propiedad con 1,500 casos) y zonas desconocidas.
`packages/core/test/coach-ia.test.ts`: historial completo para la IA (paridad con la app), activar el plan, cambiar
ejercicio (patrón, lugar, molestias), check-in fuera de rango, revisión `comida` desde el inicio, áreas del día y
herramientas que no leen después de escribir.
`apps/api/test/coach.test.ts`: modo entrenador (sistema, búsqueda web directa, reanudar `pause_turn` con `container`,
texto citado sin cortes, tramos pausados, fuentes, herramienta del plan).
`apps/web/test/coach-*.test.ts(x)`: registros de un toque (agua y su Deshacer, recortes), hojas (medidas, pasos por día,
grupos sin `<label>`), cambiar ejercicio, chat sin conexión y fuentes.

## Ideas para después

- Fotos de progreso (frente/lado/espalda) junto a las medidas.
- Leer pasos y sueño del teléfono (Health Connect / Apple Salud) en vez de copiarlos.
- Plantillas de comidas frecuentes y escáner de etiquetas.
