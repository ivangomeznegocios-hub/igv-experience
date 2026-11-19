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

**La forma más fácil:** abre Claude Code en tu PC y dile:
*"Lee CONFIGURAR-CON-CLAUDE-CODE.md del repo ivangomeznegocios-hub/igv-experience y hazlo todo."*
Tú solo inicias sesión y escribes el código que te llegue al correo.
Las instrucciones completas están en [`CONFIGURAR-CON-CLAUDE-CODE.md`](CONFIGURAR-CON-CLAUDE-CODE.md).

Todo es gratis: Cloudflare Workers, D1 y Access en su plan Free, y GitHub Actions en un repositorio
privado (2,000 minutos al mes; cada despliegue usa unos 2). Lo único con costo es el Game Master IA,
que es opcional.

Resumen de lo que se hace (a mano son unos 5 minutos):

1. **Un token de Cloudflare**: [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   → Create Token → plantilla **Edit Cloudflare Workers** + permiso **Account · D1 · Edit**.
2. **Un secreto en GitHub**: `CLOUDFLARE_API_TOKEN` (Settings → Secrets and variables → Actions).
3. **Desplegar**: Actions → Pruebas y despliegue → Run workflow. La base de datos se crea sola.
4. **Un interruptor**: Workers & Pages → igv-experience → Settings → Domains & Routes → workers.dev →
   **Enable Cloudflare Access** (plan Free de Zero Trust; deja tu correo como único permitido).
5. **Entra** a `https://igv-experience.<tu-subdominio>.workers.dev` con el código que te llega al correo.
   En ese primer ingreso la app ancla tu correo: desde ahí nadie más puede entrar, aunque tuviera otra
   cuenta de Cloudflare.

### Instálala en tu celular

- **iPhone (Safari)**: abre la URL → botón Compartir → **Agregar a pantalla de inicio**.
- **Android (Chrome)**: abre la URL → menú ⋮ → **Instalar app** (o *Agregar a pantalla principal*).

La primera vez te pedirá tu fecha de nacimiento (para *Mi vida en semanas*) y, en Personaje, calificar
tus 7 atributos iniciales con la guía de 30 y 70.

### (Opcional) Activa el Game Master IA

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
