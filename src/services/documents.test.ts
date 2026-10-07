import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const batch = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(() => Promise.resolve()) };
  return { batch, cleanup: vi.fn(() => Promise.resolve()), getDoc: vi.fn(() => Promise.resolve({ exists: () => true })), updateDoc: vi.fn(() => Promise.resolve()), writeBatch: vi.fn(() => batch) };
});

vi.mock('firebase/firestore', () => ({
  arrayRemove: vi.fn((...values: unknown[]) => ['remove', ...values]),
  arrayUnion: vi.fn((...values: unknown[]) => ['union', ...values]),
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  deleteField: vi.fn(() => 'delete-field'),
  doc: vi.fn((...parts: unknown[]) => parts.length === 1 ? { id: 'generated-id', path: `${parts[0]}/generated-id` } : parts.join('/')),
  getDoc: firestore.getDoc,
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-time'),
  updateDoc: firestore.updateDoc,
  writeBatch: firestore.writeBatch,
}));

vi.mock('./helpers', () => ({
  activityData: vi.fn(() => 'activity-data'),
  database: vi.fn(() => 'database'),
  withId: vi.fn(),
}));
vi.mock('./canvas-documents', () => ({ cleanupRemovedDocumentCards: firestore.cleanup }));

import { bulkRemoveProjectDocuments, bulkUpdateProjectDocumentLinks, createProjectDocument, deleteProjectDocument, linkProjectDocumentsToMilestone, linkProjectDocumentsToTask, unlinkProjectDocumentFromMilestone, unlinkProjectDocumentFromTask, updateProjectDocument, updateProjectDocumentLabels } from './documents';

const user = { uid: 'user-1', displayName: 'User' } as never;

