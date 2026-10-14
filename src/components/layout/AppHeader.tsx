import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { useSiteFeedback } from '@/hooks/useSiteFeedback';
import { Avatar } from '@/components/common/Avatar';
import { Icon } from '@/components/common/Icon';
import { Modal } from '@/components/common/Modal';
import { SiteFeedbackModal } from '@/components/feedback/SiteFeedbackModal';
import { linkGitHubAccount, unlinkGitHubAccount } from '@/services/github';
import { isGitHubEnabled } from '@/config/features';
import { attempt, toast } from '@/components/toast';
import { fillMessage } from '@/utils/i18n';
import { pick } from '@/utils/formatters';
import { UserMenu } from './UserMenu';

/** Top bar. `leading` replaces the brand (the workspace passes a project › section breadcrumb). */
export function AppHeader({ context, leading }: { context: AppContextValue; leading?: ReactNode }) {
  const { locale, t } = context;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const admin = context.siteRole !== null;
  // Query only open feedback on server up to limit 20 for badge
  const openCount = useSiteFeedback(context, admin, { status: 'open', limitCount: 20 }).length;
  const feedbackLabel = admin ? t('feedbackInbox') : t('sendFeedback');

  return (
    <header className="topbar">
      <div className="topbar-leading">
        {leading ?? (
          <Link className="brand" to="/">
            <span className="brand-mark">P</span>
            <strong>SuperKanban</strong>
          </Link>
        )}
      </div>
      <div className="topbar-actions">
        <button type="button" className="topbar-button tarot" onClick={() => navigate('/tarot')} title={pick(locale, 'เปิดไพ่ทาโรต์', 'Open Tarot')} aria-label={pick(locale, 'เปิดไพ่ทาโรต์', 'Open Tarot')}>
          <Icon name="sparkles" />
        </button>
        <button type="button" className="topbar-button" onClick={() => (admin ? navigate('/admin?tab=feedback') : setFeedbackOpen(true))} title={feedbackLabel} aria-label={feedbackLabel}>
          <Icon name={admin ? 'inbox' : 'feedback'} />
          {admin && openCount > 0 && <b>{openCount}</b>}
        </button>
        <UserMenu context={context} onOpenProfile={() => setProfileOpen(true)} />
      </div>
      {feedbackOpen && <SiteFeedbackModal context={context} onClose={() => setFeedbackOpen(false)} />}
      {isGitHubEnabled && profileOpen && <UserProfileModal context={context} onClose={() => setProfileOpen(false)} />}
    </header>
  );
}

function UserProfileModal({ context, onClose }: { context: AppContextValue; onClose: () => void }) {
  const { profile, user, t } = context;
  const [loading, setLoading] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    const result = await attempt(() => linkGitHubAccount(user), t('ghLinkFailed'));
    setLoading(false);
    if (result?.username) {
      toast(fillMessage(t('ghConnectedAs'), { name: result.username }));
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    await attempt(() => unlinkGitHubAccount(user), t('ghDisconnectFailed'));
    setLoading(false);
    setConfirmDisconnect(false);
    toast(t('ghDisconnected'));
  };

  return (
    <Modal title={t('profile')} onClose={onClose}>
      <div className="profile-card">
        <div className="profile-card-head">
          <Avatar name={profile.displayName} src={profile.photoURL} size="lg" />
          <div>
            <h3>{profile.displayName}</h3>
            <p className="muted">{profile.email}</p>
          </div>
        </div>

        <div className="gh-card">
          <div className="gh-card-head">
            <div>
              <strong>
                GitHub{' '}
                <span className={`gh-badge ${profile.githubUsername ? 'ok' : ''}`}>
                  {profile.githubUsername ? t('ghConnected') : t('ghNotConnected')}
                </span>
              </strong>
              <small>
                {profile.githubUsername
                  ? `@${profile.githubUsername}${profile.githubId ? ` · ID ${profile.githubId}` : ''}`
                  : t('ghIdentityHelp')}
              </small>
            </div>
            {profile.githubUsername && (
              <a className="gh-link" href={`https://github.com/${profile.githubUsername}`} target="_blank" rel="noreferrer">
                {t('ghViewProfile')}
              </a>
            )}
          </div>

          <div className="action-row">
            {profile.githubUsername ? (
              confirmDisconnect ? (
                <div className="gh-confirm">
                  <span>{t('ghDisconnectConfirm')}</span>
                  <small className="gh-note">{t('ghDisconnectNote')}</small>
                  <button className="danger small" disabled={loading} onClick={handleDisconnect}>
                    {t('ghDisconnect')}
                  </button>
                  <button className="secondary small" disabled={loading} onClick={() => setConfirmDisconnect(false)}>
                    {t('cancel')}
                  </button>
                </div>
              ) : (
                <button className="danger ghost small" disabled={loading} onClick={() => setConfirmDisconnect(true)}>
                  {t('ghDisconnectAccount')}
                </button>
              )
            ) : (
              <button className="primary small" disabled={loading} onClick={handleConnect}>
                {loading ? t('ghConnecting') : t('ghConnect')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
