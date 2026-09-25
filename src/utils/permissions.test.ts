import { describe, expect, it } from 'vitest';
import type { Membership } from '@/types';
import { canDeleteItem, canManageProject, canManageTeam, roleFor } from './permissions';

describe('permissions', () => {
  const list: Membership[] = [
    { id: '1', projectId: 'p', userId: 'u1', displayName: 'A', email: 'a@x.com', photoURL: '', role: 'owner' },
    { id: '2', projectId: 'p', userId: 'u2', displayName: 'B', email: 'b@x.com', photoURL: '', role: 'member' },
  ];
  it('extracts role for user', () => {
    expect(roleFor(list, 'u1')).toBe('owner');
    expect(roleFor(list, 'u2')).toBe('member');
    expect(roleFor(list, 'u3')).toBeNull();
  });
  it('controls project/team management', () => {
    expect(canManageTeam('owner')).toBe(true);
    expect(canManageTeam('admin')).toBe(true);
    expect(canManageTeam('member')).toBe(false);
    expect(canManageProject(null)).toBe(false);
  });
  it('allows owner, admin or creator to delete', () => {
    expect(canDeleteItem('owner', 'other', 'u1')).toBe(true);
    expect(canDeleteItem('admin', 'other', 'u1')).toBe(true);
    expect(canDeleteItem('member', 'u1', 'u1')).toBe(true);
    expect(canDeleteItem('member', 'other', 'u1')).toBe(false);
  });
});
