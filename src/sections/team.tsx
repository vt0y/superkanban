import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AppContextValue, SectionProps } from '@/context/AppContext';
import { Avatar, Modal, PageTitle, PanelTitle } from '@/components/common';
import { canManageTeam } from '@/utils/permissions';
import { changeMemberRole, createInvite, removeMember, revokeInvite, subscribeProjectInvites } from '@/services';
import {
  endGitHubSession,
  fetchOwnerType,
  fetchRepoCollaborators,
  grantablePermissions,
  fetchRepoInvitations,
  getStoredGitHubToken,
  githubAccessState,
  GitHubAuthError,
  resolveGitHubRevocation,
  revokeRepoAccess,
  setRepoCollaborator,
  subscribeGitHubRevocations,
  updateMemberGitHubPermission,
  type GitHubAccessState,
  type GitHubCollaborator,
  type GitHubInvitation,
  type GitHubPermission,
} from '@/services/github';
import { toast } from '@/components/toast';
import { attemptGitHub, GitHubSessionBar, useGitHubSession } from '@/components/github/GitHubSessionBar';
import { isGitHubEnabled } from '@/config/features';
import type { GitHubRevocation, Invite, Membership, Project, ProjectGitHubRepo, Role } from '@/types';
import type { MessageKey } from '@/utils/i18n';
import { fillMessage } from '@/utils/i18n';
import { Icon } from '@/components/common/Icon';

const GITHUB_PERMISSION_LABELS: [string, MessageKey][] = [
  ['none', 'ghPermNone'],
  ['pull', 'ghPermPull'],
  ['triage', 'ghPermTriage'],
  ['push', 'ghPermPush'],
  ['maintain', 'ghPermMaintain'],
  ['admin', 'ghPermAdmin'],
];

const REVOCATION_REASONS: Record<GitHubRevocation['reason'], MessageKey> = {
  removed: 'ghReasonRemoved',
  disconnected: 'ghReasonDisconnected',
  unlinked: 'ghReasonUnlinked',
};

type LiveAccess = { collaborators: GitHubCollaborator[]; invitations: GitHubInvitation[] };

/** What GitHub itself reports for the linked repo. Owner-only: the API needs the owner's repo token. */
function useLiveGitHubAccess(repo: ProjectGitHubRepo | null | undefined, enabled: boolean) {
  const [live, setLive] = useState<LiveAccess | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const session = useGitHubSession();
  const token = enabled ? (session?.token ?? '') : '';

  const refresh = useCallback(async () => {
    if (!repo || !token) return;
    setChecking(true);
    setFailed(false);
    try {
      const [collaborators, invitations] = await Promise.all([
        fetchRepoCollaborators(token, repo.owner, repo.name),
        fetchRepoInvitations(token, repo.owner, repo.name),
      ]);
      setLive({ collaborators, invitations });
    } catch (err) {
      if (err instanceof GitHubAuthError) endGitHubSession();
      else setFailed(true);
    } finally {
      setChecking(false);
    }
  }, [repo?.owner, repo?.name, token]);

  useEffect(() => {
    if (!token) setLive(null);
    void refresh();
  }, [refresh]);

  /** Reflect a change we just made without waiting for another round trip. */
  const setState = (login: string, state: GitHubAccessState) =>
    setLive((current) => {
      if (!current) return current;
      const other = (item: { login: string }) => item.login.toLowerCase() !== login.toLowerCase();
      return {
        collaborators: [...current.collaborators.filter(other), ...(state === 'active' ? [{ login } as GitHubCollaborator] : [])],
        invitations: [...current.invitations.filter(other), ...(state === 'pending' ? [{ id: 0, login, permission: '' }] : [])],
      };
    });

  return { live, checking, failed, hasToken: Boolean(token), refresh, setState };
}

/** Repo owner's account type: stored at link time, looked up for repos linked before we stored it. */
function useRepoOwnerType(repo: ProjectGitHubRepo | null | undefined): 'User' | 'Organization' | null {
  const [fetched, setFetched] = useState<'User' | 'Organization' | null>(null);
  useEffect(() => {
    setFetched(null);
    if (!repo || repo.ownerType) return;
    let alive = true;
    void fetchOwnerType(repo.owner).then((type) => alive && setFetched(type));
    return () => {
      alive = false;
    };
  }, [repo?.owner, repo?.ownerType]);
  return repo?.ownerType ?? fetched;
}

