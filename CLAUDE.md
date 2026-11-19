# CLAUDE.md — IGV EXPERIENCE

Contexto para futuras sesiones con IA. Léelo completo antes de cambiar algo.

## Qué es

Tablero personal de **Iván Gómez Vera** para medir y mejorar su vida real con mecánicas de juego. Registra lo
que hace fuera de la app (misiones, ingresos, lecciones, etc.) y lo convierte en XP, niveles, atributos, rachas,
grandes retos y logros. Un solo usuario, uso diario, en español, pensado primero para celular (PWA). Proyecto a
largo plazo: se le irán agregando sistemas.

**Tono y vocabulario (preferencia del usuario):** le gustan las mecánicas (XP, niveles, racha, oro, premios,
logros, misiones) pero NO el lenguaje ni la estética de fantasía/RPG ("otaku"). Todo texto visible debe sonar a
app sobria de rendimiento personal (estilo Whoop/Strava/Oura), en español de México, casual y directo. En el
código los nombres internos se conservan (módulos, tipos de evento, ids, rutas y llaves); solo cambia lo visible:

| Interno (código / ruta) | En pantalla |
|---|---|
| `bosses/boss`, `/jefes`, `BossArt` | Grandes retos / Reto (fases = fases; "avance", "Reto superado", "Se abre al superar X") |
| `bosses/recurring` | Reto recurrente |
| `npcs/npc`, `npcs/guild`, `/npcs` | Mi gente: Personas y Círculos ("persona clave") |
| `map` (`inexplorado`/`descubierto`/`dominado`) | Mapa: por conocer / conocido / habitual; "primera visita" |
| `habits/vice`, `/enemigos` | Hábitos a dejar ("recaída") |
| `/personaje` | Perfil ("Tu fuerte" = atributo más alto) |
| `/mas` (pestaña) | Más |
| `/inventario` | Dinero y recursos |
| `/game-master`, `/api/gm/*` | Coach |
| `lib/narrator.ts` (briefing, buffs, encuentro) | Resumen del día, A tu favor / en contra, Reto del día |
| `QuestMode` | Modo enfoque (ambiente: Fuego / Lluvia) |
| `day.closed` / `CampfireCard` | Cierre del día |
| `/conectar-ia`, `ai/*`, `mcp-worker.ts` | Conectar IA (servidor MCP, llaves, apps conectadas, actividad) |

## Arquitectura

```
packages/core   Reglas del juego en TypeScript puro (sin red ni DOM). Probadas con Vitest.
  src/config/game.ts   ★ TODOS los números del juego. Cambiar uno recalcula todo el historial.
  src/events.ts        Tipos de evento + validación (zod). La API y el cliente usan lo mismo.
  src/types.ts         Tipos de entidades del catálogo y ENTITY_KINDS (lista blanca de la API).
  src/engine/project.ts  project(): eventos + catálogo + config → estado completo del juego.
  src/engine/modules/  Un reductor por sistema (misiones, racha, lecciones, dinero, jefes,
                       habilidades, mapa/NPCs, temporadas, logros, atributos, misión sorpresa, oro,
                       metas, enemigos, biblioteca, cuerpo/ahorro/cierres del día, plan del día, retos).
  src/engine/insights.ts Tú vs. tú (weekPace), récords personales, "datos sobre ti" e ritmo de metas/ingresos.
  src/engine/reports.ts  Funciones puras para reportes: XP por día, reporte semanal, año en review,
                       favoritos, id de misión rápida, elección determinista por fecha.
  src/assistant/       Herramientas para IA (las usan el servidor MCP y el Coach): `snapshot.ts` (foto
                       compacta del estado), `tools.ts` (32 herramientas con zod → JSON Schema y un
                       `AssistantStore` inyectable), `memory.ts` (almacén en memoria para pruebas).
  src/seed/            Datos iniciales (IDs fijos) y guía de atributos (30/70).
packages/db     Esquema Drizzle (events, entities, server_meta) y migraciones SQL de D1.
apps/api        Worker de Cloudflare con Hono: /api/* (sync, eventos, catálogo, respaldo, Coach IA en /api/gm, push,
                Conectar IA en /api/ai y /api/oauth). Notificaciones push APAGADAS (sin cron); ver "Notificaciones push".
                El mismo Worker sirve el frontend (Workers Static Assets, SPA).
                Segundo Worker `igv-experience-mcp` (wrangler.mcp.jsonc, src/mcp-worker.ts): servidor MCP público
                con OAuth; misma base D1. Ver "Conectar IA (MCP)".
apps/web        React + Vite + PWA. Calcula el estado en el dispositivo con @igv/core.
```

