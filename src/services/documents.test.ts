import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const batch = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(() => Promise.resolve()) };
  return { batch, writeBatch: vi.fn(() => batch) };
});

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  deleteField: vi.fn(() => 'delete-field'),
  doc: vi.fn((...parts: unknown[]) => parts.length === 1 ? { id: 'generated-id', path: `${parts[0]}/generated-id` } : parts.join('/')),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-time'),
  writeBatch: firestore.writeBatch,
}));

vi.mock('./helpers', () => ({
  activityData: vi.fn(() => 'activity-data'),
  database: vi.fn(() => 'database'),
  withId: vi.fn(),
}));

import { createProjectDocument, deleteProjectDocument, updateProjectDocument } from './documents';

const user = { uid: 'user-1', displayName: 'User' } as never;

describe('document v2 writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.batch.commit.mockResolvedValue(undefined);
  });

  it('creates metadata, body, and activity in one batch', async () => {
    const id = await createProjectDocument('project-1', 'Spec', '# Hello', user);
    expect(id).toBe('generated-id');
    expect(firestore.batch.set).toHaveBeenCalledTimes(3);
    expect(firestore.batch.set).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'generated-id' }), expect.objectContaining({ title: 'Spec', schemaVersion: 2, contentBytes: 7, createdBy: 'user-1' }));
    expect(firestore.batch.set).toHaveBeenNthCalledWith(2, 'database/projects/project-1/documentBodies/generated-id', { content: '# Hello' });
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('updates metadata and body atomically while removing legacy content', async () => {
    await updateProjectDocument('project-1', 'doc-1', 'Updated', 'ภาษาไทย');
    expect(firestore.batch.update).toHaveBeenCalledWith('database/projects/project-1/documents/doc-1', expect.objectContaining({ title: 'Updated', schemaVersion: 2, contentBytes: 21, content: 'delete-field' }));
    expect(firestore.batch.set).toHaveBeenCalledWith('database/projects/project-1/documentBodies/doc-1', { content: 'ภาษาไทย' });
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('deletes both records atomically and rejects oversized bodies before writing', async () => {
    await deleteProjectDocument('project-1', 'doc-1');
    expect(firestore.batch.delete).toHaveBeenCalledTimes(2);
    await expect(updateProjectDocument('project-1', 'doc-1', 'Large', 'x'.repeat(921601))).rejects.toThrow('DOCUMENT_TOO_LARGE');
    expect(firestore.writeBatch).toHaveBeenCalledTimes(1);
  });
});
