import { useCallback, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';
import type { AppContextValue } from '@/context/AppContext';
import type { ThemeMode } from '@/types';
import { Avatar } from '@/components/common/Avatar';
import { Icon } from '@/components/common/Icon';
import { Popover } from '@/components/common/Popover';
import { Segmented } from '@/components/common/Segmented';
import { isGitHubEnabled } from '@/config/features';
import { pick } from '@/utils/formatters';

/** Avatar button in the topbar: identity, language, theme, GitHub profile and sign-out. */
export function UserMenu({ context, onOpenProfile }: { context: AppContextValue; onOpenProfile: () => void }) {
  const { profile, locale, setLocale, setTheme, t } = context;
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const subtitle = isGitHubEnabled && profile.githubUsername ? `@${profile.githubUsername}` : profile.email;

  return (
    <Popover
      open={open}
      onClose={close}
      label={pick(locale, 'เมนูผู้ใช้', 'Account menu')}
      trigger={
        <button
          type="button"
          className="topbar-button avatar-button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={pick(locale, 'เมนูผู้ใช้', 'Account menu')}
          onClick={() => setOpen((value) => !value)}
        >
          <Avatar name={profile.displayName} src={profile.photoURL} />
        </button>
      }
    >
      <div className="menu-head">
        <Avatar name={profile.displayName} src={profile.photoURL} />
        <div>
          <strong>{profile.displayName}</strong>
          <small>{subtitle}</small>
        </div>
      </div>
      <div className="menu-sep" />
      <div className="menu-row">
        <span><Icon name="globe" />{pick(locale, 'ภาษา', 'Language')}</span>
        <Segmented value={locale} onChange={setLocale} options={[{ id: 'th', label: 'ไทย' }, { id: 'en', label: 'EN' }]} />
      </div>
      <div className="menu-row">
        <span><Icon name={profile.theme === 'dark' ? 'moon' : profile.theme === 'light' ? 'sun' : 'monitor'} />{pick(locale, 'ธีม', 'Theme')}</span>
        <Segmented<ThemeMode>
          value={profile.theme}
          onChange={setTheme}
          options={[
            { id: 'system', label: <Icon name="monitor" label={t('themeSystem')} /> },
            { id: 'light', label: <Icon name="sun" label={t('themeLight')} /> },
            { id: 'dark', label: <Icon name="moon" label={t('themeDark')} /> },
          ]}
        />
      </div>
      {isGitHubEnabled && (
        <>
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); onOpenProfile(); }}>
            <Icon name="github" />
            <span>{t('profile')}</span>
            {profile.githubUsername && <b>{t('ghConnected')}</b>}
          </button>
        </>
      )}
      <div className="menu-sep" />
      <button type="button" role="menuitem" className="menu-item danger-item" onClick={() => signOut(auth!)}>
        <Icon name="logout" />
        <span>{t('signOut')}</span>
      </button>
    </Popover>
  );
}
