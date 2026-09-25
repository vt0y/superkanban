import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '@/config/firebase';
import type { AppContextValue } from '@/context/AppContext';
import { useSiteFeedback } from '@/hooks/useSiteFeedback';
import type { ThemeMode } from '@/types';
import { Avatar } from '@/components/common/Avatar';
import { Modal } from '@/components/common/Modal';
import { SiteFeedbackModal } from '@/components/feedback/SiteFeedbackModal';
import { linkGitHubAccount, unlinkGitHubAccount } from '@/services/github';
import { isGitHubEnabled } from '@/config/features';
import { attempt, toast } from '@/components/toast';
import { fillMessage } from '@/utils/i18n';

export function AppHeader({ context }: { context: AppContextValue }) {
  const { profile, locale, setLocale, setTheme, t } = context;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const admin = context.siteRole !== null;
  // Query only open feedback on server up to limit 20 for badge
  const openCount = useSiteFeedback(context, admin, { status: 'open', limitCount: 20 }).length;
  const identity = (
    <>
      <Avatar name={profile.displayName} src={profile.photoURL} />
      <span>
        <strong>{profile.displayName}</strong>
        <small>{isGitHubEnabled && profile.githubUsername ? `@${profile.githubUsername}` : profile.email}</small>
      </span>
    </>
  );

  return (
    <header className="topbar">
      <a className="brand" href="/">
        <span className="brand-mark">P</span>
        <strong>ProjectSpace</strong>
      </a>
      <div className="topbar-actions">
        <button
          className="feedback-button"
          onClick={() => (admin ? navigate('/feedback') : setFeedbackOpen(true))}
          title={admin ? t('feedbackInbox') : t('sendFeedback')}
        >
          💬{' '}
          <span>
            {admin
              ? locale === 'th'
                ? 'กล่องฟีดแบ็ก'
                : 'Inbox'
              : locale === 'th'
                ? 'ฟีดแบ็ก'
                : 'Feedback'}
          </span>
          {admin && openCount > 0 && <b>{openCount}</b>}
        </button>
        {feedbackOpen && <SiteFeedbackModal context={context} onClose={() => setFeedbackOpen(false)} />}
        <button className="locale-switch" onClick={() => setLocale(locale === 'th' ? 'en' : 'th')}>
          {locale === 'th' ? 'EN' : 'ไทย'}
        </button>
        <select
          className="theme-select"
          value={profile.theme}
          onChange={(event) => setTheme(event.target.value as ThemeMode)}
          aria-label="Theme"
        >
          <option value="system">◐ {t('themeSystem')}</option>
          <option value="light">☀ {t('themeLight')}</option>
          <option value="dark">☾ {t('themeDark')}</option>
        </select>
        <div className="profile-menu">
          {isGitHubEnabled ? (
            <button type="button" className={`profile-trigger ${profileOpen ? 'active' : ''}`} onClick={() => setProfileOpen(true)} title={t('profile')}>
              {identity}
            </button>
          ) : (
            identity
          )}
          <button onClick={() => signOut(auth!)} title={t('signOut')}>
            ↪
          </button>
        </div>
      </div>
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
