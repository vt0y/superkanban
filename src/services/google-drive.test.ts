import { afterEach, describe, expect, it, vi } from 'vitest';
import { driveDocumentId, taskAttachmentId } from './drive-attachments';
import {
  DEFAULT_DRIVE_SHARE_MODE,
  DRIVE_ROOT_FOLDER_NAME,
  clearDriveAccessToken,
  driveFolderUrl,
  driveOpenUrl,
  getOrCreateProjectDriveFolder,
  LOCAL_DRIVE_FILE_MAX_BYTES,
  projectDriveFolderStorageKey,
  shareDriveFile,
  syncDriveFileMembers,
  uploadFileToDrive,
  validateLocalDriveFile,
} from './google-drive';

vi.mock('firebase/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/auth')>();
  class GoogleAuthProvider {
    static credentialFromResult() { return { accessToken: 'test-token' }; }
    addScope() {}
    setCustomParameters() {}
  }
  return { ...actual, GoogleAuthProvider, reauthenticateWithPopup: vi.fn().mockResolvedValue({}) };
});

afterEach(() => {
  clearDriveAccessToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Google Drive attachment helpers', () => {
  it('accepts the 25 MB boundary and rejects larger local uploads', () => {
    expect(() => validateLocalDriveFile({ size: LOCAL_DRIVE_FILE_MAX_BYTES })).not.toThrow();
    expect(() => validateLocalDriveFile({ size: LOCAL_DRIVE_FILE_MAX_BYTES + 1 })).toThrow('DRIVE_FILE_TOO_LARGE');
  });

  it('constructs universal Drive links without trusting stored URLs', () => {
    expect(driveOpenUrl('abc 123')).toBe('https://drive.google.com/open?id=abc%20123');
    expect(driveFolderUrl('folder/123')).toBe('https://drive.google.com/drive/folders/folder%2F123');
  });

  it('uses a stable, collision-safe user/project cache key', () => {
    expect(projectDriveFolderStorageKey('user@example.com', 'project/1')).toBe('ps.drive.project-folder.%5B%22user%40example.com%22%2C%22project%2F1%22%5D');
    expect(projectDriveFolderStorageKey('user@example.com', 'project/1')).toBe(projectDriveFolderStorageKey('user@example.com', 'project/1'));
    expect(projectDriveFolderStorageKey('user.a', 'b.c')).not.toBe(projectDriveFolderStorageKey('user.a.b', 'c'));
  });

  it('uses deterministic per-target reference IDs', () => {
    expect(driveDocumentId('file-1')).toBe('drive_file-1');
    expect(taskAttachmentId('task-1', 'file-1')).toBe('task-1_file-1');
  });

  it('defaults new attachment batches to project-member sharing', () => {
    expect(DEFAULT_DRIVE_SHARE_MODE).toBe('members');
  });

  it('uses SuperKanban as the upload root folder', () => {
    expect(DRIVE_ROOT_FOLDER_NAME).toBe('SuperKanban');
  });

  it('reuses and renames the existing marker-backed root instead of creating another root', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    const responses = [
      { files: [{ id: 'root-1', name: 'ProjectSpace' }] },
      { id: 'root-1' },
      { files: [{ id: 'project-folder-1', name: 'Roadmap' }] },
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getOrCreateProjectDriveFolder({ uid: 'user-1' } as never, { id: 'project-1', name: 'Roadmap' })).resolves.toBe('project-folder-1');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ name: 'SuperKanban' }) });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(stored.get(projectDriveFolderStorageKey('user-1', 'project-1'))).toBe('project-folder-1');
  });

  it('uploads local files into the project folder and refreshes its cached ID', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'stale-folder'), setItem });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'root-1', name: 'SuperKanban' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'folder-2', name: 'Roadmap' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } }));
    vi.stubGlobal('fetch', fetchMock);
    const opened: string[] = [];
    class FakeXMLHttpRequest {
      status = 200;
      responseText = JSON.stringify({ id: 'file-1', name: 'plan.txt', mimeType: 'text/plain', size: '4' });
      upload: { onprogress?: (event: ProgressEvent) => void } = {};
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      open(_method: string, url: string) { opened.push(url); }
      setRequestHeader() {}
      send() { this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);

    const result = await uploadFileToDrive({ uid: 'user-2' } as never, { id: 'project-2', name: 'Roadmap' }, new File(['plan'], 'plan.txt', { type: 'text/plain' }));

    expect(result.driveFileId).toBe('file-1');
    expect(opened).toEqual(['https://upload.example/session']);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({ parents: ['folder-2'] });
    expect(setItem).toHaveBeenLastCalledWith(projectDriveFolderStorageKey('user-2', 'project-2'), 'folder-2');
  });

  it('records only the member permission IDs created by the app', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: [{ id: 'manual-1', type: 'user', emailAddress: 'member1@example.com', role: 'reader' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'managed-2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const members = [
      { userId: 'owner', email: 'owner@example.com' },
      { userId: 'member-1', email: 'member1@example.com' },
      { userId: 'member-2', email: 'member2@example.com' },
    ] as never;

    const result = await shareDriveFile({ uid: 'owner' } as never, 'file-1', 'members', members);

    expect(result).toEqual({ sharedMemberIds: ['owner', 'member-1', 'member-2'], managedPermissionIds: { 'member-2': 'managed-2' } });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ role: 'reader', type: 'user', emailAddress: 'member2@example.com' });
  });

  it('syncs current members while preserving permissions the app did not create', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ownedByMe: true, capabilities: { canShare: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: [
        { id: 'managed-old', type: 'user', emailAddress: 'former@example.com', role: 'reader' },
        { id: 'manual', type: 'user', emailAddress: 'manual@example.com', role: 'writer' },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'managed-new' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const members = [
      { userId: 'owner', email: 'owner@example.com' },
      { userId: 'new-member', email: 'new@example.com' },
    ] as never;

    const result = await syncDriveFileMembers({ uid: 'owner' } as never, 'file-1', members, { former: 'managed-old' });

    expect(result).toMatchObject({ state: 'updated', sharedMemberIds: ['owner', 'new-member'], managedPermissionIds: { 'new-member': 'managed-new' } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('managed-old');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/permissions/manual'))).toBe(false);
  });

  it('skips files not owned by the signed-in Drive user', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ownedByMe: false, capabilities: { canShare: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncDriveFileMembers({ uid: 'owner' } as never, 'file-1', [] as never, { member: 'permission-1' })).resolves.toMatchObject({ state: 'skipped' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
