# IGV EXPERIENCE

Tu vida real como un RPG. Registra lo que haces fuera de la app (misiones, ingresos, lecciones, entrenos,
conversaciones) y lo convierte en XP, niveles, atributos, rachas, jefes y logros.

- **Privada**: solo tú entras, con Cloudflare Access (código a tu correo).
- **Sincronizada**: celular y computadora leen la misma base de datos (Cloudflare D1). Funciona sin
  conexión y sube los cambios al reconectar.
- **Recalculable**: cada acción es un evento con fecha. Si cambias un número del juego, todo el historial
  se recalcula sin perder nada.
- **Instalable** en la pantalla de inicio (PWA), modo claro y oscuro.
- **Gratis**: cabe en el plan gratuito de Cloudflare.

## Qué incluye

| Fase | Contenido |
|---|---|
| 1. Base | Hoy, Misiones (principales con capítulos, secundarias, diarias, eventos), XP, niveles y títulos, racha y Día de descanso, energía, atributos con guía 30/70, Mi vida en semanas, respaldo JSON, bitácora para anular errores |
| 2. Progresión | Jefes con fases automáticas o manuales, jefes recurrentes, logros (vitrina), habilidades con evidencia, temporadas con revisión de inicio/fin, diario semanal y foto de atributos |
| 3. Mundo | Inventario (ingresos, gastos, resumen mensual, herramientas, conocimientos), NPCs y gremios con aviso a los 30 días, mapa |
| 4. Game Master IA (opcional) | Asistente que lee tu progreso y te propone misiones con la API de Claude y tu propia clave |

Los números del juego están en [`packages/core/src/config/game.ts`](packages/core/src/config/game.ts).
Las reglas y decisiones técnicas están en [`CLAUDE.md`](CLAUDE.md).

---

## Configuración inicial (una sola vez)

Necesitas: tu cuenta de GitHub y tu cuenta de Cloudflare. Tiempo: unos 20 minutos.

### 1. Crea la base de datos D1

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) → **Storage & Databases** → **D1 SQL Database** → **Create**.
2. Nombre: `igv-experience`. Crear.
3. Copia el **Database ID** (algo como `a1b2c3d4-…`).

### 2. Crea un token de API de Cloudflare

1. Arriba a la derecha, tu perfil → **My Profile** → **API Tokens** → **Create Token**.
2. Usa la plantilla **Edit Cloudflare Workers** y, en *Permissions*, agrega una fila más:
   **Account → D1 → Edit**.
3. En *Account Resources* elige tu cuenta. Crea el token y cópialo (solo se muestra una vez).
4. Copia también tu **Account ID** (está en la página principal del panel, columna derecha, o en la URL
   `dash.cloudflare.com/<ACCOUNT_ID>/…`).

### 3. Guarda los secretos en GitHub

En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**. Crea tres:

| Nombre | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | el token del paso 2 |
| `CLOUDFLARE_ACCOUNT_ID` | tu Account ID |
| `D1_DATABASE_ID` | el Database ID del paso 1 |

### 4. Primer despliegue

Ve a la pestaña **Actions** del repositorio → **Pruebas y despliegue** → **Run workflow** (o sube cualquier
cambio a `main`). Cuando termine en verde, el Worker `igv-experience` existe en Cloudflare con la URL
`https://igv-experience.<tu-subdominio>.workers.dev`.

> En este punto la API responde "Acceso no configurado" a propósito: no entrega datos hasta que actives Access.

### 5. Activa Cloudflare Access (solo tú entras)

1. En el panel: **Workers & Pages → igv-experience → Settings → Domains & Routes**.
   En la fila **workers.dev**, activa **Cloudflare Access** (*Enable Cloudflare Access*).
   Si es tu primera vez con Zero Trust, te pedirá elegir un nombre de equipo y el plan **Free**
   (puede pedirte un método de pago aunque no cobra).
2. Abre **Zero Trust → Access → Applications**. Verás una aplicación para `igv-experience…workers.dev`.
   Edítala → **Policies**: deja una sola política *Allow* con regla **Emails** = tu correo.
   Método de inicio de sesión: **One-time PIN** (te llega un código al correo).
3. En esa aplicación, copia el **Application Audience (AUD) Tag** (en *Overview* o *Basic information*).
4. Tu **team domain** está en **Zero Trust → Settings → Custom Pages** (o *Team name*):
   es `<tu-equipo>.cloudflareaccess.com`.
5. Vuelve a **Workers & Pages → igv-experience → Settings → Variables and Secrets** y agrega
   (tipo *Text*):

| Variable | Valor |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<tu-equipo>.cloudflareaccess.com` |
| `ACCESS_AUD` | el AUD Tag del paso 3 |
| `ALLOWED_EMAILS` | tu correo (si son varios, separados por coma) |

Guarda (*Deploy*). Listo: abre la URL, entra con el código que llega a tu correo y empieza a jugar.

### 6. Instálala en tu celular

- **iPhone (Safari)**: abre la URL → botón Compartir → **Agregar a pantalla de inicio**.
- **Android (Chrome)**: abre la URL → menú ⋮ → **Instalar app** (o *Agregar a pantalla principal*).

La primera vez te pedirá tu fecha de nacimiento (para *Mi vida en semanas*) y, en Personaje, calificar
tus 7 atributos iniciales con la guía de 30 y 70.

### 7. (Opcional) Activa el Game Master IA

1. Crea una clave en [platform.claude.com](https://platform.claude.com) → **API Keys**.
2. **Workers & Pages → igv-experience → Settings → Variables and Secrets → Add** → tipo **Secret**,
   nombre `ANTHROPIC_API_KEY`, valor tu clave.
3. Abre **Mundo → Game Master**. Usa el modelo `claude-opus-5-5`; para cambiarlo, agrega la variable
   `ANTHROPIC_MODEL`. Cada pregunta consume tokens de tu cuenta de la API de Claude.

---

## Uso diario

1. **En la mañana**: check-in de sueño (energía), elige tus 3 diarias (trabajo, cuerpo, libre).
2. **Durante el día**: toca ✓ al completar. Registra ingresos en el Dragón Financiero.
3. **Si fallaste**: "Escribir lección" (+30 XP). **Si no puedes**: "Día de descanso" (máx. 2 por semana).
4. **Domingo**: diario semanal de 3 líneas en Temporadas.
5. **¿Te equivocaste?** Ajustes → Bitácora de eventos → **Anular**. Nada se borra; solo deja de contar.
6. **Respaldo**: Ajustes → Exportar respaldo (JSON). Guárdalo de vez en cuando.

## Desarrollo local

```bash
pnpm install
pnpm test
cd apps/api
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm --filter @igv/web build && pnpm dev     # todo en http://localhost:8787
```

Para trabajar en la interfaz con recarga instantánea, deja `pnpm dev` corriendo en `apps/api` y en otra
terminal corre `pnpm --filter @igv/web dev` (http://localhost:5173, con proxy de `/api`).

## Cambiar números del juego

Edita [`packages/core/src/config/game.ts`](packages/core/src/config/game.ts), corre `pnpm test` y sube el
cambio a `main`. Al desplegarse, todo tu historial se recalcula con los números nuevos.

## Estructura

```
packages/core   reglas del juego + pruebas (Vitest)
packages/db     esquema y migraciones de D1 (Drizzle)
apps/api        Worker (Hono): API + sirve la web
apps/web        React + Vite + PWA
```

## Plan gratuito de Cloudflare

Workers: 100,000 peticiones al día. D1: 5 GB y 5 millones de filas leídas al día. Access: hasta 50
usuarios. El uso de una persona queda muy por debajo de estos límites.
