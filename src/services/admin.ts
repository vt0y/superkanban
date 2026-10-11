import { collection, doc, documentId, getDocs, limit, orderBy, query, serverTimestamp, startAfter, updateDoc, where } from 'firebase/firestore';
import type { AccountStatus, Project, SiteRole, UserProfile } from '@/types';
import { database, withId } from './helpers';

export interface AdminUser extends UserProfile { kind: 'user'; siteRole: SiteRole | null }
export interface AdminProject extends Project { kind: 'project'; ownerName: string; ownerEmail: string }
export interface AdminPageResult<T> { items: T[]; nextCursor: string | null; hasMore: boolean }

async function loadPage<T>(path: string, afterId?: string, pageSize = 50): Promise<AdminPageResult<T>> {
  const constraints = [orderBy(documentId()), ...(afterId ? [startAfter(afterId)] : []), limit(pageSize + 1)];
  const snapshot = await getDocs(query(collection(database(), path), ...constraints));
  const docs = snapshot.docs.slice(0, pageSize);
  return { items: docs.map((item) => ({ ...item.data(), id: item.id }) as T), nextCursor: docs.at(-1)?.id ?? null, hasMore: snapshot.docs.length > pageSize };
}

export async function loadAdminUsers(afterId?: string): Promise<AdminPageResult<AdminUser>> {
  const [page, roles] = await Promise.all([
    loadPage<UserProfile>('users', afterId), getDocs(collection(database(), 'siteAdmins')),
  ]);
  const staff = new Map(roles.docs.map((item) => [item.id, item.data().role]));
  return { ...page, items: page.items.map((user) => {
    const role = staff.get(user.id);
    return { ...user, kind: 'user', siteRole: role === 'owner' || role === 'admin' ? role : null };
  }) };
}

export async function loadAdminProjects(afterId?: string): Promise<AdminPageResult<AdminProject>> {
  const page = await loadPage<Project>('projects', afterId);
  const ids = [...new Set(page.items.map((item) => item.ownerId))];
  const owners = new Map<string, UserProfile>();
  await Promise.all(Array.from({ length: Math.ceil(ids.length / 30) }, async (_, index) => {
    const snapshot = await getDocs(query(collection(database(), 'users'), where(documentId(), 'in', ids.slice(index * 30, index * 30 + 30))));
    snapshot.docs.forEach((item) => owners.set(item.id, withId<UserProfile>(item)));
  }));
  return { ...page, items: page.items.map((project) => ({ ...project, kind: 'project', ownerName: owners.get(project.ownerId)?.displayName || project.ownerId, ownerEmail: owners.get(project.ownerId)?.email || '' })) };
}

/** Rules validate caller and protect site staff, even if the UI's role snapshot is stale. */
export async function setAdminAccountStatus(uid: string, status: AccountStatus, actorUid: string): Promise<void> {
  if (uid === actorUid) throw new Error('CANNOT_MODIFY_SELF');
  await updateDoc(doc(database(), 'users', uid), {
    accountStatus: status, statusUpdatedAt: serverTimestamp(), statusUpdatedBy: actorUid,
  });
}

export async function setAdminProjectArchived(projectId: string, archived: boolean): Promise<void> {
  await updateDoc(doc(database(), 'projects', projectId), { archived, updatedAt: serverTimestamp() });
}
