# Salud (`salud`)

Chequeos preventivos con fecha siguiente ("ya te toca"), mediciones con rango de referencia, ficha médica para
emergencias, **estudios con sus archivos** y **tu médico IA** (revisiones periódicas con todo el expediente; ver abajo). Idea del usuario: "ya toca hacer ciertas cosas"; que se sienta como juego (puntaje, XP, "ya lo hice")
pero sin relleno. Todo texto visible es sobrio, en español de México, y siempre con la nota
**"Orientación general; no sustituye a tu médico."** (`HEALTH_DISCLAIMER`). Nunca diagnostica.

## Entidades (módulo `health`)

| Kind | Id | Datos |
|---|---|---|
| `checkup` | `chk-<sugerencia>` (fijo al activar una recomendación) o `chk-<aleatorio>` | `CheckupData`: `name`, `category` (`estudios`, `consulta`, `dental`, `vista`, `piel`, `vacuna`, `otro`), `everyMonths` (0 = una sola vez), `active`, `size?` (XP; por defecto `health.checkupSize`), `lastDone?` (fecha anotada a mano, **sin XP**), `notes?`, `suggestionId?` |
| `profile` | `health-profile` (`HEALTH_PROFILE_ID`) | `HealthProfileData`: tipo de sangre, alergias, padecimientos, medicamentos, médico y teléfono, aseguradora y póliza, contacto de emergencia, notas |
| `record` | `hrec-<aleatorio>` | `HealthRecordData`: estudio, consulta, receta, imagen… `title`, `type` (`HEALTH_RECORD_TYPES`), `date`, `place?`, `doctor?`, `cost?` (dinero real), `notes?`, `files` (`HealthFileRef[]`: id, nombre, tipo, bytes), `checkupId?` / `checkupEventId?`, `ai?` (lo que leyó la IA: resumen, hallazgos, valores con rango y bandera, recomendaciones), `metricEventIds?` (mediciones que salieron de él), `expenseEventId?` |
| `consult` | `consult-auto-<fecha>` (automática, una por día) o `consult-<fecha>-<aleatorio>` | `HealthConsultData`: revisión del médico IA: `title`, `message`, `status` (bien / atencion / importante), `highlights`, `actions` (`DoctorAction`: texto, por qué, tipo, prioridad, `checkup?` para activarlo con un toque, `metric?`, `doneAt?`, `dismissedAt?`), `missing`, `nextReviewDays`, `seenAt` |
| `doctor` | `health-doctor` (`HEALTH_DOCTOR_ID`) | `HealthDoctorData`: lo que debe saber de ti (metas, antecedentes familiares y personales, estilo de vida) y `cadence` (semanal por defecto · quincenal · mensual · manual) |

Tipos en `packages/core/src/types.ts` (sección `[[salud]]`).

## Eventos

- `health.checkup_done { checkupId, name?, size?, note?, result? }`: hice un chequeo. Guarda **nombre y tamaño del
  momento** (como `mission.completed`): editar o borrar el chequeo no cambia el historial ni la XP; cambiar la config
  sí recalcula.
- `health.metric { kind, value, value2?, unit?, label?, note?, refLow?, refHigh?, recordId? }`. `kind` ∈ `HEALTH_METRIC_KINDS`:
  presion, glucosa, colesterol, frecuencia_reposo, **trigliceridos, hdl, ldl, hba1c, acido_urico, creatinina, tsh,
  vitamina_d, hemoglobina, saturacion** (las de laboratorio tienen `lab: true` en `HEALTH_METRIC_INFO`) u `otro`.
  Presión: `value` = sistólica, `value2` = diastólica (obligatoria y menor). `otro` exige `label` y unidad libre.
  `refLow`/`refHigh` = rango del propio estudio (al revés se rechaza); `recordId` = estudio del que salió. Solo registro.
  En el reductor, una `otro` con nombre conocido **en la misma unidad** ("Triglicéridos", mg/dL) se agrupa con la
  suya (`resolveMetricKind`); en otra unidad (glucosa en mmol/L) se queda como "otra". Una "otra" con rango del
  estudio se ubica contra ese rango (`classifyAgainstRange`).

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
200–239 limítrofe · ≥ 240 alto. Pulso en reposo: 60–100 (40–59 "común si entrenas"). Triglicéridos < 150 · 150–199
limítrofe · ≥ 200 alto. HDL (hombre) < 40 bajo. LDL < 100 óptimo · 130–159 limítrofe · ≥ 160 alto. HbA1c < 5.7 ·
5.7–6.4 prediabetes · ≥ 6.5 diabetes. Ácido úrico ≤ 7. Creatinina 0.6–1.3. TSH 0.4–4.0. Vitamina D 30–100 (20–29
insuficiente, < 20 deficiencia). Hemoglobina (hombre) 13.5–17.5. Saturación ≥ 95 (< 90 "busca atención hoy").
`otro`: contra el rango de su estudio si lo trae.

