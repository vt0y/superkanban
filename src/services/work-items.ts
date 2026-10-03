import type { User } from 'firebase/auth';
import type { Activity } from '@/types';
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  startAfter,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Milestone, Task } from '@/types';
import { applyMilestoneChanges, applyTaskChanges, milestoneAffectsSummary, taskAffectsSummary } from '@/utils/project-summary';
import { readSummaryForTransaction, withProjectSummaryRetry, writeSummaryInTransaction } from './project-summary';
import { activityData, database, withId, BATCH_CHUNK, type ActivityInput } from './helpers';

interface SharedSubscription<T = unknown> {
  refCount: number;
  unsubscribeTimer: ReturnType<typeof setTimeout> | null;
  unsubscribeFirestore: Unsubscribe | null;
  listeners: Set<(items: T[]) => void>;
  errorListeners: Set<(error: Error) => void>;
  latestData: T[] | null;
}

const subscriptionRegistry = new Map<string, SharedSubscription>();
const KEEP_ALIVE_MS = 30000;
export const projectQueryCacheKey = (projectId: string, name: string, scopeKey: string) => `${projectId}:${name}:${scopeKey}`;

export interface CollectionCursor { value: Timestamp; id: string }
export interface CollectionPage<T> { items: T[]; nextCursor: CollectionCursor | null; hasMore: boolean }

export async function loadProjectCollectionPage<T>(
  projectId: string,
  name: string,
  cursor: CollectionCursor | null,
  pageSize = 50,
  orderField = 'updatedAt',
  filters: QueryConstraint[] = [],
): Promise<CollectionPage<T>> {
  const constraints: QueryConstraint[] = [...filters, orderBy(orderField, 'desc'), orderBy(documentId())];
  if (cursor) constraints.push(startAfter(cursor.value, cursor.id));
  constraints.push(limit(pageSize + 1));
  const snapshot = await getDocs(query(collection(database(), 'projects', projectId, name), ...constraints));
  const docs = snapshot.docs.slice(0, pageSize);
  return {
    items: docs.map((item) => withId<T>(item)),
    nextCursor: docs.length ? { value: docs.at(-1)!.get(orderField) as Timestamp, id: docs.at(-1)!.id } : null,
    hasMore: snapshot.docs.length > pageSize,
  };
}

/** Live documents for a known id list, split below Firestore's 30-value `in` limit. */
export function subscribeProjectDocsByIds<T>(projectId: string, name: string, ids: string[], callback: (items: T[]) => void): Unsubscribe {
  const unique = [...new Set(ids)].sort();
  if (!unique.length) { callback([]); return () => undefined; }
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += 30) chunks.push(unique.slice(start, start + 30));
  const values = new Map<number, T[]>();
  const emit = () => { if (values.size === chunks.length) callback([...values.values()].flat()); };
  const stops = chunks.map((chunk, index) => onSnapshot(query(collection(database(), 'projects', projectId, name), where(documentId(), 'in', chunk)), (snapshot) => {
    values.set(index, snapshot.docs.map((item) => withId<T>(item)));
    emit();
  }));
  return () => stops.forEach((stop) => stop());
}

