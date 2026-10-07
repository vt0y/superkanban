import type { Invite, Role } from '@/types';
import { canManageTeam } from './permissions';
import { inviteState } from './invite-state';

export type InviteFilter = 'active' | 'attention' | 'all';
export function inviteCapabilities(invite: Invite, role: Role | null, readOnly: boolean, now: number) {
  const manage = canManageTeam(role) && !readOnly && invite.status !== 'revoked';
  const editable = manage && (role === 'owner' || invite.role === 'member');
  const availability = inviteState({ ...invite, status: 'active' }, now);
  return { manage, editable, availability, state: inviteState(invite, now) };
}

export function filterInvites(invites: Invite[], filter: InviteFilter, search: string, now: number, defaultName: string) {
  const term = search.trim().toLocaleLowerCase();
  return invites.filter((invite) => {
    const state = inviteState(invite, now);
    const matches = filter === 'all' || (filter === 'active' ? state === 'active' : state !== 'active' && state !== 'revoked');
    return matches && (invite.name?.trim() || defaultName).toLocaleLowerCase().includes(term);
  }).sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0) || a.id.localeCompare(b.id));
}
