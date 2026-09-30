import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  syncDriveFileMembers: vi.fn(),
  removeDrivePermissions: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  deleteDoc: vi.fn(),
  doc: vi.fn((...parts: unknown[]) => parts.join('/')),
  getDocs: mocks.getDocs,
  onSnapshot: vi.fn(),
  query: vi.fn((path: string, ...constraints: unknown[]) => ({ path, constraints })),
  serverTimestamp: vi.fn(() => 'server-time'),
  updateDoc: mocks.updateDoc,
  where: vi.fn((...args: unknown[]) => args),
  writeBatch: vi.fn(),
}));

vi.mock('./helpers', () => ({ database: vi.fn(() => 'database'), activityData: vi.fn(), withId: vi.fn(), BATCH_CHUNK: 450 }));
vi.mock('./work-items', () => ({ bulkDeleteWorkItems: vi.fn() }));
vi.mock('./google-drive', () => ({
  syncDriveFileMembers: mocks.syncDriveFileMembers,
  removeDrivePermissions: mocks.removeDrivePermissions,
}));

import { syncProjectDrivePermissions } from './drive-attachments';

const snapshot = (id: string, data: Record<string, unknown>) => ({ id, ref: `ref:${id}`, data: () => data });

describe('project Drive permission sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDoc.mockResolvedValue(undefined);
    mocks.removeDrivePermissions.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('covers owned document and task references while skipping link mode and non-Drive documents', async () => {
    mocks.getDocs
      .mockResolvedValueOnce({ docs: [
        snapshot('doc-1', { kind: 'drive', driveFileId: 'file-1', shareMode: 'members', managedPermissionIds: {} }),
        snapshot('markdown', { kind: 'markdown', createdBy: 'user-1' }),
      ] })
      .mockResolvedValueOnce({ docs: [
        snapshot('task-link', { driveFileId: 'file-link', shareMode: 'link' }),
        snapshot('task-member', { driveFileId: 'file-2', shareMode: 'members' }),
      ] });
    mocks.syncDriveFileMembers
      .mockResolvedValueOnce({ state: 'updated', sharedMemberIds: ['user-1', 'member'], managedPermissionIds: { member: 'permission-1' }, createdPermissionIds: ['permission-1'] })
      .mockResolvedValueOnce({ state: 'skipped', sharedMemberIds: ['user-1', 'member'], managedPermissionIds: {}, createdPermissionIds: [] });

    const result = await syncProjectDrivePermissions('project-1', { uid: 'user-1' } as never, [{ userId: 'user-1' }, { userId: 'member' }] as never);

    expect(result).toEqual({ total: 3, updated: 1, skipped: 2, failed: 0 });
    expect(mocks.syncDriveFileMembers).toHaveBeenCalledTimes(2);
    expect(mocks.updateDoc).toHaveBeenCalledWith('ref:doc-1', expect.objectContaining({ managedPermissionIds: { member: 'permission-1' } }));
  });

  it('rolls back newly created permissions when metadata persistence fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.getDocs
      .mockResolvedValueOnce({ docs: [snapshot('doc-1', { kind: 'drive', driveFileId: 'file-1', shareMode: 'members' })] })
      .mockResolvedValueOnce({ docs: [] });
    mocks.syncDriveFileMembers.mockResolvedValueOnce({ state: 'updated', sharedMemberIds: ['user-1'], managedPermissionIds: {}, createdPermissionIds: ['new-permission'] });
    mocks.updateDoc.mockRejectedValueOnce(new Error('firestore failed'));

    const result = await syncProjectDrivePermissions('project-1', { uid: 'user-1' } as never, [{ userId: 'user-1' }] as never);

    expect(result.failed).toBe(1);
    expect(mocks.removeDrivePermissions).toHaveBeenCalledWith(expect.anything(), 'file-1', ['new-permission']);
    expect(consoleError).toHaveBeenCalled();
  });
});
