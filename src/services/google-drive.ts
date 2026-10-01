import { GoogleAuthProvider, reauthenticateWithPopup, type User } from 'firebase/auth';
import { googleCloudProjectNumber, googleDriveApiKey } from '@/config/features';
import type { DriveRole, DriveShareMode, Membership, Project } from '@/types';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const LOCAL_DRIVE_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_DRIVE_SHARE_MODE: DriveShareMode = 'members';
export const DRIVE_ROOT_FOLDER_NAME = 'SuperKanban';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;

export interface DriveFileCandidate {
  driveFileId: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface DriveShareResult {
  sharedMemberIds: string[];
  managedPermissionIds: Record<string, string>;
  role?: DriveRole;
  linkPermissionId?: string;
}

export const GOOGLE_WORKSPACE_MIME_TYPES = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
} as const;
export type GoogleWorkspaceFileType = keyof typeof GOOGLE_WORKSPACE_MIME_TYPES;

const DRIVE_ROLE_RANK: Record<DriveRole, number> = { reader: 0, commenter: 1, writer: 2 };

export function isGoogleWorkspaceMimeType(mimeType: string): boolean {
  return (Object.values(GOOGLE_WORKSPACE_MIME_TYPES) as string[]).includes(mimeType);
}

/** Roles the app may grant: non-Google files stay view-only, and "anyone with the link" never gets edit access. */
export function allowedDriveRoles(mode: DriveShareMode, mimeType: string): DriveRole[] {
  if (!isGoogleWorkspaceMimeType(mimeType)) return ['reader'];
  return mode === 'link' ? ['reader', 'commenter'] : ['reader', 'commenter', 'writer'];
}

/** Clamps a requested role down to the highest role allowed for this file and sharing mode. */
export function effectiveDriveRole(mode: DriveShareMode, mimeType: string, requested: DriveRole): DriveRole {
  return allowedDriveRoles(mode, mimeType).filter((role) => DRIVE_ROLE_RANK[role] <= DRIVE_ROLE_RANK[requested]).pop() || 'reader';
}

export interface GoogleFileLink {
  driveFileId: string;
  mimeType?: string;
}

const LINK_TYPES: Record<string, string> = {
  document: GOOGLE_WORKSPACE_MIME_TYPES.document,
  spreadsheets: GOOGLE_WORKSPACE_MIME_TYPES.spreadsheet,
  presentation: GOOGLE_WORKSPACE_MIME_TYPES.presentation,
};
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/** Extracts a Drive file ID from a Google Docs/Sheets/Slides or Drive file URL. Folders and other hosts are rejected. */
export function parseGoogleFileLink(raw: string): GoogleFileLink | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.hostname === 'docs.google.com') {
    const match = url.pathname.match(/^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([^/]+)/);
    return match && FILE_ID.test(match[2]) ? { driveFileId: match[2], mimeType: LINK_TYPES[match[1]] } : null;
  }
  if (url.hostname === 'drive.google.com') {
    const match = url.pathname.match(/^\/(?:u\/\d+\/)?file\/d\/([^/]+)/);
    const id = match?.[1] ?? (url.pathname === '/open' ? url.searchParams.get('id') : null);
    return id && FILE_ID.test(id) ? { driveFileId: id } : null;
  }
  return null;
}

export interface DriveMemberSyncResult extends DriveShareResult {
  state: 'updated' | 'skipped';
  createdPermissionIds: string[];
}

interface CachedToken { userId: string; accessToken: string; expiresAt: number }
let cachedToken: CachedToken | null = null;

