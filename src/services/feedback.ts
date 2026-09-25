import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  type QueryConstraint,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { FeedbackCategory, SiteFeedback } from '@/types';
import { database, withId } from './helpers';

export interface SubscribeSiteFeedbackOptions {
  status?: SiteFeedback['status'];
  limitCount?: number;
}
export interface FeedbackCursor { createdAt: Timestamp; id: string }
export interface FeedbackPage { items: SiteFeedback[]; nextCursor: FeedbackCursor | null; hasMore: boolean }

function feedbackConstraints(userId: string, admin: boolean, status?: SiteFeedback['status']): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (!admin) constraints.push(where('userId', '==', userId));
  if (status) constraints.push(where('status', '==', status));
  return constraints;
}

export async function submitSiteFeedback(
  user: User,
  input: { title: string; body: string; category: FeedbackCategory; page: string },
): Promise<void> {
  await addDoc(collection(database(), 'siteFeedback'), {
    ...input,
    status: 'open',
    adminReply: '',
    userId: user.uid,
    userName: user.displayName || 'User',
    userEmail: user.email || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Site admins receive every submission; everyone else only their own (the rules enforce the same split). */
export function subscribeSiteFeedback(
  userId: string,
  admin: boolean,
  callback: (items: SiteFeedback[]) => void,
  onError?: (error: Error) => void,
  options?: SubscribeSiteFeedbackOptions,
): Unsubscribe {
  const constraints = feedbackConstraints(userId, admin, options?.status);
  constraints.push(orderBy('createdAt', 'desc'), orderBy(documentId()), limit(options?.limitCount ?? 50));

  const source = constraints.length > 0
    ? query(collection(database(), 'siteFeedback'), ...constraints)
    : collection(database(), 'siteFeedback');

  return onSnapshot(
    source,
    (snapshot) => {
      callback(
        snapshot.docs
          .map((item) => withId<SiteFeedback>(item))
          .sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now())),
      );
    },
    onError,
  );
}

export async function loadSiteFeedbackPage(
  userId: string,
  admin: boolean,
  cursor: FeedbackCursor,
  pageSize = 50,
  status?: SiteFeedback['status'],
): Promise<FeedbackPage> {
  const constraints = feedbackConstraints(userId, admin, status);
  constraints.push(orderBy('createdAt', 'desc'), orderBy(documentId()), startAfter(cursor.createdAt, cursor.id), limit(pageSize + 1));
  const snapshot = await getDocs(query(collection(database(), 'siteFeedback'), ...constraints));
  const docs = snapshot.docs.slice(0, pageSize);
  return {
    items: docs.map((item) => withId<SiteFeedback>(item)),
    nextCursor: docs.length ? { createdAt: docs.at(-1)!.get('createdAt') as Timestamp, id: docs.at(-1)!.id } : null,
    hasMore: snapshot.docs.length > pageSize,
  };
}

export async function updateSiteFeedback(
  id: string,
  values: Partial<Pick<SiteFeedback, 'status' | 'adminReply'>>,
): Promise<void> {
  await updateDoc(doc(database(), 'siteFeedback', id), { ...values, updatedAt: serverTimestamp() });
}

export async function deleteSiteFeedback(id: string): Promise<void> {
  await deleteDoc(doc(database(), 'siteFeedback', id));
}
