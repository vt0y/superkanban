import type { User } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { DriveAccessMode, DriveFileRef, DriveProjectDocument, DriveRole, Membership, ProjectDocument } from '@/types';
import { allowedDriveRoles, isDriveFolder, removeDrivePermissions, syncDriveFileMembers, updateManagedPermissionRoles, type DriveFileCandidate, type DriveShareResult } from './google-drive';
import { activityData, BATCH_CHUNK, database, withId } from './helpers';
import { bulkDeleteWorkItems } from './work-items';
import { cleanupRemovedDocumentCards } from './canvas-documents';

export const isDriveProjectDocument = (item: ProjectDocument): item is DriveProjectDocument => item.kind === 'drive';
export const driveDocumentId = (fileId: string) => `drive_${fileId}`;

/** Sharing result for a pasted link the app cannot read: no grants, no sync, access stays in Google Drive. */
export const UNMANAGED_DRIVE_SHARING: DriveShareResult = { sharedMemberIds: [], managedPermissionIds: {} };

function fileData(file: DriveFileCandidate, shareMode: DriveAccessMode, sharing: DriveShareResult, user: User) {
  return {
    driveFileId: file.driveFileId,
    name: file.name.slice(0, 240),
    mimeType: file.mimeType.slice(0, 160),
    ...(file.resourceKey ? { resourceKey: file.resourceKey.slice(0, 512) } : {}),
    ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
    shareMode,
    sharedMemberIds: sharing.sharedMemberIds,
    ...(shareMode === 'members' ? { managedPermissionIds: sharing.managedPermissionIds, permissionsSyncedAt: serverTimestamp() } : {}),
    ...(shareMode !== 'unmanaged' && sharing.role ? { role: sharing.role } : {}),
    ...(shareMode === 'link' && sharing.linkPermissionId ? { linkPermissionId: sharing.linkPermissionId } : {}),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function attachDriveProjectDocument(
  projectId: string,
  file: DriveFileCandidate,
  shareMode: DriveAccessMode,
  sharing: DriveShareResult,
  user: User,
  taskIds: string[] = [],
  milestoneIds: string[] = [],
): Promise<void> {
  const store = database();
  const id = driveDocumentId(file.driveFileId);
  const ref = doc(store, 'projects', projectId, 'documents', id);
  if ((await getDoc(ref)).exists()) {
    if (taskIds.length || milestoneIds.length) await updateDoc(ref, {
      ...(taskIds.length ? { taskIds: arrayUnion(...taskIds.slice(0, 100)) } : {}),
      ...(milestoneIds.length ? { milestoneIds: arrayUnion(...milestoneIds.slice(0, 100)) } : {}),
      updatedAt: serverTimestamp(),
    });
    return;
  }
  const batch = writeBatch(store);
  const accessMode = isDriveFolder(file) ? 'unmanaged' : shareMode;
  const access = isDriveFolder(file) ? UNMANAGED_DRIVE_SHARING : sharing;
  batch.set(ref, {
    kind: 'drive', title: file.name.slice(0, 200), labelIds: [], taskIds: [...new Set(taskIds)].slice(0, 100), milestoneIds: [...new Set(milestoneIds)].slice(0, 100), ...fileData(file, accessMode, access, user),
  });
  batch.set(doc(collection(store, 'projects', projectId, 'activities')), activityData(user, 'file_attached', `แนบไฟล์ “${file.name}”`, `attached file “${file.name}”`, id));
  await batch.commit();
}

export async function updateDriveProjectDocumentDetails(
  projectId: string,
  documentId: string,
  input: { nickname: string; description: string; labelIds: string[]; taskIds: string[]; milestoneIds?: string[] },
): Promise<void> {
  await updateDoc(doc(database(), 'projects', projectId, 'documents', documentId), {
    nickname: input.nickname.trim().slice(0, 200),
    description: input.description.trim().slice(0, 1000),
    labelIds: [...new Set(input.labelIds)].slice(0, 50),
    taskIds: [...new Set(input.taskIds)].slice(0, 100),
    milestoneIds: [...new Set(input.milestoneIds || [])].slice(0, 100),
    updatedAt: serverTimestamp(),
  });
}

/** Changes the role of app-created grants in Drive, then records it. Reverts Drive if the Firestore write fails. */
export async function updateDriveProjectDocumentRole(projectId: string, item: DriveProjectDocument, role: DriveRole, user: User): Promise<void> {
  if (item.shareMode === 'unmanaged') throw new Error('DRIVE_ROLE_UNMANAGED');
  if (!allowedDriveRoles(item.shareMode, item.mimeType).includes(role)) throw new Error('DRIVE_ROLE_NOT_ALLOWED');
  const permissionIds = item.shareMode === 'link'
    ? (item.linkPermissionId ? [item.linkPermissionId] : [])
    : Object.values(item.managedPermissionIds || {});
  if (item.shareMode === 'link' && !permissionIds.length) throw new Error('DRIVE_ROLE_UNMANAGED_LINK');
  const previous = item.role || 'reader';
  await updateManagedPermissionRoles(user, item.driveFileId, permissionIds, role);
  try {
    await updateDoc(doc(database(), 'projects', projectId, 'documents', item.id), { role, updatedAt: serverTimestamp() });
  } catch (error) {
    await updateManagedPermissionRoles(user, item.driveFileId, permissionIds, previous).catch(() => undefined);
    throw error;
  }
}

export function subscribeTaskDocuments(projectId: string, taskId: string, callback: (items: ProjectDocument[]) => void): Unsubscribe {
  return onSnapshot(query(collection(database(), 'projects', projectId, 'documents'), where('taskIds', 'array-contains', taskId)), (snapshot) => {
    callback(snapshot.docs.map((item) => withId<ProjectDocument>(item)).sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0)));
  });
}