export function driveOpenUrl(fileId: string): string {
  return `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

export function projectDriveFolderStorageKey(userId: string, projectId: string): string {
  return `ps.drive.project-folder.${encodeURIComponent(JSON.stringify([userId, projectId]))}`;
}

export function getCachedProjectDriveFolderId(userId: string, projectId: string): string | null {
  try { return localStorage.getItem(projectDriveFolderStorageKey(userId, projectId)); }
  catch { return null; }
}

function cacheProjectDriveFolderId(userId: string, projectId: string, folderId: string): void {
  try { localStorage.setItem(projectDriveFolderStorageKey(userId, projectId), folderId); }
  catch { /* Folder discovery still works when storage is unavailable. */ }
}

export function validateLocalDriveFile(file: Pick<File, 'size'>): void {
  if (file.size > LOCAL_DRIVE_FILE_MAX_BYTES) throw new Error('DRIVE_FILE_TOO_LARGE');
}

export function clearDriveAccessToken(): void { cachedToken = null; }

export async function requestDriveAccess(user: User, force = false): Promise<string> {
  if (!force && cachedToken?.userId === user.uid && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_FILE_SCOPE);
  provider.setCustomParameters({ ...(user.email ? { login_hint: user.email } : {}) });
  const result = await reauthenticateWithPopup(user, provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('DRIVE_AUTH_TOKEN_MISSING');
  cachedToken = { userId: user.uid, accessToken: token, expiresAt: Date.now() + TOKEN_LIFETIME_MS };
  return token;
}

async function authorizedFetch(user: User, input: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await requestDriveAccess(user);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && retry) {
    clearDriveAccessToken();
    const fresh = await requestDriveAccess(user, true);
    headers.set('Authorization', `Bearer ${fresh}`);
    return fetch(input, { ...init, headers });
  }
  return response;
}

async function driveJson<T>(user: User, input: string, init: RequestInit = {}): Promise<T> {
  const response = await authorizedFetch(user, input, init);
  if (!response.ok) throw new Error(`DRIVE_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

const escapeDriveQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function getOrCreateProjectDriveFolder(user: User, project: Pick<Project, 'id' | 'name'>): Promise<string> {
  const rootQuery = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='projectSpaceRoot' and value='true' }");
  const rootResult = await driveJson<{ files: Array<{ id: string; name: string }> }>(user, `${DRIVE_API}/files?q=${rootQuery}&spaces=drive&pageSize=1&fields=files(id,name)`);
  let rootId: string;
  if (rootResult.files[0]) {
    rootId = rootResult.files[0].id;
    if (rootResult.files[0].name !== DRIVE_ROOT_FOLDER_NAME) {
      await driveJson(user, `${DRIVE_API}/files/${encodeURIComponent(rootId)}?fields=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: DRIVE_ROOT_FOLDER_NAME }),
      });
    }
  } else {
    rootId = (await driveJson<{ id: string }>(user, `${DRIVE_API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', appProperties: { projectSpaceRoot: 'true' } }),
    })).id;
  }
  const marker = escapeDriveQuery(project.id);
  const q = encodeURIComponent(`'${escapeDriveQuery(rootId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='projectSpaceProjectId' and value='${marker}' }`);
  const found = await driveJson<{ files: Array<{ id: string; name: string }> }>(user, `${DRIVE_API}/files?q=${q}&spaces=drive&pageSize=1&fields=files(id,name)`);
  const desiredName = project.name.slice(0, 240);
  if (found.files[0]) {
    if (found.files[0].name !== desiredName) {
      await driveJson(user, `${DRIVE_API}/files/${encodeURIComponent(found.files[0].id)}?fields=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: desiredName }),
      });
    }
    cacheProjectDriveFolderId(user.uid, project.id, found.files[0].id);
    return found.files[0].id;
  }
  const created = await driveJson<{ id: string }>(user, `${DRIVE_API}/files?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: desiredName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId],
      appProperties: { projectSpaceProjectId: project.id },
    }),
  });
  cacheProjectDriveFolderId(user.uid, project.id, created.id);
  return created.id;
}

function uploadToSession(sessionUrl: string, token: string, file: File, onProgress?: (fraction: number) => void): Promise<DriveFileCandidate> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onerror = () => reject(new Error('DRIVE_UPLOAD_NETWORK'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`DRIVE_HTTP_${xhr.status}`));
      try { resolve(normalizeDriveFile(JSON.parse(xhr.responseText))); }
      catch { reject(new Error('DRIVE_UPLOAD_RESULT_MISSING')); }
    };
    xhr.send(file);
  });
}

export async function uploadFileToDrive(user: User, project: Pick<Project, 'id' | 'name'>, file: File, onProgress?: (fraction: number) => void): Promise<DriveFileCandidate> {
  validateLocalDriveFile(file);
  const folderId = await getOrCreateProjectDriveFolder(user, project);
  const response = await authorizedFetch(user, `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      parents: [folderId],
      appProperties: { projectSpaceProjectId: project.id },
    }),
  });
  if (!response.ok) throw new Error(`DRIVE_HTTP_${response.status}`);
  const sessionUrl = response.headers.get('Location');
  if (!sessionUrl) throw new Error('DRIVE_UPLOAD_SESSION_MISSING');
  const token = await requestDriveAccess(user);
  const uploaded = await uploadToSession(sessionUrl, token, file, onProgress);
  cacheProjectDriveFolderId(user.uid, project.id, folderId);
  onProgress?.(1);
  return uploaded;
}

function normalizeDriveFile(file: { id: string; name: string; mimeType: string; size?: string }): DriveFileCandidate {
  const parsed = file.size === undefined ? undefined : Number(file.size);
  return { driveFileId: file.id, name: file.name, mimeType: file.mimeType, ...(Number.isFinite(parsed) ? { sizeBytes: parsed } : {}) };
}

/** Creates a blank Google Doc/Sheet/Slides file in the project upload folder; app-created files stay accessible under drive.file. */
export async function createGoogleWorkspaceFile(user: User, project: Pick<Project, 'id' | 'name'>, type: GoogleWorkspaceFileType, name: string): Promise<DriveFileCandidate> {
  const folderId = await getOrCreateProjectDriveFolder(user, project);
  const created = await driveJson<{ id: string; name: string; mimeType: string }>(user, `${DRIVE_API}/files?fields=id,name,mimeType`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name.trim().slice(0, 240) || 'Untitled',
      mimeType: GOOGLE_WORKSPACE_MIME_TYPES[type],
      parents: [folderId],
      appProperties: { projectSpaceProjectId: project.id },
    }),
  });
  return normalizeDriveFile(created);
}

export async function getDriveFile(user: User, fileId: string): Promise<DriveFileCandidate> {
  const file = await driveJson<{ id: string; name: string; mimeType: string; size?: string }>(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`);
  return normalizeDriveFile(file);
}

