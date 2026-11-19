# Salud (`salud`)

Chequeos preventivos con fecha siguiente ("ya te toca"), mediciones con rango de referencia y ficha médica para
emergencias. Idea del usuario: "ya toca hacer ciertas cosas"; que se sienta como juego (puntaje, XP, "ya lo hice")
pero sin relleno. Todo texto visible es sobrio, en español de México, y siempre con la nota
**"Orientación general; no sustituye a tu médico."** (`HEALTH_DISCLAIMER`). Nunca diagnostica.

## Entidades (módulo `health`)

| Kind | Id | Datos |
|---|---|---|
| `checkup` | `chk-<sugerencia>` (fijo al activar una recomendación) o `chk-<aleatorio>` | `CheckupData`: `name`, `category` (`estudios`, `consulta`, `dental`, `vista`, `piel`, `vacuna`, `otro`), `everyMonths` (0 = una sola vez), `active`, `size?` (XP; por defecto `health.checkupSize`), `lastDone?` (fecha anotada a mano, **sin XP**), `notes?`, `suggestionId?` |
| `profile` | `health-profile` (`HEALTH_PROFILE_ID`) | `HealthProfileData`: tipo de sangre, alergias, padecimientos, medicamentos, médico y teléfono, aseguradora y póliza, contacto de emergencia, notas |

Tipos en `packages/core/src/types.ts` (sección `[[salud]]`).

## Eventos

- `health.checkup_done { checkupId, name?, size?, note?, result? }`: hice un chequeo. Guarda **nombre y tamaño del
  momento** (como `mission.completed`): editar o borrar el chequeo no cambia el historial ni la XP; cambiar la config
  sí recalcula.
- `health.metric { kind: 'presion'|'glucosa'|'colesterol'|'frecuencia_reposo'|'otro', value, value2?, unit?, label?, note? }`.
  Presión: `value` = sistólica, `value2` = diastólica (obligatoria y menor). `otro` exige `label` (p. ej.
  "Triglicéridos") y unidad libre. Solo registro.

## Reglas (reductor `engine/modules/health.ts`, guía pura en `engine/health.ts`)

- **XP**: hacer un chequeo da la XP de una misión de su tamaño (`size` del registro, o `health.checkupSize` = media,
  30 XP) al atributo `health.attribute` (Fuerza física: la salud física es "Evolución física"), fuente `health`.
  **Una vez por chequeo por día**: si hay varios registros del mismo chequeo el mismo día cuenta el de más XP
  (empate: el primero registrado), así agregar un registro nunca baja la XP (prueba de propiedades). La XP no
  depende del catálogo.
- Mediciones, ficha médica y `lastDone` anotado a mano: **sin XP**.
- **Fecha siguiente** = última vez + `everyMonths` (`addMonthsClamped`: 31 ene + 1 mes = 28/29 feb). Última vez =
  el registro más reciente o `lastDone`, el que sea más nuevo.
- **Estado** (`checkupTiming`): `atrasado` (ya pasó la fecha) · `pronto` (faltan ≤ `health.soonDays` = 30 días,
  incluye hoy) · `al_dia` · `sin_registro` (sin registro ni fecha anotada). De una sola vez y ya hecho = al día.
- **Puntaje** (`state.health.score`): % de chequeos activos que no están atrasados ni sin registro
  (al día + te toca pronto). `null` si no hay activos. Los pausados (`active: false`) no cuentan.
- Config en `config/game.ts` → `health` (`checkupSize`, `attribute`, `soonDays`).

## Estado derivado (`state.health`)

`checkups` (por id: estado, `nextDue`, `daysLeft`, `elapsed`, `timesDone`, `doneToday`, `xp`), **`due`** (activos
atrasados o que tocan en ≤ 30 días, atrasados primero: `{ checkupId, name, category, status, nextDue, daysLeft, xp }`),
`unknown` (ids sin registro), `score`, `counts`, `history` (chequeos que contaron, del más reciente), `doneThisYear`,
`xpThisYear`, `metrics` (series por clave: `presion`, `glucosa`, …, `otro:<nombre normalizado>`, cada entrada con
`level`/`levelText` de referencia) y `card` (ficha médica o `null`).

