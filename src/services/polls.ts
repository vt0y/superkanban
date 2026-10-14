import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Poll, PollVote } from '@/types';
import { database } from './helpers';
import { subscribeProjectQuery, type CollectionCursor, type CollectionPage } from './work-items';
import { FIRESTORE_DISJUNCTION_LIMIT } from '@/config/constants';

export function subscribeOpenPolls(projectId: string, callback: (polls: Poll[]) => void): Unsubscribe {
  return subscribeProjectQuery(projectId, 'polls', 'open', [where('closed', '==', false)], callback);
}

export function subscribeRecentClosedPolls(projectId: string, callback: (polls: Poll[]) => void, pageSize = 50): Unsubscribe {
  return subscribeProjectQuery(projectId, 'polls', `closed:${pageSize}`, [
    where('closed', '==', true), orderBy('updatedAt', 'desc'), orderBy(documentId()), limit(pageSize),
  ], callback);
}

export async function loadClosedPollsPage(projectId: string, cursor: CollectionCursor, pageSize = 50): Promise<CollectionPage<Poll>> {
  const snapshot = await getDocs(query(collection(database(), 'projects', projectId, 'polls'),
    where('closed', '==', true), orderBy('updatedAt', 'desc'), orderBy(documentId()),
    startAfter(cursor.value, cursor.id), limit(pageSize + 1)));
  const docs = snapshot.docs.slice(0, pageSize);
  return {
    items: docs.map((item) => ({ id: item.id, ...item.data() }) as Poll),
    nextCursor: docs.length ? { value: docs.at(-1)!.get('updatedAt'), id: docs.at(-1)!.id } : null,
    hasMore: snapshot.docs.length > pageSize,
  };
}

/** Firestore disjunction filters accept at most 30 values, so every listener is deliberately chunked. */
export function subscribeVotesForPolls(projectId: string, pollIds: string[], callback: (votes: PollVote[]) => void): Unsubscribe {
  const chunks: string[][] = [];
  for (let index = 0; index < pollIds.length; index += FIRESTORE_DISJUNCTION_LIMIT) chunks.push(pollIds.slice(index, index + FIRESTORE_DISJUNCTION_LIMIT));
  if (!chunks.length) { callback([]); return () => undefined; }
  const values = new Map<number, PollVote[]>();
  const emit = () => callback([...values.values()].flat());
  const stops = chunks.map((ids, index) => subscribeProjectQuery<PollVote>(
    projectId, 'pollVotes', `pollIds:${[...ids].sort().join(',')}`, [where('pollId', 'in', ids)],
    (items) => { values.set(index, items); emit(); },
  ));
  return () => stops.forEach((stop) => stop());
}

export async function castVote(projectId: string, pollId: string, userId: string, optionIds: string[]): Promise<void> {
  const ref = doc(database(), 'projects', projectId, 'pollVotes', `${pollId}_${userId}`);
  if (optionIds.length) await setDoc(ref, { pollId, userId, optionIds, updatedAt: serverTimestamp() });
  else await deleteDoc(ref);
}