export async function removeDrivePermissions(user: User, fileId: string, permissionIds: string[]): Promise<void> {
  await Promise.allSettled(permissionIds.map((permissionId) => authorizedFetch(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' }, false)));
}

export async function shareDriveFile(user: User, fileId: string, mode: DriveShareMode, members: Membership[], role: DriveRole = 'reader'): Promise<DriveShareResult> {
  if (mode === 'link' && role === 'writer') throw new Error('DRIVE_LINK_WRITER_FORBIDDEN');
  const existing = await driveJson<{ permissions?: Array<{ id: string; type: string; emailAddress?: string; role: string }> }>(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,emailAddress,role)`);
  const permissions = existing.permissions || [];
  const grants: Array<{ userId?: string; body: Record<string, unknown> }> = mode === 'link'
    ? (permissions.some((permission) => permission.type === 'anyone' && permission.role !== 'none') ? [] : [{ body: { role, type: 'anyone', allowFileDiscovery: false } }])
    : members.filter((member) => member.userId !== user.uid && !permissions.some((permission) => permission.type === 'user' && permission.emailAddress?.toLowerCase() === member.email.toLowerCase() && permission.role !== 'none'))
      .map((member) => ({ userId: member.userId, body: { role, type: 'user', emailAddress: member.email } }));
  const createdPermissionIds: string[] = [];
  const managedPermissionIds: Record<string, string> = {};
  let linkPermissionId: string | undefined;
  try {
    for (const grant of grants) {
      const permission = await driveJson<{ id: string }>(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&fields=id`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(grant.body),
      });
      createdPermissionIds.push(permission.id);
      if (grant.userId) managedPermissionIds[grant.userId] = permission.id;
      else linkPermissionId = permission.id;
    }
  } catch (error) {
    await removeDrivePermissions(user, fileId, createdPermissionIds);
    throw error;
  }
  return {
    sharedMemberIds: mode === 'members' ? members.map((member) => member.userId) : [],
    managedPermissionIds,
    role,
    ...(linkPermissionId ? { linkPermissionId } : {}),
  };
}

async function patchPermissionRole(user: User, fileId: string, permissionId: string, role: DriveRole): Promise<void> {
  const response = await authorizedFetch(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?fields=id`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
  });
  if (!response.ok && response.status !== 404) throw new Error(`DRIVE_HTTP_${response.status}`);
}

/** Changes the role of permissions this app created. Only the file owner can do this; other permissions are never touched. */
export async function updateManagedPermissionRoles(user: User, fileId: string, permissionIds: string[], role: DriveRole): Promise<void> {
  const file = await driveJson<{ ownedByMe?: boolean; capabilities?: { canShare?: boolean } }>(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=ownedByMe,capabilities(canShare)`);
  if (!file.ownedByMe || !file.capabilities?.canShare) throw new Error('DRIVE_NOT_OWNER');
  for (const permissionId of permissionIds) await patchPermissionRole(user, fileId, permissionId, role);
}

