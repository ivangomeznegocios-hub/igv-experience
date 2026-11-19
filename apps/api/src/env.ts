export interface Env {
  DB: D1Database;
  /** Dominio del equipo de Cloudflare Access, p. ej. "miequipo.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** "Application Audience (AUD) Tag" de la aplicación de Access */
  ACCESS_AUD?: string;
  /** Correo(s) permitidos, separados por coma */
  ALLOWED_EMAILS?: string;
  /** Solo para desarrollo local (.dev.vars). Nunca en producción. */
  DEV_BYPASS_AUTH?: string;
  /** Clave de la API de Claude para el Game Master (secreto, opcional) */
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

export type AppEnv = { Bindings: Env; Variables: { email: string } };
