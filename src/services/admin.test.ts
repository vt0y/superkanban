import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocs, updateDoc } from 'firebase/firestore';
import { loadAdminProjects, loadAdminUsers, setAdminAccountStatus, setAdminProjectArchived } from './admin';

vi.mock('./helpers', () => ({ database: () => ({}), withId: (snapshot: { id: string; data: () => object }) => ({ ...snapshot.data(), id: snapshot.id }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ path }), doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  documentId: () => '__name__', orderBy: (field: string) => ({ order: field }), limit: (value: number) => ({ limit: value }),
  startAfter: (value: string) => ({ after: value }), where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
  query: (source: unknown, ...constraints: unknown[]) => ({ source, constraints }), getDocs: vi.fn(), updateDoc: vi.fn(), serverTimestamp: () => 'server-time',
}));
const snapshot = (entries: [string, object][]) => ({ docs: entries.map(([id, data]) => ({ id, data: () => data })) }) as unknown as Awaited<ReturnType<typeof getDocs>>;
beforeEach(() => vi.clearAllMocks());
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
    await setAdminProjectArchived('p1', true);
    expect(updateDoc).toHaveBeenLastCalledWith({ path: 'projects', id: 'p1' }, { archived: true, updatedAt: 'server-time' });
  });
});
