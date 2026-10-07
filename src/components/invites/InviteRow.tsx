import { useCallback, useId, useRef, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import type { Invite, Membership, Role } from '@/types';
import { Icon, Popover } from '@/components/common';
import { inviteStateLabel } from '@/utils/invite-state';
import { inviteCapabilities } from '@/utils/invite-management';
import { fillMessage } from '@/utils/i18n';
import { copyInviteLink, inviteUrl } from './share';

export function InviteRow({ invite, context, joined, role, readOnly, now, busy, blocked, feedback, onEdit, onStatus }: {
  invite: Invite; context: AppContextValue; joined: Membership[]; role: Role | null; readOnly: boolean;
  now: number; busy: boolean; blocked: boolean; feedback?: boolean;
  onEdit: (invite: Invite, field?: 'expiry' | 'usage') => void;
  onStatus: (invite: Invite, status: Invite['status']) => void;
}) {
  const { t, locale } = context;
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const detailsId = useId();
  const urlInput = useRef<HTMLInputElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const { manage, editable, availability, state } = inviteCapabilities(invite, role, readOnly, now);
  const name = invite.name?.trim() || t('inviteDefaultName');
  const dateLocale = locale === 'th' ? 'th-TH' : 'en-US';
  const repair = availability === 'expired' || availability === 'exhausted';
  const copy = async () => {
    if (copying) return;
    setCopying(true);
    const success = await copyInviteLink(invite.id, context);
    setCopying(false); setCopyFailed(!success);
    if (!success) {
      setExpanded(true);
      // The input is mounted after expanding the details.
      window.requestAnimationFrame(() => { urlInput.current?.focus(); urlInput.current?.select(); });
    }
  };
  const edit = (field?: 'expiry' | 'usage') => { closeMenu(); onEdit(invite, field); };
  const status = (value: Invite['status']) => { closeMenu(); onStatus(invite, value); };
  return <article className="invite-entry" aria-busy={busy}>
    <div className="invite-entry-main">
      <div className="invite-entry-name">
        <h3>{name}</h3>
        <span className={`invite-status ${state}`}><span />{inviteStateLabel(state, locale)}</span>
      </div>
      <dl className="invite-entry-facts">
        <div><dt>{t('inviteRole')}</dt><dd>{t(invite.role === 'admin' ? 'inviteAdminRole' : 'inviteMemberRole')}</dd></div>
        <div><dt>{t('inviteUsage')}</dt><dd>{invite.usesCount ?? 0} / {invite.maxUses ?? t('inviteUnlimited')}</dd></div>
        <div><dt>{t('inviteExpires')}</dt><dd>{invite.expiresAt ? <time dateTime={invite.expiresAt.toDate().toISOString()} title={invite.expiresAt.toDate().toLocaleString(dateLocale)}>{invite.expiresAt.toDate().toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</time> : t('inviteNever')}</dd></div>
      </dl>
      <div className="invite-entry-actions">
        {state === 'active' && <button type="button" className="primary small" disabled={copying} onClick={() => void copy()}><Icon name="copy" />{t('copyLink')}</button>}
        {manage && state === 'paused' && <button type="button" className="secondary small" disabled={blocked || repair} onClick={() => status('active')}>{t('inviteResume')}</button>}
        {manage && repair && <button type="button" className="primary small" disabled={blocked || !editable} title={!editable ? t('inviteNeedsOwner') : undefined} onClick={() => edit(availability === 'expired' ? 'expiry' : 'usage')}>{t(availability === 'expired' ? 'inviteExtend' : 'inviteIncrease')}</button>}
        <button type="button" className="secondary small" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>{t('inviteDetails')}<Icon name="chevronDown" /></button>
        {manage && <Popover open={menu} onClose={closeMenu} label={fillMessage(t('inviteManage'), { name })} trigger={<button type="button" className="secondary small" disabled={blocked} aria-haspopup="menu" aria-expanded={menu} aria-label={fillMessage(t('inviteManage'), { name })} onClick={() => setMenu((value) => !value)}><Icon name="more" /></button>}>
          <button type="button" role="menuitem" className="menu-item" disabled={blocked || !editable} title={!editable ? t('inviteNeedsOwner') : undefined} onClick={() => edit()}><Icon name="edit" />{t('inviteEdit')}</button>
          {invite.status === 'active' && state === 'active' && <button type="button" role="menuitem" className="menu-item" disabled={blocked} onClick={() => status('paused')}><Icon name="clock" />{t('invitePause')}</button>}
          <button type="button" role="menuitem" className="menu-item danger-item" disabled={blocked} onClick={() => status('revoked')}><Icon name="unlink" />{t('inviteRevoke')}</button>
        </Popover>}
      </div>
    </div>
    {manage && state === 'paused' && repair && <p className="invite-entry-note">{fillMessage(t('inviteResumeBlocked'), { reason: inviteStateLabel(availability, locale) })}</p>}
    {manage && repair && !editable && <p className="invite-entry-note">{t('inviteNeedsOwner')}</p>}
    {busy && <p className="invite-entry-note" role="status">{t('inviteSaving')}</p>}
    {feedback !== undefined && <p className={feedback ? 'invite-entry-note' : 'form-error'} role={feedback ? 'status' : 'alert'}>{t(feedback ? 'inviteSaved' : 'inviteSaveError')}</p>}
    <div id={detailsId} hidden={!expanded} className="invite-entry-details">
      <div className="invite-share"><div className="invite-url"><Icon name="link" /><input ref={urlInput} aria-label={t('inviteUrlLabel')} value={inviteUrl(invite.id)} readOnly onFocus={(event) => event.currentTarget.select()} /></div></div>
      {copyFailed && <p className="form-error" role="alert">{t('inviteCopyError')}</p>}
      <strong>{fillMessage(t('inviteJoined'), { n: String(joined.length) })}</strong>
      {joined.length ? <ul>{joined.map((member) => <li key={member.id}>{member.displayName}</li>)}</ul> : <p className="muted">{t('inviteNoMembers')}</p>}
    </div>
  </article>;
}
