import { describe, expect, it } from 'vitest';
import app from '../src/index';

const req = (path: string, env: Record<string, unknown>, init?: RequestInit) => app.request(path, init, env as any);

describe('seguridad de la API', () => {
  it('/api/health responde sin sesión', async () => {
    const res = await req('/api/health', {});
    expect(res.status).toBe(200);
  });

  it('falla cerrada si Access no está configurado', async () => {
    const res = await req('/api/me', {});
    expect(res.status).toBe(503);
  });

  it('rechaza solicitudes sin token cuando Access está configurado', async () => {
    const res = await req('/api/me', { ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAILS: 'yo@ejemplo.com' });
    expect(res.status).toBe(401);
  });

  it('el modo de desarrollo se ignora si Access está configurado', async () => {
    const res = await req('/api/me', { DEV_BYPASS_AUTH: 'true', ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAILS: 'yo@ejemplo.com' });
    expect(res.status).toBe(401);
  });

  it('en desarrollo local permite pasar', async () => {
    const res = await req('/api/me', { DEV_BYPASS_AUTH: 'true' });
    expect(res.status).toBe(200);
  });

  it('valida los eventos antes de guardarlos', async () => {
    const res = await req('/api/events', { DEV_BYPASS_AUTH: 'true' }, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'abcdefgh-1', type: 'xp.subtract', occurredAt: new Date().toISOString(), localDate: '2026-11-23', payload: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('el Game Master se niega sin clave', async () => {
    const res = await req('/api/gm/ask', { DEV_BYPASS_AUTH: 'true' }, { method: 'POST', body: '{}' });
    expect(res.status).toBe(503);
  });
});
