import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc, getDocs, getCountFromServer, runTransaction, updateDoc } from 'firebase/firestore';
import { ADMIN_CACHE_TTL_MS, clearAdminInspectionCache, loadAdminOverview, loadAdminProjectCounts, loadAdminProjectMilestones, loadAdminProjectTasks, loadAdminProjects, loadAdminUsers, setAdminAccountStatus, setAdminProjectArchived, setAdminStaffRole } from './admin';

vi.mock('@/config/firebase', () => ({ auth: { currentUser: { uid: 'staff' } } }));
vi.mock('./helpers', () => ({ database: () => ({}), withId: (snapshot: { id: string; data: () => object }) => ({ ...snapshot.data(), id: snapshot.id }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }), doc: (_db: unknown, ...segments: string[]) => ({ path: segments.slice(0, -1).join('/'), id: segments.at(-1) }),
  documentId: () => '__name__', orderBy: (field: string) => ({ order: field }), limit: (value: number) => ({ limit: value }),
  startAfter: (value: string) => ({ after: value }), where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }), getDocs: vi.fn(), getDoc: vi.fn(), getCountFromServer: vi.fn(), runTransaction: vi.fn(), updateDoc: vi.fn(), serverTimestamp: () => 'server-time',
}));
const snapshot = (entries: [string, object][]) => ({ docs: entries.map(([id, data]) => ({ id, data: () => data })) }) as unknown as Awaited<ReturnType<typeof getDocs>>;
beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); clearAdminInspectionCache(); });
describe('admin management services', () => {
  it('loads 50 users with a lookahead and cursor, keeps legacy users, and uses trusted role documents', async () => {
    const entries = Array.from({ length: 51 }, (_, index) => [`u${index.toString().padStart(2, '0')}`, { email: `${index}@example.com`, displayName: 'User', siteRole: 'owner', id: 'spoof' }] as [string, object]);
    vi.mocked(getDocs).mockResolvedValueOnce(snapshot(entries)).mockResolvedValueOnce(snapshot([['u01', { role: 'admin' }], ['u02', { role: 'member' }]]));
    const page = await loadAdminUsers('older');
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('u49');
    expect(page.items[0]).toMatchObject({ id: 'u00', kind: 'user', siteRole: null });
    expect(page.items[0].accountStatus).toBeUndefined();
    expect(page.items[1].siteRole).toBe('admin');
    expect(page.items[2].siteRole).toBeNull();
    expect(getDocs).toHaveBeenCalledWith({ source: { path: 'users' }, constraints: [{ order: '__name__' }, { after: 'older' }, { limit: 51 }] });
  });
  it('loads project metadata and owners, falling back to owner UID when the profile is missing', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(snapshot([['p1', { ownerId: 'owner', id: 'spoof', name: 'Project' }], ['p2', { ownerId: 'missing' }]]))
      .mockResolvedValueOnce(snapshot([['owner', { displayName: 'Owner', email: 'owner@example.com' }]]));
    const page = await loadAdminProjects();
    expect(page.items[0]).toMatchObject({ id: 'p1', kind: 'project', ownerName: 'Owner', ownerEmail: 'owner@example.com' });
    expect(page.items[1]).toMatchObject({ ownerName: 'missing', ownerEmail: '' });
    expect(page.hasMore).toBe(false);
    expect(getDocs).toHaveBeenCalledTimes(2);
  });
  it('does not query owners for an empty project page', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce(snapshot([]));
    expect(await loadAdminProjects()).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(getDocs).toHaveBeenCalledOnce();
  });
  it('changes only approved fields, with audit metadata, and rejects self changes', async () => {
    await setAdminAccountStatus('member', 'suspended', 'admin');
    expect(updateDoc).toHaveBeenCalledWith({ path: 'users', id: 'member' }, { accountStatus: 'suspended', statusUpdatedBy: 'admin', statusUpdatedAt: 'server-time' });
    await expect(setAdminAccountStatus('admin', 'suspended', 'admin')).rejects.toThrow('CANNOT_MODIFY_SELF');
    await setAdminProjectArchived('p1', true, 'admin', '  Abuse review  ');
    expect(updateDoc).toHaveBeenLastCalledWith({ path: 'projects', id: 'p1' }, { archived: true, moderationArchived: true, moderationReason: 'Abuse review', moderationUpdatedBy: 'admin', moderationUpdatedAt: 'server-time', updatedAt: 'server-time' });
  });
  it('requires a meaningful bounded archive reason and clears the lock on restore', async () => {
    await expect(setAdminProjectArchived('p1', true, 'admin', ' \n ')).rejects.toThrow('MODERATION_REASON_REQUIRED');
    await expect(setAdminProjectArchived('p1', true, 'admin', 'x'.repeat(1001))).rejects.toThrow();
    expect(updateDoc).not.toHaveBeenCalled();
    await setAdminProjectArchived('p1', false, 'admin');
    expect(updateDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ archived: false, moderationArchived: false, moderationReason: '' }));
  });
  it('loads site-wide aggregates and propagates failed requests', async () => {
    vi.mocked(getCountFromServer).mockImplementation(async () => ({ data: () => ({ count: 7 }) }) as never);
    expect(await loadAdminOverview()).toEqual({ users: 7, suspendedUsers: 7, projects: 7, archivedProjects: 7, feedback: 7 });
    expect(getCountFromServer).toHaveBeenCalledWith({ source: { path: 'users' }, constraints: [{ field: 'accountStatus', operator: '==', value: 'suspended' }] });
    vi.mocked(getCountFromServer).mockRejectedValue(new Error('Denied'));
    await expect(loadAdminOverview()).rejects.toThrow('Denied');
  });
  it('counts real work items with capped aggregations and never reads the summary', async () => {
    vi.mocked(getCountFromServer).mockImplementation(async (source) => {
      const status = (source as unknown as { constraints: { value?: string }[] }).constraints.find((item) => 'value' in item)?.value;
      return { data: () => ({ count: status === 'todo' ? 5001 : status === 'done' ? 12 : 3 }) } as never;
    });
    const counts = await loadAdminProjectCounts('p1');
    expect(getCountFromServer).toHaveBeenCalledTimes(6);
    for (const [call] of vi.mocked(getCountFromServer).mock.calls) expect((call as unknown as { constraints: unknown[] }).constraints).toContainEqual({ limit: 5001 });
    expect(getCountFromServer).toHaveBeenCalledWith({ source: { path: 'projects/p1/tasks' }, constraints: [{ field: 'status', operator: '==', value: 'todo' }, { limit: 5001 }] });
    expect(getCountFromServer).toHaveBeenCalledWith({ source: { path: 'projects/p1/milestones' }, constraints: [{ limit: 5001 }] });
    expect(counts.open.todo).toEqual({ value: 5000, capped: true });
    expect(counts.open.backlog).toEqual({ value: 3, capped: false });
    expect(counts.done).toEqual({ value: 12, capped: false });
    expect(counts.milestones).toEqual({ value: 3, capped: false });
    expect(getDoc).not.toHaveBeenCalled();
    expect(getDocs).not.toHaveBeenCalled();
  });
  it('reuses inspections within the TTL, reloads after it, and drops failures', async () => {
    vi.useFakeTimers();
    vi.mocked(getCountFromServer).mockResolvedValue({ data: () => ({ count: 1 }) } as never);
    await loadAdminProjectCounts('p1'); await loadAdminProjectCounts('p1');
    expect(getCountFromServer).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(ADMIN_CACHE_TTL_MS);
    await loadAdminProjectCounts('p1');
    expect(getCountFromServer).toHaveBeenCalledTimes(12);
    vi.mocked(getDocs).mockRejectedValueOnce(new Error('Denied')).mockResolvedValueOnce(snapshot([]));
    await expect(loadAdminProjectMilestones('p1')).rejects.toThrow('Denied');
    await expect(loadAdminProjectMilestones('p1')).resolves.toMatchObject({ items: [] });
    expect(getDocs).toHaveBeenCalledTimes(2);
  });
  it('pages tasks and milestones 50 at a time with cursor and status filter', async () => {
    const entries = Array.from({ length: 51 }, (_, index) => [`t${index.toString().padStart(2, '0')}`, { title: 'Task' }] as [string, object]);
    vi.mocked(getDocs).mockResolvedValueOnce(snapshot(entries)).mockResolvedValueOnce(snapshot([['m1', { title: 'M' }]]));
    const page = await loadAdminProjectTasks('p1', 'after', 'review');
    expect(page).toMatchObject({ hasMore: true, nextCursor: 't49' });
    expect(page.items).toHaveLength(50);
    expect(getDocs).toHaveBeenCalledWith({ source: { path: 'projects/p1/tasks' }, constraints: [{ field: 'status', operator: '==', value: 'review' }, { order: '__name__' }, { after: 'after' }, { limit: 51 }] });
    expect(await loadAdminProjectMilestones('p1')).toMatchObject({ items: [{ id: 'm1' }], hasMore: false });
    expect(getDocs).toHaveBeenLastCalledWith({ source: { path: 'projects/p1/milestones' }, constraints: [{ order: '__name__' }, { limit: 51 }] });
  });
  it('protects staff targets and grants/revokes admin roles in a transaction', async () => {
    const read = vi.fn(); const set = vi.fn(); const remove = vi.fn(); const update = vi.fn();
    vi.mocked(runTransaction).mockImplementation(async (_store, action) => action({ get: read, set, delete: remove, update } as never));
    const snapshot = (data?: object) => ({ exists: () => !!data, data: () => data });
    await expect(setAdminStaffRole('admin', true, 'admin')).rejects.toThrow('CANNOT_MODIFY_SELF');
    read.mockResolvedValueOnce(snapshot({ role: 'owner' })).mockResolvedValueOnce(snapshot({}));
    await expect(setAdminStaffRole('owner', false, 'admin')).rejects.toThrow('PROTECTED_ROLE');
    read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({ accountStatus: 'suspended' }));
    await expect(setAdminStaffRole('member', true, 'admin')).rejects.toThrow('USER_SUSPENDED');
    expect(set).not.toHaveBeenCalled();
    read.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({}));
    await setAdminStaffRole('member', true, 'owner');
    expect(set).toHaveBeenCalledWith({ path: 'siteAdmins', id: 'member' }, { role: 'admin', grantedBy: 'owner', grantedAt: 'server-time' });
    read.mockResolvedValueOnce(snapshot({ role: 'admin' })).mockResolvedValueOnce(snapshot({}));
    await setAdminStaffRole('member', false, 'owner');
    expect(remove).toHaveBeenCalledWith({ path: 'siteAdmins', id: 'member' });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({ path: 'users', id: 'member' }, { staffUpdatedBy: 'owner', staffUpdatedAt: 'server-time' });
  });
});
