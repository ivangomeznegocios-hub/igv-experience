# @igv/db

Esquema de Drizzle para D1 y migraciones SQL.

- Cambiar el esquema: edita `src/schema.ts` y corre `pnpm db:generate` desde la raíz.
- Las migraciones en `migrations/` se aplican solas en cada despliegue (`wrangler d1 migrations apply`).
- Nunca edites una migración ya desplegada: crea una nueva.
