import type { Membership, Role } from '@/types';

export function roleFor(memberships: Membership[], uid: string): Role | null {
  return memberships.find((item) => item.userId === uid)?.role ?? null;
}

export function canManageTeam(role: Role | null): boolean { return role === 'owner' || role === 'admin'; }
export function canManageProject(role: Role | null): boolean { return role === 'owner' || role === 'admin'; }
export function canDeleteItem(role: Role | null, creatorId: string, uid: string): boolean {
  return role === 'owner' || role === 'admin' || creatorId === uid;
}
