# Mi gente — relaciones de toda una vida

Quién es cada persona en tu vida (círculo y rol), dónde y cuándo se conocieron, con quién hablaste hoy, qué
tan cercana es cada relación (nivel que se **gana**) y cuál se está enfriando (temperatura que **baja**).
Mecánica de juego con lenguaje sobrio: "Mi gente", "persona", "círculo", "cercanía". Nada de NPC en pantalla.

## Modelo (`npcs/npc`, `NpcData` en `types.ts`; compatible con fichas viejas)

| Campo | Qué es |
|---|---|
| `circle` | `familia`, `pareja`, `amigos`, `trabajo`, `clientes`, `comunidad`, `conocidos` (`PEOPLE_CIRCLES`, `CIRCLE_NAMES`). Sin él, se deduce del rol y si no, de `npcType`. |
| `role` | Texto libre. `PERSON_ROLES` son sugerencias reconocidas (Novia, Hija, Mamá, Primo, Mejor amiga, Socio, Cliente, Mentor, Vecino…); `roleInfo()` reconoce también "amiga de la prepa", "madre", "compañero de trabajo". Cada rol tiene `group` (orden en Familia y frecuencia), `circle` y `fem` (género del nombre de nivel). |
| `metWhere` / `metPlaceId` / `metOn` | Dónde (texto + lugar del mapa opcional) y cuándo se conocieron (`YYYY`, `YYYY-MM` o `YYYY-MM-DD`). |
| `birthday` | `MM-DD` o `YYYY-MM-DD` (con año: cuántos cumple). |
| `phone`, `notes`, `guildId` | Teléfono (enlace a llamar/WhatsApp), notas y grupo. |
| `key` | Persona clave (se conserva). |
| `startLevel` | Punto de partida 1–5: lo cercana que ya era antes de la app. Solo cambia el nivel que se **ve**; no da XP. |
| `cadenceDays` | Cada cuántos días quieres contacto. Sin valor = automático; `0` = sin meta. |
| `npcType`, `relation` | De la primera versión. Se siguen guardando (`legacyNpcType(circle, role)`) para que versiones anteriores lean la ficha. Fichas viejas: `party`/`aliado` → amigos, `mentor` → trabajo (rol Mentor), `cliente` → clientes, `rival` → conocidos. |

Los grupos (`npcs/guild`) siguen existiendo; en pantalla se llaman **Grupos** (equipo, generación, club) para no
confundirse con el **círculo** (categoría fija). CLAUDE.md los llama "Círculos": actualizar al integrar.

## Eventos

- `npc.interaction` `{ npcId, note?, channel?: 'persona'|'llamada'|'videollamada'|'mensaje', placeId? }` —
  extendido sin romper nada. Un evento por persona (registrar con varias = varios eventos). Sin canal = sin
  especificar: cuenta como contacto, NO como convivencia en persona (conservador con los registros viejos).
  Sin canal pero con lugar = en persona.
- `mission.completed` con `npcId` ("Escribirle a X") = contacto por mensaje.
- `place.visited` `{ placeId, company, npcIds?, note? }` (lo define el sistema **mapa**) = convivencia en persona,
  en ese lugar, con cada `npcId` (repetidos se cuentan una vez).

Todo se deriva en `engine/modules/gente.ts` (`reducePeople`; `reduceNpcs` en `world.ts` solo delega).

## Nivel de cercanía (1–5, se gana y nunca baja)

Requisitos ACUMULADOS en `config/game.ts → gente.levels` (días distintos con contacto, días en persona, semanas
distintas, meses distintos). Diez mensajes en un día = 1 día. Los niveles se ganan en orden; puede ganarse más de
uno el mismo día.

| Nivel | Días | En persona | Semanas | Meses | XP |
|---|---|---|---|---|---|
| 2 | 3 | 1 | 2 | 1 | 20 |
| 3 | 8 | 3 | 4 | 2 | 30 |
| 4 | 20 | 8 | 10 | 4 | 50 |
| 5 | 50 | 20 | 24 | 8 | 100 |

- XP (fuente `relationship`, atributo Relaciones) UNA vez por nivel, con fecha del día en que se cumplieron los
  requisitos. Como los conteos solo crecen al agregar eventos, agregar cualquier evento nunca baja la XP
  (prueba de propiedades en `test/gente.test.ts`). La XP se calcula por `npcId` desde los eventos, así que
  **borrar la ficha no quita la XP ganada**.
- Mismos requisitos para todos; cambia solo el **nombre** según el círculo (y el género según el rol):
  - Familia y pareja: En contacto → Presente → Cercano/a → Unido/a → Incondicional.
  - Amigos, comunidad, conocidos: Conocido/a → Compa → Amigo/a → Amigo/a cercano/a → Círculo íntimo.
  - Trabajo y clientes: Conocido/a → Contacto → Colaborador/a → De confianza → Aliado/a clave.
  Cambiar círculo o rol nunca cambia el nivel ganado ni la XP.
- Nivel que se ve = `max(startLevel, nivel ganado)`. `next.hint`: "Te faltan 2 convivencias en persona y 1
  semana más para Amiga".

