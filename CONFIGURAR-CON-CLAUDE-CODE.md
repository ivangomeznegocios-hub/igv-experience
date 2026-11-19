# Instrucciones para Claude Code: dejar IGV EXPERIENCE en línea

> Iván: abre Claude Code en tu PC dentro de una copia de este repositorio (o en cualquier carpeta) y pégale:
> **"Lee CONFIGURAR-CON-CLAUDE-CODE.md del repo ivangomeznegocios-hub/igv-experience y hazlo todo."**
> Lo único que tendrás que hacer tú: iniciar sesión cuando el navegador lo pida y escribir el código que
> Cloudflare te mande al correo.

---

## Para Claude Code

Objetivo: desplegar este proyecto en Cloudflare (plan gratuito) con despliegue automático desde GitHub y
acceso privado solo para Iván. Todo es gratis; no actives nada de pago. Usa el navegador para los paneles
de Cloudflare y GitHub, y la terminal (`gh`, `npx wrangler`) cuando sea más rápido.

Reglas:
- Nunca escribas el token de Cloudflare en archivos del repo, en commits ni en la salida de la terminal.
- No actives planes de pago. Si Cloudflare Zero Trust pide elegir plan, elige **Free** (0 USD).
- Si un paso pide iniciar sesión o un código del correo, pídeselo a Iván y espera.

### Paso 1. Token de API de Cloudflare

1. Abre https://dash.cloudflare.com/profile/api-tokens → **Create Token**.
2. Plantilla **Edit Cloudflare Workers** → **Use template**.
3. En *Permissions* agrega una fila: **Account · D1 · Edit**.
4. En *Account Resources*: **Include · <la cuenta de Iván>** (una sola cuenta).
   En *Zone Resources*: **All zones** (la plantilla lo pide; no se usa).
5. **Continue to summary → Create Token**. Copia el token (solo se muestra una vez).

### Paso 2. Guardar el token en GitHub (único secreto)

Opción rápida si `gh` está instalado y con sesión (`gh auth status`):

```bash
gh secret set CLOUDFLARE_API_TOKEN -R ivangomeznegocios-hub/igv-experience
```

(pega el token cuando lo pida; así no queda en el historial de la terminal).

Opción navegador: https://github.com/ivangomeznegocios-hub/igv-experience/settings/secrets/actions →
**New repository secret** → nombre `CLOUDFLARE_API_TOKEN`, valor el token.

Solo si el token tiene acceso a más de una cuenta de Cloudflare, agrega también `CLOUDFLARE_ACCOUNT_ID`.

### Paso 3. Desplegar

```bash
gh workflow run deploy.yml -R ivangomeznegocios-hub/igv-experience --ref main
gh run watch -R ivangomeznegocios-hub/igv-experience --exit-status
```

(o en el navegador: pestaña **Actions → Pruebas y despliegue → Run workflow**).

El workflow corre las pruebas, **crea la base D1 `igv-experience` si no existe**, aplica las migraciones y
despliega el Worker. Al terminar, la URL es `https://igv-experience.<subdominio>.workers.dev`
(el subdominio aparece en el log de `wrangler deploy` y en Workers & Pages). Si es la primera vez que la
cuenta usa Workers, puede pedir elegir un subdominio de workers.dev en el panel: elige uno.

### Paso 4. Activar Cloudflare Access (un interruptor)

1. https://dash.cloudflare.com → **Workers & Pages → igv-experience → Settings → Domains & Routes**.
2. En la fila **workers.dev**, activa **Cloudflare Access** (*Enable Cloudflare Access*).
   - Si es la primera vez con Zero Trust: elige un nombre de equipo (p. ej. `igv`) y el plan **Free**.
3. Abre **Zero Trust → Access → Applications**, entra a la aplicación de `igv-experience…workers.dev` y
   revisa su política: debe ser **Allow** con **Include → Emails → el correo de Iván** (solo ese).
   Método de inicio de sesión: **One-time PIN**.

No hace falta configurar variables: el Worker ancla automáticamente el equipo de Access, la aplicación y
el correo en el primer ingreso, y desde ahí solo acepta exactamente eso.

### Paso 5. Primer ingreso (Iván)

1. Abre la URL del Worker. Cloudflare pedirá el correo y mandará un código: **Iván lo escribe**.
2. La app pide la fecha de nacimiento y muestra la pantalla **Hoy**.
3. Verifica que `https://<url>/api/me` responde `{"email":"<correo de Iván>"}`.

### Paso 6. Instalar en el celular

- iPhone (Safari): Compartir → **Agregar a pantalla de inicio**.
- Android (Chrome): menú ⋮ → **Instalar app**.

### Paso 7 (opcional). Conectar IA (MCP)

El despliegue también crea el Worker **`igv-experience-mcp`** (el servidor MCP). **No le actives Cloudflare
Access**: los asistentes de IA no pueden pasar por ese inicio de sesión; cada conexión se aprueba en la app
(que sí tiene Access) o usa una llave creada en la app. Si la cuenta protege *todos* los Workers con Access
(política a nivel de cuenta), agrega una excepción (Bypass) solo para `igv-experience-mcp`.

Iván abre **Más → Conectar IA** en la app y sigue las instrucciones de su asistente (Claude, Claude Code,
Codex, Antigravity…). Verifica que `https://igv-experience-mcp.<subdominio>.workers.dev/` responde un JSON
con `"mcp": ".../mcp"`.

### Si algo falla

- *El workflow dice "Falta el secreto CLOUDFLARE_API_TOKEN"*: repite el paso 2.
- *Error de permisos de D1 o de cuenta*: el token necesita **Account · D1 · Edit** y una sola cuenta
  (o agrega `CLOUDFLARE_ACCOUNT_ID`).
- *La app dice "Activa Cloudflare Access"*: falta el paso 4.
- *Claude/Codex no logran conectar al MCP*: revisa que `igv-experience-mcp` NO tenga Access y que su URL
  termine en `/mcp`. Con dominio propio, define `MCP_URL` (en `igv-experience`) y `APP_URL` (en
  `igv-experience-mcp`) en Settings → Variables.
- *Hay que cambiar el correo autorizado* (reinicia el anclaje; los datos del juego no se tocan):

  ```bash
  npx wrangler d1 execute igv-experience --remote --command "DELETE FROM server_meta WHERE key='access_pin'"
  ```

### Opcional: Game Master IA (único componente con costo, por uso)

Solo si Iván lo pide: en **Workers & Pages → igv-experience → Settings → Variables and Secrets** agrega el
secreto `ANTHROPIC_API_KEY` con una clave de https://platform.claude.com. Sin esa clave todo lo demás
funciona y no cuesta nada.
