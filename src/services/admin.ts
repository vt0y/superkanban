import { collection, doc, documentId, getDoc, getDocs, getCountFromServer, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, updateDoc, where } from 'firebase/firestore';
import type { AccountStatus, Project, ProjectSummary, SiteRole, UserProfile } from '@/types';
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

export async function setAdminProjectArchived(projectId: string, archived: boolean, actorUid: string, reason = ''): Promise<void> {
  const trimmed = reason.trim();
  if (archived && (!trimmed || trimmed.length > 1000)) throw new Error('MODERATION_REASON_REQUIRED');
  await updateDoc(doc(database(), 'projects', projectId), {
    archived, moderationArchived: archived, moderationReason: archived ? trimmed : '',
    moderationUpdatedBy: actorUid, moderationUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}

export interface AdminOverviewCounts {
  users: number;
  suspendedUsers: number;
  projects: number;
  archivedProjects: number;
  feedback: number;
}

export async function loadAdminOverview(): Promise<AdminOverviewCounts> {
  const store = database();
  const users = collection(store, 'users');
  const projects = collection(store, 'projects');
  const counts = await Promise.all([
    getCountFromServer(users), getCountFromServer(query(users, where('accountStatus', '==', 'suspended'))),
    getCountFromServer(projects), getCountFromServer(query(projects, where('archived', '==', true))),
    getCountFromServer(collection(store, 'siteFeedback')),
  ]);
  return { users: counts[0].data().count, suspendedUsers: counts[1].data().count, projects: counts[2].data().count, archivedProjects: counts[3].data().count, feedback: counts[4].data().count };
}

/** Read the member-maintained summary only; never rebuild or scan private collections. */
export async function loadAdminProjectSummary(projectId: string): Promise<ProjectSummary | null> {
  const snapshot = await getDoc(doc(database(), 'projects', projectId, 'summary', 'main'));
  return snapshot.exists() ? snapshot.data() as ProjectSummary : null;
}

/** Rules recheck ownership, target status, and protected roles at commit time. */
export async function setAdminStaffRole(uid: string, grant: boolean, actorUid: string): Promise<void> {
  if (uid === actorUid) throw new Error('CANNOT_MODIFY_SELF');
  const store = database();
  const ref = doc(store, 'siteAdmins', uid);
  const profileRef = doc(store, 'users', uid);
  await runTransaction(store, async (transaction) => {
    const [role, profile] = await Promise.all([transaction.get(ref), transaction.get(profileRef)]);
    if (!profile.exists()) throw new Error('USER_NOT_FOUND');
    if (role.exists() && role.data().role !== 'admin') throw new Error('PROTECTED_ROLE');
    if (grant) {
      if (profile.data().accountStatus === 'suspended') throw new Error('USER_SUSPENDED');
      if (!role.exists()) {
        transaction.set(ref, { role: 'admin', grantedBy: actorUid, grantedAt: serverTimestamp() });
        transaction.update(profileRef, { staffUpdatedBy: actorUid, staffUpdatedAt: serverTimestamp() });
      }
    } else if (role.exists()) {
      transaction.delete(ref);
      transaction.update(profileRef, { staffUpdatedBy: actorUid, staffUpdatedAt: serverTimestamp() });
    }
  });
}
