import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Timestamp } from 'firebase/firestore';
import type { AppContextValue } from '@/context/AppContext';
import type { Invite, InviteSettings, Project, Role } from '@/types';
import { createInvite, updateInviteSettings } from '@/services/invites';
import { Modal, Icon } from '@/components/common';
import { toast } from '@/components/toast';
import { copyInviteLink } from './share';
import { fillMessage } from '@/utils/i18n';

export function InviteModal({ project, context, role, invite, focusField, onSaved, onClose }: { project: Project; context: AppContextValue; role: Role | null; invite?: Invite; focusField?: 'expiry' | 'usage'; onSaved?: () => void; onClose: () => void }) {
  const formId = useId();
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [name, setName] = useState(invite?.name ?? '');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>(invite?.role ?? 'member');
  const [expiry, setExpiry] = useState(invite ? 'keep' : '7');
  const [usage, setUsage] = useState(invite?.maxUses == null ? 'unlimited' : invite.maxUses === 1 ? 'one' : 'custom');
  const [maximum, setMaximum] = useState(invite?.maxUses ?? 10);
  const [linkId, setLinkId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (pending.current || linkId) return;
    pending.current = true;
    setBusy(true); setError('');
    const settings: InviteSettings = {
      name, role: inviteRole, maxUses: usage === 'unlimited' ? null : usage === 'one' ? 1 : maximum,
      expiresAt: expiry === 'keep' ? invite?.expiresAt ?? null : expiry === 'never' ? null : Timestamp.fromMillis(Date.now() + Number(expiry) * 86400000),
    };
    try {
      if (invite) {
        await updateInviteSettings(invite.id, settings);
        if (alive.current) { toast(context.t('inviteSaved')); onSaved?.(); onClose(); }
      }
      else {
        const id = await createInvite(project, context.user, settings);
        if (alive.current) { setLinkId(id); toast(context.t('inviteCreatedToast')); }
      }
    } catch { if (alive.current) setError(context.t('inviteFormSaveError')); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  return <Modal title={invite ? context.t('inviteEditTitle') : context.t('createInvite')} onClose={onClose} className="invite-modal" actions={!linkId && <button form={formId} className="primary" disabled={busy}>{busy ? context.t('inviteSaving') : invite ? context.t('save') : context.t('createInvite')}</button>}>
    <form id={formId} className="stack-form" onSubmit={submit}>
      {!linkId && <p className="muted">{context.t('inviteRoleHelp')}</p>}
      {!linkId && <fieldset disabled={busy || Boolean(linkId)} className="invite-form-grid">
        <label className="invite-name-field">{context.t('inviteName')}<input placeholder={context.t('inviteNamePlaceholder')} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
        <label>{context.t('colRole')}<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'member' | 'admin')}>
          <option value="member">{context.t('inviteMemberRole')}</option>{role === 'owner' && <option value="admin">{context.t('inviteAdminRole')}</option>}
        </select></label>
        <label>{context.t('inviteExpiry')}<select autoFocus={focusField === 'expiry'} value={expiry} onChange={(event) => setExpiry(event.target.value)}>
          {invite && <option value="keep">{context.t('inviteKeepExpiry')}</option>}
          {[1, 7, 30].map((days) => <option key={days} value={days}>{days} {context.t('inviteDaysFromNow')}</option>)}
          <option value="never">{context.t('inviteNever')}</option>
        </select></label>
        <label>{context.t('inviteUsage')}<select autoFocus={focusField === 'usage'} value={usage} onChange={(event) => setUsage(event.target.value)}>
          <option value="one">{context.t('inviteOneTime')}</option><option value="custom">{context.t('inviteCustomLimit')}</option><option value="unlimited">{context.t('inviteUnlimited')}</option>
        </select></label>
        {usage === 'custom' && <label>{context.t('inviteMaximum')}<input type="number" min={1} step={1} required value={maximum} onChange={(event) => setMaximum(Number(event.target.value))} /></label>}
      </fieldset>}
      {invite && <p className="muted">{fillMessage(context.t('inviteUsageWarning'), { n: String(invite.usesCount ?? 0) })}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {linkId ? <div className="invite-created"><span className="invite-created-icon"><Icon name="check" /></span><h3>{context.t('inviteReady')}</h3><p className="muted">{context.t('inviteShareHelp')}</p><div className="invite-share"><div className="invite-url"><Icon name="link" /><input aria-label={context.t('inviteUrlLabel')} readOnly value={`${location.origin}/invite/${linkId}`} onFocus={(event) => event.currentTarget.select()} /></div><button type="button" className="primary" onClick={() => void copyInviteLink(linkId, context)}><Icon name="copy" />{context.t('copyLink')}</button></div><button type="button" className="secondary" onClick={onClose}>{context.t('inviteDone')}</button></div>
        : <div className="form-actions"><span /><button type="button" className="secondary" onClick={onClose}>{context.t('inviteCancel')}</button><button className="primary" disabled={busy}>{busy ? context.t('inviteSaving') : invite ? context.t('save') : context.t('createInvite')}</button></div>}
    </form>
  </Modal>;
}
