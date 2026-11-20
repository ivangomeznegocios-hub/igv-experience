# Marcador del día (sistema "marcador")

Parte del plan de juego (`docs/plan-juego.md`, etapa J1). Convierte cada día en una partida: un puntaje de 0 a
100 de **cómo te fue** (no de cuánto registraste), días ganados y un impulso que después multiplicará el oro.
Todo es derivado (nada se guarda) y **nunca da ni quita XP**.

## Reglas

- **Inicio**: solo cuenta desde `settings.scoreStart`. Hoy se fija con "Empezar desde hoy" en la tarjeta del día
  (después lo hará el arranque guiado). Antes de esa fecha nada se juzga.
- **Puntaje** (`config.dayScore.weights`): rutina que tocaba 50 · tus 3 del plan 25 · registro 15 · cierre 10.
  Si una parte no aplica (sin rutina, sin plan, nada que registrar ese día) su peso se reparte entre las demás.
  - Rutina: las diarias que tocaban (misma regla que Hábitos: `isInRoutine` + `since`). Lo registrado como
    "Hice algo" con el mismo título cuenta. Al cerrar el día se congela la lista (`day.closed.routine`), así
    editar la rutina después no cambia días ya jugados.
  - Registro: las revisiones de `config.dayScore.logChecks` (sueño, gastos, gente, tiempo, hábitos a dejar) que
    aplican ese día; "nada que registrar" (`day.check_skipped`) cuenta como registrado.
- **Día ganado** con `winThreshold` (70).
- **Estados**: ganado · salvado (hiciste tu mínimo `settings.dayMinimum`; sin definir, cualquier misión) ·
  descanso · libre (sin rutina ni plan) · pausa · no ganado · pendiente (hoy). Hoy nunca es "no ganado".
- **Pausa**: dos o más días terminados y vacíos seguidos (`pauseMinDays`). Son neutros y no dejan pendientes.
  Los registros automáticos (`bounty.drawn`, etc.) no cuentan como "registraste algo".
- **Impulso** (`config.momentum.steps`, en %): sube por días ganados seguidos (0/2/4/7/14 → ×1 … ×2). Un día
  no ganado baja un escalón (no a cero); descanso, salvado y libre lo mantienen; una pausa completa baja uno
  solo. El primer día después de una pausa, una misión recupera el escalón ("jugada de regreso",
  `state.days.comeback`). El impulso de un día sale solo de los días anteriores. **Todavía no multiplica el oro**
  (eso llega en J3).

## Código

- `packages/core/src/engine/modules/days.ts` → `reduceDays` (después de hábitos, antes de logros) → `state.days`.
- `packages/core/src/engine/next-play.ts` → `nextPlay(state, { hour })`: la siguiente jugada de la mesa.
- App: `ui/DayRing.tsx` (anillo partido por piezas, semana, nivel), `ui/NextPlay.tsx`, `ui/TodayTiles.tsx`,
  `ui/DayDeck.tsx` (baraja: lo que falta, una tarjeta a la vez; al final el cierre), `ui/DayResult.tsx`
  (resultado al cerrar), `TabTitle` en `App.tsx` (el título de la pestaña dice cómo va tu día). Estilos en
  `styles/mesa.css`. Hoy (`screens/Hoy.tsx`) es la mesa: en celular, anillo + jugada + mosaicos y pestañas
  Hoy · Semana · Todo; en computadora (≥1100 px), tres columnas.
- Pruebas: `packages/core/test/marcador.test.ts` y la regla de oro en `golden-rules.test.ts`.
