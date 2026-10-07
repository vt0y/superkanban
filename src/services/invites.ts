import type { User } from 'firebase/auth';
import { arrayUnion, collection, doc, getDocFromServer, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore';
import type { Invite, InviteSettings, Project } from '@/types';
import { database, withId } from './helpers';
import { inviteState } from '@/utils/invite-state';

function validateSettings(settings: InviteSettings) {
  if (settings.name.length > 120 || !['member', 'admin'].includes(settings.role)
    || (settings.maxUses !== null && (!Number.isSafeInteger(settings.maxUses) || settings.maxUses < 1))) {
    throw new Error('INVALID_INVITE_SETTINGS');
  }
}

export async function createInvite(project: Project, user: User, settings: InviteSettings): Promise<string> {
  validateSettings(settings);
  const id = crypto.randomUUID().replaceAll('-', '');
  await setDoc(doc(database(), 'invites', id), {
    ...settings, name: settings.name.trim(), projectId: project.id, projectName: project.name,
    status: 'active', usesCount: 0, createdBy: user.uid, createdByName: user.displayName || '',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  return id;
}

export async function updateInviteSettings(inviteId: string, settings: InviteSettings): Promise<void> {
  validateSettings(settings);
  await updateDoc(doc(database(), 'invites', inviteId), { ...settings, name: settings.name.trim(), updatedAt: serverTimestamp() });
}

export function subscribeProjectInvites(projectId: string, callback: (items: Invite[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(database(), 'invites'), where('projectId', '==', projectId)),
    (snapshot) => callback(snapshot.docs.map((item) => withId<Invite>(item))), onError);
}

export function subscribeInvite(inviteId: string, callback: (invite: Invite | null) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(doc(database(), 'invites', inviteId), (snap) => callback(snap.exists() ? withId<Invite>(snap) : null), onError);
}

export async function acceptInvite(inviteId: string, user: User): Promise<{ projectId: string; alreadyMember: boolean }> {
  const store = database();
  const inviteRef = doc(store, 'invites', inviteId);
  // A competing write can make the rules reject an optimistic commit before
  // the SDK reports a retryable conflict. Retry only when server reads prove
  // the invite or membership changed; real permission failures are preserved.
  for (let attempt = 0; ; attempt++) {
    let observedInvite: Invite | undefined;
    let observedMembership = false;
    try {
      return await runTransaction(store, async (transaction) => {
        const current = await transaction.get(inviteRef);
        if (!current.exists()) throw new Error('INVITE_NOT_FOUND');
        const data = current.data() as Invite;
        observedInvite = data;
        const membershipRef = doc(store, 'memberships', `${data.projectId}_${user.uid}`);
        const existing = await transaction.get(membershipRef);
        observedMembership = existing.exists();
        if (existing.exists()) return { projectId: data.projectId, alreadyMember: true };
        const state = inviteState(data);
        if (state !== 'active') throw new Error(`INVITE_${state.toUpperCase()}`);
        const userSnap = await transaction.get(doc(store, 'users', user.uid));
        const githubUsername = userSnap.data()?.githubUsername;
        const githubId = userSnap.data()?.githubId;
        transaction.set(membershipRef, {
          projectId: data.projectId, userId: user.uid, displayName: user.displayName || 'User',
          email: user.email || '', photoURL: user.photoURL || '', role: data.role,
          joinedAt: serverTimestamp(), inviteId,
          ...(githubUsername ? { githubUsername } : {}), ...(githubId ? { githubId } : {}),
        });
        transaction.update(doc(store, 'projects', data.projectId), { memberIds: arrayUnion(user.uid), updatedAt: serverTimestamp() });
        transaction.update(inviteRef, { usesCount: (data.usesCount ?? 0) + 1, updatedAt: serverTimestamp() });
        return { projectId: data.projectId, alreadyMember: false };
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code !== 'permission-denied' || !observedInvite || attempt >= 4) throw error;
      const [latestInvite, latestMembership] = await Promise.all([
        getDocFromServer(inviteRef),
        getDocFromServer(doc(store, 'memberships', `${observedInvite.projectId}_${user.uid}`)),
      ]);
      if (JSON.stringify(latestInvite.data()) === JSON.stringify(observedInvite)
        && latestMembership.exists() === observedMembership) throw error;
    }
  }
}

export async function setInviteStatus(inviteId: string, status: Invite['status']): Promise<void> {
  await updateDoc(doc(database(), 'invites', inviteId), { status, updatedAt: serverTimestamp() });
}
export const revokeInvite = (inviteId: string) => setInviteStatus(inviteId, 'revoked');
