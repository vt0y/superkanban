import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppContextValue, SectionProps } from '@/context/AppContext';
import { DrivePermissionSyncPanel, Empty, Modal, PageTitle } from '@/components/common';
import { canManageProject } from '@/utils/permissions';
import { updateProject } from '@/services/projects';
import {
  endGitHubSession,
  fetchInstallationRepositories,
  getStoredGitHubToken,
  GitHubAuthError,
  linkProjectRepository,
  queueGitHubRevocation,
  revokeRepoAccess,
  unlinkProjectRepository,
  updateMemberGitHubPermission,
  type GitHubRepoSummary,
} from '@/services/github';
import { GitHubSessionBar, useGitHubSession } from '@/components/github/GitHubSessionBar';
import { attempt, toast } from '@/components/toast';
import { githubAppInstallUrl, isGitHubEnabled, isGoogleDriveEnabled } from '@/config/features';
import { PROJECT_COLORS } from '@/config/constants';
import { fillMessage } from '@/utils/i18n';
import { pick } from '@/utils/formatters';
import type { Membership, Project } from '@/types';
import { writeBatch } from 'firebase/firestore';
import { database } from '@/services/helpers';

export function Settings({ context, project, members, role, readOnly }: SectionProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: project.name, description: project.description, color: project.color });

  if (!canManageProject(role)) {
    return <Empty icon="🔒" title={context.t('noAccess')} description={context.t('settingsOwnerOnly')} />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await updateProject(project.id, form);
    toast(context.t('settingsSaved'));
  };

  return (
    <>
      <PageTitle
        eyebrow="PROJECT CONFIGURATION"
        title={context.t('settings')}
        description={context.t('settingsDesc')}
      />
      <section className="panel settings-panel">
        <h2>{context.t('projectInfo')}</h2>
        <form className="stack-form" onSubmit={submit}>
          <label>
            {context.t('projectName')}
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              disabled={readOnly}
            />
          </label>
          <label>
            {context.t('projectDescription')}
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              disabled={readOnly}
            />
          </label>
          <fieldset disabled={readOnly}>
            <legend>{context.t('projectColor')}</legend>
            <div className="color-picker">
              {PROJECT_COLORS.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={form.color === color ? 'selected' : ''}
                  style={{ background: color }}
                  onClick={() => setForm({ ...form, color })}
                />
              ))}
            </div>
          </fieldset>
          {!readOnly && <button className="primary fit">{context.t('save')}</button>}
        </form>
      </section>

      {isGoogleDriveEnabled && (
        <section className="panel settings-panel drive-settings">
          <h2>{pick(context.locale, 'สิทธิ์การเข้าถึง Google Drive', 'Google Drive access')}</h2>
          <p className="muted">{pick(context.locale, 'ซิงก์ไฟล์ที่คุณเป็นเจ้าของในโปรเจกต์นี้กับรายชื่อสมาชิกปัจจุบัน', 'Keep files you own in this project aligned with the current member list.')}</p>
          <DrivePermissionSyncPanel variant="settings" projectId={project.id} members={members} user={context.user} locale={context.locale} disabled={readOnly} />
        </section>
      )}

      {isGitHubEnabled && role === 'owner' && (
        <GitHubSettings
          project={project}
          members={members}
          context={context}
          readOnly={readOnly}
        />
      )}

      {role === 'owner' && !readOnly && (
        <section className="danger-zone">
          <div>
            <h2>{context.t('archive')}</h2>
            <p>{context.t('archiveDesc')}</p>
          </div>
          <button
            className="danger"
            onClick={async () => {
              if (confirm(fillMessage(context.t('archiveConfirm'), { name: project.name }))) {
                await updateProject(project.id, { archived: true });
                navigate('/');
              }
            }}
          >
            {context.t('archive')}
          </button>
        </section>
      )}
    </>
  );
}

