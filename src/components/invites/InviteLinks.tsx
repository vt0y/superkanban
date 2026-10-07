import { useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import type { Invite, Membership, Project, Role } from '@/types';
import { Icon } from '@/components/common';
import { canManageTeam } from '@/utils/permissions';
import { fillMessage } from '@/utils/i18n';
import { filterInvites, inviteCapabilities, type InviteFilter } from '@/utils/invite-management';
import { useProjectInvites } from '@/hooks/useProjectInvites';
import { useInviteClock } from '@/hooks/useInviteClock';
import { InviteModal } from './InviteModal';
import { InviteRow } from './InviteRow';

type InviteLinksProps = {
  onCreate: () => void;
  context: AppContextValue;
  project: Project;
  members: Membership[];
  role: Role | null;
  readOnly: boolean;
};

export function InviteLinks(props: InviteLinksProps) {
  // Project changes reset filters, open details, and edit dialogs together.
  return <ProjectInviteLinks key={props.project.id} {...props} />;
}

function ProjectInviteLinks({ context, project, members, role, readOnly, onCreate }: InviteLinksProps) {
  const { t } = context;
  const data = useProjectInvites(project.id);
  const now = useInviteClock(data.invites);
  const [filter, setFilter] = useState<InviteFilter>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string; field?: 'expiry' | 'usage' } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const name = t('inviteDefaultName');
  const visible = filterInvites(data.invites, filter, search, now, name);
  const editableInvite = data.invites.find((invite) => invite.id === editing?.id);
  const canEdit = editableInvite && inviteCapabilities(editableInvite, role, readOnly, now).editable;
  const managing = canManageTeam(role) && !readOnly;
  const hiddenFeedback = data.feedback && !visible.some((invite) => invite.id === data.feedback?.id);

  const changeStatus = (invite: Invite, status: Invite['status']) => {
    if (data.busy || !managing || invite.status === 'revoked') return;
    if (status === 'revoked' && !window.confirm(fillMessage(t('inviteRevokeConfirm'), { name: invite.name?.trim() || name }))) return;
    setSavedId(null);
    void data.changeStatus(invite.id, status);
  };
  const edit = (invite: Invite, field?: 'expiry' | 'usage') => {
    setSavedId(null);
    data.clearFeedback();
    setEditing({ id: invite.id, field });
  };
  const joined = new Map<string, Membership[]>();
  for (const member of members) {
    if (!member.inviteId) continue;
    const group = joined.get(member.inviteId) ?? [];
    group.push(member);
    joined.set(member.inviteId, group);
  }

  return (
    <section className="panel team-invites">
      <div className="invite-heading">
        <span className="invite-heading-icon"><Icon name="link" /></span>
        <div><h2>{t('inviteLinks')}</h2><p>{t('inviteManageDesc')}</p></div>
        {managing && <button type="button" className="primary small" onClick={onCreate}><Icon name="add" />{t('inviteCreateLink')}</button>}
      </div>
      <div className="invite-toolbar">
        <div className="invite-filters" role="group" aria-label={t('inviteFilter')}>
          {(['active', 'attention', 'all'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value}
              className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>
              {t(value === 'active' ? 'inviteActive' : value === 'attention' ? 'inviteAttention' : 'inviteAll')}
              <span>{filterInvites(data.invites, value, '', now, name).length}</span>
            </button>
          ))}
        </div>
        <input type="search" className="invite-search" aria-label={t('inviteSearch')}
          placeholder={t('inviteSearch')} value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {data.failed && <p className="form-error" role="alert">
        {t('inviteLoadError')} <button type="button" className="secondary small" onClick={data.retry}>{t('inviteRetry')}</button>
      </p>}
      {data.loading && <p className="muted" role="status">{t('inviteLoading')}</p>}
      {hiddenFeedback && data.feedback && (
        <p className={data.feedback.success ? 'invite-entry-note' : 'form-error'} role={data.feedback.success ? 'status' : 'alert'}>
          {data.invites.find((invite) => invite.id === data.feedback?.id)?.name || name}: {t(data.feedback.success ? 'inviteSaved' : 'inviteSaveError')}
        </p>
      )}
      {savedId && !visible.some((invite) => invite.id === savedId) && <p className="invite-entry-note" role="status">{t('inviteSaved')}</p>}
      <div className="invite-entries">
        {visible.map((invite) => (
          <InviteRow key={invite.id} invite={invite} context={context} joined={joined.get(invite.id) ?? []}
            role={role} readOnly={readOnly} now={now} busy={data.busy === invite.id} blocked={data.busy !== null}
            feedback={data.feedback?.id === invite.id ? data.feedback.success : savedId === invite.id ? true : undefined}
            onEdit={edit} onStatus={changeStatus} />
        ))}
        {!data.loading && !data.failed && !visible.length && (
          <div className="invite-empty">
            <Icon name="link" /><strong>{t('inviteEmpty')}</strong><p>{t('inviteEmptyHint')}</p>
            {!search && filter !== 'all' && <button type="button" className="secondary small" onClick={() => setFilter('all')}>{t('inviteAll')}</button>}
            {!data.invites.length && managing && <button type="button" className="primary small" onClick={onCreate}>{t('inviteCreateLink')}</button>}
          </div>
        )}
      </div>
      <p className="invite-footnote">{t('inviteFootnote')}</p>
      {editing && editableInvite && canEdit && (
        <InviteModal key={editing.id} project={project} context={context} role={role} invite={editableInvite}
          focusField={editing.field} onSaved={() => setSavedId(editing.id)} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