### Event sourcing (decisión central)

- **Eventos** (`events`): hechos con fecha (`localDate` = día en America/Mexico_City). Nunca se editan ni se
  borran; solo se **anulan** (`voided_at`) para corregir errores, y se pueden restaurar.
- **Catálogo** (`entities`): misiones, jefes, NPCs, lugares, ajustes… editable. `data` es JSON. Borrar =
  `deleted_at` (borrado lógico, para que se sincronice).
- **Estado del juego**: NUNCA se guarda. `project()` lo deriva cada vez. Por eso cambiar la config o una
  regla recalcula todo sin perder nada.
- El cálculo corre **en el cliente** (el plan gratis de Workers da ~10 ms de CPU por petición). El Worker
  solo valida y guarda.
- Fotos de temporada = `project()` con `today` en una fecha pasada (no se guardan).

### Sincronización

`apps/web/src/data/store.ts`: caché en IndexedDB + cola de cambios pendientes (funciona sin conexión).
`GET /api/sync?since=<cursor>` devuelve filas con `updated_at` mayor al cursor (con 5 s de traslape;
el merge es idempotente por id). Se sincroniza al abrir, al volver a la app, cada 60 s y tras cada acción.
Los eventos llevan id generado en el cliente → reintentar es seguro (`INSERT … ON CONFLICT DO NOTHING`).

### Seguridad

Cloudflare Access protege todo el dominio *.workers.dev del Worker (se activa con un interruptor). Además
la API exige el JWT de Access (`Cf-Access-Jwt-Assertion`, verificado con `jose`) y aplica un **anclaje en
el primer uso** (`apps/api/src/auth.ts`): el primer ingreso válido guarda en la tabla `server_meta`
(clave `access_pin`, nunca se sincroniza al cliente) el equipo de Access, el AUD de la aplicación y el
correo; desde ahí solo se acepta exactamente eso. Solo se aceptan emisores `https://<equipo>.cloudflareaccess.com`.
Las variables `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` (+ `ALLOWED_EMAILS`) son opcionales y, si existen,
reemplazan al anclaje. Sin token, la API responde 401 con `code: "access_disabled"`.
Reiniciar el anclaje: `DELETE FROM server_meta WHERE key='access_pin'` (ver CONFIGURAR-CON-CLAUDE-CODE.md).
`DEV_BYPASS_AUTH=true` solo funciona si `ACCESS_AUD` NO está definido (desarrollo local con `.dev.vars`).
Pruebas: `apps/api/test/access.test.ts` (tokens firmados reales + D1 en memoria sobre `node:sqlite`).

### Notificaciones push

**Apagadas por decisión del usuario: no las actives por defecto.** No hay cron (`"triggers": { "crons": [] }`
en `apps/api/wrangler.jsonc`) y la tarjeta de Ajustes está oculta (`PUSH_AVAILABLE = false` en
`apps/web/src/lib/notifications.ts`). Solo si él lo pide: cron `["*/15 * * * *"]` + `PUSH_AVAILABLE = true`.

Cómo funcionan cuando están activas: el estado del juego solo existe en el cliente, así que el cliente arma un **plan** de recordatorios de los
próximos 3 días (`apps/web/src/lib/notifications.ts`: check-in, racha en riesgo, NPC olvidado, cierre de
semana) y lo sube con `PUT /api/push/plan` tras cada cambio. El cron del Worker (`apps/api/src/push.ts`)
envía los que ya tocan (máx. 2 h tarde, cada id una sola vez). Web Push sin dependencias
(`apps/api/src/webpush.ts`: VAPID ES256 + cifrado aes128gcm con WebCrypto). Llaves VAPID, suscripciones,
plan y enviados viven en `server_meta` (`push_*`, nunca se sincronizan). El service worker de Workbox
importa `apps/web/public/push-sw.js`. Pruebas: `apps/api/test/push.test.ts` (descifra como el navegador).