describe('document v2 writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.batch.commit.mockResolvedValue(undefined);
    firestore.getDoc.mockResolvedValue({ exists: () => true });
  });

  it('creates metadata, body, and activity in one batch', async () => {
    const id = await createProjectDocument('project-1', 'Spec', '# Hello', ['label-1'], user);
    expect(id).toBe('generated-id');
    expect(firestore.batch.set).toHaveBeenCalledTimes(3);
    expect(firestore.batch.set).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'generated-id' }), expect.objectContaining({ title: 'Spec', labelIds: ['label-1'], schemaVersion: 2, contentBytes: 7, createdBy: 'user-1' }));
    expect(firestore.batch.set).toHaveBeenNthCalledWith(2, 'database/projects/project-1/documentBodies/generated-id', { content: '# Hello' });
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('updates metadata and body atomically while removing legacy content', async () => {
    await updateProjectDocument('project-1', 'doc-1', 'Updated', 'ภาษาไทย', ['label-2']);
    expect(firestore.batch.update).toHaveBeenCalledWith('database/projects/project-1/documents/doc-1', expect.objectContaining({ title: 'Updated', labelIds: ['label-2'], schemaVersion: 2, contentBytes: 21, content: 'delete-field' }));
    expect(firestore.batch.set).toHaveBeenCalledWith('database/projects/project-1/documentBodies/doc-1', { content: 'ภาษาไทย' });
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('deletes both records atomically and rejects oversized bodies before writing', async () => {
    await deleteProjectDocument('project-1', 'doc-1');
    expect(firestore.batch.delete).toHaveBeenCalledTimes(2);
    expect(firestore.cleanup).toHaveBeenCalledWith('project-1', ['doc-1']);
    expect(firestore.batch.commit.mock.invocationCallOrder[0]).toBeLessThan(firestore.cleanup.mock.invocationCallOrder[0]);
    await expect(updateProjectDocument('project-1', 'doc-1', 'Large', 'x'.repeat(921601), [])).rejects.toThrow('DOCUMENT_TOO_LARGE');
    expect(firestore.writeBatch).toHaveBeenCalledTimes(1);
  });

  it('updates labels without touching a document body', async () => {
    await updateProjectDocumentLabels('project-1', 'drive_file-1', ['one', 'one', 'two']);
    expect(firestore.updateDoc).toHaveBeenCalledWith('database/projects/project-1/documents/drive_file-1', { labelIds: ['one', 'two'], updatedAt: 'server-time' });
  });

  it('links and unlinks documents atomically without copying document data', async () => {
    await linkProjectDocumentsToTask('project-1', ['doc-1', 'doc-2', 'doc-1'], 'task-1');
    expect(firestore.batch.update).toHaveBeenCalledTimes(2);
    expect(firestore.batch.update).toHaveBeenCalledWith('database/projects/project-1/documents/doc-1', { taskIds: ['union', 'task-1'], updatedAt: 'server-time' });
    await unlinkProjectDocumentFromTask('project-1', 'doc-1', 'task-1');
    expect(firestore.updateDoc).toHaveBeenCalledWith('database/projects/project-1/documents/doc-1', { taskIds: ['remove', 'task-1'], updatedAt: 'server-time' });
    await linkProjectDocumentsToMilestone('project-1', ['doc-1'], 'milestone-1');
    expect(firestore.batch.update).toHaveBeenCalledWith('database/projects/project-1/documents/doc-1', { milestoneIds: ['union', 'milestone-1'], updatedAt: 'server-time' });
    await unlinkProjectDocumentFromMilestone('project-1', 'doc-1', 'milestone-1');
    expect(firestore.updateDoc).toHaveBeenCalledWith('database/projects/project-1/documents/doc-1', { milestoneIds: ['remove', 'milestone-1'], updatedAt: 'server-time' });
  });

  it('bulk adds and removes document relationships with deduplicated ids', async () => {
    await bulkUpdateProjectDocumentLinks('project-1', ['doc-1', 'doc-2', 'doc-1'], 'labelIds', 'label-1', 'add');
    expect(firestore.batch.update).toHaveBeenCalledTimes(2);
    expect(firestore.batch.update).toHaveBeenCalledWith('database/projects/project-1/documents/doc-1', { labelIds: ['union', 'label-1'], updatedAt: 'server-time' });

    vi.clearAllMocks();
    firestore.batch.commit.mockResolvedValue(undefined);
    await bulkUpdateProjectDocumentLinks('project-1', ['doc-1'], 'taskIds', 'task-1', 'remove');
    expect(firestore.batch.update).toHaveBeenCalledWith('database/projects/project-1/documents/doc-1', { taskIds: ['remove', 'task-1'], updatedAt: 'server-time' });
  });

  it('chunks bulk relationship updates below the Firestore rules access-call limit', async () => {
    await bulkUpdateProjectDocumentLinks('project-1', Array.from({ length: 9 }, (_, index) => `doc-${index}`), 'milestoneIds', 'milestone-1', 'add');
    expect(firestore.batch.update).toHaveBeenCalledTimes(9);
    expect(firestore.batch.commit).toHaveBeenCalledTimes(3);
  });

  it('bulk removes mixed documents and only deletes Markdown bodies', async () => {
    await bulkRemoveProjectDocuments('project-1', [
      { id: 'markdown-1', title: 'Spec' },
      { id: 'drive-1', kind: 'drive', title: 'Sheet' },
      { id: 'canva-1', kind: 'canva', title: 'Deck' },
      { id: 'markdown-1', title: 'Spec' },
    ] as never);

    expect(firestore.batch.delete).toHaveBeenCalledTimes(4);
    expect(firestore.batch.delete).toHaveBeenCalledWith('database/projects/project-1/documentBodies/markdown-1');
    expect(firestore.batch.delete).not.toHaveBeenCalledWith('database/projects/project-1/documentBodies/drive-1');
    expect(firestore.cleanup).toHaveBeenCalledWith('project-1', ['markdown-1', 'drive-1', 'canva-1']);
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('chunks metadata removals within the rules access-call limit', async () => {
    await bulkRemoveProjectDocuments('project-1', Array.from({ length: 5 }, (_, index) => ({ id: `drive-${index}`, kind: 'drive', title: 'Sheet' })) as never);
    expect(firestore.batch.delete).toHaveBeenCalledTimes(5);
    expect(firestore.batch.delete).toHaveBeenCalledWith('database/projects/project-1/documents/drive-1');
    expect(firestore.batch.commit).toHaveBeenCalledTimes(2);
  });
});
