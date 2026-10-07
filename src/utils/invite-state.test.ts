import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Invite } from '@/types';
import { inviteState, inviteStateLabel } from './invite-state';

const legacy = { status: 'active', expiresAt: Timestamp.fromMillis(1000) } as Invite;
describe('invite availability', () => {
  it('preserves legacy expiry and treats absent limits/counts as unlimited/zero', () => {
    expect(inviteState(legacy, 999)).toBe('active');
    expect(inviteState(legacy, 1000)).toBe('expired');
  });
  it('supports Never, unlimited, exhausted limits, and extending expired links', () => {
    expect(inviteState({ ...legacy, expiresAt: null }, 2000)).toBe('active');
    expect(inviteState({ ...legacy, maxUses: 1 }, 999)).toBe('active');
    expect(inviteState({ ...legacy, maxUses: 1, usesCount: 1 }, 999)).toBe('exhausted');
    expect(inviteState({ ...legacy, maxUses: 1, usesCount: 2 }, 999)).toBe('exhausted');
    expect(inviteState({ ...legacy, maxUses: 3, usesCount: 2 }, 999)).toBe('active');
    expect(inviteState({ ...legacy, expiresAt: Timestamp.fromMillis(3000) }, 2000)).toBe('active');
  });
  it('gives explicit status precedence and localized labels', () => {
    expect(inviteState({ ...legacy, status: 'paused' }, 2000)).toBe('paused');
    expect(inviteState({ ...legacy, status: 'revoked' }, 2000)).toBe('revoked');
    for (const state of ['active', 'paused', 'revoked', 'expired', 'exhausted'] as const) {
      expect(inviteStateLabel(state, 'en')).not.toBe(inviteStateLabel(state, 'th'));
    }
  });
});
