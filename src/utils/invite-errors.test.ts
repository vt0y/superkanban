import { describe, expect, it } from 'vitest';
import { inviteErrorMessage } from './invite-errors';

const firebaseError = (code: string) => Object.assign(new Error('Missing or insufficient permissions.'), { code });

describe('inviteErrorMessage', () => {
  it('maps the accept transaction codes', () => {
    expect(inviteErrorMessage(new Error('INVITE_REVOKED'), 'en')).toMatch(/revoked/);
    expect(inviteErrorMessage(new Error('INVITE_NOT_FOUND'), 'en')).toMatch(/no longer exists/);
  });

  it('explains a rules rejection instead of showing the raw Firebase text', () => {
    const message = inviteErrorMessage(firebaseError('permission-denied'), 'en');
    expect(message).toMatch(/expired/);
    expect(message).not.toMatch(/insufficient/);
  });

  it('falls back to a generic localized message', () => {
    expect(inviteErrorMessage('boom', 'th')).toBe('เข้าร่วมโปรเจกต์ไม่สำเร็จ กรุณาลองใหม่');
    expect(inviteErrorMessage(firebaseError('unavailable'), 'en')).toMatch(/offline/);
  });
});
