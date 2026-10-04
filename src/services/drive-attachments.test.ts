import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batch: { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(() => Promise.resolve()) },
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  syncDriveFileMembers: vi.fn(),
  removeDrivePermissions: vi.fn(),
  updateManagedPermissionRoles: vi.fn(),
  bulkDeleteWorkItems: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  arrayRemove: vi.fn((...values: unknown[]) => ({ arrayRemove: values })),
  arrayUnion: vi.fn(),
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  deleteDoc: vi.fn(),
  doc: vi.fn((...parts: unknown[]) => parts.join('/')),
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  onSnapshot: vi.fn(),
  query: vi.fn((path: string, ...constraints: unknown[]) => ({ path, constraints })),
  serverTimestamp: vi.fn(() => 'server-time'),
  updateDoc: mocks.updateDoc,
  where: vi.fn((...args: unknown[]) => args),
  writeBatch: vi.fn(() => mocks.batch),
}));

vi.mock('./helpers', () => ({ database: vi.fn(() => 'database'), activityData: vi.fn(), withId: vi.fn(), BATCH_CHUNK: 450 }));
vi.mock('./work-items', () => ({ bulkDeleteWorkItems: mocks.bulkDeleteWorkItems }));
vi.mock('./google-drive', async (importOriginal) => ({
  allowedDriveRoles: (await importOriginal<typeof import('./google-drive')>()).allowedDriveRoles,
  isDriveFolder: (await importOriginal<typeof import('./google-drive')>()).isDriveFolder,
  syncDriveFileMembers: mocks.syncDriveFileMembers,
  removeDrivePermissions: mocks.removeDrivePermissions,
  updateManagedPermissionRoles: mocks.updateManagedPermissionRoles,
}));

import { attachDriveProjectDocument, deleteMilestoneAndUnlinkDocuments, syncProjectDrivePermissions, updateDriveProjectDocumentRole } from './drive-attachments';

const snapshot = (id: string, data: Record<string, unknown>) => ({ id, ref: `ref:${id}`, data: () => data });

