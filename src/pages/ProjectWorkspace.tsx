import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { AppHeader } from '@/components/layout/AppHeader';
import { auth } from '@/config/firebase';
import type { MessageKey } from '@/utils/i18n';
import { roleFor } from '@/utils/permissions';
import { subscribeMemberships } from '@/services/members';
import { getProject, updateProject } from '@/services/projects';
import { subscribeGachaDraws } from '@/services/gacha';
import { membershipGitHubDrift, syncOwnMembershipGitHub } from '@/services/github';
import { isGitHubEnabled } from '@/config/features';
import type { GachaDraw, Membership, Project } from '@/types';
import { Board } from '@/sections/board';
import { Dashboard } from '@/sections/dashboard';
import { ProjectChat } from '@/components/chat/ProjectChat';
import { pick } from '@/utils/formatters';

const loadCalendar = () => import('@/sections/calendar');
const loadDesign = () => import('@/sections/design');
const loadMilestones = () => import('@/sections/milestones');
const loadNotes = () => import('@/sections/notes');
const loadSettings = () => import('@/sections/settings');
const loadTeam = () => import('@/sections/team');
const loadVotes = () => import('@/sections/votes');
const loadGacha = () => import('@/sections/gacha');
const SECTION_LOADERS = [loadCalendar, loadDesign, loadMilestones, loadNotes, loadSettings, loadTeam, loadVotes, loadGacha];

const Calendar = lazy(() => loadCalendar().then((m) => ({ default: m.Calendar })));
const SoftwareDesign = lazy(() => loadDesign().then((m) => ({ default: m.SoftwareDesign })));
const Milestones = lazy(() => loadMilestones().then((m) => ({ default: m.Milestones })));
const Notes = lazy(() => loadNotes().then((m) => ({ default: m.Notes })));
const Settings = lazy(() => loadSettings().then((m) => ({ default: m.Settings })));
const Team = lazy(() => loadTeam().then((m) => ({ default: m.Team })));
const Votes = lazy(() => loadVotes().then((m) => ({ default: m.Votes })));
const Gacha = lazy(() => loadGacha().then((m) => ({ default: m.Gacha })));
const GachaReveal = lazy(() => import('@/components/gacha/GachaReveal').then((m) => ({ default: m.GachaReveal })));

const NAV_GROUPS: { th: string; en: string; items: [path: string, icon: string, label: MessageKey][] }[] = [
  {
    th: 'วางแผน',
    en: 'Plan',
    items: [
      ['dashboard', '⌂', 'dashboard'],
      ['board', '▦', 'board'],
      ['calendar', '▣', 'calendar'],
      ['milestones', '◇', 'milestones'],
      ['gacha', '✦', 'gacha'],
    ],
  },
  { th: 'ออกแบบ', en: 'Design', items: [['design', '◈', 'design']] },
  {
    th: 'ร่วมมือ',
    en: 'Collaborate',
    items: [
      ['notes', '▤', 'notes'],
      ['votes', '☑', 'votes'],
    ],
  },
  {
    th: 'จัดการ',
    en: 'Manage',
    items: [
      ['team', '♙', 'team'],
      ['settings', '⚙', 'settings'],
    ],
  },
];
const SECTIONS = new Set(NAV_GROUPS.flatMap((group) => group.items.map(([path]) => path)));
const MOBILE_PRIMARY = [
  ['dashboard', '⌂', 'dashboard'],
  ['board', '▦', 'board'],
  ['notes', '▤', 'notes'],
] as const;
const MOBILE_MORE = NAV_GROUPS.flatMap((group) => group.items).filter(
  ([path]) => !MOBILE_PRIMARY.some(([primary]) => primary === path),
);

