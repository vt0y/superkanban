import { describe, expect, it, vi } from 'vitest';
import worker, { bangkokDayKey, dailyReadingLimit, hasDailyReadingCapacity, secureShuffle, type Env } from '../../workers/tarot/src/index';

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
