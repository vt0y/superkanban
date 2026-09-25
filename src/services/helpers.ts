import type { User } from 'firebase/auth';
import {
  serverTimestamp,
  type DocumentData,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Activity } from '@/types';

export function database(): Firestore {
  if (!db) throw new Error('FIREBASE_NOT_CONFIGURED');
  return db;
}

export function withId<T>(snapshot: { id: string; data(): DocumentData }): T {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

export function activityData(
  user: User,
  type: string,
  messageTh: string,
  messageEn: string,
  targetId: string,
): Omit<Activity, 'id'> {
  return {
    type,
    messageTh,
    messageEn,
    actorUid: user.uid,
    actorName: user.displayName || user.email || 'User',
    targetId,
    createdAt: serverTimestamp() as Timestamp,
  };
}

export const BATCH_CHUNK = 450;
export type ActivityInput = { type: string; th: string; en: string };
