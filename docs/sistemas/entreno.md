# Entrenamiento (`entreno`)

Registro de entrenamientos estilo app de fitness, con análisis basado en evidencia: qué hiciste, dónde, qué
músculos trabajaste, cuáles te faltan esta semana, cuándo está recuperado cada uno y cuál es la siguiente sesión.
Pantalla `/entreno` (Entrenamiento). Mapa del cuerpo 2D (frente y espalda) dibujado en SVG; los mismos datos
quedan listos para pintar el personaje 3D más adelante (sin tocar `apps/web/src/character/`).

## Eventos y entidades

- **`workout.logged`** (`events.ts`): `kind` (fuerza, cardio, movilidad, deporte, clase, caminata, otro), `title?`,
  `where?` (gym, casa, parque, calle, alberca, cancha, otro), `placeId?` (lugar del mapa, `map/place`), `minutes?`,
  `rpe?` (1–10), `note?`, `routineId?`, `missionEventId?` (la `mission.completed` que se registró junto) y
  `exercises[]`: `{ exerciseId, name, primary?, secondary?, sets[] }`; cada serie `{ reps?, kg?, sec?, min?, km? }`
  (≥ 1 valor positivo). Sin ejercicios necesita `minutes`. Las listas de `kind`/`where` están escritas en el esquema
  y en `types.ts` (`WORKOUT_KINDS`, `WORKOUT_PLACES`); hay prueba de que coinciden.
- **Entidades** (`ENTITY_KINDS.training`): `training/exercise` (ejercicio propio: `name`, `primary`, `secondary?`,
  `measure`, `equipment?`; id estable `ex-<nombre>`), `training/routine` (rutina: `name`, `kind?`,
  `exercises[{ exerciseId, name, sets, reps? }]`), `training/settings` (id `training-settings`: `missionId?` = diaria
  que cuenta al entrenar, `where?` = lugar habitual).
- Los entrenamientos de texto libre viejos (`body.logged.workout`) cuentan como sesión sin músculos
  (`source: 'cuerpo'`, tipo adivinado por palabras: correr → cardio, yoga → movilidad…).

## Biblioteca (`packages/core/src/training/library.ts`)

17 grupos musculares (`MUSCLE_IDS` en `types.ts`): pecho, espalda (dorsales y espalda alta), trapecio, hombro
frontal / lateral / posterior, bíceps, tríceps, antebrazo, abdomen, oblicuos, lumbar (espalda baja), glúteos,
cuádriceps, isquios, aductores, pantorrillas. `MUSCLES[id]`: nombre, tamaño (grande/chico → recuperación), grupo
(empuje / jalón / pierna / core), accesorio (trapecio, antebrazo, oblicuos, lumbar, aductores: piden menos series
directas), vistas y `anatomy` (músculos anatómicos, guía para el 3D).
~80 ejercicios (`EXERCISE_LIBRARY`) con equipo, forma de medir (`peso` reps×kg, `corporal` reps, `tiempo` s,
`distancia` min/km), músculos principales y secundarios y alias. Búsqueda aproximada: `searchExercises`,
`matchExercise` (acentos, plurales, alias, errores de dedo: "hip trust" → Hip thrust). La biblioteca es código: si
se corrige un ejercicio, el análisis de todo el historial se recalcula. Para músculos: biblioteca > ejercicio propio
vigente > músculos guardados en el registro (si borraste el ejercicio propio).

## Reglas y números (todo en `config/game.ts → training`)

- **Series**: una serie dura (reps > 0 o segundos > 0) cuenta 1 para cada músculo principal y
  `secondaryFactor` = 0.5 para cada secundario. El cardio (distancia) no cuenta series: suma minutos de cardio.
- **Volumen semanal** (lunes a domingo): principales `weeklySets` 6 mínimo · 10 objetivo · 20 máximo; accesorios
  `accessoryWeeklySets` 3 · 6 · 16. Nivel 0–4: nada, bajo el mínimo, efectivo, objetivo, más del máximo.
- **Frecuencia**: `minFrequency` 2 veces por semana (días distintos con ≥ 1 serie efectiva). Un músculo trabajado una
  sola vez pide al menos un bloque más en la sesión sugerida.
- **Recuperación**: tras una sesión con ≥ `recoveryMinSets` (3) series efectivas del músculo: 72 h grandes (pecho,
  espalda, lumbar, glúteos, cuádriceps, isquios), 48 h chicos. Estados: `recuperando` (con % y hora de listo),
  `listo`, `olvidado` (≥ `forgottenDays` = 8 días o nunca). La hora del entrenamiento es la de registro si fue ese
  mismo día; si no, las 18:00 de ese día.
- **Cardio**: `cardioMinutes` 150 mínimo / 300 objetivo por semana (OMS). Cuentan los minutos de ejercicios de
  distancia; sin ellos, la duración de un entreno de cardio, deporte, clase o caminata.
- **Equilibrio** (`balanceDays` 14): promedio de series por músculo principal de empuje vs. jalón y torso vs. pierna;
  avisa si uno supera al otro × `balanceRatio` 1.5 y el lado fuerte tiene ≥ `balanceMinSets` 12 series.
