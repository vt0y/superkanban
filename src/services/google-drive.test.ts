import { afterEach, describe, expect, it, vi } from 'vitest';
import { driveDocumentId } from './drive-attachments';
import {
  DEFAULT_DRIVE_SHARE_MODE,
  DRIVE_ROOT_FOLDER_NAME,
  allowedDriveRoles,
  clearDriveAccessToken,
  createGoogleWorkspaceFile,
  driveFolderUrl,
  driveOpenUrl,
  effectiveDriveRole,
  getDriveFile,
  getOrCreateProjectDriveFolder,
  LOCAL_DRIVE_FILE_MAX_BYTES,
  parseGoogleFileLink,
  parseGoogleFolderLink,
  pickDriveFileById,
  pickDriveFiles,
  projectDriveFolderStorageKey,
  shareDriveFile,
  syncDriveFileMembers,
  updateManagedPermissionRoles,
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
  });

  it('defaults new attachment batches to project-member sharing', () => {
    expect(DEFAULT_DRIVE_SHARE_MODE).toBe('members');
  });

  it('uses SuperKanban as the upload root folder', () => {
    expect(DRIVE_ROOT_FOLDER_NAME).toBe('SuperKanban');
  });

  it('pins Picker to the app origin and keeps it alive through the selected-file callback', async () => {
    let callback: ((data: Record<string, unknown>) => void) | undefined;
    const setOrigin = vi.fn();
    const setVisible = vi.fn();
    class DocsView {
      setIncludeFolders() { return this; }
      setSelectFolderEnabled() { return this; }
    }
    class PickerBuilder {
      setAppId() { return this; }
      setDeveloperKey() { return this; }
      setOAuthToken() { return this; }
      setOrigin(origin: string) { setOrigin(origin); return this; }
      addView() { return this; }
      enableFeature() { return this; }
      setCallback(next: (data: Record<string, unknown>) => void) { callback = next; return this; }
      build() { return { setVisible }; }
    }
    vi.stubGlobal('window', {
      location: { origin: 'https://app.example.com' },
      google: { picker: {
        DocsView,
        PickerBuilder,
        Feature: { MULTISELECT_ENABLED: 'multi' },
        Action: { CANCEL: 'cancel', ERROR: 'error', PICKED: 'picked' },
        Response: { ERROR: 'error' },
      } },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'file-1', name: 'plan.pdf', mimeType: 'application/pdf', size: '42' }), { status: 200 })));

    const selected = pickDriveFiles({ uid: 'user-1' } as never);
    await vi.waitFor(() => expect(setOrigin).toHaveBeenCalledWith('https://app.example.com'));
    expect(setVisible).toHaveBeenCalledWith(true);
    callback?.({ action: 'picked', docs: [{ id: 'file-1' }] });

    await expect(selected).resolves.toEqual([{ driveFileId: 'file-1', name: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 42 }]);
    expect(setVisible).toHaveBeenLastCalledWith(false);
  });

  it('focuses Picker on one pasted file and reads its name after exact-ID confirmation', async () => {
    let callback: ((data: Record<string, unknown>) => void) | undefined;
    const setFileIds = vi.fn();
    const setVisible = vi.fn();
    class DocsView {
      setIncludeFolders() { return this; }
      setSelectFolderEnabled() { return this; }
      setFileIds(fileId: string) { setFileIds(fileId); return this; }
    }
    class PickerBuilder {
      setAppId() { return this; }
      setDeveloperKey() { return this; }
      setOAuthToken() { return this; }
      setOrigin() { return this; }
      addView() { return this; }
      setCallback(next: (data: Record<string, unknown>) => void) { callback = next; return this; }
      build() { return { setVisible }; }
    }
    vi.stubGlobal('window', {
      location: { origin: 'https://app.example.com' },
      google: { picker: {
        DocsView,
        PickerBuilder,
        Action: { CANCEL: 'cancel', ERROR: 'error', PICKED: 'picked' },
        Response: { ERROR: 'error' },
      } },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '1AbCdEfGhIjK', name: 'Public roadmap', mimeType: 'application/vnd.google-apps.document' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const selected = pickDriveFileById({ uid: 'user-1' } as never, '1AbCdEfGhIjK', '0-safe_Key');
    await vi.waitFor(() => expect(setFileIds).toHaveBeenCalledWith('1AbCdEfGhIjK'));
    callback?.({ action: 'picked', docs: [{ id: '1AbCdEfGhIjK' }] });

    await expect(selected).resolves.toEqual({ driveFileId: '1AbCdEfGhIjK', name: 'Public roadmap', mimeType: 'application/vnd.google-apps.document' });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-Goog-Drive-Resource-Keys')).toBe('1AbCdEfGhIjK/0-safe_Key');
    expect(setVisible).toHaveBeenLastCalledWith(false);
  });

  it('rejects a different file returned by focused Picker and treats cancellation as no selection', async () => {
    const callbacks: Array<(data: Record<string, unknown>) => void> = [];
    class DocsView {
      setIncludeFolders() { return this; }
      setSelectFolderEnabled() { return this; }
      setFileIds() { return this; }
    }
    class PickerBuilder {
      setAppId() { return this; }
      setDeveloperKey() { return this; }
      setOAuthToken() { return this; }
      setOrigin() { return this; }
      addView() { return this; }
      setCallback(next: (data: Record<string, unknown>) => void) { callbacks.push(next); return this; }
      build() { return { setVisible: vi.fn() }; }
    }
    vi.stubGlobal('window', {
      location: { origin: 'https://app.example.com' },
      google: { picker: { DocsView, PickerBuilder, Action: { CANCEL: 'cancel', ERROR: 'error', PICKED: 'picked' }, Response: { ERROR: 'error' } } },
    });

    const mismatch = pickDriveFileById({ uid: 'user-1' } as never, '1AbCdEfGhIjK');
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks[0]({ action: 'picked', docs: [{ id: 'DifferentFile99' }] });
    await expect(mismatch).rejects.toThrow('DRIVE_PICKER_FILE_MISMATCH');

    const cancelled = pickDriveFileById({ uid: 'user-1' } as never, '1AbCdEfGhIjK');
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    callbacks[1]({ action: 'cancel' });
    await expect(cancelled).resolves.toBeNull();
  });

  it('adds valid resource keys to metadata requests and ignores unsafe values', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: '1AbCdEfGhIjK', name: 'Spec', mimeType: 'application/vnd.google-apps.document' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await getDriveFile({ uid: 'user-1' } as never, '1AbCdEfGhIjK', '0-safe_Key');
    await getDriveFile({ uid: 'user-1' } as never, '1AbCdEfGhIjK', 'unsafe/key');

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-Goog-Drive-Resource-Keys')).toBe('1AbCdEfGhIjK/0-safe_Key');
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has('X-Goog-Drive-Resource-Keys')).toBe(false);
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

    expect(result).toEqual({ sharedMemberIds: ['owner', 'member-1', 'member-2'], managedPermissionIds: { 'member-2': 'managed-2' }, role: 'reader' });
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

  it('grants the requested role and records the anyone-with-link permission it created', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'anyone-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await shareDriveFile({ uid: 'owner' } as never, 'file-1', 'link', [] as never, 'commenter');

    expect(result).toEqual({ sharedMemberIds: [], managedPermissionIds: {}, role: 'commenter', linkPermissionId: 'anyone-1' });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ role: 'commenter', type: 'anyone', allowFileDiscovery: false });
  });

  it('never grants edit access to anyone with the link', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(shareDriveFile({ uid: 'owner' } as never, 'file-1', 'link', [] as never, 'writer')).rejects.toThrow('DRIVE_LINK_WRITER_FORBIDDEN');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limits elevated roles to Google Docs, Sheets and Slides', () => {
    const doc = 'application/vnd.google-apps.document';
    expect(allowedDriveRoles('members', doc)).toEqual(['reader', 'commenter', 'writer']);
    expect(allowedDriveRoles('link', doc)).toEqual(['reader', 'commenter']);
    expect(allowedDriveRoles('members', 'application/pdf')).toEqual(['reader']);
    expect(effectiveDriveRole('link', doc, 'writer')).toBe('commenter');
    expect(effectiveDriveRole('members', 'application/pdf', 'writer')).toBe('reader');
    expect(effectiveDriveRole('members', 'application/vnd.google-apps.presentation', 'writer')).toBe('writer');
  });

  it('parses Google file links and rejects folders and other hosts', () => {
    expect(parseGoogleFileLink('https://docs.google.com/document/d/1AbCdEfGhIjK_lm-no/edit?usp=sharing')).toEqual({ driveFileId: '1AbCdEfGhIjK_lm-no', mimeType: 'application/vnd.google-apps.document' });
    expect(parseGoogleFileLink('https://docs.google.com/spreadsheets/u/1/d/1AbCdEfGhIjK/edit#gid=0')).toEqual({ driveFileId: '1AbCdEfGhIjK', mimeType: 'application/vnd.google-apps.spreadsheet' });
    expect(parseGoogleFileLink(' https://docs.google.com/presentation/d/1AbCdEfGhIjK/view ')).toEqual({ driveFileId: '1AbCdEfGhIjK', mimeType: 'application/vnd.google-apps.presentation' });
    expect(parseGoogleFileLink('https://drive.google.com/file/d/1AbCdEfGhIjK/view')).toEqual({ driveFileId: '1AbCdEfGhIjK' });
    expect(parseGoogleFileLink('https://drive.google.com/open?id=1AbCdEfGhIjK')).toEqual({ driveFileId: '1AbCdEfGhIjK' });
    expect(parseGoogleFileLink('https://drive.google.com/drive/folders/1AbCdEfGhIjK')).toBeNull();
    expect(parseGoogleFileLink('https://docs.google.com.evil.example/document/d/1AbCdEfGhIjK')).toBeNull();
    expect(parseGoogleFileLink('http://docs.google.com/document/d/1AbCdEfGhIjK')).toBeNull();
    expect(parseGoogleFileLink('not a url')).toBeNull();
    expect(parseGoogleFileLink('https://docs.google.com/document/d/1AbCdEfGhIjK/edit?resourcekey=0-safe_Key')).toMatchObject({ resourceKey: '0-safe_Key' });
    expect(parseGoogleFileLink('https://docs.google.com/document/d/1AbCdEfGhIjK/edit?resourcekey=unsafe%2Fkey')).not.toHaveProperty('resourceKey');
  });

  it('parses Drive folder links and preserves only the resource key', () => {
    expect(parseGoogleFolderLink('https://drive.google.com/drive/folders/1AbCdEfGhIjK?resourcekey=0-safe_Key&usp=sharing')).toEqual({ driveFileId: '1AbCdEfGhIjK', mimeType: 'application/vnd.google-apps.folder', resourceKey: '0-safe_Key' });
    expect(parseGoogleFolderLink('https://drive.google.com/file/d/1AbCdEfGhIjK/view')).toBeNull();
    expect(parseGoogleFolderLink('https://drive.google.com.evil.test/drive/folders/1AbCdEfGhIjK')).toBeNull();
    expect(driveFolderUrl('folder id', 'key_1')).toBe('https://drive.google.com/drive/folders/folder%20id?resourcekey=key_1');
  });

  it('creates Google files inside the project upload folder', async () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'root-1', name: 'SuperKanban' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'folder-1', name: 'Roadmap' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'doc-1', name: 'Spec', mimeType: 'application/vnd.google-apps.document' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createGoogleWorkspaceFile({ uid: 'user-1' } as never, { id: 'project-1', name: 'Roadmap' }, 'document', ' Spec ')).resolves.toEqual({ driveFileId: 'doc-1', name: 'Spec', mimeType: 'application/vnd.google-apps.document' });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ name: 'Spec', mimeType: 'application/vnd.google-apps.document', parents: ['folder-1'], appProperties: { projectSpaceProjectId: 'project-1' } });
  });

  it('aligns managed permission roles during sync without touching manual permissions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ownedByMe: true, capabilities: { canShare: true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ permissions: [
        { id: 'managed-1', type: 'user', emailAddress: 'member@example.com', role: 'reader' },
        { id: 'manual', type: 'user', emailAddress: 'manual@example.com', role: 'reader' },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'managed-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const members = [
      { userId: 'owner', email: 'owner@example.com' },
      { userId: 'member', email: 'member@example.com' },
      { userId: 'manual-member', email: 'manual@example.com' },
    ] as never;

    await syncDriveFileMembers({ uid: 'owner' } as never, 'file-1', members, { member: 'managed-1' }, 'writer');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/permissions/managed-1');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ role: 'writer' }) });
  });

  it('refuses role changes on files the user does not own', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ownedByMe: false, capabilities: { canShare: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(updateManagedPermissionRoles({ uid: 'owner' } as never, 'file-1', ['managed-1'], 'commenter')).rejects.toThrow('DRIVE_NOT_OWNER');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
