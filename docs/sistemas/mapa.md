# Mapa (vida y empresa)

"¿Qué lugares conoces?" de Guadalajara y de cualquier parte del mundo: con quién los has vivido (solo, en pareja, en
familia, con amigos), qué te falta por conocer, **a dónde quieres ir (objetivos)** y, en otra capa, dónde opera tu
empresa (oficinas, sucursales, clientes, proveedores, zonas). Pantalla `/mapa` (acceso ya existente en Más → Mapa).

**Preferencia del usuario (nov 2026):** las sugerencias del catálogo de Jalisco "no le sirven": quiere SU mapa, con sus
propios lugares y objetivos, en colores (ya fui / no he ido / objetivo). Por eso las sugerencias están apagadas por
defecto y el mapa se centra en lo que él agrega.

En pantalla: **por conocer / conocido / habitual**, "primera visita", "Lo has vivido", "Mi vida / Mi empresa".
Internamente se conservan `inexplorado / descubierto / dominado`.

## Datos

- **Lugar** = entidad `map/place` (`PlaceData`, `packages/core/src/types.ts`). Compatible con lo anterior: los
  lugares viejos (`name`, `placeType` ∈ lugar/experiencia/comunidad, `notes`) siguen valiendo y son de la capa vida.
  Campos nuevos (todos opcionales): `layer` ('vida' | 'empresa'; sin él se deduce con `placeLayer()`: los tipos de
  empresa son de empresa), `city`, `zone` (colonia), `lat`/`lng`, `catalogId` (lugar del catálogo de Jalisco),
  `npcIds` (personas ligadas; en empresa = contactos del cliente/proveedor), `active` (empresa: false = ya no opera
  ahí), `since` (empresa: desde cuándo) y `goal` (objetivo, ver abajo).
- **Objetivo** = `PlaceData.goal: { with?: VisitCompany | null, by?: 'AAAA' | 'AAAA-MM' | 'AAAA-MM-DD' | null, since }`
  (p. ej. Disneyland California, en familia, para 2027). Se cumple con la **primera visita desde `since`** (con esa
  compañía si `with` viene); las visitas anteriores no cuentan. Es solo visual: **no da XP extra** (la primera visita al
  lugar ya da la suya), así que quitarlo o borrarlo nunca baja XP. Editar un objetivo pendiente conserva `since`; volver
  a marcar uno cumplido empieza de nuevo ("Volver a ir").
- `PLACE_TYPES`: lugar, experiencia, comunidad, restaurante, cafe, bar, parque, naturaleza, museo, cultura, deporte,
  compras, evento, pueblo, playa, viaje (ciudad / viaje) + empresa: oficina, sucursal, cliente, proveedor, zona.
  Nombres visibles en `PLACE_TYPE_NAMES`; grupos en `VIDA_PLACE_TYPES` / `EMPRESA_PLACE_TYPES`.
- **Eventos**:
  - `place.visited { placeId, company: 'solo'|'pareja'|'familia'|'amigos'|'trabajo'|'otro', npcIds?, note?, rating? (1–5) }`
    (contrato con "Mi gente": cuenta como contacto en persona con cada `npcIds`). `company` repite
    `VISIT_COMPANIES`; una prueba verifica que coincidan.
  - `map.status_changed { placeId, status }` (sin cambios): fija el estado a mano ("Marcar como habitual").
- **Ajuste** `settings.map.suggestions` (sincronizado; antes era `localStorage`): `true` muestra las sugerencias de
  Jalisco. Sin él (lo normal) no salen los puntos sugeridos, ni la sección de colecciones, ni los resultados
  "emblemáticos" al buscar o al crear un lugar. El motor no cambia: las colecciones siguen contando y su XP se conserva.
- **Catálogo fijo de Jalisco** (`packages/core/src/engine/map-catalog.ts`): 35 lugares emblemáticos con coordenadas
  aproximadas (Centro Histórico, Minerva, Colomos, Huentitán, Basílica de Zapopan, Akron, Tlaquepaque, Tonalá,
  Chapala, Ajijic, Tequila, Tapalpa, Mazamitla, Guachimontones, Vallarta…) y 6 **colecciones** (Guadalajara
  esencial, Centro Histórico, Zapopan, Naturaleza tapatía, Estadios y escenarios, Escapadas de Jalisco), cada una
  con un tamaño de misión. No es catálogo editable: visitar o guardar uno crea el lugar `place-<id del catálogo>`
  (id fijo: dos dispositivos crean el mismo). Un lugar propio también cuenta si su `catalogId` apunta al catálogo.
  Cambiar esta lista recalcula colecciones (como la config).

## Reglas (`engine/modules/map.ts`; `world.ts` solo re-exporta `reduceMap`)

- Se pliegan `map.status_changed` y `place.visited` en orden cronológico (`foldMapEvents`, puro; lo usan el reductor
  y la IA). Un cambio manual fija el estado; cada visita lo puede subir: ≥1 visita → al menos conocido;
  ≥ `cfg.mapa.habitualVisits` (5) → habitual.
