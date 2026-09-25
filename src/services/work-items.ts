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
  startAfter,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { activityData, database, withId, BATCH_CHUNK, type ActivityInput } from './helpers';

interface SharedSubscription<T = unknown> {
  refCount: number;
  unsubscribeTimer: ReturnType<typeof setTimeout> | null;
  unsubscribeFirestore: Unsubscribe | null;
  listeners: Set<(items: T[]) => void>;
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
): Promise<CollectionPage<T>> {
  const constraints: QueryConstraint[] = [orderBy(orderField, 'desc'), orderBy(documentId())];
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

export function subscribeProjectCollection<T>(
  projectId: string,
  name: string,
  callback: (items: T[]) => void,
): Unsubscribe {
  return subscribeProjectQuery(projectId, name, 'all', [], callback);
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
): Unsubscribe {
  const key = projectQueryCacheKey(projectId, name, scopeKey);
  let sub = subscriptionRegistry.get(key) as SharedSubscription<T> | undefined;

  if (!sub) {
    sub = {
      refCount: 0,
      unsubscribeTimer: null,
      unsubscribeFirestore: null,
      listeners: new Set(),
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
    );
  }

  return () => {
    if (!sub) return;
    sub.listeners.delete(callback);
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
  const batch = writeBatch(store);
  batch.update(doc(store, 'projects', projectId, collectionName, itemId), { ...values, updatedAt: serverTimestamp() });
  if (user && activity) {
    const activityRef = doc(collection(store, 'projects', projectId, 'activities'));
    batch.set(activityRef, activityData(user, activity.type, activity.th, activity.en, itemId));
  }
  await batch.commit();
}

export async function deleteWorkItem(projectId: string, collectionName: string, itemId: string): Promise<void> {
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
  for (let start = 0; start < itemIds.length; start += BATCH_CHUNK) {
    const batch = writeBatch(store);
    itemIds.slice(start, start + BATCH_CHUNK).forEach((id) => {
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
  for (let start = 0; start < itemIds.length; start += BATCH_CHUNK) {
    const batch = writeBatch(store);
    itemIds.slice(start, start + BATCH_CHUNK).forEach((id) =>
      batch.delete(doc(store, 'projects', projectId, collectionName, id)),
    );
    await batch.commit();
  }
}
