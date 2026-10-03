import type { User } from 'firebase/auth';
import { doc, serverTimestamp, updateDoc, writeBatch, type Unsubscribe } from 'firebase/firestore';
import type { DocumentCanvasCard, ProjectDocument } from '@/types';
import { documentCanvasId } from '@/utils/canvas-items';
import { BATCH_CHUNK, database } from './helpers';
import { subscribeProjectDocsByIds } from './work-items';

export async function pinProjectDocuments(projectId: string, documentIds: string[], positions: Array<{ x: number; y: number }>, user: User): Promise<void> {
  const ids = [...new Set(documentIds)];
  for (let start = 0; start < ids.length; start += BATCH_CHUNK) {
    const batch = writeBatch(database());
    ids.slice(start, start + BATCH_CHUNK).forEach((documentIdValue, offset) => {
      const position = positions[start + offset];
      if (!position) return;
      batch.set(doc(database(), 'projects', projectId, 'stickyNotes', documentCanvasId(documentIdValue)), {
        kind: 'document', documentId: documentIdValue, x: position.x, y: position.y,
        createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

export async function unpinProjectDocument(projectId: string, documentIdValue: string): Promise<void> {
  const batch = writeBatch(database());
  batch.delete(doc(database(), 'projects', projectId, 'stickyNotes', documentCanvasId(documentIdValue)));
  await batch.commit();
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
  return subscribeProjectDocsByIds<ProjectDocument>(projectId, 'documents', ids, callback);
}

export const canvasDocumentCards = (items: DocumentCanvasCard[]) => items;