- **Primera visita**: la primera vez que un lugar deja de estar por conocer (por visita o por el evento viejo) da
  `rewards.discovery` (30 XP) **una sola vez**, fuente `discovery`, a Creatividad (capa vida) o a
  `cfg.mapa.empresaAttribute` (Finanzas, capa empresa). `discoveryDates` sigue alimentando el logro "discoveries".
- **Colección completa**: cuando todos sus lugares están conocidos, la XP de una misión de su tamaño
  (`missionXp[size]`), una vez, el día del último lugar; fuente `discovery` (sale como "Mapa" en las pantallas),
  `refId: collection:<id>`, a Creatividad. Depende de que algo haya sido conocido alguna vez (`discoveredOn`), así
  que agregar eventos nunca baja XP (prueba de propiedades en `test/mapa.test.ts`).
- Visitar varias veces no da XP extra (XP por resultados, no por repetir).
- **Objetivos** (`mapGoals(entidades, visitas, hoy)` → `state.map.goals`, puro): por lugar sin borrar con `goal`,
  `deadline` (`goalDeadline`: fin del año/mes/día), `doneOn` (`placeGoalDoneOn`) y `late` (pasó el plazo sin cumplirse).
  Orden: pendientes por plazo (sin fecha al final), luego cumplidos (el más reciente primero). `summary.goals` =
  `{ open, done, next }` (opcional: las fotos viejas no lo traen; `SNAPSHOT_SCHEMA` subió a 5).
- Estado (`state.map`): `goals`, `places[id]` (status, discoveredOn, masteredOn, visits, first/lastVisit, `firsts` = primera
  vez con cada compañía, `byCompany`, `people`, `rating` promedio), `visits`, `firsts`, `collections`, `catalog`
  (id del catálogo → lugar ligado y desde cuándo lo conoces) y `summary` (conocidos, habituales, por conocer,
  ciudades, "Lo has vivido", visitas recientes, colecciones y dónde opera la empresa).

## Pantalla `/mapa` (`screens/Mapa.tsx`, `ui/mapa/*`, `styles/mapa.css`)

- Pestañas **Mi vida / Mi empresa** (se recuerda en el dispositivo, `localStorage` `igv-mapa`). Arriba: **Agregar**
  (lugar u objetivo) y **Fui a…**.
- **Mapa visual** (`ui/mapa/MapView.tsx`, sin librerías): Web Mercator, arrastrar, pellizcar, rueda, doble toque,
  botones +/−/ver todo/mi ubicación, agrupación de marcadores cercanos, etiquetas sin encimarse. Encuadre inicial en
  el núcleo de tus lugares (`corePoints`: ignora los pocos lejanos, p. ej. un viaje; "ver todo" sí los incluye); sin
  lugares, Guadalajara (o las sugerencias de la zona metropolitana si están prendidas). Colores: **objetivo naranja
  (`--flame`) con banderita** (gana aunque ya conozcas el lugar, hasta cumplirlo), habitual oro, conocido turquesa, por
  conocer anillo, sugerencia punto tenue; empresa: sede oro, cliente turquesa, proveedor violeta, zona halo azul.
- **Marcar un punto**: mantener presionado el mapa (550 ms sin moverse; clic derecho en computadora) o el botón de la mira
  naranja (barra flotante "Marcar aquí"). Abre el formulario con ese punto y pregunta a Nominatim qué hay ahí (ciudad,
  colonia y, si es un lugar con nombre, su nombre y tipo; de cerca no propone el nombre del pueblo).
- **Fondo de calles**: teselas raster de OpenStreetMap (`tile.openstreetmap.org`) dibujadas a mano, solo las
  visibles, con atribución "© OpenStreetMap" (política de uso de OSM: uso ligero de un solo usuario, sin descargas
  masivas). En tema oscuro se invierten con un filtro CSS. Botón "Calles" para apagarlas; sin conexión queda una
  retícula sobria. No hay CSP que lo impida (revisado `index.html`, `vite.config.ts`, Worker).
- Filtros: Todo / **Objetivos** / con quién (Solo / En pareja / En familia / Con amigos…; incluye los objetivos con esa
  compañía), ciudad, colección (solo con sugerencias); empresa: por tipo.
- Tarjeta del lugar: estado, primera visita, visitas, "Lo has vivido" (con fecha de la primera vez de cada
  compañía), personas, calificación, últimas visitas (anular con "Deshacer"), Registrar visita, Habitual, Google
  Maps, Editar; con objetivo: "En familia · para 2027 · faltan 13 meses" (o "Objetivo cumplido el…") y "Ya fui" propone
  la compañía del objetivo; sin objetivo, botón "Objetivo" (o "Volver a ir"). Sugerencia del catálogo: Ya fui / Quiero ir
  / Google Maps.
- Secciones vida: números (objetivos, conocidos, habituales, por conocer), **Objetivos** (pendientes con "Ya fui" y
  cumplidos plegados), **Colecciones de Jalisco** (solo con sugerencias) (avance y XP; al abrir una se filtra el mapa y se listan sus lugares),
  **Lo has vivido** (lugares por compañía y primeras veces), **Tus lugares** (por estado, con búsqueda; "sin
  ubicación" como respaldo de lista). Empresa: números, **Dónde opera** (ciudades con lugares, clientes y desde
  cuándo) y lugares por tipo con contactos; los inactivos se ven apagados.