### Conectar IA (MCP)

Para usar la app desde Claude (web, escritorio, móvil, Claude Code), ChatGPT, Codex, Antigravity, Cursor…
- **Dos Workers**: la app (`igv-experience`, detrás de Cloudflare Access) y el MCP (`igv-experience-mcp`,
  SIN Access, porque los asistentes no pueden pasar por su login). Así no hay que configurar excepciones de
  Access. URLs: `https://igv-experience-mcp.<sub>.workers.dev/mcp` (se deducen del host; con dominio propio,
  variables `MCP_URL` en la app y `APP_URL` en el MCP, ver `apps/api/src/ai/urls.ts`). NO actives Access en
  el Worker del MCP.
- **Protocolo** (`apps/api/src/ai/mcp.ts`): Streamable HTTP sin estado (POST /mcp → JSON; sin SSE ni
  sesiones; GET/DELETE → 405). Versiones 2025-11-25 … 2024-11-05. `instructions` = guía de la app.
- **Autenticación** (`ai/credentials.ts`, `ai/oauth.ts`, tabla `ai_credentials`, tokens solo como SHA-256):
  OAuth 2.1 con metadatos RFC 9728/8414, registro dinámico (RFC 7591, clientes públicos; tope de 30 apps sin
  conectar por hora → 429, para no agotar la cuota de D1), PKCE S256 obligatorio, access 1 h, refresh 90 días
  que ROTA (reusar uno rotado hace más de 60 s revoca la conexión; dentro de ese margen se acepta por
  refrescos en paralelo o reintentos; rotar no anula los access vigentes), revocación.
  La pantalla "Permitir" vive en la app (`GET/POST /api/oauth/authorize`, detrás de Access + anclaje; CSRF
  por `Origin`; casilla obligatoria "Yo inicié esta conexión" contra doble clickjacking; muestra host y ruta de
  regreso y avisa si una app dice ser Claude/ChatGPT y no regresa a su dominio exacto); loopback acepta
  cualquier puerto (Claude Code, Codex). Alternativa: **llaves** `igv_key_…` creadas en la app (para
  Codex/Antigravity/Claude Code con encabezado). Revocar = inmediato. `WWW-Authenticate` solo en ASCII.
- **Herramientas** (`packages/core/src/assistant/tools.ts`): consultar (`ver_*`, `guia_de_la_app`),
  registrar (eventos) y organizar (catálogo). Validan con zod, nunca registran en el futuro (salvo planear
  y agendar) ni más de un año atrás, no duplican misiones que ya contaron, y no borran metas/retos con
  avances (su XP depende de la entidad: se archivan), ni cambian días/tamaño de un reto completado u
  objetivo/tamaño de una meta cumplida (le quitaría XP). `marcar_reto` solo marca días del intento en curso
  y solo empieza hoy o ayer. Los errores vuelven como `isError` (no excepciones).
- **Permisos**: `server_meta.ai_settings.allowWrites` (pantalla Conectar IA). En solo lectura, las
  herramientas que escriben ni se listan ni se ejecutan.
- **Bitácora** (tabla `ai_activity`): cada acción que escribe guarda quién (nombre de la llave o de la app
  OAuth, o "Coach"), un resumen y sus referencias (eventos creados, eventos anulados, versión previa de cada
  entidad y `savedAt` de la que dejó la IA) → "Deshacer" en la app (`POST /api/ai/activity/:id/undo`). Deshacer
  no pisa lo que Iván cambió o borró después, y una meta o reto creados por la IA con avances propios se
  archivan en vez de borrarse (responde `kept` = cuántos cambios se respetaron).
