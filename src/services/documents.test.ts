import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const batch = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(() => Promise.resolve()) };
  return { batch, updateDoc: vi.fn(() => Promise.resolve()), writeBatch: vi.fn(() => batch) };
});

vi.mock('firebase/firestore', () => ({
  arrayRemove: vi.fn((...values: unknown[]) => ['remove', ...values]),
  arrayUnion: vi.fn((...values: unknown[]) => ['union', ...values]),
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  deleteField: vi.fn(() => 'delete-field'),
  doc: vi.fn((...parts: unknown[]) => parts.length === 1 ? { id: 'generated-id', path: `${parts[0]}/generated-id` } : parts.join('/')),
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

import { createProjectDocument, deleteProjectDocument, linkProjectDocumentsToTask, unlinkProjectDocumentFromTask, updateProjectDocument, updateProjectDocumentLabels } from './documents';

const user = { uid: 'user-1', displayName: 'User' } as never;

describe('document v2 writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.batch.commit.mockResolvedValue(undefined);
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
  });
});