- Formulario de lugar: **Buscar** en cualquier parte del mundo (`GeoSearch`, ver abajo), "¿Qué es para ti?" (Quiero ir /
  Objetivo / Ya fui; al editar "¿Es un objetivo?"); objetivo → "¿Con quién quieres ir?" (Da igual, Solo, En pareja…) y
  "¿Para cuándo?" (Sin fecha, Este año, los 2 siguientes o un mes); "Ya fui" guarda el lugar y abre "Registrar visita";
  autocompleta con el catálogo (solo con sugerencias), capa, tipo, ciudad (sugerencias), colonia, ubicación con mapa
  de mira fija (mueves el mapa), "Usar mi ubicación" (geolocalización) o pegar coordenadas / liga de Google Maps
  (`parseMapCoords`); en empresa, contactos, desde y "sigue activo".
- **Registro rápido "Fui a…"**: `ui/quick/VisitQuick.tsx` (props `{ date, setDate, today, onDone }`) para la hoja
  "+" (lo conecta el integrador). Busca entre tus lugares (objetivos marcados), el catálogo (solo con sugerencias) o crea
  uno nuevo (con "Estoy aquí" o "Buscar dónde está"). Si el lugar es un objetivo con compañía, la propone; al cumplirlo
  avisa "¡Objetivo cumplido!".
- **Búsqueda de lugares** (`apps/web/src/lib/geocode.ts`): Nominatim de OpenStreetMap (mismo proveedor que las calles).
  Política de uso: solo al tocar "Buscar"/Enter (nunca mientras escribes), máx. 1 petición por segundo, caché en memoria,
  atribución "Datos © OpenStreetMap", `accept-language=es` y preferencia (sin limitar) a lo cercano a tus lugares
  (`viewbox`). `parseNominatimRow` arma nombre (o "calle número" para direcciones), detalle, ciudad, colonia y el tipo de
  lugar (`guessPlaceType`). Sin conexión avisa. Pruebas en `apps/web/test/geocode.test.ts`.

## IA (`assistant/tools-mapa.ts`)

- `ver_mapa` (consultar): lugares con ids, estado, visitas, con quién, colecciones y, con `sugerencias`, lugares
  emblemáticos por conocer; `capa: 'empresa'` muestra dónde opera y los lugares por tipo.
- `registrar_visita` (registrar): lugar por id, id del catálogo o nombre (exacto, parcial único o del catálogo; si
  no existe se crea), `compania`, `personas` por nombre ("Ana" → "Ana López" si es único), nota, calificación,
  fecha. No duplica la misma visita (lugar + día + compañía). Responde la XP de primera visita, primeras veces y
  avance de colecciones.
- `guardar_lugar` (organizar): crea/edita (capa, tipo, ciudad, zona, lat/lng, personas, activo, desde,
  `catalogo_id`, **`objetivo: { con?, para? } | null`**, que reemplaza el objetivo completo) y `estado` a mano (emite
  `map.status_changed`). Pide lat/lng siempre que la IA sepa dónde está, para que salga en el mapa.
- `ver_mapa` lista los objetivos (pendientes y cumplidos) y solo menciona colecciones con avance o si pide sugerencias;
  `registrar_visita` avisa "¡Objetivo cumplido!"; el panorama dice los objetivos pendientes.
- Foto para la IA: `snapshot.mapa` = `state.map.summary` (opcional, fotos viejas no lo traen); el panorama
  (`renderOverview`) agrega la sección "## Mapa". Historial: `place.visited` → "Visita: lugar · en pareja (Ana)".

## Pruebas

`packages/core/test/mapa.test.ts`: objetivos (plazos, se cumplen solo desde `since` y con la compañía, sin XP extra,
borrados, fotos viejas, herramientas de IA), compatibilidad (eventos y lugares viejos), estado por visitas, XP de primera
visita una vez (venga de donde venga), cambios manuales, "Lo has vivido", capa empresa (atributo y resumen),
catálogo sano, colecciones (XP una vez, ligas por id fijo y por `catalogId`), propiedad "agregar eventos nunca
baja XP ni atributos", utilidades y las tres herramientas de IA con el almacén en memoria.

## Pendientes para integrar

- Conectar `VisitQuick` a la hoja "+" (`ui/QuickAdd.tsx`), p. ej. ícono `pin`, "Fui a…".
- `ver_catalogo` (tipo `lugares`, en tools.ts) aún calcula el estado solo con `map.status_changed`; conviene que
  delegue a `foldMapEvents` o remita a `ver_mapa`.
- Deshacer de la IA (`apps/api/src/ai/store.ts`): un lugar creado por la IA se borra aunque Iván le haya
  registrado visitas después (las visitas y su XP se conservan, pero el lugar desaparece). Conviene una guarda
  como la de metas/retos (`place.visited` / `map.status_changed` por `placeId`).
- CLAUDE.md: actualizar la fila del mapa y "Reglas del juego" con este resumen.
