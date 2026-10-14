import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import worker, { _resetJwksCacheForTest, bangkokDayKey, checkAccountAccess, dailyReadingLimit, hasDailyReadingCapacity, secureShuffle, type Env } from '../../workers/tarot/src/index';

const env = {
  ALLOWED_ORIGINS: 'https://app.example.com',
  ALLOWED_EMAIL_DOMAINS: 'example.com',
  FIREBASE_PROJECT_ID: 'demo',
  KKU_API_BASE_URL: 'https://ai.example.com/v1',
  KKU_MODEL_ID: '1',
  KKU_API_KEY: 'secret',
  DAILY_READING_LIMIT: '5',
} as Env;

describe('tarot worker shuffle', () => {
  it('returns a fresh permutation without duplicates', () => {
    const source = Array.from({ length: 78 }, (_, index) => index);
    const result = secureShuffle(source);
    expect(result).toHaveLength(78);
    expect(new Set(result)).toEqual(new Set(source));
    expect(result).not.toBe(source);
  });

  it('answers an allowed CORS preflight without touching storage', async () => {
    const response = await worker.fetch(new Request('https://worker.example.com/v1/tarot/sessions', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.com' },
    }), env);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  });

  it('rejects untrusted origins before authentication', async () => {
    const response = await worker.fetch(new Request('https://worker.example.com/v1/tarot/sessions', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    }), env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
  });

  it('requires a Firebase bearer token', async () => {
    const response = await worker.fetch(new Request('https://worker.example.com/v1/tarot/sessions', {
      method: 'POST',
      headers: { Origin: 'https://app.example.com' },
    }), env);
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  });
});

describe('tarot daily reading limit', () => {
  it('uses a validated Worker environment value with a safe fallback', () => {
    expect(dailyReadingLimit({ DAILY_READING_LIMIT: '7' })).toBe(7);
    expect(dailyReadingLimit({ DAILY_READING_LIMIT: '0' })).toBe(5);
    expect(dailyReadingLimit({ DAILY_READING_LIMIT: 'not-a-number' })).toBe(5);
  });

  it('resets at midnight in Bangkok', () => {
    expect(bangkokDayKey(Date.parse('2026-09-26T16:59:59.999Z'))).toBe('2026-09-26');
    expect(bangkokDayKey(Date.parse('2026-09-26T17:00:00.000Z'))).toBe('2026-09-27');
  });

  it('blocks session creation when the configured quota is already full', async () => {
    const first = vi.fn().mockResolvedValue({ count: 5 });
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    const quotaEnv = { DB: { prepare }, DAILY_READING_LIMIT: '5' } as unknown as Env;

    await expect(hasDailyReadingCapacity(quotaEnv, 'user-1', Date.parse('2026-09-26T12:00:00Z'))).resolves.toBe(false);
    expect(bind).toHaveBeenCalledWith('user-1', '2026-09-26');
  });
});


describe('account access in the worker', () => {
  const request = () => new Request('https://worker.example.com/v1/tarot/sessions', { method: 'POST', headers: { Authorization: 'Bearer verified-token', 'Accept-Language': 'en' } });
  afterEach(() => vi.unstubAllGlobals());
  it.each([{}, { accountStatus: { stringValue: 'active' } }])('accepts active and legacy profiles', async (fields) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ fields }));
    vi.stubGlobal('fetch', fetcher);
    expect(await checkAccountAccess(request(), env, 'alice', {})).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('https://firestore.googleapis.com/v1/projects/demo/databases/(default)/documents/users/alice', expect.objectContaining({ headers: { Authorization: 'Bearer verified-token' } }));
  });
  it('rejects suspension and checks again after reactivation with no status cache', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ fields: { accountStatus: { stringValue: 'suspended' } } })).mockResolvedValueOnce(Response.json({ fields: { accountStatus: { stringValue: 'active' } } }));
    vi.stubGlobal('fetch', fetcher);
    const denied = await checkAccountAccess(request(), env, 'alice', {});
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toMatchObject({ error: { code: 'ACCOUNT_SUSPENDED', retryable: false } });
    expect(await checkAccountAccess(request(), env, 'alice', {})).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([404, 403, 500])('fails closed with retryable error when Firestore returns %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    const response = await checkAccountAccess(request(), env, 'alice', {});
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({ error: { code: 'ACCOUNT_STATUS_UNAVAILABLE', retryable: true } });
  });
  it('fails closed for network failure or malformed status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    expect((await checkAccountAccess(request(), env, 'alice', {}))?.status).toBe(503);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ fields: { accountStatus: { integerValue: '1' } } })));
    expect((await checkAccountAccess(request(), env, 'alice', {}))?.status).toBe(503);
  });
});

