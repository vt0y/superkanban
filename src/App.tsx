import { lazy, Suspense, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { Navigate, Route, Routes } from 'react-router-dom';
import { auth, googleProvider, missingFirebaseConfig } from '@/config/firebase';
import { isAllowedEmail } from '@/config/auth-domains';
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
import { AccountSuspended } from '@/pages/AccountSuspended';
import { FullLoader } from '@/components/common/FullLoader';

const AdminPage = lazy(() => import('@/pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const ConfigScreen = lazy(() => import('@/pages/ConfigScreen').then((m) => ({ default: m.ConfigScreen })));
const Home = lazy(() => import('@/pages/Home').then((m) => ({ default: m.Home })));
const InviteAccept = lazy(() => import('@/pages/InviteAccept').then((m) => ({ default: m.InviteAccept })));
const LoginScreen = lazy(() => import('@/pages/LoginScreen').then((m) => ({ default: m.LoginScreen })));
const NewProject = lazy(() => import('@/pages/NewProject').then((m) => ({ default: m.NewProject })));
const ProjectWorkspace = lazy(() => import('@/pages/ProjectWorkspace').then((m) => ({ default: m.ProjectWorkspace })));
const SiteFeedbackPage = lazy(() => import('@/pages/SiteFeedbackPage').then((m) => ({ default: m.SiteFeedbackPage })));
const TarotPage = lazy(() => import('@/pages/TarotPage').then((m) => ({ default: m.TarotPage })));

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
  const [projectsLoaded, setProjectsLoaded] = useState(false);
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
            setProjects([]);
            setProjectsLoaded(false);
            setSiteRole(undefined);
            setAuthError('DOMAIN_NOT_ALLOWED');
            return;
          }
          setProfile(null);
          setError('');
          setUser(nextUser);
          setProjects([]);
          setProjectsLoaded(false);
          setSiteRole(undefined);
        } else {
          setUser(null);
          setProfile(null);
          setProjects([]);
          setProjectsLoaded(false);
          setSiteRole(undefined);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    const stopProfile = subscribeEnsuredProfile(user, setProfile, () => setError('ไม่สามารถโหลดหรือสร้างโปรไฟล์ได้'));
    const stopSiteRole = subscribeSiteRole(user.uid, setSiteRole);
    return () => {
      stopProfile();
      stopSiteRole();
    };
  }, [user]);

  const accountActive = !!user && profile?.id === user.uid && profile.accountStatus !== 'suspended';
  useEffect(() => {
    setProjects([]);
    setProjectsLoaded(false);
    if (!user || !accountActive) return;
    let current = true;
    const stop = subscribeProjects(user.uid, (items) => {
      if (!current) return;
      setProjects(items); setProjectsLoaded(true);
    }, () => {
      if (!current) return;
      setProjectsLoaded(true); setError('ไม่สามารถโหลดโปรเจกต์ได้');
    });
    return () => { current = false; stop(); };
  }, [user, accountActive]);

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
  if (!profile || profile.id !== user.uid) {
    if (error) return <main className="page-shell feedback-page"><p role="alert">{error}</p><button type="button" className="secondary" onClick={() => window.location.reload()}>ลองใหม่ / Retry</button><button type="button" className="secondary" onClick={() => void signOut(auth!)}>ออกจากระบบ / Sign out</button></main>;
    return <FullLoader />;
  }
  if (profile.accountStatus === 'suspended') return <Theme theme={profile.theme}><AccountSuspended locale={profile.locale} onSignOut={() => void signOut(auth!)} /></Theme>;
  if (siteRole === undefined) return <FullLoader />;

  const setLocale = (locale: Locale) => void updatePreferences(user.uid, { locale });
  const setTheme = (theme: ThemeMode) => void updatePreferences(user.uid, { theme });
  const context: AppContextValue = {
    user,
    profile,
    projects,
    projectsLoaded,
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
          <Route path="/admin" element={siteRole === 'owner' || siteRole === 'admin' ? <AdminPage context={context} /> : <Navigate to="/" replace />} />
          <Route path="/feedback" element={siteRole === 'owner' || siteRole === 'admin' ? <Navigate to="/admin?tab=feedback" replace /> : <SiteFeedbackPage context={context} />} />
          <Route path="/tarot" element={<TarotPage context={context} />} />
          {/* `/p/:id/docs/:documentId` opens a document; the workspace redirects the old /documents/ and /notes/ forms. */}
          <Route path="/p/:projectId/:section/:documentId" element={<ProjectWorkspace context={context} />} />
          <Route path="/p/:projectId/:section?" element={<ProjectWorkspace context={context} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
    </Theme>
  );
}
