# CLAUDE.md — IGV EXPERIENCE

Contexto para futuras sesiones con IA. Léelo completo antes de cambiar algo.

## Qué es

Tablero personal de **Iván Gómez Vera** para jugar su vida real como un RPG. Registra lo que hace fuera
de la app (misiones, ingresos, lecciones, etc.) y lo convierte en XP, niveles, atributos, rachas, jefes y
logros. Un solo usuario, uso diario, en español, pensado primero para celular (PWA). Proyecto a largo plazo:
se le irán agregando sistemas.

## Arquitectura

```
packages/core   Reglas del juego en TypeScript puro (sin red ni DOM). Probadas con Vitest.
  src/config/game.ts   ★ TODOS los números del juego. Cambiar uno recalcula todo el historial.
  src/events.ts        Tipos de evento + validación (zod). La API y el cliente usan lo mismo.
  src/types.ts         Tipos de entidades del catálogo y ENTITY_KINDS (lista blanca de la API).
  src/engine/project.ts  project(): eventos + catálogo + config → estado completo del juego.
  src/engine/modules/  Un reductor por sistema (misiones, racha, lecciones, dinero, jefes,
                       habilidades, mapa/NPCs, temporadas, logros, atributos).
  src/seed/            Datos iniciales (IDs fijos) y guía de atributos (30/70).
packages/db     Esquema Drizzle (2 tablas) y migraciones SQL de D1.
apps/api        Worker de Cloudflare con Hono: /api/* (sync, eventos, catálogo, respaldo, Game Master).
                El mismo Worker sirve el frontend (Workers Static Assets, SPA).
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

Cloudflare Access protege todo el dominio *.workers.dev del Worker. Además la API verifica el JWT de
Access (`Cf-Access-Jwt-Assertion`, con `jose`) y que el correo esté en `ALLOWED_EMAILS`. Si faltan las
variables, la API responde 503 (falla cerrada). `DEV_BYPASS_AUTH=true` solo funciona si `ACCESS_AUD`
NO está definido (desarrollo local con `.dev.vars`).

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
- Diarias y misiones de NPC: una vez por día. Secundarias, capítulos y eventos: una sola vez.
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
- Mi vida en semanas: 90 filas (años de cumpleaños a cumpleaños) × 52 columnas; la columna 52 absorbe los
  días sobrantes. "Semanas vividas" = floor(días vividos / 7).

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
```

## Decisiones técnicas

- Un solo Worker con Static Assets (no Pages + Worker): una URL, una política de Access, sin CORS.
- Estado de la app con un store propio (`useSyncExternalStore` + IndexedDB) en lugar de TanStack Query:
  hace falta cola sin conexión y proyección local; es más simple así.
- Sin librería de UI ni de íconos: CSS propio con tokens (`apps/web/src/styles.css`) e íconos SVG en
  `ui/icons.tsx`. Tema claro/oscuro/automático (`lib/theme.ts`).
- Game Master (fase 4): `POST /api/gm/ask` con el SDK oficial `@anthropic-ai/sdk`, modelo
  `claude-opus-5-5` (cambiable con la variable `ANTHROPIC_MODEL`), respaldo automático ante rechazos
  (`fallbacks: "default"`). El cliente arma un resumen del estado; la clave es el secreto
  `ANTHROPIC_API_KEY` del Worker. El GM solo propone; no registra nada por sí mismo.
- Despliegue: GitHub Actions (`.github/workflows/deploy.yml`) → pruebas → crea la base D1 si no existe
  (por nombre `igv-experience`) → migraciones D1 → `wrangler deploy`. Secretos: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
  `keep_vars: true` conserva las variables configuradas en el panel de Cloudflare.

## Convenciones

- Todo el texto visible en español (México). Fechas de día como `'YYYY-MM-DD'` en hora de CDMX.
- No guardes estado derivado en la base de datos. No restes XP nunca.
- No edites migraciones ya desplegadas; crea nuevas.
- Mantén este archivo y el README al día al terminar cada cambio grande.
