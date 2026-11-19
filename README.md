# IGV EXPERIENCE

Tu vida real, medida y con progreso. Registra lo que haces fuera de la app (misiones, ingresos, lecciones,
entrenos, conversaciones) y lo convierte en XP, niveles, atributos, rachas, grandes retos y logros.
Mecánicas de juego, lenguaje y estética sobrios de app de rendimiento personal (nada de fantasía).

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
| 2. Progresión | Grandes retos con fases automáticas o manuales, retos recurrentes, logros (vitrina), habilidades con evidencia, temporadas con revisión de inicio/fin, diario semanal y foto de atributos |
| 3. Más | Dinero y recursos (ingresos, gastos, resumen mensual, herramientas, conocimientos), Mi gente (personas y círculos) con aviso a los 30 días, mapa |
| 4. Coach IA (opcional) | Coach que lee tu progreso y te propone misiones con la API de Claude y tu propia clave |
| 5. Registro rápido | Botón **+** para registrar todo con un toque (misión sin catálogo, dinero con montos rápidos, persona, agenda, meta, cuerpo, descanso, días pasados), rutina de diarias con checks y "Deshacer", deslizar para completar, favoritos, agenda, misión sorpresa con bono, oro y tienda de premios reales, avatar que evoluciona, sonidos y vibración, cierre del día, reporte semanal con resumen del Coach, registro por texto libre con el Coach, notificaciones push, Mi vida en semanas por año calendario con zoom a año y a días, hitos de vida, historial en calendario, estadísticas, metas con contador, hábitos a dejar, presupuesto y ahorro, biblioteca, cuerpo, buscador y "Mi año en review" (imagen/PDF) |
| 6. Experiencia en vivo | Identidad visual sobria en grafito y oro con tipografía Plus Jakarta Sans (más estilos de color desbloqueables), monograma evolutivo (iniciales + anillo de nivel), **Modo enfoque** (temporizador/cronómetro, sub-pasos, avance del reto vinculado y sonido ambiental de fuego/lluvia), Resumen del día local sin IA, lo que tienes a tu favor / en contra y Reto del día, grandes retos con ícono y barra de avance segmentada, **Estilo de la app** en la tienda (paletas de color con oro), **Cierre del día**, celebraciones de logros, día perfecto y avance en retos, mapa interactivo (por conocer → conocido → habitual), árbol visual de habilidades, tarjetas de misión aceptables con un toque en el Coach y dictado por voz |
| 7. Vida real | Lenguaje sobrio (Perfil, Grandes retos, Mi gente, Coach, Cierre del día), **Tus 3 de hoy** (planear el día y mañana, bono de oro al cumplir), **Tú vs. tú** contra la semana pasada a la misma hora, **Récords y datos** (récords personales, patrones de sueño/día/hora, ritmo de metas e ingresos), **Retos de N días** (no rompas la cadena), **Compromisos** con oro en juego, bono sorpresa al cerrar el día y **resumen semanal** compartible por imagen o WhatsApp |
| 8. Conectar IA | **Servidor MCP** para usar tu app desde Claude (web, escritorio, celular y Claude Code), ChatGPT, Codex, Antigravity o Cursor: ve tu progreso y registra, planea y organiza por ti desde el chat. Conexión con inicio de sesión (OAuth, apruebas en la app) o con llaves, modo solo lectura, **bitácora de lo que hizo la IA con "Deshacer"**, y el **Coach de la app ahora también actúa** (registra por ti) |

Los números del juego están en [`packages/core/src/config/game.ts`](packages/core/src/config/game.ts).
Las reglas y decisiones técnicas están en [`CLAUDE.md`](CLAUDE.md).

---

## Configuración inicial (una sola vez)

**La forma más fácil:** abre Claude Code en tu PC y dile:
*"Lee CONFIGURAR-CON-CLAUDE-CODE.md del repo ivangomeznegocios-hub/igv-experience y hazlo todo."*
Tú solo inicias sesión y escribes el código que te llegue al correo.
Las instrucciones completas están en [`CONFIGURAR-CON-CLAUDE-CODE.md`](CONFIGURAR-CON-CLAUDE-CODE.md).

Todo es gratis: Cloudflare Workers, D1 y Access en su plan Free, y GitHub Actions en un repositorio
privado (2,000 minutos al mes; cada despliegue usa unos 2). Lo único con costo es el Coach IA,
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

La primera vez te pedirá tu fecha de nacimiento (para *Mi vida en semanas*) y, en Perfil, calificar
tus 7 atributos iniciales con la guía de 30 y 70.

### (Opcional) Activa el Coach IA

