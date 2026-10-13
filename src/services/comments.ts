import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Comment, CommentTarget } from '@/types';
import { database, withId } from './helpers';
import { safePhotoURL } from '@/utils/photo-url';

export function subscribeComments(
  projectId: string,
  targetId: string,
  callback: (items: Comment[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(database(), 'projects', projectId, 'comments'), where('targetId', '==', targetId)),
    (snapshot) => {
      callback(
        snapshot.docs
          .map((item) => withId<Comment>(item))
          .sort((a, b) => (a.createdAt?.toMillis() ?? Date.now()) - (b.createdAt?.toMillis() ?? Date.now())),
      );
    },
  );
}

export async function addComment(
  projectId: string,
  targetType: CommentTarget,
  targetId: string,
  body: string,
  user: User,
): Promise<void> {
  await addDoc(collection(database(), 'projects', projectId, 'comments'), {
    targetType,
    targetId,
    body,
    authorName: user.displayName || user.email || 'User',
    authorPhoto: safePhotoURL(user.photoURL),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
