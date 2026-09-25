import { lazy, Suspense, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { Navigate, Route, Routes } from 'react-router-dom';
import { auth, googleProvider, missingFirebaseConfig } from '@/config/firebase';
import { getDomainErrorMessage, isAllowedEmail } from '@/config/auth-domains';
import type { AppContextValue } from '@/context/AppContext';
import { translate, type MessageKey } from '@/utils/i18n';
import {
  subscribeEnsuredProfile,
  subscribeProjects,
  subscribeSiteRole,
  updatePreferences,
} from '@/services';
import type { Locale, Project, SiteRole, ThemeMode, UserProfile } from '@/types';
import { Theme } from '@/components/layout/Theme';
import { Toaster } from '@/components/toast/Toaster';
import { FullLoader } from '@/components/common/FullLoader';

const ConfigScreen = lazy(() => import('@/pages/ConfigScreen').then((m) => ({ default: m.ConfigScreen })));
const Home = lazy(() => import('@/pages/Home').then((m) => ({ default: m.Home })));
const InviteAccept = lazy(() => import('@/pages/InviteAccept').then((m) => ({ default: m.InviteAccept })));
const LoginScreen = lazy(() => import('@/pages/LoginScreen').then((m) => ({ default: m.LoginScreen })));
const NewProject = lazy(() => import('@/pages/NewProject').then((m) => ({ default: m.NewProject })));
const ProjectWorkspace = lazy(() => import('@/pages/ProjectWorkspace').then((m) => ({ default: m.ProjectWorkspace })));
const SiteFeedbackPage = lazy(() => import('@/pages/SiteFeedbackPage').then((m) => ({ default: m.SiteFeedbackPage })));

// Re-exports for backward-compatibility
export type { AppContextValue } from '@/context/AppContext';
export { AppHeader } from '@/components/layout/AppHeader';
export { Avatar, Empty, Modal } from '@/components/common';

export default function App() {
  if (!auth || missingFirebaseConfig.length) {
    return (
      <Suspense fallback={<FullLoader />}>
        <ConfigScreen />
      </Suspense>
    );
  }
  return <AuthGate />;
}

function AuthGate() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [siteRole, setSiteRole] = useState<SiteRole | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(
    () =>
      onAuthStateChanged(auth!, async (nextUser) => {
        if (nextUser) {
          if (!isAllowedEmail(nextUser.email)) {
            await signOut(auth!);
            setUser(null);
            setProfile(null);
            setSiteRole(undefined);
            setAuthError(getDomainErrorMessage());
            return;
          }
          setUser(nextUser);
          setSiteRole(undefined);
        } else {
          setUser(null);
          setProfile(null);
          setSiteRole(undefined);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    const stopProfile = subscribeEnsuredProfile(user, setProfile, () => setError('ไม่สามารถโหลดหรือสร้างโปรไฟล์ได้'));
    const stopProjects = subscribeProjects(user.uid, setProjects, () => setError('ไม่สามารถโหลดโปรเจกต์ได้'));
    const stopSiteRole = subscribeSiteRole(user.uid, setSiteRole);
    return () => {
      stopProfile();
      stopProjects();
      stopSiteRole();
    };
  }, [user]);

  const handleLogin = async () => {
    setAuthError('');
    const result = await signInWithPopup(auth!, googleProvider);
    if (!isAllowedEmail(result.user.email)) {
      await signOut(auth!);
      throw new Error('DOMAIN_NOT_ALLOWED');
    }
  };

  if (user === undefined) return <FullLoader />;
  if (!user) {
    return (
      <Suspense fallback={<FullLoader />}>
        <LoginScreen onLogin={handleLogin} errorMessage={authError} />
      </Suspense>
    );
  }
  if (!profile || siteRole === undefined) return <FullLoader />;

  const setLocale = (locale: Locale) => void updatePreferences(user.uid, { locale });
  const setTheme = (theme: ThemeMode) => void updatePreferences(user.uid, { theme });
  const context: AppContextValue = {
    user,
    profile,
    projects,
    siteRole,
    locale: profile.locale,
    t: (key) => translate(profile.locale, key as MessageKey),
    setLocale,
    setTheme,
  };

  return (
    <Theme theme={profile.theme}>
      {error && <div className="global-error">{error}</div>}
      <Suspense fallback={<FullLoader />}>
        <Routes>
          <Route path="/" element={<Home context={context} />} />
          <Route path="/new" element={<NewProject context={context} />} />
          <Route path="/invite/:inviteId" element={<InviteAccept context={context} />} />
          <Route path="/feedback" element={<SiteFeedbackPage context={context} />} />
          <Route path="/p/:projectId/:section?" element={<ProjectWorkspace context={context} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
    </Theme>
  );
}