## Temperatura (cálida / tibia / fría; sí baja)

Días desde el último contacto real contra la frecuencia esperada (`cadenceFor`): la elegida en la ficha; si no,
`gente.roleCadence` (pareja 1, hijos 2, padres 7, hermanos y abuelos 14, resto de la familia 60, mejor amigo 14,
amigo 30, trabajo 14, cliente 30, mentor y vecino 60, conocido 0); si no, `gente.circleCadence`. Una persona
clave sin frecuencia elegida espera contacto al menos cada `npc.keyContactDays` (30). Cálida hasta
`frecuencia × 1.5`, tibia hasta `× 3`, luego fría. Sin meta o sin contactos = sin temperatura.

Persona clave → misión "Escribirle a X" (igual que antes) cuando lleva `npc.keyContactDays` días sin contacto
**o** cuando ya está fría según su frecuencia (p. ej. pareja clave: a los 4 días).

## Estadísticas (en `state.npcs`)

Por persona (`NpcState`): nivel, nombre, fechas de cada nivel, conteos, `next`, frecuencia, temperatura,
tendencia (`sube`/`baja`/`estable`: días con contacto en los últimos 30 contra los 30 anteriores, con
diferencia ≥ 2 y ≥ 1.5×; config `trendDays`, `trendMinChange`, `trendRatio`), contactos por canal, lugares
juntos, primer contacto, desde cuándo se conocen, próximo cumpleaños y prioridad en Familia.
Global: `contacts` (todos), `contactedToday`, `weeks`/`months` (12 cada uno, contactos = persona-día),
`byCircle`, `places` (por lugar, con quién y cuántos días), `birthdays` (próximos 30 días), `levelUps`.
Funciones puras: `mostSeen`, `relationSummary` (lo usan las herramientas de IA; se prueba igual al reductor),
`knownForText`, `nextBirthday`, `temperatureFor`, `trendFor`, `levelFromCounts`.

## Pantallas

- `/npcs` (`screens/Npcs.tsx`), pestañas **Personas · Estadísticas · Grupos**:
  "Hoy hablaste con…", buscador, **Por atender** (frías o clave olvidadas), Cumpleaños, **Familia** (pareja e
  hijos primero; con "Arma tu familia": chips de rol + nombre, sin inventar nombres), secciones por círculo y
  "¿Cómo sube la cercanía?". Cada fila: monograma con anillo de avance y nivel, rol · nombre de nivel,
  temperatura, último contacto y botón para registrar.
- `/npcs/:id` (`screens/Persona.tsx`): escalera de 5 niveles, barra al siguiente con lo que falta, 4 requisitos,
  registro en un toque (Nos vimos / Llamada / Mensaje / Más…), temperatura con frecuencia editable, datos
  (cumpleaños, se conocieron, teléfono con WhatsApp, grupo, notas), juntos (canales, lugares) e historial con
  "Anular".
- Componentes compartidos en `ui/people.tsx` (`ContactForm`, `LogSheet`, `PersonSheet`, `FamilyBuilder`,
  `PeopleTodayCard`, `PeopleWatcher`) y estilos en `styles/gente.css`.
- `ui/quick/PeopleQuick.tsx`: el registro de la hoja "+" (varias personas, canal, lugar, nota, día; escribir un
  nombre nuevo permite agregarlo ahí mismo). Reemplaza a "Hablé con…".
- `PeopleWatcher` (global en `App.tsx`): aviso "Tu relación con Jorge ahora es Presente · +20 XP" al subir de nivel.

## IA (`assistant/tools-gente.ts`)

- `registrar_contacto`: `persona_id` o `personas` (hasta 20), `canal`, `lugar_id`, `nota`, `fecha`.
- `guardar_persona`: `circulo`, `rol` (deduce el círculo), `clave`, `conocio_en`, `conocio_lugar_id`,
  `conocio_fecha`, `cumpleanos`, `telefono`, `grupo_id`, `nivel_inicial`, `frecuencia_dias`, `notas` ("" borra un
  campo); acepta `tipo`/`relacion` de la versión anterior.
- `ver_mi_gente` (por círculo, con nivel, temperatura y lo que falta) y `ver_persona` (requisitos, lugares,
  canales y últimos contactos con id).
- Foto (`snapshot.people`): `list`, `today`, `birthdays`, `week`, `recentLevelUps` además de lo anterior.
  Panorama: sección "## Mi gente". Guía: `GENTE_GUIDE`.

## Pruebas

`packages/core/test/gente.test.ts`: requisitos y niveles, diez mensajes ≠ amistad, varios niveles el mismo día,
punto de partida sin XP, nombres por círculo y género, `place.visited` y misiones como contacto, XP que sobrevive
al borrar la ficha, temperatura y frecuencia, persona clave, tendencia, cumpleaños, compatibilidad con
`npcType`, validación del evento, propiedad "agregar eventos nunca baja XP, atributos ni niveles" (y
`relationSummary` = reductor), y herramientas de IA con el almacén en memoria.
