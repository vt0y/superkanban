import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { DriveFileRef, DriveProjectDocument, DriveShareMode, Membership, ProjectDocument, TaskAttachment } from '@/types';
import { removeDrivePermissions, syncDriveFileMembers, type DriveFileCandidate, type DriveShareResult } from './google-drive';
import { activityData, BATCH_CHUNK, database, withId } from './helpers';
import { bulkDeleteWorkItems } from './work-items';

export const isDriveProjectDocument = (item: ProjectDocument): item is DriveProjectDocument => item.kind === 'drive';
export const driveDocumentId = (fileId: string) => `drive_${fileId}`;
export const taskAttachmentId = (taskId: string, fileId: string) => `${taskId}_${fileId}`;

function fileData(file: DriveFileCandidate, shareMode: DriveShareMode, sharing: DriveShareResult, user: User) {
  return {
    driveFileId: file.driveFileId,
    name: file.name.slice(0, 240),
    mimeType: file.mimeType.slice(0, 160),
    ...(file.sizeBytes === undefined ? {} : { sizeBytes: file.sizeBytes }),
    shareMode,
    sharedMemberIds: sharing.sharedMemberIds,
    ...(shareMode === 'members' ? { managedPermissionIds: sharing.managedPermissionIds, permissionsSyncedAt: serverTimestamp() } : {}),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function attachDriveProjectDocument(
  projectId: string,
  file: DriveFileCandidate,
  shareMode: DriveShareMode,
  sharing: DriveShareResult,
  user: User,
): Promise<void> {
  const store = database();
  const id = driveDocumentId(file.driveFileId);
  const batch = writeBatch(store);
  batch.set(doc(store, 'projects', projectId, 'documents', id), {
    kind: 'drive', title: file.name.slice(0, 200), ...fileData(file, shareMode, sharing, user),
  });
  batch.set(doc(collection(store, 'projects', projectId, 'activities')), activityData(user, 'file_attached', `แนบไฟล์ “${file.name}”`, `attached file “${file.name}”`, id));
  await batch.commit();
}

export async function detachDriveProjectDocument(projectId: string, id: string): Promise<void> {
  await deleteDoc(doc(database(), 'projects', projectId, 'documents', id));
}

export function subscribeTaskAttachments(projectId: string, taskId: string, callback: (items: TaskAttachment[]) => void): Unsubscribe {
  return onSnapshot(query(collection(database(), 'projects', projectId, 'taskAttachments'), where('taskId', '==', taskId)), (snapshot) => {
    callback(snapshot.docs.map((item) => withId<TaskAttachment>(item)).sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0)));
  });
}

export async function attachDriveTaskFile(
  projectId: string,
  taskId: string,
  file: DriveFileCandidate,
  shareMode: DriveShareMode,
  sharing: DriveShareResult,
  user: User,
): Promise<void> {
  const store = database();
  const id = taskAttachmentId(taskId, file.driveFileId);
  const batch = writeBatch(store);
  batch.set(doc(store, 'projects', projectId, 'taskAttachments', id), { taskId, ...fileData(file, shareMode, sharing, user) });
  batch.set(doc(collection(store, 'projects', projectId, 'activities')), activityData(user, 'file_attached', `แนบไฟล์ “${file.name}” กับงาน`, `attached file “${file.name}” to a task`, taskId));
  await batch.commit();
}

export async function detachDriveTaskFile(projectId: string, id: string): Promise<void> {
  await deleteDoc(doc(database(), 'projects', projectId, 'taskAttachments', id));
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
  const [documents, attachments] = await Promise.all([
    getDocs(query(collection(store, 'projects', projectId, 'documents'), where('createdBy', '==', user.uid))),
    getDocs(query(collection(store, 'projects', projectId, 'taskAttachments'), where('createdBy', '==', user.uid))),
  ]);
  const candidates = [
    ...documents.docs.filter((snapshot) => (snapshot.data() as ProjectDocument).kind === 'drive'),
    ...attachments.docs,
  ];
  const summary: DrivePermissionSyncSummary = { total: candidates.length, updated: 0, skipped: 0, failed: 0 };

  for (const snapshot of candidates) {
    const file = snapshot.data() as DriveFileRef;
    if (file.shareMode !== 'members') {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await syncDriveFileMembers(user, file.driveFileId, members, file.managedPermissionIds);
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

export async function deleteTasksWithAttachments(projectId: string, taskIds: string[]): Promise<void> {
  const store = database();
  for (let start = 0; start < taskIds.length; start += 30) {
    const ids = taskIds.slice(start, start + 30);
    const snapshot = await getDocs(query(collection(store, 'projects', projectId, 'taskAttachments'), where('taskId', 'in', ids)));
    for (let refStart = 0; refStart < snapshot.docs.length; refStart += BATCH_CHUNK) {
      const batch = writeBatch(store);
      snapshot.docs.slice(refStart, refStart + BATCH_CHUNK).forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }
  }
  await bulkDeleteWorkItems(projectId, 'tasks', taskIds);
}