export function ProjectWorkspace({ context }: { context: AppContextValue }) {
  const params = useParams();
  const projectId = params.projectId || '';
  const section = params.documentId ? 'notes' : (params.section || 'dashboard');
  const documentId = params.documentId;
  const contextProject = context.projects.find((item) => item.id === projectId);
  const [fallbackProject, setFallbackProject] = useState<{ projectId: string; project: Project | null } | null>(null);
  const [membershipState, setMembershipState] = useState<{ projectId: string; members: Membership[] } | null>(null);
  const [gachaState, setGachaState] = useState<{ projectId: string; draws: GachaDraw[] } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const fallbackMatches = fallbackProject?.projectId === projectId;
  const project = contextProject ? contextProject : fallbackMatches ? fallbackProject.project : undefined;
  const projectPending = !context.projectsLoaded || (!contextProject && !fallbackMatches);
  const canAccessProject = Boolean(project?.memberIds.includes(context.user.uid));
  const showGachaHistory = section === 'gacha';
  const members = membershipState?.projectId === projectId ? membershipState.members : [];
  const gachaDraws = gachaState?.projectId === projectId ? gachaState.draws : [];

  useEffect(() => {
    if (contextProject) {
      setFallbackProject((current) => current?.projectId === projectId ? null : current);
      return;
    }
    if (!context.projectsLoaded) return;
    let active = true;
    void getProject(projectId)
      .then((next) => { if (active) setFallbackProject({ projectId, project: next }); })
      .catch(() => { if (active) setFallbackProject({ projectId, project: null }); });
    return () => { active = false; };
  }, [context.projectsLoaded, contextProject, projectId]);

  useEffect(() => {
    if (!project || !canAccessProject) return;
    return subscribeMemberships(project.id, (items) => setMembershipState({ projectId: project.id, members: items }));
  }, [project?.id, canAccessProject]);

  useEffect(() => {
    if (!project || !canAccessProject) return;
    const limitCount = showGachaHistory ? 15 : 1;
    return subscribeGachaDraws(project.id, limitCount, (draws) => setGachaState({ projectId: project.id, draws }));
  }, [project?.id, canAccessProject, showGachaHistory]);

  useEffect(() => setMenuOpen(false), [section]);

  // Warm the other sections' chunks once the page is idle, so switching tabs (slow on mobile
  // networks) renders instantly instead of flashing a full-screen loader.
  useEffect(() => {
    const warm = () => SECTION_LOADERS.forEach((load) => void load().catch(() => undefined));
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(warm, 2500);
    return () => window.clearTimeout(timer);
  }, []);

  // Self-heal: keep my GitHub handle on this project's membership in step with my profile, so the
  // owner sees who is connected even if the sync at connect time failed. One write, only on drift.
  const healAttempted = useRef('');
  const mine = members.find((member) => member.userId === context.user.uid);
  useEffect(() => {
    if (!isGitHubEnabled || !mine || !project || project.archived) return;
    if (!membershipGitHubDrift(mine, context.profile)) return;
    const key = `${mine.id}:${context.profile.githubUsername || ''}:${context.profile.githubId || ''}`;
    if (healAttempted.current === key) return;
    healAttempted.current = key;
    syncOwnMembershipGitHub(mine, context.profile).catch((err) => console.warn('GitHub membership self-heal skipped', err));
  }, [mine?.id, mine?.githubUsername, mine?.githubId, context.profile.githubUsername, context.profile.githubId, project?.archived]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    addEventListener('keydown', close);
    return () => {
      removeEventListener('keydown', close);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  if (projectPending || project === undefined)
    return (
      <div className="full-loader">
        <span className="loader" />
      </div>
    );
  if (!project || !project.memberIds.includes(context.user.uid)) return <Navigate to="/" replace />;
  // The old "Use Cases" page is now part of Software Design.
  if (section === 'use-cases') return <Navigate to={`/p/${project.id}/design?view=list`} replace />;
  const role = roleFor(members, context.user.uid);
  const readOnly = project.archived;
  const common = { context, project, members, role, readOnly };
  const { locale } = context;

  const moreActive = MOBILE_MORE.some(([path]) => path === section);

  return (
    <div className={`workspace section-${section} ${readOnly ? 'read-only' : ''}`}>
      <AppHeader context={context} />
      <aside className="sidebar">
        <div className="sidebar-project">
          <button className="close-sidebar" onClick={() => setMenuOpen(false)}>
            ×
          </button>
          <button className="project-switch" onClick={() => navigate('/')}>
            <span style={{ background: project.color }}>{project.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{project.name}</strong>
              <small>
                {role || 'member'} · {pick(locale, 'สลับโปรเจกต์', 'switch project')}
              </small>
            </div>
            <b>⌄</b>
          </button>
        </div>
        <nav>
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.en}>
              <small>{pick(locale, group.th, group.en)}</small>
              {group.items.map(([path, icon, label]) => (
                <NavLink
                  key={path}
                  to={`/p/${project.id}/${path}`}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <i>{icon}</i>
                  {context.t(label)}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="project-progress">
            <span>
              <b>{pick(locale, 'เชื่อมต่อเรียลไทม์', 'Realtime sync')}</b>
              <small>● Live</small>
            </span>
            <div className="member-dots">
              {members.slice(0, 6).map((member) => (
                <i key={member.id} title={member.displayName}>
                  {member.displayName.slice(0, 1).toUpperCase()}
                </i>
              ))}
              {members.length > 6 && <i>+{members.length - 6}</i>}
            </div>
          </div>
        </div>
      </aside>
      <main className="workspace-content">
        {readOnly && (
          <div className="archived-banner">
            <span>📦</span>
            <div>
              <strong>{context.t('readOnly')}</strong>
              <small>
                {pick(
                  locale,
                  'โปรเจกต์นี้ถูกเก็บแล้ว คุณยังดูข้อมูลทั้งหมดได้แต่แก้ไขไม่ได้',
                  'This project is archived. You can browse everything, but changes are disabled.',
                )}
              </small>
            </div>
            {role === 'owner' && (
              <button className="secondary" onClick={() => void updateProject(project.id, { archived: false })}>
                {context.t('unarchive')}
              </button>
            )}
          </div>
        )}
        <Suspense fallback={<div className="section-loader"><span className="loader" /></div>}>
          {section === 'dashboard' && <Dashboard {...common} />}
          {section === 'board' && <Board {...common} />}
          {section === 'calendar' && <Calendar {...common} />}
          {section === 'milestones' && <Milestones {...common} />}
          {section === 'gacha' && <Gacha {...common} draws={gachaDraws} />}
          {section === 'design' && <SoftwareDesign {...common} />}
          {section === 'notes' && <Notes {...common} documentId={documentId} />}
          {section === 'votes' && <Votes {...common} />}
          {section === 'team' && <Team {...common} />}
          {section === 'settings' && <Settings {...common} />}
          {!SECTIONS.has(section) && <Navigate to={`/p/${project.id}/dashboard`} replace />}
        </Suspense>
      </main>
      <nav className="mobile-bottom-nav" aria-label={pick(locale, 'เมนูโปรเจกต์', 'Project navigation')}>
        {MOBILE_PRIMARY.map(([path, icon, label]) => (
          <NavLink key={path} to={`/p/${project.id}/${path}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <i>{icon}</i>
            <span>{context.t(label)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={moreActive || menuOpen ? 'active' : ''}
          aria-expanded={menuOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <i>•••</i>
          <span>{pick(locale, 'เพิ่มเติม', 'More')}</span>
        </button>
      </nav>
      {menuOpen && (
        <div className="mobile-more-layer">
          <button className="mobile-more-scrim" onClick={() => setMenuOpen(false)} aria-label={pick(locale, 'ปิดเมนู', 'Close menu')} />
          <section className="mobile-more-sheet" id="mobile-more-menu" aria-label={pick(locale, 'เมนูเพิ่มเติม', 'More navigation')}>
            <div className="mobile-sheet-handle" />
            <header>
              <button className="project-switch" onClick={() => navigate('/')}>
                <span style={{ background: project.color }}>{project.name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <strong>{project.name}</strong>
                  <small>
                    {role || 'member'} · {pick(locale, 'สลับโปรเจกต์', 'switch project')}
                  </small>
                </div>
                <b>→</b>
              </button>
            </header>
            <div className="mobile-more-links">
              {MOBILE_MORE.map(([path, icon, label]) => (
                <NavLink
                  key={path}
                  to={`/p/${project.id}/${path}`}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <i>{icon}</i>
                  <span>{context.t(label)}</span>
                  <b>›</b>
                </NavLink>
              ))}
            </div>
            <div className="mobile-preferences">
              <button type="button" onClick={() => context.setLocale(locale === 'th' ? 'en' : 'th')}>
                <span>🌐 {pick(locale, 'ภาษา', 'Language')}</span>
                <b>{locale === 'th' ? 'English' : 'ไทย'}</b>
              </button>
              <label>
                <span>◐ {pick(locale, 'ธีม', 'Theme')}</span>
                <select
                  value={context.profile.theme}
                  onChange={(event) => context.setTheme(event.target.value as AppContextValue['profile']['theme'])}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <button type="button" className="mobile-sign-out" onClick={() => signOut(auth!)}>
                <span>↪ {context.t('signOut')}</span>
              </button>
            </div>
          </section>
        </div>
      )}
      <ProjectChat context={context} project={project} readOnly={readOnly} />
      <Suspense fallback={null}>
        <GachaReveal projectId={project.id} locale={locale} latestDraw={gachaDraws[0] ?? null} />
      </Suspense>
    </div>
  );
}
