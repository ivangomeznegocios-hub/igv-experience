import { describe, expect, it, vi, afterEach } from 'vitest';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import app from '../src/index';
import { runScheduledPush } from '../src/push';
import { b64url, encryptPayload, fromB64url, generateVapidKeys, vapidAuthorization } from '../src/webpush';
import { fakeD1 } from './fake-d1';

const enc = new TextEncoder();

/** Descifrado según RFC 8291 (el lado del navegador), para comprobar el cifrado. */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, authSecret: Uint8Array) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const hk = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hk(authSecret, ecdh, keyInfo, 32);
  const cek = await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
  expect(plain.at(-1)).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function browserSub() {
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64url((await crypto.subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
  return { ua, auth, keys: { p256dh, auth: b64url(auth) } };
}

describe('web push', () => {
  it('cifra el mensaje con aes128gcm de forma que el navegador lo puede descifrar', async () => {
    const { ua, auth, keys } = await browserSub();
    const body = await encryptPayload(enc.encode('{"title":"Hola"}'), keys);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(await decrypt(body, ua, auth)).toBe('{"title":"Hola"}');
  });

  it('firma el JWT de VAPID con ES256 para el origen del endpoint', async () => {
    const keys = await generateVapidKeys();
    expect(fromB64url(keys.publicKey)).toHaveLength(65);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://igv.example.workers.dev');
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(m[2]).toBe(keys.publicKey);
    expect(decodeProtectedHeader(m[1]).alg).toBe('ES256');
    const { d: _d, key_ops: _ops, ...pub } = keys.privateJwk;
    const { payload } = await jwtVerify(m[1], await importJWK({ ...pub, alg: 'ES256' }, 'ES256'));
    expect(payload.aud).toBe('https://fcm.googleapis.com');
    expect(decodeJwt(m[1]).sub).toBe('https://igv.example.workers.dev');
  });
});

describe('API de notificaciones', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('guarda la suscripción y el plan, y el cron envía solo lo que ya toca, una vez', async () => {
    const env = { DB: fakeD1(), DEV_BYPASS_AUTH: 'true' } as any;
    const call = (path: string, method = 'GET', body?: unknown) =>
      app.request(`https://igv.example.workers.dev/api/push${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } }, env);

    const key = (await (await call('/key')).json()) as { publicKey: string };
    expect(fromB64url(key.publicKey)).toHaveLength(65);
    // la llave se genera una sola vez
    expect(((await (await call('/key')).json()) as { publicKey: string }).publicKey).toBe(key.publicKey);

    const { keys } = await browserSub();
    expect((await call('/subscribe', 'POST', { endpoint: 'http://inseguro.example/x', keys })).status).toBe(400);
    expect((await call('/subscribe', 'POST', { endpoint: 'https://push.example.com/abc', keys })).status).toBe(200);

    const now = Date.parse('2026-11-20T03:00:00Z');
    const plan = {
      items: [
        { id: 'a', at: '2026-11-20T02:59:00Z', title: 'Racha en riesgo', body: 'Completa una misión' },
        { id: 'b', at: '2026-11-20T09:00:00Z', title: 'Futuro', body: '' },
        { id: 'c', at: '2026-11-19T20:00:00Z', title: 'Muy viejo', body: '' },
      ],
    };
    expect((await call('/plan', 'PUT', plan)).status).toBe(200);

    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await runScheduledPush(env, now)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://push.example.com/abc');
    expect((init.headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm');
    expect(await runScheduledPush(env, now + 60_000)).toBe(0);

    // una suscripción vencida (410) se elimina
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 410 })));
    await call('/test', 'POST');
    expect(((await (await call('/status')).json()) as { devices: number }).devices).toBe(0);
  });

  it('las rutas de push exigen sesión', async () => {
    const res = await app.request('/api/push/key', {}, { DB: fakeD1() } as any);
    expect(res.status).toBe(401);
  });
});