export function Team({ context, project, members, role, readOnly }: SectionProps) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [collaboratorLoading, setCollaboratorLoading] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const { t } = context;
  const repo = project.githubRepo;
  const hasRepo = isGitHubEnabled && Boolean(repo);
  const isOwner = role === 'owner';
  const access = useLiveGitHubAccess(repo, hasRepo && isOwner);
  const session = useGitHubSession();
  const ownerType = useRepoOwnerType(repo);
  const grantable = ownerType ? grantablePermissions(ownerType) : [];
  /** Anything that changes access on GitHub needs the owner's management session. */
  const managing = isOwner && !readOnly && Boolean(session);
  const permissionLabel = (value: string) => t(GITHUB_PERMISSION_LABELS.find(([key]) => key === value)?.[1] ?? 'ghPermNone');
  const isRepoOwner = (member: Membership) =>
    Boolean(repo && member.githubUsername && member.githubUsername.toLowerCase() === repo.owner.toLowerCase());
  const linkedCount = members.filter((member) => member.githubUsername).length;

  useEffect(() => (canManageTeam(role) ? subscribeProjectInvites(project.id, setInvites) : undefined), [project.id, role]);

  const flash = (memberId: string) => {
    setFlashId(memberId);
    window.setTimeout(() => setFlashId((current) => (current === memberId ? null : current)), 1600);
  };

  const changeRole = async (member: Membership, nextRole: Role) => {
    if (member.role === 'owner') return;
    await changeMemberRole(project.id, member.userId, nextRole);
  };

  const handleGitHubPermissionChange = async (member: Membership, nextPermission: string) => {
    if (!repo) return;
    if (!member.githubUsername) {
      toast(t('ghMemberNotLinked'));
      return;
    }

    const token = getStoredGitHubToken();
    if (!token) {
      toast(t('ghNeedToken'));
      return;
    }

    const username = member.githubUsername;

    if (nextPermission === 'none') {
      if (!confirm(fillMessage(t('ghRevokeConfirm'), { name: username }))) return;
      setCollaboratorLoading(member.id);
      const ok = await attemptGitHub(context, async () => {
        await revokeRepoAccess(token, repo.owner, repo.name, username);
        await updateMemberGitHubPermission(project.id, member.userId, null);
      }, 'ghRevokeFailed');
      setCollaboratorLoading(null);
      if (ok !== undefined) {
        access.setState(username, 'none');
        flash(member.id);
        toast(fillMessage(t('ghRevoked'), { name: username }));
      }
      return;
    }

    setCollaboratorLoading(member.id);
    const ok = await attemptGitHub(context, async () => {
      const res = await setRepoCollaborator(token, repo.owner, repo.name, username, nextPermission as GitHubPermission, ownerType ?? 'User');
      await updateMemberGitHubPermission(project.id, member.userId, nextPermission as GitHubPermission);
      return res;
    }, 'ghPermFailed');
    setCollaboratorLoading(null);
    if (ok) {
      // 201 = invitation created (pending until accepted); 204 = already a collaborator, permission changed.
      access.setState(username, ok.invited ? 'pending' : 'active');
      flash(member.id);
      const values = { name: username, perm: permissionLabel(nextPermission) };
      toast(fillMessage(t(ok.invited ? 'ghInvited' : 'ghPermUpdated'), values));
    }
  };

  /** GitHub access a member still holds on the linked repo; they cannot be removed until it is revoked. */
  const heldGrant = (member: Membership) => (hasRepo && member.githubUsername && member.githubPermission ? member.githubUsername : '');

  const removeBlockedReason = (member: Membership): string => {
    if (!heldGrant(member)) return '';
    if (!isOwner) return t('ghRemoveNeedsOwner');
    if (!managing) return t('ghRemoveNeedsSession');
    return '';
  };

  const handleRemoveMember = async (member: Membership) => {
    const grant = heldGrant(member);
    if (removeBlockedReason(member)) return;
    const question = grant
      ? fillMessage(t('removeMemberGitHubConfirm'), { name: member.displayName, handle: grant })
      : fillMessage(t('removeMemberConfirm'), { name: member.displayName });
    if (!confirm(question)) return;

    if (!grant || !repo) {
      await removeMember(project.id, member.userId);
      return;
    }

    // Revoke on GitHub first; the member is only removed once that succeeded.
    setCollaboratorLoading(member.id);
    const revoked = await attemptGitHub(context, () => revokeRepoAccess(getStoredGitHubToken(), repo.owner, repo.name, grant), 'ghRemoveRevokeFailed');
    if (revoked === undefined) {
      setCollaboratorLoading(null);
      return;
    }
    await removeMember(project.id, member.userId);
    setCollaboratorLoading(null);
    access.setState(grant, 'none');
    toast(fillMessage(t('ghRemovedAndRevoked'), { name: member.displayName }), 'success');
  };

  const liveState = (member: Membership): GitHubAccessState | null =>
    access.live && member.githubUsername ? githubAccessState(member.githubUsername, access.live.collaborators, access.live.invitations) : null;

  return (
    <>
      <PageTitle
        eyebrow="PEOPLE & ACCESS"
        title={context.t('team')}
        description={t('teamDesc')}
        action={
          canManageTeam(role) && !readOnly ? (
            <button className="primary" onClick={() => setShowInvite(true)}>
              <Icon name="add" /> {context.t('invite')}
            </button>
          ) : undefined
        }
      />

      {hasRepo && repo && <RepoSummary context={context} repo={repo} me={members.find((m) => m.userId === context.user.uid)} />}

      <section className="panel team-panel">
        <PanelTitle title={`${context.t('members')} (${members.length})`} />
        {hasRepo && isOwner && (
          <div className="gh-status-bar">
            {!readOnly && <GitHubSessionBar context={context} />}
            {managing && ownerType === 'User' && <small className="gh-note"><Icon name="info" /> {t('ghPersonalRepoWriteOnly')}</small>}
            {access.hasToken && (
              <>
                <button type="button" className="secondary small" disabled={access.checking} onClick={() => void access.refresh()}>
                  {access.checking ? t('ghChecking') : t('ghCheckStatus')}
                </button>
                {access.failed && <small className="form-error">{t('ghStatusFailed')}</small>}
              </>
            )}
          </div>
        )}
        <div className={`team-table ${hasRepo ? 'with-github' : ''}`}>
          <div className="table-head">
            <span>{t('colMember')}</span>
            <span>{t('colRole')}</span>
            {hasRepo && (
              <span>
                {t('colGitHub')} · {fillMessage(t('ghLinkedCount'), { n: String(linkedCount), total: String(members.length) })}
              </span>
            )}
            <span>{t('colJoined')}</span>
            <span />
          </div>

          {members.map((member) => (
            <div className={`team-row ${flashId === member.id ? 'gh-row-flash' : ''}`} key={member.id}>
              <div>
                <Avatar name={member.displayName} src={member.photoURL} />
                <span>
                  <strong>
                    {member.displayName}
                    {member.userId === context.user.uid ? ` (${t('you')})` : ''}
                  </strong>
                  <small>{member.email}</small>
                </span>
              </div>

              <div>
                {isOwner && member.role !== 'owner' && !readOnly ? (
                  <select value={member.role} onChange={(e) => changeRole(member, e.target.value as Role)}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                ) : (
                  <span className={`role ${member.role}`}>{member.role}</span>
                )}
              </div>

              {hasRepo && (
                <div className="gh-member">
                  {!member.githubUsername ? (
                    <small className="muted">{t('ghNotLinked')}</small>
                  ) : isRepoOwner(member) ? (
                    <>
                      <span className="gh-badge ok">{t('ghRepoOwner')}</span>
                      <GitHubHandle login={member.githubUsername} />
                    </>
                  ) : (
                    <>
                      {managing ? (
                        <select
                          value={member.githubPermission || 'none'}
                          disabled={collaboratorLoading === member.id || !ownerType}
                          onChange={(e) => handleGitHubPermissionChange(member, e.target.value)}
                          aria-label={fillMessage(t('ghAccessFor'), { name: member.githubUsername })}
                          title={ownerType === 'User' ? t('ghPersonalRepoWriteOnly') : undefined}
                        >
                          {GITHUB_PERMISSION_LABELS.filter(
                            ([value]) => value === 'none' || value === member.githubPermission || grantable.includes(value as GitHubPermission),
                          ).map(([value, key]) => (
                            <option key={value} value={value} disabled={value !== 'none' && !grantable.includes(value as GitHubPermission)}>
                              {t(key)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <small title={isOwner && !readOnly ? t('ghLockedHint') : undefined}>
                          {isOwner && !readOnly && <Icon name="lock" />}
                          {member.githubPermission ? permissionLabel(member.githubPermission) : t('ghPermNone')}
                        </small>
                      )}
                      <GitHubHandle login={member.githubUsername} />
                      <AccessBadge context={context} state={liveState(member)} saved={Boolean(member.githubPermission)} />
                    </>
                  )}
                </div>
              )}

              <span>{member.joinedAt?.toDate().toLocaleDateString() || '—'}</span>

              <span>
                {canManageTeam(role) && !readOnly && member.role === 'member' && member.userId !== context.user.uid && (
                  <span title={removeBlockedReason(member) || undefined}>
                    <button
                      className="icon-danger"
                      disabled={Boolean(removeBlockedReason(member)) || collaboratorLoading === member.id}
                      aria-label={removeBlockedReason(member) || fillMessage(t('removeMemberConfirm'), { name: member.displayName })}
                      onClick={() => void handleRemoveMember(member)}
                    >
                      <Icon name={removeBlockedReason(member) ? 'lock' : 'trash'} />
                    </button>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      {isGitHubEnabled && canManageTeam(role) && (
        <PendingRevocations context={context} projectId={project.id} isOwner={isOwner} readOnly={readOnly} />
      )}

      {canManageTeam(role) && (
        <section className="panel invites-panel">
          <PanelTitle title={t('inviteLinks')} />
          <div className="invite-list">
            {invites
              .filter((item) => item.status === 'active')
              .map((invite) => (
                <div key={invite.id}>
                  <span><Icon name="link" /></span>
                  <div>
                    <strong>{t('anyoneWithLink')}</strong>
                    <small>
                      {invite.role} · {t('expires')} {invite.expiresAt.toDate().toLocaleDateString()}
                    </small>
                  </div>
                  <button onClick={() => void navigator.clipboard.writeText(`${location.origin}/invite/${invite.id}`)}>
                    {t('copyLink')}
                  </button>
                  {!readOnly && (
                    <button className="icon-danger" onClick={() => void revokeInvite(invite.id)}>
                      <Icon name="close" />
                    </button>
                  )}
                </div>
              ))}
            {!invites.some((item) => item.status === 'active') && <p className="muted">{t('noInviteLinks')}</p>}
          </div>
        </section>
      )}

      {showInvite && !readOnly && <InviteModal project={project} context={context} role={role} onClose={() => setShowInvite(false)} />}
    </>
  );
}

/** Tells every member which repository this project uses and what their own access is. */
function RepoSummary({ context, repo, me }: { context: AppContextValue; repo: ProjectGitHubRepo; me?: Membership }) {
  const { t } = context;
  const permission = GITHUB_PERMISSION_LABELS.find(([key]) => key === me?.githubPermission)?.[1];
  const mine = !me?.githubUsername
    ? t('ghYouNotConnected')
    : me.githubUsername.toLowerCase() === repo.owner.toLowerCase()
      ? t('ghRepoOwner')
      : permission
        ? fillMessage(t('ghYourAccess'), { perm: t(permission) })
        : t('ghYouNoAccess');

  return (
    <section className="panel gh-repo-summary">
      <span aria-hidden="true"><Icon name="github" /></span>
      <div>
        <small>{t('ghRepoOfProject')}</small>
        <strong>
          <a className="gh-link" href={repo.url} target="_blank" rel="noreferrer">
            {repo.fullName} <Icon name="open" />
          </a>{' '}
          <span className={`gh-badge ${repo.private ? '' : 'ok'}`}>{repo.private ? t('ghPrivate') : t('ghPublic')}</span>
        </strong>
        <small>{mine}</small>
      </div>
    </section>
  );
}

function GitHubHandle({ login }: { login: string }) {
  return (
    <a href={`https://github.com/${login}`} target="_blank" rel="noreferrer" className="gh-link">
      @{login}
    </a>
  );
}

/** Live status from GitHub; only shown when we could ask GitHub (owner with a repo token). */
function AccessBadge({ context, state, saved }: { context: AppContextValue; state: GitHubAccessState | null; saved: boolean }) {
  const { t } = context;
  if (state === 'active') return <span className="gh-badge ok">{t('ghStateActive')}</span>;
  if (state === 'pending')
    return (
      <span className="gh-badge warn" title={t('ghStatePendingHint')}>
        {t('ghStatePending')}
      </span>
    );
  if (state === 'none' && saved)
    return (
      <span className="gh-badge bad" title={t('ghStateOutOfSyncHint')}>
        {t('ghStateOutOfSync')}
      </span>
    );
  return null;
}

function PendingRevocations({
  context,
  projectId,
  isOwner,
  readOnly,
}: {
  context: AppContextValue;
  projectId: string;
  isOwner: boolean;
  readOnly: boolean;
}) {
  const { t } = context;
  const [items, setItems] = useState<GitHubRevocation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => subscribeGitHubRevocations(projectId, setItems), [projectId]);

  if (!items.length) return null;

  const revoke = async (targets: GitHubRevocation[]) => {
    const token = getStoredGitHubToken();
    if (!token) {
      toast(t('ghNeedToken'));
      return;
    }
    setBusy(targets.length === 1 ? targets[0].id : 'all');
    const results = await Promise.allSettled(targets.map((item) => resolveGitHubRevocation(token, projectId, item)));
    setBusy(null);
    if (results.some((result) => result.status === 'rejected' && result.reason instanceof GitHubAuthError)) {
      endGitHubSession();
      toast(t('ghSessionExpired'), 'error');
      return;
    }
    const failed = results.filter((result) => result.status === 'rejected').length;
    const done = results.length - failed;
    if (done) toast(fillMessage(t('ghRevokedCount'), { n: String(done) }));
    if (failed) toast(fillMessage(t('ghRevokeSomeFailed'), { n: String(failed) }));
  };

  const session = useGitHubSession();
  const canRevoke = isOwner && !readOnly && Boolean(session);

  return (
    <section className="panel invites-panel gh-pending-panel">
      <PanelTitle
        title={fillMessage(t('ghPendingTitle'), { n: String(items.length) })}
        action={
          canRevoke && items.length > 1 ? (
            <button className="danger small" disabled={busy !== null} onClick={() => void revoke(items)}>
              {t('ghRevokeAll')}
            </button>
          ) : undefined
        }
      />
      <p className="muted gh-pending-hint">
        {!isOwner ? t('ghPendingAdminHint') : canRevoke ? t('ghPendingOwnerHint') : t('ghLockedHint')}
      </p>
      <div className="invite-list">
        {items.map((item) => (
          <div key={item.id}>
            <span><Icon name="unlock" /></span>
            <div>
              <strong>
                {item.displayName} · <GitHubHandle login={item.githubUsername} />
              </strong>
              <small>
                {item.repoOwner}/{item.repoName} · {t(REVOCATION_REASONS[item.reason])}
                {item.createdAt ? ` · ${item.createdAt.toDate().toLocaleDateString()}` : ''}
              </small>
            </div>
            {canRevoke && (
              <button className="danger small" disabled={busy !== null} onClick={() => void revoke([item])}>
                {busy === item.id ? '…' : t('ghRevoke')}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function InviteModal({
  project,
  context,
  role,
  onClose,
}: {
  project: Project;
  context: AppContextValue;
  role: Role | null;
  onClose: () => void;
}) {
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [link, setLink] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = await createInvite(project, context.user, inviteRole);
    setLink(`${location.origin}/invite/${id}`);
  };

  return (
    <Modal title={context.t('createInvite')} onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <p className="muted">{context.t('inviteHelp')}</p>
        <label>
          {context.t('colRole')}
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
            disabled={Boolean(link)}
          >
            <option value="member">Member</option>
            {role === 'owner' && <option value="admin">Admin</option>}
          </select>
        </label>
        {link ? (
          <div className="generated-link">
            <small>{context.t('inviteLink')}</small>
            <code>{link}</code>
            <button type="button" className="primary" onClick={() => void navigator.clipboard.writeText(link)}>
              {context.t('copyLink')}
            </button>
          </div>
        ) : (
          <button className="primary">{context.t('createInvite')}</button>
        )}
      </form>
    </Modal>
  );
}

