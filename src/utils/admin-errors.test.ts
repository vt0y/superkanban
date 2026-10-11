import { describe, expect, it } from 'vitest';
import { adminLoadError, adminLoadErrorMessage } from './admin-errors';

describe('admin loading errors', () => {
  it('keeps normalized codes without exposing database data or exception messages', () => {
    expect(adminLoadError({ code: 'firestore/permission-denied', message: 'private user info' })).toEqual({ code: 'permission-denied' });
    expect(adminLoadError(new Error('private user info'))).toEqual({ code: 'unknown' });
    expect(adminLoadError(null)).toEqual({ code: 'unknown' });
  });
  it('distinguishes permissions, expired authentication, outages and quota errors', () => {
    expect(adminLoadErrorMessage({ code: 'permission-denied' }, 'en')).toContain('Firestore rules');
    expect(adminLoadErrorMessage({ code: 'unauthenticated' }, 'en')).toContain('Sign out');
    expect(adminLoadErrorMessage({ code: 'unavailable' }, 'en')).toContain('connection');
    expect(adminLoadErrorMessage({ code: 'resource-exhausted' }, 'en')).toContain('limit');
    expect(adminLoadErrorMessage({ code: 'unknown' }, 'th')).toContain('ลองใหม่');
  });
});
