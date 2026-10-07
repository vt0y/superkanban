import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Invite } from '@/types';
import { filterInvites, inviteCapabilities } from './invite-management';

const now = 1000;
const invite = (id: string, overrides: Partial<Invite> = {}): Invite => ({ id, projectId: 'p', projectName: 'Team', role: 'member', status: 'active', createdBy: 'owner', expiresAt: null, ...overrides });
const links = [invite('active', { name: 'Design', createdAt: Timestamp.fromMillis(500) }), invite('paused', { status: 'paused' }), invite('expired', { expiresAt: Timestamp.fromMillis(now) }), invite('exhausted', { usesCount: 1, maxUses: 1 }), invite('revoked', { status: 'revoked' })];

describe('invitation management', () => {
  it('separates usable, actionable and historical links', () => {
    expect(filterInvites(links, 'active', '', now, 'Team invitation').map((x) => x.id)).toEqual(['active']);
    expect(filterInvites(links, 'attention', '', now, 'Team invitation').map((x) => x.id)).toEqual(['exhausted', 'expired', 'paused']);
    expect(filterInvites(links, 'all', '', now, 'Team invitation')).toHaveLength(5);
  });
  it('searches names with trimmed case-insensitive input and a legacy fallback', () => {
    expect(filterInvites(links, 'all', '  DESIGN ', now, 'Team invitation').map((x) => x.id)).toEqual(['active']);
    expect(filterInvites(links, 'all', 'team', now, 'Team invitation')).toHaveLength(4);
    expect(filterInvites(links, 'active', 'missing', now, 'Team invitation')).toEqual([]);
  });
  it('orders by creation time, with stable ordering for legacy timestamps', () => {
    expect(filterInvites([invite('old'), invite('new', { createdAt: Timestamp.fromMillis(900) }), links[0]], 'all', '', now, '').map((x) => x.id)).toEqual(['new', 'active', 'old']);
  });
  it('restricts admin-role edits to the owner while permitting admin status management', () => {
    const admin = invite('admin', { role: 'admin' });
    expect(inviteCapabilities(admin, 'admin', false, now)).toMatchObject({ manage: true, editable: false });
    expect(inviteCapabilities(admin, 'owner', false, now)).toMatchObject({ manage: true, editable: true });
    expect(inviteCapabilities(links[0], 'admin', false, now).editable).toBe(true);
    for (const role of ['member', null] as const) expect(inviteCapabilities(links[0], role, false, now).manage).toBe(false);
    expect(inviteCapabilities(admin, 'owner', true, now).manage).toBe(false);
    expect(inviteCapabilities(links[4], 'owner', false, now)).toMatchObject({ manage: false, editable: false });
  });
  it('detects blockers even while a link is paused, including simultaneous limits', () => {
    expect(inviteCapabilities(invite('p', { status: 'paused', expiresAt: Timestamp.fromMillis(now), maxUses: 1, usesCount: 1 }), 'owner', false, now)).toMatchObject({ state: 'paused', availability: 'expired' });
    expect(inviteCapabilities(invite('p', { status: 'paused', maxUses: 1, usesCount: 1 }), 'owner', false, now).availability).toBe('exhausted');
  });
});
