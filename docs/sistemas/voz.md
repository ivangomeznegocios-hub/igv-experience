# Voz y registro automático (`voz`)

Iván usa mucho la voz: este sistema le deja **hablarle a la app** y que todo quede guardado casi sin teclear. No da
XP por sí mismo: convierte lo que dice en los registros de siempre (misiones, dinero, sueño, peso, personas,
lecciones, agenda), que dan su XP normal.

## Qué hace

- **Botón "Hablar"** (micrófono) encima del "+", en todas las pantallas salvo el Coach (igual que el "+").
  Un toque abre la hoja **Cuéntame** y ya está escuchando (el dictado arranca dentro del mismo toque porque los
  navegadores lo exigen). Por qué un botón aparte y no "mantener presionado el +": se descubre solo, es un toque
  (sin gesto que aprender), no choca con el toque normal del "+" y queda en la misma zona del pulgar.
  También hay un botón grande "Cuéntame" arriba del menú del "+", y `/?accion=hablar` la abre (acceso directo).
- **Cuéntame**: micrófono grande, texto en vivo (editable), "Guardar".
  1. Siempre guarda lo dicho tal cual (`note.captured`): nunca se pierde.
  2. Con Coach activado y conexión → `/api/gm/ask` con `mode: 'dictado'`: el Coach registra todo con sus
     herramientas SIN preguntar (salvo algo esencial) y responde "Registré: … / No entendí: …". Cada acción sale
     con "Deshacer" (`api.aiUndo`). Como cada sistema agrega sus herramientas de IA, el dictado registra también
     entrenos, visitas, tiempo, salud… sin tocar este sistema.
  3. Sin Coach, sin conexión o si el Coach falla → **analizador local** (`parseDictation`, puro, en el
     dispositivo): tarjetas de propuestas con ✓ de un toque, ✕ para quitar, tocar para corregir y "Guardar todo".
  4. **Notas por procesar** (dentro de Cuéntame): las notas `pendiente` con "Procesar" (Coach si se puede; si no,
     aquí) y "Descartar". Una nota vieja se procesa relativa a SU día ("ayer" = el día anterior a la nota).
- **Registro rápido (+)**: menú data-driven (`QUICK_ENTRIES` en `ui/QuickAdd.tsx`, con anclas por sistema);
  micrófono en los campos principales (Hice algo, Monto + concepto —"350 de gasolina" llena todo—, Lección, Nota de
  persona, Por hacer); en "Hice algo" y "Por hacer" el tamaño y el atributo se **sugieren mientras escribes**
  (`inferMission`) y él puede cambiarlos.
- **Coach → Registrar mi día** usa las mismas tarjetas (`ui/Proposals.tsx`).

## Eventos (no dan XP)

| Tipo | Payload | Notas |
|---|---|---|
| `note.captured` | `{ text, source: 'voz'\|'texto', handled: 'coach'\|'local'\|'pendiente' }` | `pendiente` = falta procesarla. Sin Coach configurado nace `local`. |
| `note.processed` | `{ noteId, via: 'coach'\|'local'\|'descartada' }` | Cierra una nota pendiente. Cuenta el primero; anularlo la regresa a pendientes. |

Estado: `GameState.notes` (`engine/modules/notes.ts`): `pending` (más reciente primero), `total`, `resolved`.
Foto para la IA: `snapshot.notes?` (`pending`, `latest`; opcional porque las fotos viejas no la traen; al integrar
conviene subir `SNAPSHOT_SCHEMA`). `renderOverview` avisa "Notas por procesar: N".

Los registros que salen de una propuesta usan los eventos de siempre: `mission.completed` (diaria/agenda del
catálogo o misión rápida), `income.recorded`, `expense.recorded`, `checkin.morning` (sueño), `body.logged` (peso),
`rest_day.marked`, `npc.interaction` (con `channel` si el sistema de personas ya lo acepta; si no, se ignora),
`lesson.written`, `goal.progress` y una entidad `planner/todo` (pendiente de agenda).

## Analizador local (`packages/core/src/voice/`)

- `text.ts`: normalizar, tokens, raíces ligeras (pretérito → infinitivo: "entrené" ≈ "entrenar", "pagué" ≈
  "pagar"; sinónimos gym = gimnasio = ejercicio = entrenar), números en palabras y dígitos ("mil quinientos",
  "$1,500", "15 mil", "3 lucas", "ochenta y dos punto cinco", "seis y media"). Exporta `parseSpanishNumber`.
- `infer.ts`: `inferMission(título, historial)` → `{ size, attribute, source }`. Primero su historial (mismo
  título → lo que eligió; parecido ≥ `voz.historyMatch` → igual), luego diccionario de palabras clave (pesos:
  actividad física clara 2, personas 1.5, resto 1, verbos genéricos 0.5), si no `chica · Disciplina`. Tamaño:
  conservador (grande solo para resultados claros como "cerré una venta"; épica nunca).