- **Estado para la IA = foto en caché** (`server_meta.ai_snapshot`, `buildSnapshot`): la app la sube tras
  sincronizar (`lib/aiSnapshot.ts`, solo sin cambios pendientes; `version` = cursor de sync). El Worker la
  usa si `version ≥ max(updated_at)`, es del mismo día y su `config` = `CONFIG_FINGERPRINT` (huella de
  `config/game.ts`); si no, recalcula con `project()` (CPU del plan gratis: ~10–20 ms por año de datos, por
  eso se evita). La app solo vuelve a subir si cambió el contenido. Es caché derivada, nunca fuente de verdad:
  sube `SNAPSHOT_SCHEMA` si cambias su forma.
- **Coach** (`/api/gm/ask`): bucle de herramientas con la API de Claude (mismas herramientas, máx. 8
  rondas y 12 herramientas, fuente "Coach" en la bitácora). Cuenta las consultas a D1 (`ai/budget.ts`; el
  plan gratis permite 50 por invocación) y se detiene en 40. Un error en una herramienta vuelve como
  `is_error`; si la conversación falla, la respuesta trae igual las `actions` ya hechas. El servidor arma el
  panorama (`renderOverview`); con `readOnly: true` + `context` (reporte semanal) usa solo esos datos y sin
  herramientas que escriben.
- **Agregar una herramienta**: defínela en `tools.ts` con `tool({...})`, agrégala a `ASSISTANT_TOOLS`,
  devuelve `ok(texto, resumen, refs)` si escribe, y prueba en `packages/core/test/assistant.test.ts`.
  Aparece sola en el MCP, en el Coach y en la lista de la pantalla.
- Pruebas: `packages/core/test/assistant.test.ts`, `apps/api/test/mcp.test.ts` (llaves, OAuth completo con
  PKCE y rotación, solo lectura, bitácora y deshacer) y `apps/api/test/coach.test.ts` (API de Claude simulada).

## Reglas de oro (nunca se rompen; hay pruebas en `packages/core/test/golden-rules.test.ts`)

1. La XP nunca se resta. Descansar no quita XP. (`ctx.addXp` ignora montos ≤ 0; prueba de propiedades
   con eventos aleatorios verifica que agregar cualquier evento nunca baja XP ni atributos.)
2. Un "Día de descanso" marcado no rompe la racha.
3. XP por acciones y resultados, no por horas.
4. Una lección escrita tras un fracaso da 30 XP.
5. El dinero real y la XP son sistemas separados (registrar dinero no da XP; solo los resultados
   —fases del Dragón, logro "Mes cubierto"— dan XP).

## Reglas del juego (implementación)

- Misiones: chica 10, media 30, grande 100, épica 300. El evento guarda **tamaño y atributo del momento**
  (si después editas la misión, el historial no cambia; si cambias la config, sí se recalcula).
- Diarias, misiones de NPC y misiones rápidas (`kind: 'quick'`, "Hice algo", id `quick-<título normalizado>`):
  una vez por día. Secundarias, capítulos, eventos y pendientes de la agenda (`kind: 'todo'`): una sola vez.
- Rutina: una diaria aparece sola en Hoy si `routine !== false` y le toca el día (`days`, 0 = lunes; vacío =
  todos). `daily.selected` (los 3 espacios antiguos) sigue siendo válido pero la UI ya no lo usa.
- Desmarcar un check = anular sus eventos de ese día (corrección, no castigo); siempre con "Deshacer".
  Duplicados: gana el primer **registro** (por `createdAt`), no la fecha más antigua, para que registrar
  algo nuevo nunca invalide algo que ya contaba.
- Racha: día con ≥1 misión → racha +1 y bono `min(5·n, 35)` a Disciplina. Día de descanso → no rompe, no
  suma, no da bono. Máximo 2 descansos por semana (lunes–domingo), respetados en orden de registro; un día
  con misiones no gasta cupo. Un día vacío ya terminado → racha 0. Hoy nunca rompe la racha.
