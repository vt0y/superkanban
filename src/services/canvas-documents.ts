import { measuredFirestore } from './firestore-diagnostics';
import type { User } from 'firebase/auth';
import { arrayRemove, deleteField, collection, doc, limit, query, serverTimestamp, where, type Unsubscribe } from 'firebase/firestore';
import type { CanvasItem, StickyNote, DocumentCanvasCard, ProjectDocument } from '@/types';
import { normalizeCanvasNote } from '@/utils/canvas-items';
import { BATCH_CHUNK, database } from './helpers';
import { subscribeProjectDocsByIds } from './work-items';

const { runTransaction, getDocsFromServer, updateDoc, writeBatch } = measuredFirestore('canvas-documents');

export async function pinProjectDocuments(projectId: string, documentIds: string[], positions: Array<{ x: number; y: number }>, user: User): Promise<void> {
  const ids = [...new Set(documentIds)];
  if (positions.length !== ids.length || positions.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('INVALID_CARD_POSITIONS');
  // Each create checks a different source document; leave room for rules access calls.
  const chunkSize = 4;
  for (let start = 0; start < ids.length; start += chunkSize) {
    const batch = writeBatch(database());
    ids.slice(start, start + chunkSize).forEach((documentIdValue, offset) => {
      const position = positions[start + offset];
      batch.set(doc(collection(database(), 'projects', projectId, 'stickyNotes')), {
        kind: 'note', content: '', taskId: '', color: '#fef3c7', pinned: false, documentIds: [documentIdValue], x: position.x, y: position.y,
        createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

export async function unpinProjectDocument(projectId: string, cardId: string): Promise<void> {
  const batch = writeBatch(database());
  batch.delete(doc(database(), 'projects', projectId, 'stickyNotes', cardId));
  await batch.commit();
}

/** Call after deleting source metadata: rules then prevent concurrent creation of new copies. */
export async function removeDocumentCanvasCards(projectId: string, documentId: string): Promise<void> {
  for (const [field, operator] of [['documentId', '=='], ['documentIds', 'array-contains']] as const) {
    for (;;) {
      const snapshot = await getDocsFromServer(query(collection(database(), 'projects', projectId, 'stickyNotes'), where(field, operator, documentId), limit(BATCH_CHUNK)));
      if (!snapshot.docs.length) break;
      if (field === 'documentId') {
        await runTransaction(database(), async (transaction) => {
          const current = await Promise.all(snapshot.docs.map((card) => transaction.get(card.ref)));
          current.forEach((card) => {
            if (!card.exists()) return;
            transaction.update(card.ref, card.data().kind === 'document'
              ? { kind: 'note', content: '', taskId: '', documentId: deleteField(), documentIds: [], updatedAt: serverTimestamp() }
              : { documentIds: arrayRemove(documentId), updatedAt: serverTimestamp() });
          });
        });
      } else {
        const batch = writeBatch(database());
        snapshot.docs.forEach((card) => batch.update(card.ref, { documentIds: arrayRemove(documentId), updatedAt: serverTimestamp() }));
        await batch.commit();
      }
    }
  }
}

export class DocumentCardCleanupError extends Error {
  constructor(public readonly retry: () => Promise<void>, cause: unknown) {
    super('Document removed; note attachment cleanup is incomplete.', { cause });
  }
}

/** Retrying never repeats metadata deletion, whose creator checks require the original record. */
export async function cleanupRemovedDocumentCards(projectId: string, documentIds: string[]): Promise<void> {
  const retry = async () => {
    for (const id of new Set(documentIds)) await removeDocumentCanvasCards(projectId, id);
  };
  try { await retry(); } catch (error) { throw new DocumentCardCleanupError(retry, error); }
}

export type DocumentCanvasCardSettings = Partial<Pick<DocumentCanvasCard, 'pinned' | 'color'>>;

/** Updates team-shared card presentation without changing the linked document or ownership fields. */
export async function updateDocumentCanvasCard(projectId: string, cardId: string, settings: DocumentCanvasCardSettings): Promise<void> {
  await updateDoc(doc(database(), 'projects', projectId, 'stickyNotes', cardId), {
    ...settings,
    updatedAt: serverTimestamp(),
  });
}

/** Subscribes only to pinned metadata. Markdown bodies are never read. */
export function subscribePinnedDocumentMetadata(projectId: string, ids: string[], callback: (items: ProjectDocument[]) => void): Unsubscribe {
  return subscribeProjectDocsByIds<ProjectDocument>(projectId, 'documents', [...new Set(ids)], callback);
}

export const canvasDocumentCards = (items: DocumentCanvasCard[]) => items;

/** Reads current data so conversion never overwrites concurrent text or presentation edits. */
export async function updateCanvasNote(projectId: string, id: string, patch: Partial<StickyNote>): Promise<void> {
  const store = database();
  await runTransaction(store, async (transaction) => {
    const ref = doc(store, 'projects', projectId, 'stickyNotes', id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('NOTE_UNAVAILABLE');
    const current = { ...snapshot.data(), id } as CanvasItem;
    const conversion = current.kind === 'document' ? {
      kind: 'note', content: '', taskId: '', color: current.color || '#fef3c7', pinned: current.pinned || false,
      documentIds: normalizeCanvasNote(current).documentIds, documentId: deleteField(),
    } : {};
    transaction.update(ref, { ...conversion, ...patch, updatedAt: serverTimestamp() });
  });
}