1. Crea una clave en [platform.claude.com](https://platform.claude.com) → **API Keys**.
2. **Workers & Pages → igv-experience → Settings → Variables and Secrets → Add** → tipo **Secret**,
   nombre `ANTHROPIC_API_KEY`, valor tu clave.
3. Abre **Más → Coach**. Usa el modelo `claude-opus-5-5`; para cambiarlo, agrega la variable
   `ANTHROPIC_MODEL`. Cada pregunta consume tokens de tu cuenta de la API de Claude.

### Conecta tu app a tu asistente de IA (MCP)

Abre **Más → Conectar IA**: ahí está la URL del servidor MCP, las instrucciones con tus datos ya puestos y
la bitácora de todo lo que hizo la IA (con "Deshacer"). La URL es:

```
https://igv-experience-mcp.<tu-subdominio>.workers.dev/mcp
```

- **Claude (claude.ai, escritorio y celular)**: Configuración → Conectores → *Agregar conector personalizado*
  → pega la URL → **Conectar**. Se abre tu app (con el código de Cloudflare a tu correo si hace falta) y
  tocas **Permitir**. Queda disponible en todas tus apps de Claude.
- **Claude Code**: `claude mcp add --transport http --scope user igv <URL>` y luego `/mcp` → *Authenticate*.
- **Codex**: `codex mcp add igv --url <URL>` y `codex mcp login igv` (o una llave con `bearer_token_env_var`).
- **Antigravity**: en *MCP Servers → View raw config* agrega `"igv": { "serverUrl": "<URL>", "headers": { "Authorization": "Bearer <llave>" } }`.
- **Otros** (ChatGPT en modo desarrollador, Cursor, VS Code…): URL + OAuth, o el encabezado `Authorization: Bearer <llave>`.

Las **llaves** se crean en esa misma pantalla (se muestran una sola vez; revócalas cuando quieras). Con
el interruptor **Permisos** dejas a la IA en solo lectura. Ejemplos para el chat: *"¿cómo voy hoy?"*,
*"registra que entrené y leí"*, *"anota un gasto de $350 en comida"*, *"agéndame llamar al contador el
viernes"*, *"arma mis 3 de mañana"*, *"crea una meta de leer 12 libros este año"*.

No cuesta nada extra: el servidor MCP es un segundo Worker en el plan gratuito y la IA la pagas en tu
propia suscripción (Claude, ChatGPT…). Se despliega solo con el resto; no lleva Cloudflare Access (los
asistentes no pueden pasar por él), por eso cada conexión se aprueba en la app, que sí lo lleva.

### Notificaciones

Están **apagadas**: la app no manda nada al celular ni corre tareas automáticas en Cloudflare. El código
está listo por si algún día las quieres; se activan pidiéndoselo a Claude Code (ver `CLAUDE.md`).

---

## Uso diario

1. **En la mañana**: check-in de sueño (energía). Tu **rutina** de diarias ya aparece como lista de checks.
2. **Durante el día**: toca el check (o desliza →) al completar. ¿Algo que no está en el catálogo? Botón
   **+ → Hice algo**. Ingresos, gastos, personas, metas y entrenos también van por el **+**.
3. **¿Te equivocaste?** Toca otra vez el check o "Deshacer" en el aviso. Para días pasados: Progreso →
   Historial → toca el día. Nada se borra; solo deja de contar.
4. **¿Se te olvidó ayer?** En el **+** elige "Ayer" (o cualquier fecha) antes de registrar.
5. **Si fallaste**: "Escribir lección" (+30 XP). **Si no puedes**: "Día de descanso" (máx. 2 por semana).
6. **En la noche**: "Cerrar el día" (resumen + una línea). Planea mañana con **+ → Por hacer**.
7. **Domingo**: diario semanal de 3 líneas en Temporadas y Reporte semanal.
8. **Respaldo**: Ajustes → Exportar respaldo (JSON). Guárdalo de vez en cuando.

Atajos: mantén presionado el ícono de la app instalada para "Registrar misión / gasto / ingreso / Planear".

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

Servidor MCP en local: en otra terminal, `cd apps/api && pnpm dev:mcp` (http://localhost:8788/mcp; comparte
la base D1 local con la app).

## Cambiar números del juego

Edita [`packages/core/src/config/game.ts`](packages/core/src/config/game.ts), corre `pnpm test` y sube el
cambio a `main`. Al desplegarse, todo tu historial se recalcula con los números nuevos.

## Estructura

```
packages/core   reglas del juego + pruebas (Vitest)
packages/db     esquema y migraciones de D1 (Drizzle)
apps/api        Workers (Hono): API + web, y el servidor MCP (wrangler.mcp.jsonc)
apps/web        React + Vite + PWA
```

## Plan gratuito de Cloudflare

Workers: 100,000 peticiones al día (entre la app y el servidor MCP). D1: 5 GB y 5 millones de filas leídas al día. Access: hasta 50
usuarios. El uso de una persona queda muy por debajo de estos límites.