- Niveles: pasar de n a n+1 cuesta 250·n. XP acumulada para el nivel L = 125·L·(L−1)
  (nivel 2 = 250, 5 = 2,500, 10 = 11,250).
- Títulos: 1 Aprendiz, 5 Explorador, 10 Constructor, 15 Estratega, 20 Leyenda. Premio real cada 5 niveles
  (definido por el usuario en Ajustes → `settings.levelRewards`).
- Atributos: valor inicial (calificado una vez, evento `profile.attributes_rated`; cuenta el primero) +
  `floor(XP del atributo / 100)`, tope 100.
- XP por atributo: misión → su atributo; racha → Disciplina; lección → atributo de la misión fallida o
  Inteligencia; rango de habilidad → atributo de la habilidad; fase de jefe → atributo de su misión
  principal; jefe recurrente → atributo del jefe; descubrimiento → Creatividad; logro → solo XP total.
- Energía: ≥7 h = 100, ≥6 h = 75, menos = 50. Energía ≤ 50 → solo se sugieren misiones chicas y de
  recuperación.
- Logro 50 · Rango de habilidad 100 · Fase de jefe 300 · Jefe recurrente 30 · Descubrimiento 30 · Lección 30.
- Jefes: fases en orden. Métricas: `manual`, `month_income`, `consecutive_months_income`,
  `weekly_streak` (misiones, veces por semana, semanas seguidas; la semana en curso no rompe la cuenta).
  `lockedUntilBossId` bloquea hasta vencer a otro jefe (El Imperio ← El Dragón).
- Logros automáticos (condición medible) o manuales; uno automático también se puede desbloquear a mano.
- Habilidades: rangos Aprendiz → Experto → Maestro, en orden y solo con evidencia escrita.
- NPC clave sin contacto ≥ 30 días → misión generada "Escribirle a X" (chica, Relaciones). Completarla
  cuenta como interacción.
- Mapa: inexplorado → descubierto → dominado. El primer descubrimiento de cada lugar da XP (una vez).
- Temporadas de 13 semanas. Diario semanal de 3 líneas (`journal.weekly`, la última versión de la semana
  gana). Revisión de inicio/fin (`season.review`); la de fin desbloquea "Temporada completa".
- Mi vida en semanas, dos vistas: **por año calendario** (por defecto; filas = años enero–diciembre, columnas =
  semanas lunes–domingo recortadas al año, 53 o 54; `calendarYearWeeks`) y **por cumpleaños** (90 filas × 52
  columnas; la columna 52 absorbe los días sobrantes). Zoom: semana → 7 días; año → cada semana dividida en
  sus 7 días. Semanas/días pintados por XP (`heatLevel`). Hitos de vida: entidad `life/milestone`.
  "Semanas vividas" = floor(días vividos / 7).
- Misión sorpresa: el cliente sortea una al día (`pickForDate`) y la guarda como evento `bounty.drawn` (gana el
  primero del día) para que editar el catálogo no cambie el historial. Completarla ese día da
  `bounty.bonusPercent` % extra (fuente `bounty`, atributo de la misión).
- Oro: 1 por cada `gold.xpPerGold` XP de cada entrada (floor). Se gasta con `reward.redeemed` en la tienda
  (`shop/reward`); un canje cuenta solo si alcanzaba el oro en su fecha (orden cronológico). Nunca toca la XP.
- Metas (`goals/goal`, evento `goal.progress`): al llegar al objetivo dan la XP de una misión de su tamaño
  (una vez). Las cumplidas se archivan, no se borran.
- Biblioteca (`library/book`, evento `library.finished`): XP de misión de su tamaño, una vez por libro.
- Plan del día (`plan.set`, `modules/plans.ts`): máx. 3 cosas para un día; la última versión gana. Una cosa
  está hecha si su misión se completó ese día. Cumplir todas da `goldBonus.planCompleted` de oro (no XP).
  Se planea desde Hoy ("Tus 3 de hoy") y al cerrar el día se ofrece planear mañana.
