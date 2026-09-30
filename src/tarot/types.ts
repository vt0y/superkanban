import type { Timestamp } from 'firebase/firestore';
import type { Locale } from '@/types';
import type { TarotCategory, TarotPosition } from './deck';

export interface TarotSelectedCard {
  id: string;
  position: TarotPosition;
  reversed: boolean;
  nameTh: string;
  nameEn: string;
}

export interface TarotSession {
  sessionId: string;
  deckSize: 78;
  expiresAt: string;
}

export interface TarotReveal {
  cards: TarotSelectedCard[];
  readingMarkdown: string;
  requestId: string;
}

export interface TarotReading extends TarotReveal {
  id: string;
  schemaVersion: 1;
  category: TarotCategory;
  question: string;
  locale: Locale;
  createdBy: string;
  createdAt?: Timestamp;
}

export interface TarotApiErrorBody {
  error?: { code?: string; message?: string; retryable?: boolean };
}
