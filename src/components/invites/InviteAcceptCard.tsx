import type { Invite, Locale } from '@/types';
import { Icon } from '@/components/common/Icon';
import { inviteState, type InviteState } from '@/utils/invite-state';
import { inviteErrorMessage } from '@/utils/invite-errors';
import { fillMessage, translate, type MessageKey } from '@/utils/i18n';

export type InviteReadFailure = 'denied' | 'retryable' | null;
type InviteAcceptCardProps = {
  invite: Invite | null | undefined;
  locale: Locale;
  projectsLoaded: boolean;
  alreadyMember: boolean;
  now: number;
  online: boolean;
  busy: boolean;
  failure: InviteReadFailure;
  acceptUnavailable: boolean;
  error: string;
  onRetry: () => void;
  onHome: () => void;
  onOpenProject: () => void;
  onAccept: () => void;
};

const memberStateKeys: Record<Exclude<InviteState, 'active'>, MessageKey> = {
  paused: 'inviteMemberPaused', expired: 'inviteMemberExpired',
  exhausted: 'inviteMemberExhausted', revoked: 'inviteMemberRevoked',
};

/** Presentation is shared across server denials and local expiry, without revealing the reason to outsiders. */
export function InviteAcceptCard({ invite, locale, projectsLoaded, alreadyMember, now, online, busy,
  failure, acceptUnavailable, error, onRetry, onHome, onOpenProject, onAccept }: InviteAcceptCardProps) {
  const t = (key: MessageKey) => translate(locale, key);
  const state = invite ? inviteState(invite, now) : null;
  const unavailable = failure === 'denied' || invite === null
    || (projectsLoaded && invite && !alreadyMember && (state !== 'active' || acceptUnavailable));

  let content;
  if (unavailable) {
    content = <>
      <h1>{t('inviteUnavailableTitle')}</h1>
      <p role="status">{t('inviteUnavailableHint')}</p>
      <button type="button" className="secondary wide" onClick={onHome}>{t('inviteBackHome')}</button>
      <button type="button" className="secondary wide" disabled={!online} onClick={onRetry}>{t('inviteCheckAgain')}</button>
    </>;
  } else if (failure === 'retryable' || (!online && invite === undefined)) {
    content = <>
      <p className="form-error" role="alert">{online ? error : inviteErrorMessage({ code: 'unavailable' }, locale)}</p>
      <button type="button" className="secondary wide" onClick={onRetry}>{t('inviteRetry')}</button>
    </>;
  } else if (!projectsLoaded || !invite) {
    content = <p role="status">{t('loading')}</p>;
  } else {
    const expiry = invite.expiresAt?.toDate().toLocaleString(locale === 'th' ? 'th-TH' : 'en-US');
    content = <>
      <span className="eyebrow">{t('invitePageEyebrow')}</span>
      <h1>{invite.projectName}</h1>
      {alreadyMember ? (
        <p className="invite-meta"><Icon name="check" /> {t('inviteAlreadyMember')}</p>
      ) : (
        <p>
          {invite.createdByName ? fillMessage(t('invitePageInvitedBy'), { name: invite.createdByName }) : t('invitePageInvited')}{' '}
          <b>{t(invite.role === 'admin' ? 'invitePageAdminRole' : 'invitePageMemberRole')}</b>
        </p>
      )}
      {state === 'active' && <p className="invite-meta"><Icon name="clock" /> {expiry ? fillMessage(t('inviteValidUntil'), { expiry }) : t('inviteNever')}</p>}
      {alreadyMember && state && state !== 'active' && <p className="invite-meta" role="status">
        <Icon name="clock" /> {fillMessage(t('inviteMemberUnavailable'), { state: t(memberStateKeys[state]) })}
      </p>}
      {!online && <p className="form-error" role="alert">{inviteErrorMessage({ code: 'unavailable' }, locale)}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {alreadyMember ? (
        <button type="button" className="primary wide" onClick={onOpenProject}>{t('inviteOpenProject')}</button>
      ) : (
        <button type="button" className="primary wide" disabled={busy || !online} onClick={onAccept}>
          {t(busy ? 'inviteJoining' : 'inviteJoinProject')}
        </button>
      )}
    </>;
  }
  return <div className="invite-card">
    <div className="invite-icon"><Icon name="mail" /></div>
    {content}
  </div>;
}