describe('project Drive permission sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDoc.mockResolvedValue(undefined);
    mocks.removeDrivePermissions.mockResolvedValue(undefined);
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    mocks.batch.commit.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('syncs only Drive documents from the unified library', async () => {
    mocks.getDocs
      .mockResolvedValueOnce({ docs: [
        snapshot('doc-1', { kind: 'drive', driveFileId: 'file-1', shareMode: 'members', managedPermissionIds: {} }),
        snapshot('markdown', { kind: 'markdown', createdBy: 'user-1' }),
      ] });
    mocks.syncDriveFileMembers
      .mockResolvedValueOnce({ state: 'updated', sharedMemberIds: ['user-1', 'member'], managedPermissionIds: { member: 'permission-1' }, createdPermissionIds: ['permission-1'] });

    const result = await syncProjectDrivePermissions('project-1', { uid: 'user-1' } as never, [{ userId: 'user-1' }, { userId: 'member' }] as never);

    expect(result).toEqual({ total: 1, updated: 1, skipped: 0, failed: 0 });
    expect(mocks.syncDriveFileMembers).toHaveBeenCalledTimes(1);
    expect(mocks.updateDoc).toHaveBeenCalledWith('ref:doc-1', expect.objectContaining({ managedPermissionIds: { member: 'permission-1' } }));
  });

  it('always stores Drive folders as unmanaged without permission metadata', async () => {
    await attachDriveProjectDocument('project-1', { driveFileId: 'folder-1', name: 'Research', mimeType: 'application/vnd.google-apps.folder', resourceKey: 'key_1' }, 'members', { sharedMemberIds: ['member'], managedPermissionIds: { member: 'permission' }, role: 'writer' }, { uid: 'user-1' } as never);
    expect(mocks.batch.set).toHaveBeenCalledWith('database/projects/project-1/documents/drive_folder-1', expect.objectContaining({ shareMode: 'unmanaged', sharedMemberIds: [], resourceKey: 'key_1' }));
    expect(mocks.batch.set.mock.calls[0]?.[1]).not.toHaveProperty('managedPermissionIds');
  });

  it('unlinks documents before deleting a milestone', async () => {
    mocks.getDocs.mockResolvedValueOnce({ docs: [snapshot('doc-1', {}), snapshot('doc-2', {})] });
    await deleteMilestoneAndUnlinkDocuments('project-1', 'milestone-1');
    expect(mocks.batch.update).toHaveBeenCalledTimes(2);
    expect(mocks.batch.update).toHaveBeenCalledWith('ref:doc-1', { milestoneIds: { arrayRemove: ['milestone-1'] }, updatedAt: 'server-time' });
    expect(mocks.bulkDeleteWorkItems).toHaveBeenCalledWith('project-1', 'milestones', ['milestone-1']);
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

  it('syncs each document with its stored role and skips unmanaged links', async () => {
    mocks.getDocs.mockResolvedValueOnce({ docs: [
      snapshot('doc-1', { kind: 'drive', driveFileId: 'file-1', shareMode: 'members', role: 'writer', managedPermissionIds: {} }),
      snapshot('doc-2', { kind: 'drive', driveFileId: 'file-2', shareMode: 'unmanaged' }),
    ] });
    mocks.syncDriveFileMembers.mockResolvedValueOnce({ state: 'updated', sharedMemberIds: ['user-1'], managedPermissionIds: {}, createdPermissionIds: [] });

    const result = await syncProjectDrivePermissions('project-1', { uid: 'user-1' } as never, [{ userId: 'user-1' }] as never);

    expect(result).toEqual({ total: 2, updated: 1, skipped: 1, failed: 0 });
    expect(mocks.syncDriveFileMembers).toHaveBeenCalledWith(expect.anything(), 'file-1', expect.anything(), {}, 'writer');
  });

  const driveItem = (patch: Record<string, unknown>) => ({
    id: 'drive_file-1', kind: 'drive', title: 'Spec', driveFileId: 'file-1', name: 'Spec', mimeType: 'application/vnd.google-apps.document',
    shareMode: 'members', sharedMemberIds: [], managedPermissionIds: { member: 'perm-1' }, createdBy: 'user-1', ...patch,
  }) as never;

  it('changes managed Drive roles before recording the new role', async () => {
    mocks.updateManagedPermissionRoles.mockResolvedValue(undefined);
    await updateDriveProjectDocumentRole('project-1', driveItem({}), 'commenter', { uid: 'user-1' } as never);
    expect(mocks.updateManagedPermissionRoles).toHaveBeenCalledWith(expect.anything(), 'file-1', ['perm-1'], 'commenter');
    expect(mocks.updateDoc).toHaveBeenCalledWith(expect.anything(), { role: 'commenter', updatedAt: 'server-time' });
  });

  it('reverts Drive roles when the Firestore write fails', async () => {
    mocks.updateManagedPermissionRoles.mockResolvedValue(undefined);
    mocks.updateDoc.mockRejectedValueOnce(new Error('firestore failed'));
    await expect(updateDriveProjectDocumentRole('project-1', driveItem({ role: 'reader' }), 'writer', { uid: 'user-1' } as never)).rejects.toThrow('firestore failed');
    expect(mocks.updateManagedPermissionRoles).toHaveBeenLastCalledWith(expect.anything(), 'file-1', ['perm-1'], 'reader');
  });

  it('rejects role changes that are unsafe or not app-managed', async () => {
    await expect(updateDriveProjectDocumentRole('project-1', driveItem({ shareMode: 'link' }), 'writer', { uid: 'user-1' } as never)).rejects.toThrow('DRIVE_ROLE_NOT_ALLOWED');
    await expect(updateDriveProjectDocumentRole('project-1', driveItem({ shareMode: 'link' }), 'commenter', { uid: 'user-1' } as never)).rejects.toThrow('DRIVE_ROLE_UNMANAGED_LINK');
    await expect(updateDriveProjectDocumentRole('project-1', driveItem({ shareMode: 'unmanaged' }), 'reader', { uid: 'user-1' } as never)).rejects.toThrow('DRIVE_ROLE_UNMANAGED');
    await expect(updateDriveProjectDocumentRole('project-1', driveItem({ mimeType: 'application/pdf' }), 'writer', { uid: 'user-1' } as never)).rejects.toThrow('DRIVE_ROLE_NOT_ALLOWED');
    expect(mocks.updateManagedPermissionRoles).not.toHaveBeenCalled();
  });
});