`metricKindFromName` reconoce nombres de laboratorio en español ("Colesterol HDL", "Hemoglobina glucosilada A1c") y
evita los parecidos (no HDL, hemoglobina corpuscular media, glucosa en orina). `recordValueToMetric` convierte un valor
de un estudio en medición (conocida u "otra" con su nombre, unidad y rango).

## Pantalla `/salud` (`screens/Salud.tsx` + `screens/salud/Medico.tsx` y `Estudios.tsx`, estilos `styles/salud.css`)

Pestañas en `?tab=` (Resumen · Médico · Estudios · Chequeos · Mediciones). Enlaces directos: `?ficha=1` abre la ficha,
`?tab=medico&perfil=1` abre "Lo que debe saber de ti", `?tab=medico&estudio=<id>` prepara una pregunta sobre un estudio.

- **Resumen**: Tu salud (abajo), tarjeta del médico, Ya te toca, Recomendados (si falta activar alguna; "Ya no mostrar
  aquí" lo guarda en `localStorage`), Tu expediente (datos que faltan) y Ficha médica.
- **Recomendaciones siempre visibles** (`Recommendations`): las 9 con su estado; activar una NO esconde las demás (queda
  "✓ Al día / Sin registro / Atrasado"); las que no tocan por edad en "Más adelante". Antes, al activar la primera, la
  lista se iba a un colapsable al fondo y parecía que desaparecían.
- **Chequeos**: Ya te toca, Al día, Recomendados, Pausados e Historial.

Lo de antes, en detalle:

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
- `registrar_medicion` (registrar): valida presión (dos valores) y `otro` (nombre); acepta `ref_min`/`ref_max`; una
  `otro` con nombre conocido en su unidad se guarda como la conocida; responde con el rango de referencia.
- `registrar_estudio` (registrar): guarda un `health/record` con sus valores (y, salvo `guardar_mediciones: false`,
  los numéricos como `health.metric` con `recordId`). Para que Claude/ChatGPT lean un PDF que les compartes y lo
  guarden en tu expediente. No sube archivos.
- `guardar_antecedentes` (organizar): metas, antecedentes familiares y personales, estilo de vida y frecuencia de la
  revisión (`health/doctor`).
- `ver_salud` también muestra los estudios recientes (con lo fuera de rango), la última revisión del médico con lo
  pendiente y los antecedentes.
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

## Tu médico IA (`engine/health-dossier.ts`, `apps/api/src/medico.ts`, `lib/medico.ts`)

Idea del usuario: "un médico personalizado que lea todo (entreno, mediciones, mis archivos), que vea mi historial y cómo
voy evolucionando, que no pueda empezar sin datos, y que una vez por semana o por mes me diga en el inicio «tu médico te
quiere decir esto»". Sin XP: todo es registro y orientación. Nunca diagnostica ni receta (`DOCTOR_DISCLAIMER`).

- **Expediente** (`buildHealthDossier(state, entities)`, puro): datos generales (edad, estatura, peso con su tendencia
  1/3/12 meses, IMC, grasa, cintura y cintura/estatura), lo que debe saber de ti, ficha, chequeos, mediciones (las
  últimas 6 de cada serie con nivel y rango), estudios (completos del último año, en una línea los viejos), sueño 7/30
  días, entrenamiento de 4 semanas (sesiones, cardio vs 150 min, series duras), hábitos a dejar, las 3 revisiones
  anteriores con qué acciones hizo y los datos que faltan. Marca **NUEVO** lo posterior a la última revisión. ≤ 40 000
  caracteres (se recorta).
- **Datos que faltan** (`healthDataGaps`, `healthFileScore` = % completo): nacimiento, estatura, peso del mes, cintura
  (6 meses), presión (1 año), análisis de sangre (1 año: medición de laboratorio o estudio tipo laboratorio), ficha,
  antecedentes familiares, sueño (14 días), actividad (31 días) y al menos un chequeo. Cada uno con su enlace.
- **Revisión** (`POST /api/medico/consult`, esfuerzo alto, salida estructurada): la app manda el expediente y guarda
  la respuesta como `health/consult`. La primera es a mano ("Empezar mi primera revisión", `kind: inicial`); después
  `DoctorAutoReview` (montado en App) la pide sola cuando `doctorReviewDue` (última + 7/14/30 días según `cadence`),
  una vez al día como máximo, con conexión y ya sincronizado, con id `consult-auto-<fecha>` (dos dispositivos el mismo
  día = una sola). También "Pedir una revisión ahora" con un tema opcional.
- **Aviso**: `state.health.unseenConsultId` → tarjeta "Tu médico te quiere decir algo" arriba de Hoy
  (`ui/DoctorCard.tsx`, `only="nueva"`), en "Pide tu atención" de Más y como punto en la pestaña. Abrir la pestaña
  Médico la marca vista (`seenAt`). Ya vista, si queda una acción de prioridad alta, va con los avisos del día
  (`only="pendiente"`).
- **Acciones**: hecho / descartar (con Deshacer), "Activar chequeo" (usa la recomendación de la app si el nombre
  coincide), "Registrar <medición>" y "Subir resultado".
- **Preguntar** (`POST /api/medico/ask`): chat con el expediente; opcionalmente con los archivos de un estudio. La
  plática se guarda solo en el dispositivo (`localStorage`, 30 mensajes).

## Estudios y archivos

- **Archivos** en D1, NO en el catálogo ni en la sincronización: tablas `health_files` (id, nombre, tipo, bytes,
  trozos) y `health_file_chunks` (base64 en trozos de 900 000 caracteres; D1 permite ~2 MB por fila). Migración
  `0003_health_files.sql`. `POST /api/medico/files?name=&mime=` (cuerpo = base64 en texto, valida tipo, tamaño
  ≤ 10 MB y la firma del archivo), `GET /api/medico/files/:id`, `DELETE`. PDF, JPG, PNG, WEBP y GIF. Las fotos se
  reducen en el teléfono a ~2200 px JPEG (`prepareFile`). Ojo: el plan gratis de D1 da 500 MB por base; el respaldo
  JSON (`/api/backup`) NO incluye los archivos.
- **Leer con IA** (`POST /api/medico/read`, esfuerzo medio, salida estructurada): PDF como `document` y fotos como
  `image` (varias fotos = un solo estudio). Regresa título, tipo, fecha, lugar, médico, costo, resumen, hallazgos,
  TODOS los valores (nombre, valor, unidad, rango, límites, bandera, `kind` si coincide) y si cuenta como chequeo
  preventivo (`checkup` = id de recomendación). La app lo muestra para confirmar (`ReadingReview`): marcas qué valores
  van a mediciones, si se cuenta como chequeo (+XP del chequeo, en la fecha del estudio) y si el costo va como gasto.
- Fechas: si no cambiaste la fecha al subirlo, gana la del documento; el gasto y el chequeo se registran al final, ya
  con la fecha definitiva. **Volver a leer** reemplaza (anula y vuelve a crear) las mediciones que salieron de ese
  estudio; "Deshacer" las restaura.
- Borrar un estudio borra sus archivos; sus mediciones solo si lo confirmas; el gasto y la XP del chequeo se quedan.
- Gasto: `expense.recorded` categoría "Salud" (dinero real, sin XP). `state.health.spendThisYear` / `spendTotal`.

## Pendiente para el integrador / huecos conocidos

- Conectar `HealthQuick` en la hoja "+" (`ui/QuickAdd.tsx`) y el acceso a `/salud` en `screens/Menus.tsx`; agregar
  `/salud` al arreglo `WORLD` de `App.tsx` para que "Más" se marque activo.
- Mostrar `state.health.due` en Hoy / revisión del día.
- `DELETABLE` de `borrar_elemento` no incluye `health/checkup` (fuera de anclas).
- Sin notificaciones push de "ya te toca" (están apagadas por decisión del usuario): el médico avisa dentro de la app.
- Los archivos no van en el respaldo JSON ni se pueden ver sin conexión.

## Pruebas (médico IA)

`packages/core/test/medico.test.ts` (rangos de laboratorio, nombres, unidades, valores → mediciones, estudios y gasto,
revisión sin ver / pendientes / frecuencia, datos que faltan, expediente con NUEVO y recorte, sin XP, herramientas) y
`apps/api/test/medico.test.ts` (archivos: subir/bajar/borrar, trozos, tipos; leer, revisión y preguntar con la API de
Claude simulada; errores).
