import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { fakeD1 } from './fake-d1';

// Llaves de dos equipos de Access de prueba: el tuyo y uno ajeno.
const keys: Record<string, { keys: JWK[] }> = {};
vi.mock('jose', async (orig) => {
  const actual = await orig<typeof import('jose')>();
  return { ...actual, createRemoteJWKSet: (url: URL) => actual.createLocalJWKSet(keys[url.host]) };
});

async function team(name: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  keys[`${name}.cloudflareaccess.com`] = { keys: [{ ...(await exportJWK(publicKey)), kid: name, alg: 'RS256' }] };
  return (aud: string, email: string) =>
    new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: name }).setIssuer(`https://${name}.cloudflareaccess.com`).setAudience(aud).setIssuedAt().setExpirationTime('1h').sign(privateKey);
}

describe('anclaje automático de Cloudflare Access', () => {
  let mine: Awaited<ReturnType<typeof team>>;
  let other: Awaited<ReturnType<typeof team>>;
  let app: typeof import('../src/index').default;
  const env = { DB: fakeD1() };
  const me = async (token?: string) => (await app.request('/api/me', { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }, env as any)).status;

  beforeAll(async () => {
    mine = await team('ivan');
    other = await team('ajeno');
    app = (await import('../src/index')).default;
  });

  it('el primer ingreso válido ancla equipo, aplicación y correo', async () => {
    expect(await me(await mine('app', 'ivan@correo.com'))).toBe(200);
    expect(await me(await mine('app', 'ivan@correo.com'))).toBe(200);
  });

  it('después solo entra ese correo', async () => {
    expect(await me(await mine('app', 'otro@correo.com'))).toBe(403);
  });

  it('rechaza tokens de otra aplicación del mismo equipo', async () => {
    expect(await me(await mine('otra-app', 'ivan@correo.com'))).toBe(401);
  });

  it('rechaza tokens de otro equipo de Access aunque traigan tu correo', async () => {
    expect(await me(await other('app', 'ivan@correo.com'))).toBe(403);
  });

  it('rechaza firmas falsas', async () => {
    const t = await mine('app', 'ivan@correo.com');
    expect(await me(t.slice(0, -4) + 'AAAA')).toBe(401);
    expect(await me()).toBe(401);
  });
});
