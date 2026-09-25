import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { ProjectChatMessage, UserProfile } from '@/types';
import { database, withId } from './helpers';

export function subscribeChatMessages(
  projectId: string,
  callback: (items: ProjectChatMessage[]) => void,
  onError?: (error: Error) => void,
  limitCount = 40,
): Unsubscribe {
  const source = query(
    collection(database(), 'projects', projectId, 'chatMessages'),
    orderBy('createdAt', 'desc'),
    limit(limitCount),
  );
  return onSnapshot(
    source,
    (snapshot) => {
      callback(snapshot.docs.map((item) => withId<ProjectChatMessage>(item)).reverse());
    },
    onError,
  );
}

export async function sendChatMessage(
  projectId: string,
  body: string,
  sender: Pick<UserProfile, 'displayName' | 'photoURL'> & { id: string },
): Promise<void> {
  await addDoc(collection(database(), 'projects', projectId, 'chatMessages'), {
    body: body.trim(),
    authorName: sender.displayName,
    authorPhoto: sender.photoURL || '',
    createdBy: sender.id,
    createdAt: serverTimestamp(),
  });
}
