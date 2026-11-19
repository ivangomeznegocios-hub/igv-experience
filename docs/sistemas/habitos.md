# Hábitos + "¿Cómo fue tu día?"

Lo que pidió Iván: "Que los hábitos se vayan armando con lo que lleno. Registro todo y la app me dice qué hábitos
estoy haciendo bien y cuáles mal. Y luego: ¿cómo fue tu día?, ¿qué hiciste?, ¿cuánto tiempo?, ¿qué registraste,
qué no, qué faltó? Mucha más profundidad pero fácil de navegar; nada de chapa."

Es un sistema **de solo lectura**: no da ni quita XP, no crea entidades nuevas y solo agrega un tipo de evento
(`day.check_skipped`, "nada que registrar"). Todo sale de `project()` y de los registros del día.

## Qué hace

1. **Hábitos (rutina)** — `packages/core/src/engine/habits.ts`, reductor `reduceHabits` → `state.habits`.
   - Un hábito = una diaria con `routine !== false`. Se respeta su horario (`days`, 0 = lunes; vacío = todos).
   - Solo cuentan los días que le tocaban, **desde que existe** (`habitSince`: día de `createdAt` en CDMX, o el primer
     día de uso de la app si es posterior o no se sabe; si la completaste antes —registro de días pasados— empieza ahí).
   - Los días de descanso válidos (`state.streak.restDays`) no cuentan en contra. **Hoy nunca cuenta en contra.**
   - Lo registrado como "Hice algo" con el mismo título que una diaria (`quickMissionId(título)`) cuenta para esa diaria.
   - Por hábito: cumplimiento en 7 y 30 días (`{ done, due, rate }`), 30 días anteriores, racha actual y mejor (días
     que tocaban seguidos; descansos y días que no tocaban no la rompen), tendencia (`mejorando` / `estable` /
     `empeorando`, en puntos), tira de 30 días (`done | missed | rest | off | extra | before | pending`), cumplimiento por
     día de la semana (8 semanas) y días flojos (`weakDays`: ≤ promedio − 25 pts, con ≥ 2 muestras).
   - Veredicto por los 30 días: **Vas muy bien** ≥ 80 %, **A medias** 40–80 %, **Flojo** < 40 %, **Recién empezado** si
     le tocaron menos de 4 días.
2. **Hábitos que se arman solos** (`state.habits.suggestions`): lo que registraste (misiones rápidas, pendientes con el
   mismo título o diarias fuera de la rutina) en ≥ 3 días distintos de los últimos 14 y que no está en tu rutina →
   "Hazlo hábito". Un toque crea la diaria en la rutina con el mismo título, tamaño y atributo (o mete a la rutina la
   diaria que ya existía) y, si se nota un patrón (un día de la semana repetido ≥ 2 veces en 4 semanas, de 1 a 4 días),
   con esos días. Como conserva el título, su historial de "Hice algo" sigue contando (como `extra` antes de crearse).
   Descartar una sugerencia es una preferencia del dispositivo (`localStorage`, `igv.habits.dismissed`).
3. **Hábitos a dejar** — `engine/modules/vices.ts` (`state.vices[id]`): además de los días sin recaer, días con
   recaída en 30 días y en los 30 anteriores, tendencia (diferencia ≥ 1 recaída por mes), veredicto (0 = vas muy bien,
   1–2 = a medias, 3+ = flojo), recaídas por mes (últimos 6 meses desde que se cuenta), día de la semana en que más
   recaes (≥ 3 recaídas en 90 días, ≥ 40 % ese día) y "una recaída cada N días".
4. **"¿Cómo fue tu día?"** — `engine/day-review.ts`, `reviewDay(input)` (puro, para cualquier día ≤ hoy):
   - Lo registrado, agrupado por área (`DAY_AREAS` + `EVENT_AREAS`; lo desconocido va a "Otros registros"), descrito con
     `describeEvent` de `assistant/format.ts` (cada sistema ya agrega ahí su texto).
   - Revisiones (`DAY_CHECKS`) con su avance de 0 a 1 → **% del día registrado** = promedio de las que aplican.
     "Nada que registrar" (evento `day.check_skipped { checkId, label }`) cuenta como respondida.
   - Tu día en números (XP, misiones, gasto, ingreso, sueño) y el cierre (`day.closed`: ánimo 1–5 + nota).

## Revisiones incluidas (en orden de prioridad)

