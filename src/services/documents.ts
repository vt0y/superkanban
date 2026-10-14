import { measuredFirestore } from '@/services/firestore-diagnostics';
import type { User } from 'firebase/auth';
import {
  collection,
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { LoadedProjectDocument, MarkdownProjectDocument, ProjectDocument, ProjectDocumentBody } from '@/types';
import { DOCUMENT_BODY_MAX_BYTES, documentMetadata } from '@/utils/documents';
import { activityData, database, withId } from './helpers';
import { cleanupRemovedDocumentCards } from './canvas-documents';

const { onSnapshot, runTransaction, writeBatch, updateDoc } = measuredFirestore('documents');

function metadataRef(projectId: string, documentId: string) {
  return doc(database(), 'projects', projectId, 'documents', documentId);
}

function bodyRef(projectId: string, documentId: string) {
  return doc(database(), 'projects', projectId, 'documentBodies', documentId);
}

function assertDocumentSize(content: string) {
  const bytes = documentMetadata(content).contentBytes;
  if (bytes > DOCUMENT_BODY_MAX_BYTES) throw new Error('DOCUMENT_TOO_LARGE');
}

// Document rules read the project/membership and, for Markdown, the separate body.
// Keep atomic batches small enough for Firestore's 20 document-access-call limit.
const DOCUMENT_RULES_BATCH_SIZE = 4;

export function subscribeProjectDocument(
  projectId: string,
  documentId: string,
  callback: (value: LoadedProjectDocument | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  let metadata: MarkdownProjectDocument | null | undefined;
  let body: string | undefined;
  let bodyLoaded = false;

  const emit = () => {
    if (metadata === undefined) return;
    if (metadata === null) return callback(null);
    if (typeof metadata.content === 'string') return callback({ ...metadata, content: metadata.content });
    if (bodyLoaded) callback({ ...metadata, content: body || '' });
  };

  const stopMetadata = onSnapshot(metadataRef(projectId, documentId), (snapshot) => {
    const value = snapshot.exists() ? withId<ProjectDocument>(snapshot) : null;
    metadata = value?.kind === 'drive' || value?.kind === 'canva' ? null : value;
    emit();
  }, onError);
  const stopBody = onSnapshot(bodyRef(projectId, documentId), (snapshot) => {
    bodyLoaded = true;
    body = snapshot.exists() ? (snapshot.data() as ProjectDocumentBody).content : '';
    emit();
  }, onError);

  return () => { stopMetadata(); stopBody(); };
}

export async function createProjectDocument(projectId: string, title: string, content: string, labelIds: string[], user: User, taskIds: string[] = [], milestoneIds: string[] = []): Promise<string> {
  assertDocumentSize(content);
  const store = database();
  const itemRef = doc(collection(store, 'projects', projectId, 'documents'));
  const itemBodyRef = doc(store, 'projects', projectId, 'documentBodies', itemRef.id);
  const activityRef = doc(collection(store, 'projects', projectId, 'activities'));
  const batch = writeBatch(store);
  batch.set(itemRef, { kind: 'markdown', title, labelIds: [...new Set(labelIds)].slice(0, 50), taskIds: [...new Set(taskIds)].slice(0, 100), milestoneIds: [...new Set(milestoneIds)].slice(0, 100), ...documentMetadata(content), createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(itemBodyRef, { content });
  batch.set(activityRef, activityData(user, 'document_created', `สร้างเอกสาร “${title}”`, `created document “${title}”`, itemRef.id));
  await batch.commit();
  return itemRef.id;
}

export async function updateProjectDocument(projectId: string, documentId: string, title: string, content: string, labelIds: string[], taskIds: string[] = [], milestoneIds: string[] = []): Promise<void> {
  assertDocumentSize(content);
  const store = database();
  const batch = writeBatch(store);
  batch.update(doc(store, 'projects', projectId, 'documents', documentId), {
    title,
    labelIds: [...new Set(labelIds)].slice(0, 50),
    taskIds: [...new Set(taskIds)].slice(0, 100),
    milestoneIds: [...new Set(milestoneIds)].slice(0, 100),
    ...documentMetadata(content),
    content: deleteField(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(store, 'projects', projectId, 'documentBodies', documentId), { content });
  await batch.commit();
}

export async function linkProjectDocumentsToTask(projectId: string, documentIds: string[], taskId: string): Promise<void> {
  await bulkUpdateProjectDocumentLinks(projectId, documentIds, 'taskIds', taskId, 'add');
}

export async function unlinkProjectDocumentFromTask(projectId: string, documentId: string, taskId: string): Promise<void> {
  await updateDoc(metadataRef(projectId, documentId), { taskIds: arrayRemove(taskId), updatedAt: serverTimestamp() });
}

export async function linkProjectDocumentsToMilestone(projectId: string, documentIds: string[], milestoneId: string): Promise<void> {
  await bulkUpdateProjectDocumentLinks(projectId, documentIds, 'milestoneIds', milestoneId, 'add');
}

export type ProjectDocumentLinkField = 'labelIds' | 'taskIds' | 'milestoneIds';

/** Atomically adds or removes one relationship across document metadata records. */
export async function bulkUpdateProjectDocumentLinks(
  projectId: string,
  documentIds: string[],
  field: ProjectDocumentLinkField,
  value: string,
  operation: 'add' | 'remove',
): Promise<void> {
  const ids = [...new Set(documentIds)];
  for (let start = 0; start < ids.length; start += DOCUMENT_RULES_BATCH_SIZE) {
    const batch = writeBatch(database());
    ids.slice(start, start + DOCUMENT_RULES_BATCH_SIZE).forEach((id) => batch.update(metadataRef(projectId, id), {
      [field]: operation === 'add' ? arrayUnion(value) : arrayRemove(value),
      updatedAt: serverTimestamp(),
    }));
    await batch.commit();
  }
}

export async function unlinkProjectDocumentFromMilestone(projectId: string, documentId: string, milestoneId: string): Promise<void> {
  await updateDoc(metadataRef(projectId, documentId), { milestoneIds: arrayRemove(milestoneId), updatedAt: serverTimestamp() });
}

/** Updates lightweight document metadata without touching a Markdown body or Drive permissions. */
export async function updateProjectDocumentLabels(projectId: string, documentId: string, labelIds: string[]): Promise<void> {
  await updateDoc(metadataRef(projectId, documentId), {
    labelIds: [...new Set(labelIds)].slice(0, 50),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProjectDocument(projectId: string, documentId: string): Promise<void> {
  const store = database();
  const batch = writeBatch(store);
  batch.delete(doc(store, 'projects', projectId, 'documentBodies', documentId));
  batch.delete(doc(store, 'projects', projectId, 'documents', documentId));
  await batch.commit();
  await cleanupRemovedDocumentCards(projectId, [documentId]);
}

/** Removes library records and their app-owned body/card data; external source files are untouched. */
export async function bulkRemoveProjectDocuments(projectId: string, documents: ProjectDocument[]): Promise<void> {
  const items = [...new Map(documents.map((item) => [item.id, item])).values()];
  for (let start = 0; start < items.length; start += DOCUMENT_RULES_BATCH_SIZE) {
    const chunk = items.slice(start, start + DOCUMENT_RULES_BATCH_SIZE);
    const batch = writeBatch(database());
    chunk.forEach((item) => {
      batch.delete(metadataRef(projectId, item.id));
      if (item.kind !== 'drive' && item.kind !== 'canva') batch.delete(bodyRef(projectId, item.id));
    });
    await batch.commit();
    await cleanupRemovedDocumentCards(projectId, chunk.map((item) => item.id));
  }
}

/** Idempotently moves an embedded legacy body without changing the document's visible timestamp. */
export async function migrateLegacyProjectDocument(projectId: string, documentId: string): Promise<void> {
  const store = database();
  const itemRef = doc(store, 'projects', projectId, 'documents', documentId);
  const itemBodyRef = doc(store, 'projects', projectId, 'documentBodies', documentId);
  await runTransaction(store, async (transaction) => {
    const [itemSnapshot, bodySnapshot] = await Promise.all([transaction.get(itemRef), transaction.get(itemBodyRef)]);
    if (!itemSnapshot.exists()) return;
    const item = itemSnapshot.data() as Omit<MarkdownProjectDocument, 'id'>;
    if (item.schemaVersion === 2 || typeof item.content !== 'string') return;
    assertDocumentSize(item.content);
    if (!bodySnapshot.exists()) transaction.set(itemBodyRef, { content: item.content });
    transaction.update(itemRef, { ...documentMetadata(item.content), content: deleteField() });
  });
}
