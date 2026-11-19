import { mcpApp } from './ai/mcp';

/**
 * Worker del servidor MCP (`igv-experience-mcp`). Público a propósito (sin Cloudflare Access): los asistentes
 * de IA se identifican con OAuth o con una llave creada en la app. Comparte la base D1 con la app.
 */
export default {
  fetch: mcpApp.fetch,
  request: mcpApp.request,
};