| id | Área | Aplica | Listo si | "Nada que registrar" |
|---|---|---|---|---|
| `sueno` | cuerpo | siempre | `checkin.morning` ese día | — |
| `actividad` | misiones | si no es descanso | ≥ 1 `mission.completed` | (en la app: "Fue descanso") |
| `rutina` | misiones | si no es descanso y hay diarias que tocaban y ya existían | avance = hechas / que tocaban | — |
| `gastos` | dinero | siempre | `expense.recorded` | "No gasté nada" |
| `gente` | gente | siempre | `npc.interaction` o cualquier registro con `npcId` / `npcIds` | "Nada que anotar" |
| `agenda` | agenda | si hay pendientes de ese día (hoy: también atrasados) | avance = hechos / del día | — |
| `plan` | agenda | si hubo "Tus 3" para ese día | avance = hechas / planeadas | — |
| `habitos-dejar` | hábitos | si hay hábitos a dejar que ya se contaban | `vice.relapse` ese día | "Todo limpio" |
| `cierre` | cierre | siempre | `day.closed` | — |

En Hoy, antes de las 6 pm, la línea "Te falta…" no insiste con el cierre (el % sí lo cuenta).

## Cómo registrar una revisión nueva (otro sistema)

Son **dos entradas** (una en core y otra en la app). Nada más cambia.

1. **Core** — en `packages/core/src/engine/day-review.ts`, agrega un elemento al final de `DAY_CHECKS`. Para el caso
   común ("¿hay un registro de estos tipos ese día?") usa `eventCheck`:

   ```ts
   eventCheck({
     id: 'tiempo',                 // único; también es el `revision` de marcar_nada_que_registrar
     area: 'trabajo',              // un id de DAY_AREAS
     label: 'Tiempo',              // título en la lista
     short: 'cuánto tiempo trabajaste', // para "Te falta: …"
     question: '¿Cuánto tiempo estuviste en la oficina y en qué?',
     types: ['time.logged'],
     applies: (c) => c.weekday < 5 && !c.restDay,   // opcional (por defecto, siempre)
     detail: (c) => `${c.of<{ minutes: number }>('time.logged').reduce((s, e) => s + e.payload.minutes, 0)} min`, // opcional
     skipLabel: 'Hoy no trabajé',  // opcional: permite "nada que registrar"
     tool: 'registrar_tiempo',     // opcional: herramienta de IA para llenarlo
   }),
   ```

   Si el avance es parcial, escribe la revisión completa (`progress(c)` de 0 a 1 y `pending(c)` con títulos). El
   contexto `c` solo trae datos del día y del catálogo (`events`, `of(tipo)`, `list(módulo, tipo)`, `doneOn`,
   `doneEver`, `plan`, `restDay`, `weekday`…) para que funcione igual en la app y en la IA; `c.state` solo existe en
   la app (úsalo únicamente para detalles opcionales). Si tu evento no tiene área, agrégalo a `EVENT_AREAS`
   (`'time.logged': 'trabajo'`); si no, sale en "Otros registros".

2. **App** — en `apps/web/src/ui/dayCheckActions.tsx`, agrega su entrada en `DAY_CHECK_UI` (ícono + acción de un
   toque, o un componente `Inline` para llenarlo sin salir de la pantalla):

   ```ts
   tiempo: { icon: 'clock', action: { label: 'Registrar tiempo', run: ({ date, navigate }) => navigate(`/tiempo?fecha=${date}`) } },
   ```

   Sin entrada, la revisión igual se muestra (con el ícono de su área y, si aplica, "nada que registrar").

Ejemplos para los sistemas en paralelo (ajusta tipos y textos a lo que se integre):

```ts
eventCheck({ id: 'entreno', area: 'cuerpo', label: 'Entrenamiento', short: 'tu entrenamiento', question: '¿Entrenaste?', types: ['workout.logged'], skipLabel: 'Hoy no entrené', tool: 'registrar_entreno' }),
eventCheck({ id: 'tiempo', area: 'trabajo', label: 'Tiempo', short: 'cuánto tiempo trabajaste', question: '¿Cuánto tiempo estuviste en la oficina y en qué?', types: ['time.logged'], applies: (c) => c.weekday < 5 && !c.restDay, skipLabel: 'Hoy no trabajé' }),
// Gente: `place.visited` con `npcIds` ya cuenta para `gente`; basta con EVENT_AREAS: { 'place.visited': 'gente' }.
// Salud: una revisión con applies(c) = hay un chequeo vencido en el catálogo/estado, progress = `health.checkup_done` ese día.
// Aprendizaje y notas de voz: normalmente no son revisiones; con EVENT_AREAS ('learning.test_taken': 'aprendizaje') ya aparecen en "Lo que registraste".
```

## Pantallas

