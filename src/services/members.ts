import {
  arrayRemove,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Membership, Role } from '@/types';
import { database, withId } from './helpers';
import { queueGitHubRevocation, type GitHubRevocationInput } from './github';

export function subscribeMemberships(projectId: string, callback: (items: Membership[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(database(), 'memberships'), where('projectId', '==', projectId)),
    (snapshot) => {
      callback(snapshot.docs.map((item) => withId<Membership>(item)).sort((a, b) => a.displayName.localeCompare(b.displayName)));
    },
  );
}

export async function changeMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
  await updateDoc(doc(database(), 'memberships', `${projectId}_${userId}`), { role });
}

/** `revocation` queues GitHub access that could not be removed right away, atomically with the removal. */
export async function removeMember(projectId: string, userId: string, revocation?: GitHubRevocationInput): Promise<void> {
  const store = database();
  const batch = writeBatch(store);
  if (revocation) queueGitHubRevocation(batch, projectId, revocation);
  batch.delete(doc(store, 'memberships', `${projectId}_${userId}`));
  batch.update(doc(store, 'projects', projectId), { memberIds: arrayRemove(userId), updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function leaveProject(projectId: string, userId: string): Promise<void> {
  await removeMember(projectId, userId);
}
