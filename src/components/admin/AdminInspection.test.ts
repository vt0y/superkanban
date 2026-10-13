import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '@/context/AppContext';
import type { Task } from '@/types';
import { loadAdminOverview, loadAdminProjectCounts, loadAdminProjectMilestones, loadAdminProjectTasks, type AdminProject, type AdminProjectCounts } from '@/services/admin';
import { useAdminCollection } from '@/hooks/useAdminCollection';
import { loadSiteFeedbackCounts } from '@/services/feedback';
import { useSiteFeedbackPage } from '@/hooks/useSiteFeedback';
import { useAdminCounts } from '@/hooks/useAdminCounts';
import { AdminOverview } from './AdminOverview';
import { AdminProjectInspector } from './AdminProjectInspector';

// Drive async hooks without a browser, including dependency changes and cleanup.
const lifecycle = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = lifecycle.index++;
    const slots = lifecycle.slots;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void), dependencies: unknown[]) => {
    const index = lifecycle.index++;
    const previous = lifecycle.slots[index] as { dependencies: unknown[]; cleanup?: () => void } | undefined;
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      lifecycle.effects.push(() => {
        previous?.cleanup?.();
        lifecycle.slots[index] = { dependencies, cleanup: effect() };
      });
    }
  },
}));
vi.mock('@/components/common/Modal', () => ({ Modal: ({ children }: { children: ReactNode }) => createElement('div', {}, children) }));
vi.mock('@/services/admin', () => ({ ADMIN_CACHE_TTL_MS: 60_000, ADMIN_COUNT_CAP: 5000, loadAdminOverview: vi.fn(), loadAdminProjectCounts: vi.fn(), loadAdminProjectTasks: vi.fn(), loadAdminProjectMilestones: vi.fn() }));
vi.mock('@/hooks/useAdminCollection', () => ({ useAdminCollection: vi.fn() }));
vi.mock('@/services/feedback', () => ({ loadSiteFeedbackCounts: vi.fn() }));
vi.mock('@/hooks/useSiteFeedback', () => ({ useSiteFeedbackPage: vi.fn(() => ({ items: [{ id: 'f1', title: 'Broken export', body: '', category: 'bug', status: 'open', userName: 'Ann' }], loading: false, error: null })) }));
const context = { locale: 'en', user: { uid: 'staff' }, siteRole: 'admin' } as AppContextValue;
const project: AdminProject = { id: 'p1', kind: 'project', name: 'Project', ownerId: 'owner', ownerName: 'Owner', ownerEmail: 'owner@example.com', memberIds: ['owner'], archived: false, description: '', color: '' };
const count = (value: number, capped = false) => ({ value, capped });
const projectCounts: AdminProjectCounts = { open: { backlog: count(1), todo: count(5000, true), in_progress: count(0), review: count(0) }, done: count(5), milestones: count(2), loadedAt: Date.now() };
const hostile: Task & { kind: 'task' } = { kind: 'task', id: 't1', title: '<img src=x onerror=alert(1)>', description: 'x'.repeat(2500), status: 'weird' as never, priority: 'high', assigneeIds: ['a', 'b'], tags: [], checklist: [{ id: 'c1', text: 'Check it', done: true }], dueDate: '2026-10-20', milestoneId: '', order: 0, createdBy: 'owner' };
const collectionState = (overrides: object = {}) => ({ items: [hostile], hasMore: true, loading: false, loadingMore: false, error: null, refresh: vi.fn(), loadMore: vi.fn(), retry: vi.fn(), replace: vi.fn(), ...overrides });
function render(component: () => ReactNode) {
  lifecycle.index = 0;
  const tree = component();
  lifecycle.effects.splice(0).forEach((commit) => commit());
  return { tree, html: renderToStaticMarkup(tree) };
}
function buttons(node: ReactNode): { onClick?: () => void; disabled?: boolean }[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return [];
  return [...(node.type === 'button' ? [node.props] : []), ...buttons(node.props.children)];
}
const inspect = () => AdminProjectInspector({ context, project, onClose: vi.fn() });
beforeEach(() => { vi.resetAllMocks(); lifecycle.slots = []; lifecycle.index = 0; lifecycle.effects = []; });

