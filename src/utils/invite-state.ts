import type { Invite, Locale } from '@/types';
import { translate, type MessageKey } from './i18n';

export type InviteState = Invite['status'] | 'expired' | 'exhausted';
export function inviteState(invite: Invite, now = Date.now()): InviteState {
  if (invite.status !== 'active') return invite.status;
  if (invite.expiresAt && invite.expiresAt.toMillis() <= now) return 'expired';
  if (invite.maxUses != null && (invite.usesCount ?? 0) >= invite.maxUses) return 'exhausted';
  return 'active';
}
export function inviteStateLabel(state: InviteState, locale: Locale): string {
  const labels: Record<InviteState, MessageKey> = { active: 'inviteStateActive', paused: 'inviteStatePaused', expired: 'inviteStateExpired', exhausted: 'inviteStateExhausted', revoked: 'inviteStateRevoked' };
  return translate(locale, labels[state]);
}
