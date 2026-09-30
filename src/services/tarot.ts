import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { database, withId } from './helpers';
import type { Locale } from '@/types';
import type { TarotCategory } from '@/tarot/deck';
import type { TarotApiErrorBody, TarotReading, TarotReveal, TarotSession } from '@/tarot/types';

const apiBase = ((import.meta.env.VITE_TAROT_API_URL as string | undefined) ?? '').replace(/\/$/, '');
const HISTORY_LIMIT = 20;

export class TarotApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function tarotRequest<T>(user: User, path: string, body: object): Promise<T> {
  if (!apiBase) throw new TarotApiError('ยังไม่ได้ตั้งค่า Tarot API', 'NOT_CONFIGURED', 0, false);
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Accept-Language': 'locale' in body && body.locale === 'th' ? 'th' : 'en',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new TarotApiError('เชื่อมต่อห้องพยากรณ์ไม่ได้ กรุณาลองใหม่', 'NETWORK_ERROR', 0, true);
  }
  const payload = await response.json().catch(() => ({})) as T & TarotApiErrorBody;
  if (!response.ok) {
    throw new TarotApiError(
      payload.error?.message || 'การพยากรณ์ขัดข้อง กรุณาลองใหม่',
      payload.error?.code || 'API_ERROR',
      response.status,
      Boolean(payload.error?.retryable),
    );
  }
  return payload;
}

export function createTarotSession(
  user: User,
  category: TarotCategory,
  question: string,
  locale: Locale,
): Promise<TarotSession> {
  return tarotRequest(user, '/v1/tarot/sessions', { category, question: question.trim(), locale });
}

export function revealTarotSession(user: User, sessionId: string, selectedIndexes: number[]): Promise<TarotReveal> {
  return tarotRequest(user, `/v1/tarot/sessions/${encodeURIComponent(sessionId)}/reveal`, { selectedIndexes });
}

function readings(userId: string) {
  return collection(database(), 'users', userId, 'tarotReadings');
}

export async function loadTarotHistory(userId: string): Promise<TarotReading[]> {
  const snapshot = await getDocs(query(readings(userId), orderBy('createdAt', 'desc'), limit(HISTORY_LIMIT)));
  return snapshot.docs.map((item) => withId<TarotReading>(item));
}

export async function saveTarotReading(
  userId: string,
  input: Omit<TarotReading, 'id' | 'schemaVersion' | 'createdBy' | 'createdAt'>,
): Promise<string> {
  const created = await addDoc(readings(userId), {
    ...input,
    schemaVersion: 1,
    createdBy: userId,
    createdAt: serverTimestamp(),
  });
  const overflow = await getDocs(query(readings(userId), orderBy('createdAt', 'desc'), limit(HISTORY_LIMIT + 25)));
  const stale = overflow.docs.slice(HISTORY_LIMIT);
  if (stale.length) {
    const batch = writeBatch(database());
    stale.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  return created.id;
}

export function deleteTarotReading(userId: string, readingId: string): Promise<void> {
  return deleteDoc(doc(database(), 'users', userId, 'tarotReadings', readingId));
}

export async function clearTarotHistory(userId: string): Promise<void> {
  const snapshot = await getDocs(query(readings(userId), limit(HISTORY_LIMIT + 25)));
  if (!snapshot.size) return;
  const batch = writeBatch(database());
  snapshot.docs.forEach((item) => batch.delete(item.ref));
  await batch.commit();
}
