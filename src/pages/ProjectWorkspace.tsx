import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { lockBodyScroll } from '@/utils/scroll-lock';
import { Link, NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { AppHeader } from '@/components/layout/AppHeader';
import { Icon, type IconName } from '@/components/common/Icon';
import { useMediaQuery } from '@/hooks/useMediaQuery';
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
const Documents = lazy(() => loadNotes().then((m) => ({ default: m.Documents })));
const Settings = lazy(() => loadSettings().then((m) => ({ default: m.Settings })));
const Team = lazy(() => loadTeam().then((m) => ({ default: m.Team })));
const Votes = lazy(() => loadVotes().then((m) => ({ default: m.Votes })));
const Gacha = lazy(() => loadGacha().then((m) => ({ default: m.Gacha })));
const GachaReveal = lazy(() => import('@/components/gacha/GachaReveal').then((m) => ({ default: m.GachaReveal })));

const NAV_GROUPS: { th: string; en: string; items: [path: string, icon: IconName, label: MessageKey][] }[] = [
  {
    th: 'งานหลัก',
    en: 'Work',
    items: [
      ['dashboard', 'dashboard', 'dashboard'],
      ['board', 'board', 'board'],
      ['calendar', 'calendar', 'calendar'],
      ['notes', 'note', 'notes'],
      ['documents', 'document', 'documents'],
    ],
  },
  { th: 'วางแผนและออกแบบ', en: 'Plan & Design', items: [['milestones', 'milestone', 'milestones'], ['design', 'design', 'design']] },
  {
    th: 'ร่วมมือ',
    en: 'Collaborate',
    items: [
      ['team', 'team', 'team'],
      ['votes', 'vote', 'votes'],
      ['gacha', 'gacha', 'gacha'],
    ],
  },
  {
    th: 'จัดการ',
    en: 'Manage',
    items: [
      ['settings', 'settings', 'settings'],
    ],
  },
];
const SECTIONS = new Set(NAV_GROUPS.flatMap((group) => group.items.map(([path]) => path)));
const MOBILE_PRIMARY: [path: string, icon: IconName, label: MessageKey][] = [
  ['dashboard', 'dashboard', 'dashboard'],
  ['board', 'board', 'board'],
  ['notes', 'note', 'notes'],
  ['documents', 'document', 'documents'],
];
const MOBILE_MORE = NAV_GROUPS.flatMap((group) => group.items).filter(
  ([path]) => !MOBILE_PRIMARY.some(([primary]) => primary === path),
);

export function ProjectWorkspace({ context }: { context: AppContextValue }) {
  const params = useParams();
  const projectId = params.projectId || '';
  // A document detail route belongs to the standalone Documents section.
  const section = params.documentId ? 'documents' : (params.section || 'dashboard');
  const documentId = params.documentId;
  const contextProject = context.projects.find((item) => item.id === projectId);
  const [fallbackProject, setFallbackProject] = useState<{ projectId: string; project: Project | null } | null>(null);
  const [membershipState, setMembershipState] = useState<{ projectId: string; members: Membership[] } | null>(null);
  const [gachaState, setGachaState] = useState<{ projectId: string; draws: GachaDraw[] } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop: persisted collapse to the icon rail. Tablet: always a rail, expandable as a drawer.
  const [collapsed, setCollapsed] = useState(() => readCollapsed());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const navigate = useNavigate();
  const location = useLocation();
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

  useEffect(() => { setMenuOpen(false); setDrawerOpen(false); }, [section]);

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
    if (!menuOpen && !drawerOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      setDrawerOpen(false);
    };
    const unlock = lockBodyScroll();
    addEventListener('keydown', close);
    return () => {
      removeEventListener('keydown', close);
      unlock();
    };
  }, [menuOpen, drawerOpen]);

  if (projectPending || project === undefined)
    return (
      <div className="full-loader">
        <span className="loader" />
      </div>
    );
  if (!project || !project.memberIds.includes(context.user.uid)) return <Navigate to="/" replace />;
  // The old "Use Cases" page is now part of Software Design.
  if (section === 'use-cases') return <Navigate to={`/p/${project.id}/design?view=list`} replace />;
  // Preserve bookmarks to the former Documents tab after splitting it from Notes.
  if (section === 'notes' && new URLSearchParams(location.search).get('tab') === 'documents') return <Navigate to={`/p/${project.id}/documents`} replace />;
  const role = roleFor(members, context.user.uid);
  const readOnly = project.archived;
  const common = { context, project, members, role, readOnly };
  const { locale } = context;

  const moreActive = MOBILE_MORE.some(([path]) => path === section);
  const rail = desktop ? collapsed : !drawerOpen;
  const toggleSidebar = () => {
    if (!desktop) return setDrawerOpen((open) => !open);
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  };
  const sectionLabel = NAV_GROUPS.flatMap((group) => group.items).find(([path]) => path === section)?.[2];
  const projectInitials = project.name.slice(0, 2).toUpperCase();
  const roleLabel = (role || 'member').replace(/^./, (letter) => letter.toUpperCase());
  const breadcrumb = (
    <nav className="crumbs" aria-label={pick(locale, 'ตำแหน่ง', 'Breadcrumb')}>
      <Link to={`/p/${project.id}/dashboard`}>
        <span className="project-mark" style={{ background: project.color }}>{projectInitials}</span>
        <span>{project.name}</span>
      </Link>
      {sectionLabel && (
        <>
          <Icon name="chevronRight" />
          <strong>{context.t(sectionLabel)}</strong>
        </>
      )}
    </nav>
  );

  return (
    <div className={`workspace section-${section} ${readOnly ? 'read-only' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <aside className={`sidebar ${rail ? 'is-rail' : ''} ${!desktop && drawerOpen ? 'drawer-open' : ''}`}>
        <div className="sidebar-project">
          <button className="project-switch" onClick={() => navigate('/')} title={rail ? `${project.name} · ${pick(locale, 'สลับโปรเจกต์', 'switch project')}` : undefined}>
            <span style={{ background: project.color }}>{projectInitials}</span>
            <div>
              <strong>{project.name}</strong>
              <small>
                {roleLabel} · {pick(locale, 'สลับโปรเจกต์', 'Switch project')}
              </small>
            </div>
            <Icon name="chevronsUpDown" />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label={pick(locale, 'เมนูโปรเจกต์', 'Project navigation')}>
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.en}>
              <small>{pick(locale, group.th, group.en)}</small>
              {group.items.map(([path, icon, label]) => (
                <NavLink
                  key={path}
                  to={`/p/${project.id}/${path}`}
                  title={rail ? context.t(label) : undefined}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <Icon name={icon} />
                  <span>{context.t(label)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="member-dots" title={members.map((member) => member.displayName).join(', ')}>
            {members.slice(0, 5).map((member) => (
              <i key={member.id}>{member.displayName.slice(0, 1).toUpperCase()}</i>
            ))}
            {members.length > 5 && <i className="more">+{members.length - 5}</i>}
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={rail ? pick(locale, 'ขยายแถบด้านข้าง', 'Expand sidebar') : pick(locale, 'ย่อแถบด้านข้าง', 'Collapse sidebar')}
            title={rail ? pick(locale, 'ขยายแถบด้านข้าง', 'Expand sidebar') : pick(locale, 'ย่อแถบด้านข้าง', 'Collapse sidebar')}
          >
            <Icon name={rail ? 'panelOpen' : 'panelClose'} />
          </button>
        </div>
      </aside>
      <button type="button" className="sidebar-scrim" tabIndex={-1} aria-label={pick(locale, 'ปิดเมนู', 'Close menu')} onClick={() => setDrawerOpen(false)} />
      <AppHeader context={context} leading={breadcrumb} />
      <main className="workspace-content">
        {readOnly && (
          <div className="archived-banner">
            <span><Icon name="archive" /></span>
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
          {section === 'notes' && <Notes {...common} />}
          {section === 'documents' && <Documents {...common} documentId={documentId} />}
          {section === 'votes' && <Votes {...common} />}
          {section === 'team' && <Team {...common} />}
          {section === 'settings' && <Settings {...common} />}
          {!SECTIONS.has(section) && <Navigate to={`/p/${project.id}/dashboard`} replace />}
        </Suspense>
      </main>
      <nav className="mobile-bottom-nav" aria-label={pick(locale, 'เมนูโปรเจกต์', 'Project navigation')}>
        {MOBILE_PRIMARY.map(([path, icon, label]) => (
          <NavLink key={path} to={`/p/${project.id}/${path}`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={icon} />
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
          <Icon name="more" />
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
                <span style={{ background: project.color }}>{projectInitials}</span>
                <div>
                  <strong>{project.name}</strong>
                  <small>
                    {roleLabel} · {pick(locale, 'สลับโปรเจกต์', 'Switch project')}
                  </small>
                </div>
                <Icon name="chevronsUpDown" />
              </button>
            </header>
            <div className="mobile-more-links">
              {MOBILE_MORE.map(([path, icon, label]) => (
                <NavLink
                  key={path}
                  to={`/p/${project.id}/${path}`}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <Icon name={icon} />
                  <span>{context.t(label)}</span>
                </NavLink>
              ))}
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

const COLLAPSE_KEY = 'ps.sidebarCollapsed';
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
  } catch {
    // storage blocked: the collapse just won't persist
  }
}