- Retos de N días (`challenges/challenge`, `challenge.started` / `challenge.checked`, `modules/challenges.ts`):
  cada `started` abre un intento si no hay otro en curso; un día ya terminado sin marcar lo hace fallar (hoy
  nunca). Completarlo da la XP de una misión de su tamaño (fuente `challenge`), una vez por intento.
- Oro extra (nunca XP): bono sorpresa al cerrar un día con ≥1 misión (`dayCloseBonus`, elegido por fecha de
  `goldBonus.dayCloseOptions`), y compromisos (`pledge.made` / `pledge.resolved`): se aparta lo apostado si
  alcanzaba el oro; cumplir devuelve `stake × pledge.payoutMultiplier`, fallar lo pierde; cuenta el primer resultado.
- Récords, tú vs. tú, datos sobre ti y ritmo: funciones puras en `engine/insights.ts` (no se guardan).
  Pantalla `/records`; aviso de récord en vivo con `ui/RecordWatcher.tsx`.
- Resumen semanal para compartir (`ui/WeekShare.tsx`): imagen PNG o texto por WhatsApp al compañero de
  cuentas (`settings.partner`).
- Sin XP (solo registro): enemigos (`habits/vice`, `vice.relapse`; cuenta días sin caer), cuerpo
  (`body.logged`), ahorro (`finance/savings`, `savings.moved`), presupuesto (`settings.budgets`), cierre del
  día (`day.closed`).

## Cómo agregar un sistema nuevo

1. `packages/core/src/events.ts`: agrega sus tipos de evento (schema zod + etiqueta).
2. `packages/core/src/types.ts`: tipos de su entidad y su entrada en `ENTITY_KINDS`.
3. `packages/core/src/engine/modules/<sistema>.ts`: un reductor `reduceX(ctx, deps)` que lea eventos con
   `ofType`, entidades con `entitiesOf` y dé XP solo con `ctx.addXp`. Regístralo en `project.ts`.
4. Pruebas en `packages/core/test/`. Corre `pnpm test`.
5. Pantalla en `apps/web/src/screens/`, ruta en `App.tsx` y acceso en `screens/Menus.tsx`.
6. Si necesita columnas nuevas en D1: edita `packages/db/src/schema.ts` y `pnpm db:generate`.
   Normalmente NO hace falta (el catálogo es JSON).

## Comandos

```
pnpm install
pnpm test                 # reglas del juego + API
pnpm typecheck
pnpm --filter @igv/web build
cd apps/api && cp .dev.vars.example .dev.vars && pnpm db:migrate:local && pnpm dev   # API + web en :8787
pnpm --filter @igv/web dev  # Vite en :5173 con proxy de /api a :8787
cd apps/api && pnpm dev:mcp   # servidor MCP en :8788 (misma D1 local)
```

## Decisiones técnicas

- Un solo Worker con Static Assets (no Pages + Worker): una URL, una política de Access, sin CORS.
- Estado de la app con un store propio (`useSyncExternalStore` + IndexedDB) en lugar de TanStack Query:
  hace falta cola sin conexión y proyección local; es más simple así.