- **Semanas seguidas**: semanas con ≥ `streakMinSessions` 2 sesiones; la semana en curso no rompe la cuenta.
- **Sesión sugerida** (`suggestSession`): plantillas cuerpo completo / torso / pierna / empuje / jalón. Solo las que
  tienen sus músculos clave recuperados; gana la que cubre más series atrasadas (con tope de una sesión: 20 series,
  `perMuscle` por plantilla); a igualdad, la de clave más atrasada y luego ese orden. Los ejercicios salen por
  patrón de movimiento (sentadilla, bisagra, press horizontal, jalón vertical, remo…), tus favoritos primero, nunca
  con un músculo principal en recuperación; fuera del gym, peso corporal / mancuernas / banda / kettlebell. Si todo
  se está recuperando o ya cubriste el volumen: cardio (si falta) o descanso.
- **Récords** (`ExerciseRecord`): 1RM estimado con Epley `kg × (1 + reps/30)` (hasta 20 reps), peso máximo, más reps,
  volumen de sesión, segundos, km y ritmo; historial por sesión para la gráfica (`progressSeries`).

## XP (reglas de oro intactas)

- Un entrenamiento **no da XP por sí solo**. La app (y la IA) registran junto una `mission.completed`: la diaria
  elegida en Ajustes de entrenamiento o, por defecto, la misión rápida "Entrenar" (`quickMissionId('Entrenar')`,
  media · Fuerza física, `config.training.mission`). De ahí salen XP, racha, oro y atributos. Si esa misión ya contó
  ese día no se registra otra. "Deshacer" anula ambos; anular un entrenamiento desde el historial anula su misión solo
  si no hay otro entrenamiento ese día.
- **Récord personal** (fuente `training_record`, `config.training.record`): misión chica (10 XP, Fuerza física) cuando
  un registro supera la mejor marca (1RM estimado, reps, segundos o km según el ejercicio) de los registros
  **anteriores por orden de registro** con fecha igual o anterior, y ya había al menos uno. Máximo uno por ejercicio
  por día y `maxPerDay` (3) por día. Así agregar un registro nunca le quita un récord (ni XP) a otro y una foto de
  una fecha pasada no depende de lo posterior (hay prueba de propiedades).

## Código

- Core: `training/library.ts` (músculos, ejercicios, búsqueda), `engine/modules/training.ts` (`reduceTraining` →
  `state.training`: `workouts`, `records`, `custom`, `settings`, `summary`), `engine/training.ts` (análisis con hora:
  `muscleStatus`, `trainingAnalysis`, `suggestSession`, `SPLITS`/`SPLIT_SLOTS`, `progressSeries`, `wouldBeRecords`,
  `trainingMission`).
- **Para el personaje 3D**: `muscleStatus(state.training.summary, nowIso)` devuelve por músculo `load` (0–1, volumen
  de la semana contra el objetivo), `fatigue` (0–1, 1 = recién entrenado fuerte), `volumeLevel` (0–4) y `state`;
  `MUSCLES[id].anatomy` dice qué músculos anatómicos agrupa cada zona.
- IA: `assistant/tools-entreno.ts` → `registrar_entrenamiento` (ejercicios por nombre aproximado, series o atajo
  `n_series`/`reps`/`kg`, cardio con `minutos`/`km`, ejercicio nuevo con `musculos` → se crea `training/exercise`;
  todo o nada; crea entreno + misión como la app; avisa récords) y `ver_entrenamiento` (estado por músculo, te falta,
  equilibrio, sesión sugerida, recientes, rutinas; con `ejercicio`, récords y progreso). La foto para la IA lleva
  `training` (= `state.training.summary`) y el panorama una sección "## Entrenamiento".
- Web: `screens/Entreno.tsx` (pestañas Semana · Historial · Récords · Rutinas), `ui/BodyMap.tsx` (SVG frente/espalda,
  colores por volumen o recuperación), `ui/quick/WorkoutQuick.tsx` (`WorkoutQuick` para la hoja "+", `WorkoutForm`,
  `ExercisePicker`, `Stepper`), `ui/WorkoutSheet.tsx` (hoja global; se abre con `openWorkout({ draft?, date? })` de
  `lib/entreno.ts`), `lib/entreno.ts` (borradores: repetir último, rutina, sugerida; guardar/anular; borrador en
  `localStorage` por si cierras la hoja a medias), `styles/entreno.css`. Tarjeta en `screens/Cuerpo.tsx`.

## Pruebas

`packages/core/test/entreno.test.ts`: esquema y biblioteca, búsqueda aproximada, series por músculo y semana,
cardio, texto libre de Cuerpo, ejercicios propios, semanas seguidas, recuperación 48/72 h, olvidado, te falta,
equilibrio, sesión sugerida (vacío, torso/pierna/empuje ayer, volumen cumplido, en casa), Epley y récords, XP por
récord (primero no, uno por ejercicio por día, tope diario, registros atrasados, fotos pasadas), propiedad "agregar
cualquier entrenamiento nunca baja XP ni atributos", misión ligada, y herramientas de IA con el almacén en memoria.

## Pendiente para integrar

- `WorkoutQuick` en la hoja "+" (`ui/QuickAdd.tsx`) y un acceso a `/entreno` en `screens/Menus.tsx`.
- En Hoy: al completar la diaria de entrenar, ofrecer `openWorkout({ date })` para registrar el detalle.
- Etiqueta de la fuente `training_record` ("Récord") en los mapas `SOURCE_LABEL`/`SRC` de `ui/DaySheet.tsx`,
  `screens/Personaje.tsx` y `screens/Estadisticas.tsx`, y `workout.logged` en `describeEvent` de `ui/DaySheet.tsx`.
- `QuickAdd` → Cuerpo aún tiene el campo de entrenamiento en texto libre: se puede quitar (sigue contando si existe).
