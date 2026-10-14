import { collection, doc, documentId, getDocs, getCountFromServer, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, updateDoc, where, type QueryConstraint } from 'firebase/firestore';
import { auth } from '@/config/firebase';
import type { AccountStatus, Milestone, Project, SiteRole, Task, TaskStatus, UserProfile } from '@/types';
import { OPEN_STATUSES } from '@/utils/project-summary';
import { database, withId } from './helpers';
import { FIRESTORE_DISJUNCTION_LIMIT } from '@/config/constants';

export interface AdminUser extends UserProfile { kind: 'user'; siteRole: SiteRole | null }
export interface AdminProject extends Project { kind: 'project'; ownerName: string; ownerEmail: string }
export interface AdminPageResult<T> { items: T[]; nextCursor: string | null; hasMore: boolean }

async function loadPage<T>(path: string | string[], afterId?: string, filters: QueryConstraint[] = [], pageSize = 50): Promise<AdminPageResult<T>> {
  const [root, ...segments] = typeof path === 'string' ? [path] : path;
  const constraints = [...filters, orderBy(documentId()), ...(afterId ? [startAfter(afterId)] : []), limit(pageSize + 1)];
  const snapshot = await getDocs(query(collection(database(), root, ...segments), ...constraints));
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
  await Promise.all(Array.from({ length: Math.ceil(ids.length / FIRESTORE_DISJUNCTION_LIMIT) }, async (_, index) => {
    const snapshot = await getDocs(query(collection(database(), 'users'), where(documentId(), 'in', ids.slice(index * FIRESTORE_DISJUNCTION_LIMIT, index * FIRESTORE_DISJUNCTION_LIMIT + FIRESTORE_DISJUNCTION_LIMIT))));
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

export const ADMIN_COUNT_CAP = 5000;
export const ADMIN_CACHE_TTL_MS = 60_000;
export type AdminOpenStatus = (typeof OPEN_STATUSES)[number];
export interface AdminCount { value: number; capped: boolean }
export interface AdminProjectCounts { open: Record<AdminOpenStatus, AdminCount>; done: AdminCount; milestones: AdminCount; loadedAt: number }

// Project inspection is on demand and throttled: repeat requests within the TTL reuse the result, failures are dropped.
const inspections = new Map<string, { at: number; request: Promise<unknown> }>();
function throttled<T>(key: string, load: () => Promise<T>): Promise<T> {
  const scoped = `${auth?.currentUser?.uid ?? ''}:${key}`;
  const now = Date.now();
  inspections.forEach((entry, id) => { if (now - entry.at >= ADMIN_CACHE_TTL_MS) inspections.delete(id); });
  const existing = inspections.get(scoped);
  if (existing) return existing.request as Promise<T>;
  const request = load();
  inspections.set(scoped, { at: now, request });
  request.catch(() => { if (inspections.get(scoped)?.request === request) inspections.delete(scoped); });
  return request;
}
export function clearAdminInspectionCache() { inspections.clear(); }

/** Count aggregations bill about one read per 1,000 matches; the limit caps each query regardless of project size. */
async function cappedCount(path: string[], ...filters: QueryConstraint[]): Promise<AdminCount> {
  const [root, ...segments] = path;
  const counted = await getCountFromServer(query(collection(database(), root, ...segments), ...filters, limit(ADMIN_COUNT_CAP + 1)));
  const value = counted.data().count;
  return { value: Math.min(value, ADMIN_COUNT_CAP), capped: value > ADMIN_COUNT_CAP };
}

/** Counts real work items; the member-written summary is never read. */
export function loadAdminProjectCounts(projectId: string): Promise<AdminProjectCounts> {
  return throttled(`counts:${projectId}`, async () => {
    const tasks = ['projects', projectId, 'tasks'];
    const [open, done, milestones] = await Promise.all([
      Promise.all(OPEN_STATUSES.map((status) => cappedCount(tasks, where('status', '==', status)))),
      cappedCount(tasks, where('status', '==', 'done')),
      cappedCount(['projects', projectId, 'milestones']),
    ]);
    return { open: Object.fromEntries(OPEN_STATUSES.map((status, index) => [status, open[index]])) as Record<AdminOpenStatus, AdminCount>, done, milestones, loadedAt: Date.now() };
  });
}

export function loadAdminProjectTasks(projectId: string, afterId?: string, status?: TaskStatus): Promise<AdminPageResult<Task>> {
  return throttled(`tasks:${projectId}:${status ?? ''}:${afterId ?? ''}`, () => loadPage<Task>(['projects', projectId, 'tasks'], afterId, status ? [where('status', '==', status)] : []));
}

export function loadAdminProjectMilestones(projectId: string, afterId?: string): Promise<AdminPageResult<Milestone>> {
  return throttled(`milestones:${projectId}:${afterId ?? ''}`, () => loadPage<Milestone>(['projects', projectId, 'milestones'], afterId));
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