- Sin librería de UI ni de íconos: CSS propio con tokens (`apps/web/src/styles.css`, paleta grafito y oro + estilos de color desbloqueables `[data-skin]`, tipografía `Plus Jakarta Sans` (también como `--font-display`, peso 800 y tracking cerrado) + `JetBrains Mono`; sin serif medieval) e íconos SVG en `ui/icons.tsx`. Tema claro/oscuro/automático (`lib/theme.ts`). Gráficas SVG propias (`ui/charts.tsx`), monograma evolutivo con iniciales, marco por título y anillo de avance de nivel (`ui/Avatar.tsx`), ícono sobrio de cada gran reto en un mosaico redondeado con anillo de avance opcional y barra de avance segmentada (`ui/BossArt.tsx`; `BossHpBar` recibe lo que falta y pinta el avance), mapa SVG por conocer/conocido/habitual (`screens/Mapa.tsx`) y árbol visual de habilidades (`screens/Habilidades.tsx`).
- Experiencia en vivo (fase 6, sin migraciones D1):
  - **Modo enfoque** (`ui/QuestMode.tsx`): pantalla de enfoque con cronómetro o cuenta regresiva persistente en `localStorage`, sub-pasos de sesión, avance del gran reto vinculado y audio ambiental sintético (`lib/sound.ts`: fuego / lluvia con WebAudio).
  - **Resumen del día y Reto del día** (`lib/narrator.ts`): resumen del día con tono de coach, lo que tienes a tu favor / en contra, reto del día y vínculo reto↔misión calculados 100 % en el cliente desde `GameState` (sin IA ni costo).
  - **Estilo de la app** (`lib/themes.ts`, pestaña en `screens/Tienda.tsx`): paletas de color (Grafito, Bosque, Vino, Medianoche = `obsidian`, `emerald`, `crimson`, `royal`) que se desbloquean con oro usando `reward.redeemed` y se eligen en `settings.equipped.skin`. Las auras y emblemas del avatar (la antigua "Armería RPG") se retiraron por verse demasiado fantasía; si había canjes de ellos, la pestaña ofrece anularlos para recuperar el oro. Preferencia del usuario: estética sobria de "vida real", nada otaku.
  - **Celebraciones y feedback** (`ui/fx.tsx`, `lib/sound.ts`): banners de logro desbloqueado, "Avanzaste en el reto" (meta mensual de ingresos), rango de habilidad, día perfecto, misiones del día, y overlays de "Fase completada" / "Reto superado" y subida de nivel con monograma.
  - **Cierre del día** (`CampfireCard` / `CloseDaySheet` en `screens/Hoy.tsx`, evento `day.closed`): resumen del día y una nota.
  - **Dictado por voz** (`lib/voice.ts`): Web Speech API (`es-MX`) en QuickAdd y Coach, con tarjetas de oferta de misión aceptables con 1 toque.
- Registro rápido: `ui/QuickAdd.tsx` (botón + global; `openQuickAdd({ mode, date })` desde cualquier pantalla; `/?accion=gasto` lo abre desde los accesos directos del manifest). Hoja de un día: `ui/DaySheet.tsx`.
- Preferencias del dispositivo (sonido, vibración, notificaciones) en `localStorage` (`lib/prefs.ts`), no en D1.
- Coach IA (fase 4; antes "Game Master", las rutas conservan `gm`): `POST /api/gm/ask` (conversar y ACTUAR con las herramientas de
  `packages/core/src/assistant`, ver "Conectar IA (MCP)") y `POST /api/gm/parse` (texto libre → propuestas de
  registro con salida estructurada `output_config.format`; el cliente las muestra y el usuario confirma). Ambos usan el SDK oficial `@anthropic-ai/sdk`, modelo
  `claude-opus-5-5` (cambiable con la variable `ANTHROPIC_MODEL`), respaldo automático ante rechazos
  (`fallbacks: "default"`). El cliente arma un resumen del estado; la clave es el secreto
  `ANTHROPIC_API_KEY` del Worker. El prompt (`apps/api/src/gm.ts`) es de un coach de rendimiento personal,
  directo y cálido, en español de México, sin lenguaje de fantasía. En "Conversar" el Coach puede registrar por ti (cada acción
  queda en la bitácora con "Deshacer"); en "Registrar mi día" solo propone y tú confirmas.
- Despliegue: GitHub Actions (`.github/workflows/deploy.yml`) → pruebas → crea la base D1 si no existe
  (por nombre `igv-experience`) → migraciones D1 → `wrangler deploy` (app) → `wrangler deploy -c wrangler.mcp.jsonc` (MCP). Secreto: `CLOUDFLARE_API_TOKEN` (`CLOUDFLARE_ACCOUNT_ID` opcional).
  `keep_vars: true` conserva las variables configuradas en el panel de Cloudflare.

## Convenciones

- Todo el texto visible en español (México). Fechas de día como `'YYYY-MM-DD'` en hora de CDMX.
- No guardes estado derivado en la base de datos. No restes XP nunca.
- No edites migraciones ya desplegadas; crea nuevas.
- Mantén este archivo y el README al día al terminar cada cambio grande.