describe('admin overview and inspection', () => {
  const feedbackCounts = { total: 27, byStatus: { open: 9, in_review: 1, resolved: 15, declined: 2 } };
  const counts = () => useAdminCounts(context);
  it('loads site-wide and feedback counts together and refreshes them explicitly', async () => {
    vi.mocked(loadAdminOverview).mockResolvedValue({ users: 84, suspendedUsers: 2, projects: 19, archivedProjects: 3, feedback: 27 });
    vi.mocked(loadSiteFeedbackCounts).mockResolvedValue(feedbackCounts);
    lifecycle.index = 0; expect(counts().loading).toBe(true); lifecycle.effects.splice(0).forEach((commit) => commit());
    await vi.waitFor(() => expect(lifecycle.slots[2]).toBe(false));
    lifecycle.index = 0; const loaded = counts();
    expect(loaded.overview?.users).toBe(84); expect(loaded.feedback?.byStatus.open).toBe(9); expect(loaded.error).toBeNull();
    loaded.refresh();
    lifecycle.index = 0; counts(); lifecycle.effects.splice(0).forEach((commit) => commit());
    expect(loadAdminOverview).toHaveBeenCalledTimes(2);
    expect(loadSiteFeedbackCounts).toHaveBeenCalledTimes(2);
  });
  it('keeps the counts that loaded and reports the source that failed', async () => {
    vi.mocked(loadAdminOverview).mockRejectedValue({ code: 'permission-denied' });
    vi.mocked(loadSiteFeedbackCounts).mockResolvedValue(feedbackCounts);
    lifecycle.index = 0; counts(); lifecycle.effects.splice(0).forEach((commit) => commit());
    await vi.waitFor(() => expect(lifecycle.slots[2]).toBe(false));
    lifecycle.index = 0; const failed = counts();
    expect(failed.overview).toBeNull(); expect(failed.feedback).toEqual(feedbackCounts); expect(failed.error).toBeTruthy();
  });
  it('renders dashboard tiles that deep-link to filtered tabs, plus open feedback', () => {
    const onNavigate = vi.fn(); const onRefresh = vi.fn();
    const props = { context, overview: { users: 84, suspendedUsers: 2, projects: 19, archivedProjects: 3, feedback: 27 }, feedback: feedbackCounts, loading: false, error: null, onRefresh, onNavigate };
    const { tree, html } = render(() => AdminOverview(props));
    expect(html).toContain('84'); expect(html).toContain('19'); expect(html).toContain('Broken export');
    expect(useSiteFeedbackPage).toHaveBeenCalledWith(context, { status: 'open', limitCount: 5 });
    const all = buttons(tree);
    all[0].onClick!(); expect(onRefresh).toHaveBeenCalled();
    all[2].onClick!(); expect(onNavigate).toHaveBeenLastCalledWith('users', 'suspended');
    all[4].onClick!(); expect(onNavigate).toHaveBeenLastCalledWith('projects', 'archived');
  });
  it('shows overview errors with retry instead of zero totals', () => {
    const onRefresh = vi.fn();
    const { tree, html } = render(() => AdminOverview({ context, overview: null, feedback: null, loading: false, error: 'Denied', onRefresh, onNavigate: vi.fn() }));
    expect(html).toContain('role="alert"'); expect(html).toContain('Retry'); expect(html).toContain('skeleton-text');
    buttons(tree)[1].onClick!(); expect(onRefresh).toHaveBeenCalled();
  });
  it('shows Firestore counts, capping large ones, without reading the summary', async () => {
    vi.mocked(loadAdminProjectCounts).mockResolvedValue(projectCounts);
    vi.mocked(useAdminCollection).mockReturnValue(collectionState() as never);
    render(inspect);
    await vi.waitFor(() => expect(lifecycle.slots[1]).toBe(false));
    const html = render(inspect).html;
    expect(loadAdminProjectCounts).toHaveBeenCalledWith('p1');
    expect(html).toContain('5006+');
    expect(html).toContain('5000+');
    expect(html).toContain('Live data from Firestore');
    expect(html).not.toContain('not verified abuse evidence');
  });
  it('renders member-written task text escaped, clipped, and with unknown enums labelled', async () => {
    vi.mocked(loadAdminProjectCounts).mockResolvedValue(projectCounts);
    vi.mocked(useAdminCollection).mockReturnValue(collectionState() as never);
    render(inspect);
    await vi.waitFor(() => expect(lifecycle.slots[1]).toBe(false));
    const html = render(inspect).html;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain(`${'x'.repeat(2000)}…`);
    expect(html).not.toContain('x'.repeat(2001));
    expect(html).toContain('unknown · High');
    expect(html).toContain('Assignees: 2');
    expect(html).toContain('☑ Check it');
  });
  it('binds the paged loader to the project, status filter and tab, and loads more on request', async () => {
    vi.mocked(loadAdminProjectCounts).mockResolvedValue(projectCounts);
    const state = collectionState();
    vi.mocked(useAdminCollection).mockReturnValue(state as never);
    vi.mocked(loadAdminProjectTasks).mockResolvedValue({ items: [hostile], nextCursor: null, hasMore: false });
    vi.mocked(loadAdminProjectMilestones).mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const { tree } = render(inspect);
    const [load, identity] = vi.mocked(useAdminCollection).mock.calls[0];
    expect(identity).toBe('staff:p1:tasks:all');
    expect((await load('cursor')).items[0]).toMatchObject({ kind: 'task', id: 't1' });
    expect(loadAdminProjectTasks).toHaveBeenCalledWith('p1', 'cursor', undefined);
    buttons(tree).at(-1)!.onClick!();
    expect(state.loadMore).toHaveBeenCalled();
    lifecycle.slots[4] = 'milestones';
    render(inspect);
    const [milestones, scope] = vi.mocked(useAdminCollection).mock.calls.at(-1)!;
    expect(scope).toBe('staff:p1:milestones:all');
    await milestones();
    expect(loadAdminProjectMilestones).toHaveBeenCalledWith('p1', undefined);
  });
  it('keeps refresh disabled until the cached inspection expires', async () => {
    vi.mocked(loadAdminProjectCounts).mockResolvedValue({ ...projectCounts, loadedAt: Date.now() });
    vi.mocked(useAdminCollection).mockReturnValue(collectionState() as never);
    render(inspect);
    await vi.waitFor(() => expect(lifecycle.slots[1]).toBe(false));
    expect(buttons(render(inspect).tree)[0].disabled).toBe(true);
    vi.mocked(loadAdminProjectCounts).mockResolvedValue({ ...projectCounts, loadedAt: Date.now() - 61_000 });
    lifecycle.slots[0] = { ...projectCounts, loadedAt: Date.now() - 61_000 };
    const refresh = buttons(render(inspect).tree)[0];
    expect(refresh.disabled).toBe(false);
    refresh.onClick!(); render(inspect);
    expect(loadAdminProjectCounts).toHaveBeenCalledTimes(2);
  });
  it('shows count errors without zero totals and list errors with retry', async () => {
    vi.mocked(loadAdminProjectCounts).mockRejectedValue({ code: 'unavailable' });
    const state = collectionState({ items: [], hasMore: false, error: 'unavailable' });
    vi.mocked(useAdminCollection).mockReturnValue(state as never);
    render(inspect);
    await vi.waitFor(() => expect(lifecycle.slots[1]).toBe(false));
    const { tree, html } = render(inspect);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('Total tasks');
    buttons(tree).find((button) => button.onClick === state.retry)!.onClick!();
    expect(state.retry).toHaveBeenCalled();
  });
  it('ignores a pending count load after losing the view', async () => {
    let resolve!: (value: AdminProjectCounts) => void;
    vi.mocked(loadAdminProjectCounts).mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.mocked(useAdminCollection).mockReturnValue(collectionState() as never);
    render(inspect);
    const effect = lifecycle.slots[7] as { cleanup: () => void };
    effect.cleanup();
    resolve(projectCounts);
    await Promise.resolve();
    expect(lifecycle.slots[0]).toBeNull();
  });
});
