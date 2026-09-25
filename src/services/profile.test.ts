import { describe, expect, it } from 'vitest';
import type { User } from 'firebase/auth';
import { ensureUserProfile, isAllowedEmail, profileAuthChanged } from './profile';

describe('profile email validation', () => {
  it('accepts configured domain emails', () => {
    expect(isAllowedEmail('student@example.com')).toBe(true);
    expect(isAllowedEmail('john.doe@example.com')).toBe(true);
    expect(isAllowedEmail('123456789-0@example.com')).toBe(true);
    expect(isAllowedEmail('1234567890@example.com')).toBe(true);
    expect(isAllowedEmail('TEACHER@EXAMPLE.COM')).toBe(true);
    expect(isAllowedEmail('mixedCase@EXAmple.com')).toBe(true);
  });

  it('rejects disallowed email addresses and invalid formats', () => {
    expect(isAllowedEmail('user@hotmail.com')).toBe(false);
    expect(isAllowedEmail('student@example.com.evil.com')).toBe(false);
    expect(isAllowedEmail('student@notexample.com')).toBe(false);
    expect(isAllowedEmail('@example.com')).toBe(false);
    expect(isAllowedEmail('')).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
    expect(isAllowedEmail(undefined)).toBe(false);
  });

  it('ensureUserProfile rejects non-allowed users before database call', async () => {
    const fakeUser = {
      uid: 'user-123',
      email: 'outsider@hotmail.com',
      displayName: 'Outsider',
      photoURL: '',
    } as unknown as User;

    await expect(ensureUserProfile(fakeUser)).rejects.toThrow('DOMAIN_NOT_ALLOWED');
  });

  it('does not require a profile write when Auth identity fields are unchanged', () => {
    const user = { email: 'student@example.com', displayName: 'Student', photoURL: 'photo' } as User;
    expect(profileAuthChanged({ email: user.email!, displayName: user.displayName!, photoURL: user.photoURL! }, user)).toBe(false);
    expect(profileAuthChanged({ email: user.email!, displayName: 'Old name', photoURL: user.photoURL! }, user)).toBe(true);
  });
});
