import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '@/context/AppContext';
import type { ProjectSummary } from '@/types';
import { loadAdminOverview, loadAdminProjectSummary, type AdminProject } from '@/services/admin';
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
vi.mock('@/services/admin', () => ({ loadAdminOverview: vi.fn(), loadAdminProjectSummary: vi.fn() }));
vi.mock('@/services/feedback', () => ({ loadSiteFeedbackCounts: vi.fn() }));
vi.mock('@/hooks/useSiteFeedback', () => ({ useSiteFeedbackPage: vi.fn(() => ({ items: [{ id: 'f1', title: 'Broken export', body: '', category: 'bug', status: 'open', userName: 'Ann' }], loading: false, error: null })) }));
const context = { locale: 'en', user: { uid: 'staff' }, siteRole: 'admin' } as AppContextValue;
const project: AdminProject = { id: 'p1', kind: 'project', name: 'Project', ownerId: 'owner', ownerName: 'Owner', ownerEmail: 'owner@example.com', memberIds: ['owner'], archived: false, description: '', color: '' };
const summary: ProjectSummary = { version: 1, openCount: 501, doneTotal: 5, openByStatus: { backlog: 0, todo: 501, in_progress: 0, review: 0 }, openByMilestone: {}, doneByMilestone: {}, truncated: true, openTasks: { t1: { title: 'Inspect this task', status: 'todo', priority: 'high', dueDate: '', dueTime: '', assigneeIds: ['owner'], milestoneId: 'm1' } }, milestones: { m1: { title: 'First milestone', status: 'active', dueDate: '', dueTime: '', dependsOn: [] } } };
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
  it('shows missing summaries without attempting a rebuild', async () => {
    vi.mocked(loadAdminProjectSummary).mockResolvedValue(null);
    render(inspect);
    await vi.waitFor(() => expect(lifecycle.slots[1]).toBe(false));
    const html = render(inspect).html;
    expect(html).toContain('Summary unavailable');
    expect(html).toContain('member must update or rebuild');
    expect(loadAdminProjectSummary).toHaveBeenCalledWith('p1');
  });
  it('exposes summary details while flagging stale and truncated estimates', async () => {
    vi.mocked(loadAdminProjectSummary).mockResolvedValue(summary);
    render(inspect);
    await vi.waitFor(() => expect(lifecycle.slots[1]).toBe(false));
    const html = render(inspect).html;
    expect(html).toContain('506');
    expect(html).toContain('Inspect this task');
    expect(html).toContain('First milestone');
    expect(html).toContain('may be stale');
    expect(html).toContain('truncated');
    expect(html).toContain('not verified abuse evidence');
  });
  it('permits retrying inspection errors without displaying stale content', async () => {
    vi.mocked(loadAdminProjectSummary).mockRejectedValue({ code: 'unavailable' });
    render(inspect);
    await vi.waitFor(() => expect(lifecycle.slots[1]).toBe(false));
    const failed = render(inspect);
    expect(failed.html).toContain('role="alert"');
    vi.mocked(loadAdminProjectSummary).mockResolvedValue(summary);
    buttons(failed.tree)[0].onClick!(); render(inspect);
    await vi.waitFor(() => expect(lifecycle.slots[1]).toBe(false));
    expect(render(inspect).html).toContain('Inspect this task');
  });
  it('ignores a pending inspection after losing the view', async () => {
    let resolve!: (value: ProjectSummary) => void;
    vi.mocked(loadAdminProjectSummary).mockReturnValue(new Promise((done) => { resolve = done; }));
    render(inspect);
    const effect = lifecycle.slots[4] as { cleanup: () => void };
    effect.cleanup();
    resolve(summary);
    await Promise.resolve();
    expect(lifecycle.slots[0]).toBeNull();
  });
});