- **`/habitos`** (`screens/Habitos.tsx`): % de la rutina en 30 días (anillo) + cuántos van muy bien / a medias /
  flojos; "Se está volviendo hábito" (Hazlo hábito / descartar); secciones **Lo que estás haciendo bien**, **A medias**,
  **Flojo**, **Recién empezados**: cada hábito con su %, racha, tendencia, "hoy te toca" y tira de 30 días; al tocarlo:
  7 días / 30 días / mes anterior, barras por día de la semana y dónde más fallas. Abajo, resumen de hábitos a dejar
  (lleva a `/enemigos`).
- **`/dia`** y **`/dia?fecha=YYYY-MM-DD`** (`screens/Dia.tsx`): anillo con el % registrado y lo que falta, tu día en
  números, lo ya respondido (tocar un "nada que registrar" lo deshace), **Lo que falta** (cada hueco con su pregunta y
  su acción: sueño y rutina/agenda/plan/recaída se llenan en línea con un toque; gastos, gente y "lo que hiciste" abren
  el "+" en ese día), **Lo que registraste** por área y **¿Cómo te sentiste?** (ánimo + nota = `day.closed`, también
  para días pasados; hoy, al cerrar, ofrece planear mañana). Flechas para ir a días anteriores.
- **Hoy** (`screens/Hoy.tsx`): fila "¿Cómo fue tu día? · 60% registrado · Te falta: …" (lleva a `/dia`), botón
  "Hábitos" en la tarjeta de rutina, una línea de hábitos solo si hay algo que decir (una sugerencia "Hazlo hábito" o un
  hábito flojo/empeorando que hoy toca) y la misma fila dentro de la hoja "Cierre del día".
- **`/enemigos`**: veredicto, recaídas en 30 días contra las 30 anteriores, tendencia, barras por mes y patrón.
- Componentes: `ui/HabitBits.tsx` (anillo, tira, veredicto, tendencia, `makeHabit`, `HabitsHighlight`),
  `ui/DayReview.tsx` (`useDayReview`, `DayReviewRow`), `ui/dayCheckActions.tsx`, estilos en `styles/habitos.css`.

## IA (`assistant/tools-habitos.ts`)

- `ver_habitos` (consultar): cada hábito con %, racha, tendencia y días flojos; sugerencias; hábitos a dejar.
- `revisar_dia` (consultar, `fecha` opcional): % registrado, números, lo registrado por área, lo respondido y lo que
  falta con su herramienta. Pensada para que el Coach pregunte "¿y con quién estuviste hoy?".
- `marcar_nada_que_registrar` (registrar, `revision` = `gastos` | `gente` | `habitos-dejar`): escribe
  `day.check_skipped` (sin XP; se puede deshacer desde la bitácora). No duplica ni lo marca si ya hay registros.
- Foto (`snapshot.habits`): cumplimiento, conteos, cada hábito (sin la tira), sugerencias y análisis de hábitos a dejar.
  El panorama (`renderOverview`) suma una sección "Hábitos (30 días)" y sugiere `revisar_dia`.
- En la IA, el día de descanso se toma de que esté marcado ese día (sin el tope semanal) y las fechas de inicio de los
  hábitos salen de la foto.

## Configuración (`config/game.ts` → `habits`)

`goodRate` 0.8 · `okRate` 0.4 · `minDaysToJudge` 4 · `trendDelta` 0.1 · `trendMinDays` 4 · `weekdayWeeks` 8 ·
`weakDayGap` 0.25 · `suggestMinTimes` 3 · `suggestLookbackDays` 14 · `viceGoodMax` 0 · `viceOkMax` 2 · `viceTrendDelta` 1.

## Pruebas

`packages/core/test/habitos.test.ts`: tasas respetando horario, creación y descansos; tira de 30 días; rachas; hoy
pendiente; tendencia y veredictos; días flojos; sugerencias (ventana, rutina, historial de "Hice algo", diaria fuera
de rutina); hábitos a dejar; revisiones del día (áreas, %, nada que registrar y anulado, rutina por día y creación,
descanso, gente/agenda/plan/hábitos a dejar/cierre, futuro, revisión de otro sistema); que nada de esto da XP; y las
tres herramientas de IA con el almacén en memoria.

## Al integrar (lo que este sistema no pudo tocar)

- `screens/Menus.tsx`: agregar un mosaico **Hábitos** (`/habitos`, ícono `repeat`) — sugerido en Progreso o en Más.
- `App.tsx`: agregar `/habitos` y `/dia` a `PROGRESS`/`WORLD` si quieres que se resalte una pestaña.
- `ui/DaySheet.tsx` (Historial): botón "¿Cómo fue tu día?" → `/dia?fecha=<día>`.
- Subir `SNAPSHOT_SCHEMA` (la foto ganó `habits`).
- Resumir este archivo en CLAUDE.md (reglas: nada de XP; `day.check_skipped`).
