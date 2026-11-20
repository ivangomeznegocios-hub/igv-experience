# Tu ciudad (sistema "ciudad")

Parte del plan de juego (`docs/plan-juego.md`, etapa J2): **algo tuyo que crece**. Lo que haces en la vida real se
vuelve material para construir la ciudad de tu vida: un distrito por atributo, cada uno con su edificio principal
que sube de nivel. Todo es derivado de eventos y **nunca da XP ni oro** (reglas de oro intactas).

## Reglas (números en `config.city`)

- **Inicio**: la ciudad empieza el mismo día que el marcador (`settings.scoreStart`), con el Centro (Disciplina)
  en nivel 1 y los otros seis lotes vacíos.
- **Materiales** de un distrito = 1 por cada XP de su atributo desde el inicio + lo recogido − lo gastado.
- **Obras** (`city.build_started { districtId, level }`): solo cuentan si es el siguiente nivel, el distrito no
  tiene otra obra, hay un equipo libre y alcanzaban los materiales en esa fecha (orden cronológico, como los
  canjes de oro). Cuestan y tardan lo que diga `levels[nivel-1]` (50/1 d … 2,500/7 d).
- **Inaugurar** (`city.inaugurated`): cuando la obra terminó. Hasta entonces el equipo sigue ocupado: es lo que te
  trae de vuelta ("mañana queda lista").
- **Equipos**: `crews` (1) y uno más desde el nivel de jugador `extraCrewAtLevel` (7).
- **Producción**: cada nivel produce `productionPerLevel` (4) materiales al día desde el día siguiente a
  inaugurarlo; el almacén guarda `storageDays` (3) días. `city.collected` recoge todo.
- Lo que no cuenta queda en `state.city.rejected` (no se borra nada).

## Código

- Core: `engine/city-catalog.ts` (distritos), `engine/modules/city.ts` (`reduceCity`, después de atributos) →
  `state.city`. La siguiente jugada (`engine/next-play.ts`) propone inaugurar, recoger y fundar/construir.
- IA: `assistant/tools-ciudad.ts` (`ver_ciudad`, `construir`, `inaugurar`, `recoger_produccion`); la foto de la
  IA trae `city` y `score` (SNAPSHOT_SCHEMA 4).
- App: maqueta 3D en `city/scene.ts` + `city/CityView.tsx` (three.js con `lazy`, cámara ortográfica, dibuja solo
  al cambiar; el lienzo se crea en cada montaje), `ui/CityCard.tsx` (maqueta, acciones y fila de distrito),
  `lib/city.ts` (construir, inaugurar, recoger), pantalla `screens/Ciudad.tsx` (`/ciudad`), tarjeta en la mesa
  (columna central en computadora, pestaña "Ciudad" en celular) y mosaico en "Más".
- Probar sin GPU: Chromium con `--use-gl=angle --use-angle=swiftshader`.
- Pruebas: `packages/core/test/ciudad.test.ts` y la regla de oro (eventos de ciudad aleatorios).

## Pendiente (siguientes etapas)

- J3: efecto de los niveles en el oro (+% en misiones de su atributo) e impulso aplicado al oro.
- J4: desbloquear distritos por nivel de jugador; arranque guiado.
- J6: edificios de ventaja (elegir uno de dos en niveles 3, 6 y 9).