**Para integrar en Hoy / revisión del día**: `state.health.due` es la lista lista para mostrar ("Ya te toca:
Limpieza dental, atrasada 16 días · +30 XP") con enlace a `/salud`. `state.health.unknown` son los que no tienen
fecha (mejor mostrarlos solo en /salud para no saturar Hoy).

## Recomendaciones (`HEALTH_SUGGESTIONS`, `healthSuggestionsFor(birthDate, today)`)

Para un hombre adulto, con base en guías públicas (USPSTF, ADA, AHA/ACC, esquema de vacunación del adulto):
limpieza dental (6 meses), chequeo general con laboratorios — glucosa, lípidos, biometría, orina — (12), toma de
presión (12), vista (24), lunares y piel (12), influenza (12, oct–nov), Td (120), próstata/antígeno (desde 45,
"platícalo con tu médico", 24) y cáncer colorrectal (45–75, 12). Con `settings.birthDate` se marcan las que aplican
por edad (`applies`); sin ella, las de edad quedan como "Desde los 45" y no entran en "Activar las recomendadas".
Activar una crea `chk-<id>` (activarla dos veces no duplica).

## Rangos de referencia (`classifyHealthMetric`; contexto, no diagnóstico)

Presión: < 120/80 en rango; 120–129/< 80 elevada; ≥ 130 o ≥ 80 etapa 1; ≥ 140 o ≥ 90 etapa 2; ≥ 180 o ≥ 120 muy
alta; < 90/60 baja. Glucosa en ayunas: 70–99 · 100–125 prediabetes · ≥ 126 diabetes. Colesterol total: < 200 ·
200–239 limítrofe · ≥ 240 alto. Pulso en reposo: 60–100 (40–59 "común si entrenas"). `otro`: sin referencia.

## Pantalla `/salud` (`screens/Salud.tsx`, estilos `styles/salud.css`)

1. **Tu salud**: anillo con el puntaje, "N de M chequeos al día" + una línea de qué hacer, y mosaicos de sueño
   promedio de 7 días (`state.body.sleep`), último peso (`state.body.lastWeight`, lleva a /cuerpo) y chequeos/XP del año.
2. **Ya te toca**: atrasados, pronto y sin registro; botón "Ya lo hice +XP" (fecha Hoy/Ayer/Antier/otra, resultado y
   nota) y, si no hay fecha, "¿cuándo fue la última vez?" (atajos "hace 6 meses", sin XP). Tocar el nombre edita.
3. **Al día**: siguiente fecha y barra de cuánto ha pasado del intervalo; "+ Chequeo" para uno propio.
4. **Recomendados** (o "Activa tus chequeos" si no hay ninguno): uno por toque o "Activar las recomendadas".
5. **Mediciones**: última lectura con su nivel, gráfica SVG propia (dos líneas en la presión, líneas de referencia
   punteadas, tooltip al pasar el dedo; colores `--salud-s1/s2` validados para daltonismo en claro y oscuro) y registros
   con "Anular".
6. **Ficha médica** (teléfonos con `tel:`), **Pausados** e **Historial de chequeos** (anular = quitar su XP).

**Registro rápido**: `ui/quick/HealthQuick.tsx` exporta `HealthQuick({ date, setDate, today, onDone })` con dos modos:
"Chequeo o consulta" (los que ya tocan primero, luego recomendaciones sin activar —las activa— y "Otro" que crea uno,
o reutiliza el del mismo nombre) y "Medición" (con su referencia en vivo). También exporta `CheckupDoneForm` y
`MetricForm`. Acciones compartidas en `lib/health.ts`.

## Herramientas de IA (`assistant/tools-salud.ts`)

- `ver_salud` (consultar): ya le toca / sin registro / al día / pausados con ids, recomendaciones sin activar según
  su edad, última medición de cada serie con referencia y ficha médica.
- `registrar_chequeo` (registrar): por `chequeo_id`, `recomendacion` (la activa) o `nombre` (lo reutiliza o lo crea);
  no duplica el mismo día; responde la XP y cuándo vuelve a tocar.
- `registrar_medicion` (registrar): valida presión (dos valores) y `otro` (nombre); responde con el rango de referencia.
- `guardar_chequeo` (organizar): activar recomendación, crear, editar, pausar (`activo: false`) y `ultima_vez` sin XP.
- `guardar_ficha_medica` (organizar): solo cambia los campos enviados ("" borra uno).

Foto para la IA: `snapshot.health` (puntaje, conteos, chequeos con estado, última medición por serie, ficha). Panorama
(`renderOverview`): sección "## Salud" solo si hay chequeos activos o mediciones. `EVENT_TEXT`/`describeEvent` y
`EVENT_LABELS` incluyen los dos eventos. `borrar_elemento` no cubre chequeos (su tabla no está anclada): la IA pausa.

## Pruebas

`packages/core/test/salud.test.ts`: suma de meses, estados y umbral de 30 días, fecha siguiente con `lastDone`,
lista `due` y puntaje, XP una vez por chequeo por día, tamaño del registro, config, mediciones sin XP, propiedad
"agregar registros de salud nunca baja XP ni atributos" (con `createdAt` aleatorio), validación de eventos,
recomendaciones por edad, rangos, foto/panorama y las 5 herramientas con `memoryAssistantStore` (incluye solo lectura).

## Pendiente para el integrador / huecos conocidos

- Conectar `HealthQuick` en la hoja "+" (`ui/QuickAdd.tsx`) y el acceso a `/salud` en `screens/Menus.tsx`; agregar
  `/salud` al arreglo `WORLD` de `App.tsx` para que "Más" se marque activo.
- Mostrar `state.health.due` en Hoy / revisión del día.
- `DELETABLE` de `borrar_elemento` no incluye `health/checkup` (fuera de anclas).
- Sin notificaciones push de "ya te toca" (están apagadas por decisión del usuario).