export function subscribeProjectCollection<T>(
  projectId: string,
  name: string,
  callback: (items: T[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return subscribeProjectQuery(projectId, name, 'all', [], callback, onError);
}

/**
 * Shares only identical Firestore queries. `scopeKey` must describe every
 * constraint (including limits/cursors) so differently scoped screens can
 * never receive each other's cached result.
 */
export function subscribeProjectQuery<T>(
  projectId: string,
  name: string,
  scopeKey: string,
  constraints: QueryConstraint[],
  callback: (items: T[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const key = projectQueryCacheKey(projectId, name, scopeKey);
  let sub = subscriptionRegistry.get(key) as SharedSubscription<T> | undefined;

  if (!sub) {
    sub = {
      refCount: 0,
      unsubscribeTimer: null,
      unsubscribeFirestore: null,
      listeners: new Set(),
      errorListeners: new Set(),
      latestData: null,
    };
    subscriptionRegistry.set(key, sub as SharedSubscription);
  }

  if (sub.unsubscribeTimer) {
    clearTimeout(sub.unsubscribeTimer);
    sub.unsubscribeTimer = null;
  }

  sub.refCount += 1;
  sub.listeners.add(callback);
  if (onError) sub.errorListeners.add(onError);

  if (sub.latestData !== null) {
    try {
      callback(sub.latestData);
    } catch (err) {
      console.error('Error invoking cached callback', err);
    }
  }

  if (!sub.unsubscribeFirestore) {
    sub.unsubscribeFirestore = onSnapshot(
      query(collection(database(), 'projects', projectId, name), ...constraints),
      (snapshot) => {
        const items = snapshot.docs.map((item) => withId<T>(item));
        if (sub) {
          sub.latestData = items;
          sub.listeners.forEach((listener) => {
            try {
              listener(items);
            } catch (err) {
              console.error('Error in subscription listener', err);
            }
          });
        }
      },
      (error) => {
        // Firestore ends a listener after an error: forget it so the next subscriber retries.
        if (sub) {
          sub.unsubscribeFirestore = null;
          sub.errorListeners.forEach((listener) => listener(error));
        }
        if (subscriptionRegistry.get(key) === sub) subscriptionRegistry.delete(key);
      },
    );
  }

  return () => {
    if (!sub) return;
    sub.listeners.delete(callback);
    if (onError) sub.errorListeners.delete(onError);
    sub.refCount = Math.max(0, sub.refCount - 1);

    if (sub.refCount === 0) {
      sub.unsubscribeTimer = setTimeout(() => {
        if (sub && sub.refCount === 0) {
          if (sub.unsubscribeFirestore) {
            sub.unsubscribeFirestore();
            sub.unsubscribeFirestore = null;
          }
          subscriptionRegistry.delete(key);
        }
      }, KEEP_ALIVE_MS);
    }
  };
}

export function subscribeRecentActivities(
  projectId: string,
  limitCount = 8,
  callback: (items: Activity[]) => void,
): Unsubscribe {
  const q = query(
    collection(database(), 'projects', projectId, 'activities'),
    orderBy('createdAt', 'desc'),
    limit(limitCount),
  );
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((item) => withId<Activity>(item)));
  });
}

export async function createWorkItem(
  projectId: string,
  collectionName: string,
  values: DocumentData,
  user: User,
  activity: { type: string; th: string; en: string },
): Promise<string> {
  const store = database();
  const itemRef = doc(collection(store, 'projects', projectId, collectionName));
  const activityRef = doc(collection(store, 'projects', projectId, 'activities'));
  if (collectionName === 'tasks' || collectionName === 'milestones') {
    const after = { id: itemRef.id, ...values, createdBy: user.uid } as unknown as Task & Milestone;
    await runTrackedTransaction(projectId, async () => runTransaction(store, async (transaction) => {
      const summary = await readSummaryForTransaction(transaction, store, projectId);
      const next = collectionName === 'tasks'
        ? applyTaskChanges(summary, [{ before: null, after: after as Task }])
        : applyMilestoneChanges(summary, [{ before: null, after: after as Milestone }]);
      transaction.set(itemRef, { ...values, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(activityRef, activityData(user, activity.type, activity.th, activity.en, itemRef.id));
      writeSummaryInTransaction(transaction, store, projectId, next);
    }));
    return itemRef.id;
  }
  const batch = writeBatch(store);
  batch.set(itemRef, { ...values, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(activityRef, activityData(user, activity.type, activity.th, activity.en, itemRef.id));
  await batch.commit();
  return itemRef.id;
}

export async function updateWorkItem(
  projectId: string,
  collectionName: string,
  itemId: string,
  values: DocumentData,
  user?: User,
  activity?: { type: string; th: string; en: string },
): Promise<void> {
  const store = database();
  if (collectionName === 'tasks' || collectionName === 'milestones') {
    const itemRef = doc(store, 'projects', projectId, collectionName, itemId);
    await runTrackedTransaction(projectId, async () => runTransaction(store, async (transaction) => {
      const [snapshot, summary] = await Promise.all([
        transaction.get(itemRef),
        readSummaryForTransaction(transaction, store, projectId),
      ]);
      if (!snapshot.exists()) throw new Error('WORK_ITEM_NOT_FOUND');
      const before = { id: snapshot.id, ...snapshot.data() } as DocumentData;
      const after = { ...before, ...values, id: itemId } as DocumentData;
      transaction.update(itemRef, { ...values, updatedAt: serverTimestamp() });
      if (user && activity) {
        const activityRef = doc(collection(store, 'projects', projectId, 'activities'));
        transaction.set(activityRef, activityData(user, activity.type, activity.th, activity.en, itemId));
      }
      if (collectionName === 'tasks' && taskAffectsSummary(before as Task, after as Task)) {
        writeSummaryInTransaction(transaction, store, projectId, applyTaskChanges(summary, [{ before: before as Task, after: after as Task }]));
      } else if (collectionName === 'milestones' && milestoneAffectsSummary(before as Milestone, after as Milestone)) {
        writeSummaryInTransaction(transaction, store, projectId, applyMilestoneChanges(summary, [{ before: before as Milestone, after: after as Milestone }]));
      }
    }));
    return;
  }
  const batch = writeBatch(store);
  batch.update(doc(store, 'projects', projectId, collectionName, itemId), { ...values, updatedAt: serverTimestamp() });
  if (user && activity) {
    const activityRef = doc(collection(store, 'projects', projectId, 'activities'));
    batch.set(activityRef, activityData(user, activity.type, activity.th, activity.en, itemId));
  }
  await batch.commit();
}

export async function deleteWorkItem(projectId: string, collectionName: string, itemId: string): Promise<void> {
  if (collectionName === 'tasks' || collectionName === 'milestones') {
    const store = database();
    const itemRef = doc(store, 'projects', projectId, collectionName, itemId);
    await runTrackedTransaction(projectId, async () => runTransaction(store, async (transaction) => {
      const [snapshot, summary] = await Promise.all([transaction.get(itemRef), readSummaryForTransaction(transaction, store, projectId)]);
      if (!snapshot.exists()) return;
      const before = { id: snapshot.id, ...snapshot.data() } as unknown as Task & Milestone;
      transaction.delete(itemRef);
      const next = collectionName === 'tasks'
        ? applyTaskChanges(summary, [{ before: before as Task, after: null }])
        : applyMilestoneChanges(summary, [{ before: before as Milestone, after: null }]);
      writeSummaryInTransaction(transaction, store, projectId, next);
    }));
    return;
  }
  await deleteDoc(doc(database(), 'projects', projectId, collectionName, itemId));
}

export async function bulkUpdateWorkItems(
  projectId: string,
  collectionName: string,
  itemIds: string[],
  values: DocumentData | ((id: string) => DocumentData),
  user?: User,
  activity?: ActivityInput,
): Promise<void> {
  const store = database();
  const chunkSize = collectionName === 'tasks' || collectionName === 'milestones' ? 200 : BATCH_CHUNK;
  for (let start = 0; start < itemIds.length; start += chunkSize) {
    const ids = itemIds.slice(start, start + chunkSize);
    if (collectionName === 'tasks' || collectionName === 'milestones') {
      await runTrackedTransaction(projectId, async () => runTransaction(store, async (transaction) => {
        const refs = ids.map((id) => doc(store, 'projects', projectId, collectionName, id));
        const [snapshots, summary] = await Promise.all([
          Promise.all(refs.map((ref) => transaction.get(ref))),
          readSummaryForTransaction(transaction, store, projectId),
        ]);
        const changes = snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => {
          const before = { id: snapshot.id, ...snapshot.data() } as DocumentData;
          const patch = typeof values === 'function' ? values(snapshot.id) : values;
          return { before, after: { ...before, ...patch, id: snapshot.id } as DocumentData, patch, ref: snapshot.ref };
        });
        changes.forEach(({ ref, patch }) => transaction.update(ref, { ...patch, updatedAt: serverTimestamp() }));
        if (start === 0 && user && activity) transaction.set(doc(collection(store, 'projects', projectId, 'activities')), activityData(user, activity.type, activity.th, activity.en, itemIds[0] || ''));
        if (collectionName === 'tasks') {
          const material = changes.filter(({ before, after }) => taskAffectsSummary(before as Task, after as Task));
          if (material.length) writeSummaryInTransaction(transaction, store, projectId, applyTaskChanges(summary, material as unknown as Array<{ before: Task; after: Task }>));
        } else {
          const material = changes.filter(({ before, after }) => milestoneAffectsSummary(before as Milestone, after as Milestone));
          if (material.length) writeSummaryInTransaction(transaction, store, projectId, applyMilestoneChanges(summary, material as unknown as Array<{ before: Milestone; after: Milestone }>));
        }
      }));
      continue;
    }
    const batch = writeBatch(store);
    ids.forEach((id) => {
      batch.update(doc(store, 'projects', projectId, collectionName, id), {
        ...(typeof values === 'function' ? values(id) : values),
        updatedAt: serverTimestamp(),
      });
    });
    if (start === 0 && user && activity) {
      batch.set(
        doc(collection(store, 'projects', projectId, 'activities')),
        activityData(user, activity.type, activity.th, activity.en, itemIds[0] || ''),
      );
    }
    await batch.commit();
  }
}

export async function bulkDeleteWorkItems(
  projectId: string,
  collectionName: string,
  itemIds: string[],
): Promise<void> {
  const store = database();
  const chunkSize = collectionName === 'tasks' || collectionName === 'milestones' ? 200 : BATCH_CHUNK;
  for (let start = 0; start < itemIds.length; start += chunkSize) {
    const ids = itemIds.slice(start, start + chunkSize);
    if (collectionName === 'tasks' || collectionName === 'milestones') {
      await runTrackedTransaction(projectId, async () => runTransaction(store, async (transaction) => {
        const refs = ids.map((id) => doc(store, 'projects', projectId, collectionName, id));
        const [snapshots, summary] = await Promise.all([
          Promise.all(refs.map((ref) => transaction.get(ref))),
          readSummaryForTransaction(transaction, store, projectId),
        ]);
        const before = snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })) as unknown as Array<Task & Milestone>;
        snapshots.filter((snapshot) => snapshot.exists()).forEach((snapshot) => transaction.delete(snapshot.ref));
        const next = collectionName === 'tasks'
          ? applyTaskChanges(summary, before.map((item) => ({ before: item as Task, after: null })))
          : applyMilestoneChanges(summary, before.map((item) => ({ before: item as Milestone, after: null })));
        if (before.length) writeSummaryInTransaction(transaction, store, projectId, next);
      }));
      continue;
    }
    const batch = writeBatch(store);
    ids.forEach((id) =>
      batch.delete(doc(store, 'projects', projectId, collectionName, id)),
    );
    await batch.commit();
  }
}

async function runTrackedTransaction(projectId: string, operation: () => Promise<void>): Promise<void> {
  await withProjectSummaryRetry(projectId, operation);
}