function GitHubSettings({
  project,
  members,
  context,
  readOnly,
}: {
  project: Project;
  members: Membership[];
  context: AppContextValue;
  readOnly: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [revokeAll, setRevokeAll] = useState(true);
  const [loading, setLoading] = useState(false);
  const repo = project.githubRepo;
  const { t } = context;
  const granted = members.filter((member) => member.githubUsername && member.githubPermission);

  // Revoke on GitHub where possible; whatever fails (or everything, without a token) is queued in the Team page.
  const revokeGranted = async () => {
    if (!repo) return;
    const token = getStoredGitHubToken();
    const results = await Promise.allSettled(
      granted.map(async (member) => {
        if (!token) throw new Error('NO_TOKEN');
        await revokeRepoAccess(token, repo.owner, repo.name, member.githubUsername!);
        await updateMemberGitHubPermission(project.id, member.userId, null);
      }),
    );
    if (results.some((result) => result.status === 'rejected' && result.reason instanceof GitHubAuthError)) endGitHubSession();
    const leftover = granted.filter((_, index) => results[index].status === 'rejected');
    if (leftover.length) {
      const batch = writeBatch(database());
      leftover.forEach((member) =>
        queueGitHubRevocation(batch, project.id, {
          githubUsername: member.githubUsername!,
          userId: member.userId,
          displayName: member.displayName,
          permission: member.githubPermission!,
          repoOwner: repo.owner,
          repoName: repo.name,
          reason: 'unlinked',
          createdBy: context.user.uid,
        }),
      );
      await batch.commit();
    }
    const revoked = granted.length - leftover.length;
    if (revoked) toast(fillMessage(t('ghRevokedCount'), { n: String(revoked) }));
    if (leftover.length) toast(fillMessage(t('ghUnlinkQueued'), { n: String(leftover.length) }));
  };

  const handleUnlink = async () => {
    if (!repo) return;
    setLoading(true);
    const ok = await attempt(async () => {
      if (revokeAll && granted.length) await revokeGranted();
      await unlinkProjectRepository(project.id, repo.fullName, context.user);
    }, t('ghUnlinkFailed'));
    setLoading(false);
    setConfirmUnlink(false);
    if (ok !== undefined) toast(t('ghUnlinked'));
  };

  return (
    <section className="panel settings-panel gh-settings">
      <h2>GitHub</h2>
      {repo ? (
        <>
          <div className="gh-card gh-card-head gh-linked-card">
            <div>
              <strong>
                {repo.fullName} <span className={`gh-badge ${repo.private ? '' : 'ok'}`}>{repo.private ? t('ghPrivate') : t('ghPublic')}</span>
                <span className="gh-badge ok">{t('ghCurrentRepo')}</span>
              </strong>
              <small>
                {t('ghDefaultBranch')}: {repo.defaultBranch || 'main'}
              </small>
            </div>
            <a className="gh-link" href={repo.url} target="_blank" rel="noreferrer">
              {t('ghOpen')}
            </a>
          </div>
          {!readOnly && <GitHubSessionBar context={context} />}
          {!readOnly && (
            <div className="action-row">
              {confirmUnlink ? (
                <div className="gh-confirm">
                  <span>{t('ghUnlinkConfirm')}</span>
                  {granted.length > 0 && (
                    <label className="gh-check">
                      <input type="checkbox" checked={revokeAll} onChange={(e) => setRevokeAll(e.target.checked)} />
                      {fillMessage(t('ghUnlinkRevokeAll'), { n: String(granted.length) })}
                    </label>
                  )}
                  <button className="danger small" disabled={loading} onClick={handleUnlink}>
                    {t('ghUnlink')}
                  </button>
                  <button className="secondary small" disabled={loading} onClick={() => setConfirmUnlink(false)}>
                    {t('cancel')}
                  </button>
                </div>
              ) : (
                <button className="danger ghost small" disabled={loading} onClick={() => setConfirmUnlink(true)}>
                  {t('ghUnlinkRepo')}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="muted">{t('ghRepoHelp')}</p>
          {!readOnly && (
            <button className="primary fit" onClick={() => setModalOpen(true)}>
              {t('ghLinkRepo')}
            </button>
          )}
        </>
      )}
      {modalOpen && <LinkRepoModal project={project} context={context} onClose={() => setModalOpen(false)} />}
    </section>
  );
}

function LinkRepoModal({ project, context, onClose }: { project: Project; context: AppContextValue; onClose: () => void }) {
  const projectId = project.id;
  const linked = project.githubRepo;
  /** The repo picked in this modal; success is shown only once the live project confirms it. */
  const [pickedId, setPickedId] = useState<number | null>(null);
  const { t } = context;
  const session = useGitHubSession();
  const token = session?.token ?? '';
  const [repos, setRepos] = useState<GitHubRepoSummary[]>([]);
  const [installations, setInstallations] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadRepos = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const result = await fetchInstallationRepositories(token);
      setRepos(result.repos);
      setInstallations(result.installations);
    } catch (err: unknown) {
      if (err instanceof GitHubAuthError) {
        endGitHubSession();
        setError(t('ghSessionExpired'));
      } else {
        setError(err instanceof Error ? err.message : t('ghFetchFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setRepos([]);
    setInstallations(null);
    void loadRepos();
  }, [token]);

  const handleSelectRepo = async (repo: GitHubRepoSummary) => {
    setLoading(true);
    const ok = await attempt(
      () =>
        linkProjectRepository(
          projectId,
          {
            id: repo.id,
            owner: repo.owner,
            name: repo.name,
            fullName: repo.fullName,
            url: repo.htmlUrl,
            private: repo.private,
            ownerType: repo.ownerType,
            defaultBranch: repo.defaultBranch,
          },
          context.user,
        ),
      t('ghLinkRepoFailed'),
    );
    setLoading(false);
    if (ok !== undefined) {
      setPickedId(repo.id);
      toast(fillMessage(t('ghLinkedRepo'), { name: repo.fullName }), 'success');
    } else {
      setError(t('ghLinkRepoFailed'));
    }
  };

  const query = filter.toLowerCase();
  const filtered = repos.filter((r) => r.fullName.toLowerCase().includes(query) || r.description.toLowerCase().includes(query));
  const installLink = (label: string) => (
    <a className="gh-link" href={githubAppInstallUrl} target="_blank" rel="noreferrer">
      {label}
    </a>
  );

  return (
    <Modal title={t('ghLinkRepo')} onClose={onClose} wide>
      {pickedId !== null ? (
        <div className="gh-linked-done" role="status">
          {linked?.id === pickedId ? (
            <>
              <span className="gh-linked-check">✓</span>
              <strong>{t('ghSelected')}</strong>
              <p>{fillMessage(t('ghLinkedToProject'), { repo: linked.fullName, project: project.name })}</p>
              <small className="muted">{t('ghLinkedNext')}</small>
              <div className="action-row">
                <button type="button" className="primary" onClick={onClose}>
                  {t('ghDone')}
                </button>
              </div>
            </>
          ) : (
            <p className="muted">{t('ghSaving')}</p>
          )}
        </div>
      ) : (
      <div className="stack-form">
        <p className="muted">{t('ghAuthHelp')}</p>
        <GitHubSessionBar context={context} />
        {error && <p className="form-error">{error}</p>}
        {token && installations === 0 && !loading && (
          <div className="gh-install-empty">
            <strong>{t('ghInstallTitle')}</strong>
            <small className="muted">{t('ghInstallHelp')}</small>
            <div className="action-row">
              <a className="primary small gh-button-link" href={githubAppInstallUrl} target="_blank" rel="noreferrer">
                {t('ghInstallApp')} ↗
              </a>
              <button type="button" className="secondary small" onClick={() => void loadRepos()}>
                ↻ {t('ghInstalledReload')}
              </button>
            </div>
          </div>
        )}
        {token && Boolean(installations) && (
          <>
            <div className="gh-inline">
              <input type="search" placeholder={t('ghSearchRepos')} value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button type="button" className="secondary" disabled={loading} onClick={() => void loadRepos()}>
                ↻ {t('refresh')}
              </button>
            </div>
            <div className="gh-repo-list">
              {loading && <p className="muted">{t('ghLoadingRepos')}</p>}
              {filtered.map((repo) => (
                <div className={`gh-repo-item ${linked?.id === repo.id ? 'selected' : ''}`} key={repo.id}>
                  <div>
                    <strong>
                      {repo.fullName} <span className={`gh-badge ${repo.private ? '' : 'ok'}`}>{repo.private ? t('ghPrivate') : t('ghPublic')}</span>
                    </strong>
                    {repo.description && <small>{repo.description}</small>}
                  </div>
                  {linked?.id === repo.id ? (
                    <span className="gh-badge ok">{t('ghCurrentRepo')}</span>
                  ) : (
                    <button className="primary small" disabled={loading || pickedId !== null} onClick={() => handleSelectRepo(repo)}>
                      {t('select')}
                    </button>
                  )}
                </div>
              ))}
              {!loading && filtered.length === 0 && <p className="muted gh-empty">{t('ghNoRepos')}</p>}
            </div>
            <small className="muted">
              {t('ghMissingRepo')} {installLink(t('ghManageInstall'))}
            </small>
          </>
        )}
        {token && installations === null && loading && <p className="muted">{t('ghLoadingRepos')}</p>}
      </div>
      )}
    </Modal>
  );
}