export function subscribeMilestoneDocuments(projectId: string, milestoneId: string, callback: (items: ProjectDocument[]) => void): Unsubscribe {
  return onSnapshot(query(collection(database(), 'projects', projectId, 'documents'), where('milestoneIds', 'array-contains', milestoneId)), (snapshot) => {
    callback(snapshot.docs.map((item) => withId<ProjectDocument>(item)).sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0)));
  });
}

export async function detachDriveProjectDocument(projectId: string, id: string): Promise<void> {
  const store = database();
  const batch = writeBatch(store);
  batch.delete(doc(store, 'projects', projectId, 'documents', id));
  await batch.commit();
  await cleanupRemovedDocumentCards(projectId, [id]);
}

export interface DrivePermissionSyncSummary {
  total: number;
  updated: number;
  skipped: number;
  failed: number;
}

export async function syncProjectDrivePermissions(
  projectId: string,
  user: User,
  members: Membership[],
): Promise<DrivePermissionSyncSummary> {
  const store = database();
  const documents = await getDocs(query(collection(store, 'projects', projectId, 'documents'), where('createdBy', '==', user.uid)));
  const candidates = documents.docs.filter((snapshot) => (snapshot.data() as ProjectDocument).kind === 'drive');
  const summary: DrivePermissionSyncSummary = { total: candidates.length, updated: 0, skipped: 0, failed: 0 };

  for (const snapshot of candidates) {
    const file = snapshot.data() as DriveFileRef;
    if (file.shareMode !== 'members') {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await syncDriveFileMembers(user, file.driveFileId, members, file.managedPermissionIds, file.role || 'reader');
      if (result.state === 'skipped') {
        summary.skipped += 1;
        continue;
      }
      try {
        await updateDoc(snapshot.ref, {
          sharedMemberIds: result.sharedMemberIds,
          managedPermissionIds: result.managedPermissionIds,
          permissionsSyncedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        await removeDrivePermissions(user, file.driveFileId, result.createdPermissionIds);
        throw error;
      }
      summary.updated += 1;
    } catch (error) {
      console.error('Drive permission sync failed', file.driveFileId, error);
      summary.failed += 1;
    }
  }
  return summary;
}

export async function deleteTasksAndUnlinkDocuments(projectId: string, taskIds: string[]): Promise<void> {
  const store = database();
  for (let start = 0; start < taskIds.length; start += 30) {
    const ids = taskIds.slice(start, start + 30);
    const snapshot = await getDocs(query(collection(store, 'projects', projectId, 'documents'), where('taskIds', 'array-contains-any', ids)));
    for (let refStart = 0; refStart < snapshot.docs.length; refStart += BATCH_CHUNK) {
      const batch = writeBatch(store);
      snapshot.docs.slice(refStart, refStart + BATCH_CHUNK).forEach((item) => batch.update(item.ref, { taskIds: arrayRemove(...ids), updatedAt: serverTimestamp() }));
      await batch.commit();
    }
  }
  await bulkDeleteWorkItems(projectId, 'tasks', taskIds);
}

export async function deleteMilestoneAndUnlinkDocuments(projectId: string, milestoneId: string): Promise<void> {
  const store = database();
  const snapshot = await getDocs(query(collection(store, 'projects', projectId, 'documents'), where('milestoneIds', 'array-contains', milestoneId)));
  for (let start = 0; start < snapshot.docs.length; start += BATCH_CHUNK) {
    const batch = writeBatch(store);
    snapshot.docs.slice(start, start + BATCH_CHUNK).forEach((item) => batch.update(item.ref, { milestoneIds: arrayRemove(milestoneId), updatedAt: serverTimestamp() }));
    await batch.commit();
  }
  await bulkDeleteWorkItems(projectId, 'milestones', [milestoneId]);
}