describe('suspension before worker operations', () => {
  let token: string;
  let jwk: JsonWebKey;
  const encode = (data: string | Uint8Array) => Buffer.from(data).toString('base64url');
  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const prefix = `${encode(JSON.stringify({ alg: 'RS256', kid: 'account-test' }))}.${encode(JSON.stringify({ sub: 'alice', aud: 'demo', iss: 'https://securetoken.google.com/demo', exp: Math.floor(Date.now() / 1000) + 3600, email: 'alice@example.com', email_verified: true }))}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(prefix));
    token = `${prefix}.${encode(new Uint8Array(signature))}`;
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each(['/v1/tarot/sessions', '/v1/tarot/sessions/aaaaaaaaaaaaaaaaaaaa/reveal', '/v1/links/canva/resolve', '/v1/links/canva/title'])('blocks %s despite a valid Firebase token, before rate limiting or storage', async (path) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('googleapis.com/service_accounts') ? Response.json({ keys: [{ ...jwk, kid: 'account-test' }] }) : Response.json({ fields: { accountStatus: { stringValue: 'suspended' } } })));
    const limiter = { limit: vi.fn() };
    const prepare = vi.fn();
    const bindings = { ...env, DB: { prepare }, SESSION_RATE_LIMITER: limiter, REVEAL_RATE_LIMITER: limiter, LINK_RATE_LIMITER: limiter } as unknown as Env;
    const response = await worker.fetch(new Request(`https://worker.example.com${path}`, { method: 'POST', headers: { Origin: 'https://app.example.com', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }), bindings);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'ACCOUNT_SUSPENDED' } });
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('JWKS refresh flood mitigation', () => {
  let pair: CryptoKeyPair;
  let validJwk: JsonWebKey;
  const encode = (data: string | Uint8Array) => Buffer.from(data).toString('base64url');

  const createValidToken = async (kid: string, sub = 'alice', expSeconds = 86400) => {
    const now = Math.floor(Date.now() / 1000);
    const header = encode(JSON.stringify({ alg: 'RS256', kid }));
    const payload = encode(JSON.stringify({
      sub,
      aud: env.FIREBASE_PROJECT_ID,
      iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      exp: now + expSeconds,
      email: `${sub}@example.com`,
      email_verified: true,
    }));
    const prefix = `${header}.${payload}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(prefix));
    return `${prefix}.${encode(new Uint8Array(sig))}`;
  };

  const makeValidRequest = (token: string) => new Request('https://worker.example.com/v1/tarot/sessions', {
    method: 'POST',
    headers: {
      Origin: 'https://app.example.com',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  beforeAll(async () => {
    pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    validJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetJwksCacheForTest();
  });

  it('limits outbound JWKS fetch to at most 1 across 100 requests with unknown kid', async () => {
    _resetJwksCacheForTest();
    let jwksFetchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/service_accounts')) {
        jwksFetchCount += 1;
        return new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }
      return new Response('', { status: 404 });
    }));

    const now = Math.floor(Date.now() / 1000);
    const requests = Array.from({ length: 100 }, (_, i) => {
      const header = encode(JSON.stringify({ alg: 'RS256', kid: `unknown-kid-${i}` }));
      const payload = encode(JSON.stringify({
        sub: `user-${i}`,
        aud: env.FIREBASE_PROJECT_ID,
        iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        exp: now + 3600,
        email: `user${i}@example.com`,
        email_verified: true,
      }));
      const dummyToken = `${header}.${payload}.dummysignature`;
      return new Request('https://worker.example.com/v1/tarot/sessions', {
        method: 'POST',
        headers: {
          Origin: 'https://app.example.com',
          Authorization: `Bearer ${dummyToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    });

    const responses = await Promise.all(requests.map((req) => worker.fetch(req, env)));
    for (const res of responses) {
      expect(res.status).toBe(401);
    }
    expect(jwksFetchCount).toBe(1);
  });

  it('allows retry after a failed in-flight fetch', async () => {
    vi.useFakeTimers();
    _resetJwksCacheForTest();
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/service_accounts')) {
        attempt += 1;
        if (attempt === 1) throw new Error('Network failure');
        return new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }
      return new Response('', { status: 404 });
    }));

    const now = Math.floor(Date.now() / 1000);
    const makeReq = () => {
      const header = encode(JSON.stringify({ alg: 'RS256', kid: 'kid-1' }));
      const payload = encode(JSON.stringify({
        sub: 'user-1',
        aud: env.FIREBASE_PROJECT_ID,
        iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        exp: now + 3600,
      }));
      return new Request('https://worker.example.com/v1/tarot/sessions', {
        method: 'POST',
        headers: { Origin: 'https://app.example.com', Authorization: `Bearer ${header}.${payload}.sig` },
        body: '{}',
      });
    };

    const res1 = await worker.fetch(makeReq(), env);
    expect(res1.status).toBe(401);
    expect(attempt).toBe(1);

    const res2 = await worker.fetch(makeReq(), env);
    expect(res2.status).toBe(401);
    expect(attempt).toBe(1);

    vi.advanceTimersByTime(60_000);
    const res3 = await worker.fetch(makeReq(), env);
    expect(res3.status).toBe(401);
    expect(attempt).toBe(2);
  });

  it('enforces cooldown on unknown kid when cache is warm', async () => {
    vi.useFakeTimers();
    _resetJwksCacheForTest();
    let jwksFetchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/service_accounts')) {
        jwksFetchCount += 1;
        return new Response(JSON.stringify({ keys: [{ ...validJwk, kid: 'warm-key' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }
      return new Response('', { status: 404 });
    }));

    const now = Math.floor(Date.now() / 1000);
    const makeReq = (kid: string, i = 0) => {
      const header = encode(JSON.stringify({ alg: 'RS256', kid }));
      const payload = encode(JSON.stringify({
        sub: `user-${i}`,
        aud: env.FIREBASE_PROJECT_ID,
        iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        exp: now + 3600,
        email: `user${i}@example.com`,
        email_verified: true,
      }));
      return new Request('https://worker.example.com/v1/tarot/sessions', {
        method: 'POST',
        headers: {
          Origin: 'https://app.example.com',
          Authorization: `Bearer ${header}.${payload}.sig`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    };

    const warmRes = await worker.fetch(makeReq('warm-key', 0), env);
    expect(warmRes.status).toBe(401);
    expect(jwksFetchCount).toBe(1);

    for (let i = 1; i <= 20; i++) {
      const res = await worker.fetch(makeReq(`unknown-kid-${i}`, i), env);
      expect(res.status).toBe(401);
    }
    expect(jwksFetchCount).toBe(1);

    vi.advanceTimersByTime(60_000);
    const afterCooldownRes = await worker.fetch(makeReq('unknown-kid-after-cooldown', 21), env);
    expect(afterCooldownRes.status).toBe(401);
    expect(jwksFetchCount).toBe(2);
  });

  it('allows 20 concurrent valid tokens on cold cache with exactly 1 JWKS fetch', async () => {
    _resetJwksCacheForTest();
    let jwksFetchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/service_accounts')) {
        jwksFetchCount += 1;
        return new Response(JSON.stringify({ keys: [{ ...validJwk, kid: 'valid-kid' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }
      if (url.includes('firestore.googleapis.com')) {
        return Response.json({ fields: { accountStatus: { stringValue: 'active' } } });
      }
      return new Response('', { status: 404 });
    }));

    const authBindings = {
      ...env,
      SESSION_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    } as unknown as Env;

    const tokens = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createValidToken('valid-kid', `user-${i}`, 86400))
    );

    const responses = await Promise.all(tokens.map((tok) => worker.fetch(makeValidRequest(tok), authBindings)));
    for (const res of responses) {
      expect(res.status).not.toBe(401);
      expect(res.status).toBe(400);
    }
    expect(jwksFetchCount).toBe(1);
  });

  it('allows 20 concurrent valid tokens after expiry with exactly 1 refresh fetch', async () => {
    vi.useFakeTimers();
    _resetJwksCacheForTest();
    let jwksFetchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/service_accounts')) {
        jwksFetchCount += 1;
        return new Response(JSON.stringify({ keys: [{ ...validJwk, kid: 'valid-kid' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }
      if (url.includes('firestore.googleapis.com')) {
        return Response.json({ fields: { accountStatus: { stringValue: 'active' } } });
      }
      return new Response('', { status: 404 });
    }));

    const authBindings = {
      ...env,
      SESSION_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    } as unknown as Env;

    const warmToken = await createValidToken('valid-kid', 'warm-user', 86400);
    const warmRes = await worker.fetch(makeValidRequest(warmToken), authBindings);
    expect(warmRes.status).not.toBe(401);
    expect(jwksFetchCount).toBe(1);

    vi.advanceTimersByTime(3601 * 1000);
    const fetchCountBefore = jwksFetchCount;

    const tokens = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createValidToken('valid-kid', `user-${i}`, 86400))
    );
    const responses = await Promise.all(tokens.map((tok) => worker.fetch(makeValidRequest(tok), authBindings)));
    for (const res of responses) {
      expect(res.status).not.toBe(401);
      expect(res.status).toBe(400);
    }
    expect(jwksFetchCount - fetchCountBefore).toBe(1);
    expect(jwksFetchCount).toBe(2);
  });

  it('accepts valid token using stale keys when cache is expired and fetch fails', async () => {
    vi.useFakeTimers();
    _resetJwksCacheForTest();
    let failJwks = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/service_accounts')) {
        if (failJwks) throw new Error('JWKS endpoint offline');
        return new Response(JSON.stringify({ keys: [{ ...validJwk, kid: 'valid-kid' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
        });
      }
      if (url.includes('firestore.googleapis.com')) {
        return Response.json({ fields: { accountStatus: { stringValue: 'active' } } });
      }
      return new Response('', { status: 404 });
    }));

    const authBindings = {
      ...env,
      SESSION_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    } as unknown as Env;

    const token = await createValidToken('valid-kid', 'alice', 86400);
    const warmRes = await worker.fetch(makeValidRequest(token), authBindings);
    expect(warmRes.status).not.toBe(401);

    vi.advanceTimersByTime(3601 * 1000);
    failJwks = true;

    const staleRes = await worker.fetch(makeValidRequest(token), authBindings);
    expect(staleRes.status).not.toBe(401);
    expect(staleRes.status).toBe(400);
  });
});