export async function syncDriveFileMembers(
  user: User,
  fileId: string,
  members: Membership[],
  previousManagedPermissionIds: Record<string, string> = {},
  role: DriveRole = 'reader',
): Promise<DriveMemberSyncResult> {
  const file = await driveJson<{ ownedByMe?: boolean; capabilities?: { canShare?: boolean } }>(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=ownedByMe,capabilities(canShare)`);
  if (!file.ownedByMe || !file.capabilities?.canShare) {
    return { state: 'skipped', sharedMemberIds: members.map((member) => member.userId), managedPermissionIds: previousManagedPermissionIds, createdPermissionIds: [] };
  }

  const result = await driveJson<{ permissions?: Array<{ id: string; type: string; emailAddress?: string; role: string }> }>(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,emailAddress,role)`);
  const permissions = result.permissions || [];
  const permissionById = new Map(permissions.map((permission) => [permission.id, permission]));
  const targetMembers = members.filter((member) => member.userId !== user.uid);
  const targetById = new Map(targetMembers.map((member) => [member.userId, member]));
  const managedPermissionIds = { ...previousManagedPermissionIds };
  const createdPermissionIds: string[] = [];

  try {
    for (const [memberId, permissionId] of Object.entries(managedPermissionIds)) {
      const target = targetById.get(memberId);
      const permission = permissionById.get(permissionId);
      const emailChanged = Boolean(target && permission?.emailAddress?.toLowerCase() !== target.email.toLowerCase());
      if (!target || emailChanged) {
        if (permission) {
          const response = await authorizedFetch(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' }, false);
          if (!response.ok && response.status !== 404) throw new Error(`DRIVE_HTTP_${response.status}`);
        }
        delete managedPermissionIds[memberId];
      } else if (!permission) {
        delete managedPermissionIds[memberId];
      } else if (permission.role !== role) {
        await patchPermissionRole(user, fileId, permissionId, role);
      }
    }

    for (const member of targetMembers) {
      const existing = permissions.some((permission) => permission.type === 'user' && permission.role !== 'none' && permission.emailAddress?.toLowerCase() === member.email.toLowerCase());
      if (existing && managedPermissionIds[member.userId]) continue;
      if (existing) continue;
      const permission = await driveJson<{ id: string }>(user, `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&fields=id`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, type: 'user', emailAddress: member.email }),
      });
      managedPermissionIds[member.userId] = permission.id;
      createdPermissionIds.push(permission.id);
    }
  } catch (error) {
    await removeDrivePermissions(user, fileId, createdPermissionIds);
    throw error;
  }

  return { state: 'updated', sharedMemberIds: members.map((member) => member.userId), managedPermissionIds, createdPermissionIds };
}

declare global {
  interface Window {
    gapi?: { load(name: string, options: { callback(): void; onerror(): void }): void };
    google?: { picker?: any };
  }
}

let pickerScriptPromise: Promise<void> | null = null;
let activePicker: { setVisible(visible: boolean): void } | null = null;
const PICKER_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (pickerScriptPromise) return pickerScriptPromise;
  pickerScriptPromise = new Promise((resolve, reject) => {
    const ready = () => window.gapi?.load('picker', { callback: resolve, onerror: () => reject(new Error('DRIVE_PICKER_LOAD_FAILED')) });
    if (window.gapi) return ready();
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error('DRIVE_PICKER_LOAD_FAILED'));
    document.head.appendChild(script);
  });
  return pickerScriptPromise;
}

export async function pickDriveFiles(user: User): Promise<DriveFileCandidate[]> {
  const token = await requestDriveAccess(user);
  await loadPicker();
  const picker = window.google?.picker;
  if (!picker) throw new Error('DRIVE_PICKER_LOAD_FAILED');
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout = 0;
    const finish = (result: DriveFileCandidate[] | Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      activePicker?.setVisible(false);
      activePicker = null;
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const view = new picker.DocsView().setIncludeFolders(true).setSelectFolderEnabled(false);
    try {
      const built = new picker.PickerBuilder()
        .setAppId(googleCloudProjectNumber)
        .setDeveloperKey(googleDriveApiKey)
        .setOAuthToken(token)
        .setOrigin(window.location.origin)
        .addView(view)
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .setCallback((data: any) => {
          const pickerError = data?.[picker.Response?.ERROR || 'error'] || data?.error;
          if (pickerError || data?.action === picker.Action.ERROR) {
            finish(new Error('DRIVE_PICKER_CALLBACK_FAILED'));
          } else if (data?.action === picker.Action.CANCEL) {
            finish([]);
          } else if (data?.action === picker.Action.PICKED) {
            const docs = data.docs || [];
            if (!docs.length) {
              finish(new Error('DRIVE_PICKER_RESULT_MISSING'));
              return;
            }
            Promise.all(docs.map((item: { id: string }) => getDriveFile(user, item.id))).then(finish, (error) => finish(error instanceof Error ? error : new Error('DRIVE_PICKER_FILE_FAILED')));
          }
        })
        .build();
      activePicker?.setVisible(false);
      activePicker = built;
      timeout = globalThis.setTimeout(() => finish(new Error('DRIVE_PICKER_CALLBACK_TIMEOUT')), PICKER_CALLBACK_TIMEOUT_MS) as unknown as number;
      built.setVisible(true);
    } catch (error) {
      finish(error instanceof Error ? error : new Error('DRIVE_PICKER_LOAD_FAILED'));
    }
  });
}