- `parse.ts`: `buildVoiceContext(eventos, entidades, hoy)` (misiones completables + agenda, personas con
  `role`/`circle` si existen, historial y categorías de gasto) y `parseDictation(texto, ctx)` →
  `{ proposals, unknown }`.
  - Parte en frases por puntuación y conectores, y **sin puntuación** (así llega el dictado) corta donde empieza
    otro verbo conjugado o un pendiente ("…gym gasté…", "…mi novia mañana tengo que…"). No corta números ("treinta
    y cinco", "seis horas y media"), listas de personas ("mi papá, mi mamá y mi hermano") ni subordinadas.
  - Detecta: lección ("aprendí que…", y se lleva el tropiezo previo) · pendiente ("mañana/tengo que/no olvidar/el
    viernes…" → agenda) · negaciones (no registra lo que NO hizo) · descanso · sueño · peso · gasto/ingreso (monto,
    concepto, categoría: primero la que él ya usó para ese concepto, luego diccionario con SU nombre de categoría si
    ya existe; "…y 150 de uber" hereda el tipo; "cerré una venta" = ingreso + misión) · personas (por nombre y por
    papel: "mi papá", "mi novia", "mis papás"; canal llamada/mensaje/persona; varias que encajan → alternativas) ·
    diaria ligada a la persona ("estuve con mi hijo" → "Tiempo de calidad con mi hijo") · misión del catálogo por
    parecido (`voz.missionMatch`; títulos con "o" valen por opción) · si no, misión rápida (`quick-<título>`) con
    tamaño/atributo de `inferMission`.
  - Fechas: hoy, ayer, antier, anoche (sueño = hoy), mañana, pasado mañana, hace N días, el lunes… Se quedan para
    las frases siguientes, salvo la de un pendiente.
- Configuración: `GAME_CONFIG.voz` (`missionMatch`, `historyMatch`, `historyDays`).

## Dictado en el navegador (`apps/web/src/lib/voice.ts`)

`Dictation` + `useDictation`: `SpeechRecognition`/`webkitSpeechRecognition` en es-MX, texto en vivo (`interim`),
reinicio automático cuando el navegador corta por silencio (máx. 6 en 8 s), modo no continuo en Android (Chrome
Android repite resultados en continuo), quita repetidos dentro de una sesión, `stopAndFlush()` para no perder las
últimas palabras al guardar, un solo dictado a la vez, errores claros en español (permiso, sin micrófono, sin
internet, sin soporte). Si Safari no deja reiniciar sin toque, se detiene sin error. `useVoiceInput` se conserva.

## IA (`assistant/tools-voz.ts`)

`ver_notas` (consultar), `guardar_nota` y `marcar_nota` (registrar). Línea en `GUIDE_SYSTEMS`.
Coach: `apps/api/src/gm.ts` → `mode: 'dictado'` agrega `DICTADO_SYSTEM` como segundo bloque de sistema (no rompe la
caché del primero) y envuelve lo dictado con la fecha; en solo lectura responde 409 `code: 'read_only'` (la app deja
la nota pendiente y propone registros locales).

## Archivos

- Core: `src/voice/{text,infer,parse,index}.ts`, `src/engine/modules/notes.ts`, `src/assistant/tools-voz.ts`
  (+ anclas en events, config, project, index, tools, format, snapshot).
- API: `src/gm.ts` (modo dictado).
- Web: `lib/voice.ts`, `lib/voz.ts` (aplicar propuestas, notas, Coach), `ui/Cuentame.tsx` (botón + hoja),
  `ui/Proposals.tsx` (tarjetas + acciones del Coach), `ui/MicButton.tsx`, `ui/QuickAdd.tsx`,
  `screens/GameMaster.tsx`, `styles/voz.css`. Montado en `App.tsx` (`<Hablar />`).

## Reglas

- Nada se registra sin que él lo diga: el Coach no inventa; el analizador local solo propone y él confirma.
- Lo dicho se guarda siempre (`note.captured`), aunque no se entienda nada.
- No duplica: misma misión el mismo día (o una no repetible ya hecha), mismo descanso o misma persona el mismo día
  salen marcadas "Ya estaba registrada".
- Registrar dinero no da XP (regla 5); "cerré una venta" da XP por la misión, no por el monto.

## Pruebas

- `packages/core/test/voz.test.ts`: números, partir frases (con y sin puntuación), `inferMission` (diccionario,
  pesos, historial), contexto, `parseDictation` con frases reales en español de México, notas en `project()` y las
  herramientas de IA.
- `apps/api/test/coach.test.ts`: modo dictado (bloque de sistema, texto envuelto, herramientas), conversación normal
  sin el bloque, 409 en solo lectura y validación.

## Para integrar

- Manifest (`apps/web/vite.config.ts`, `shortcuts`): agregar `{ name: 'Hablar', url: '/?accion=hablar' }`.
- Formularios `ui/quick/<X>Quick.tsx` de otros sistemas: importarlos bajo su ancla al inicio de `QuickAdd.tsx` y
  agregar `{ mode, icon, label, Form }` bajo su ancla en `QUICK_ENTRIES`.
- Subir `SNAPSHOT_SCHEMA` una vez (la foto ganó `notes`).
- `voz.css` da más espacio al final de la página en celular (`.main` con el micrófono presente) para que nada quede
  tapado por los dos botones flotantes.
