import type { User } from 'firebase/auth';
import {
  Timestamp,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Invite, Project, Role } from '@/types';
import { database, withId } from './helpers';

export async function createInvite(
  project: Project,
  user: User,
  role: Exclude<Role, 'owner'>,
): Promise<string> {
  const id = crypto.randomUUID().replaceAll('-', '');
  await setDoc(doc(database(), 'invites', id), {
    projectId: project.id,
    projectName: project.name,
    role,
    status: 'active',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  });
  return id;
}

export function subscribeProjectInvites(projectId: string, callback: (items: Invite[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(database(), 'invites'), where('projectId', '==', projectId)),
    (snapshot) => {
      callback(snapshot.docs.map((item) => withId<Invite>(item)));
    },
  );
}

export function subscribeInvite(inviteId: string, callback: (invite: Invite | null) => void): Unsubscribe {
  return onSnapshot(doc(database(), 'invites', inviteId), (snap) =>
    callback(snap.exists() ? withId<Invite>(snap) : null),
  );
}

export async function acceptInvite(invite: Invite, user: User): Promise<void> {
  const store = database();
  const inviteRef = doc(store, 'invites', invite.id);
  const projectRef = doc(store, 'projects', invite.projectId);
  const userRef = doc(store, 'users', user.uid);
  const membershipRef = doc(store, 'memberships', `${invite.projectId}_${user.uid}`);
  await runTransaction(store, async (transaction) => {
    const current = await transaction.get(inviteRef);
    if (!current.exists()) throw new Error('INVITE_NOT_FOUND');
    const data = current.data() as Invite;
    if (data.status !== 'active') throw new Error('INVITE_REVOKED');
    const userSnap = await transaction.get(userRef);
    const githubUsername = (userSnap.exists() && (userSnap.data()?.githubUsername as string)) || null;
    const githubId = (userSnap.exists() && (userSnap.data()?.githubId as string)) || null;
    transaction.set(membershipRef, {
      projectId: invite.projectId,
      userId: user.uid,
      displayName: user.displayName || 'User',
      email: user.email || '',
      photoURL: user.photoURL || '',
      role: invite.role,
      joinedAt: serverTimestamp(),
      inviteId: invite.id,
      ...(githubUsername ? { githubUsername } : {}),
      ...(githubId ? { githubId } : {}),
    });
    transaction.update(projectRef, { memberIds: arrayUnion(user.uid), updatedAt: serverTimestamp() });
  });
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await updateDoc(doc(database(), 'invites', inviteId), { status: 'revoked' });
}
