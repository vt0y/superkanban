import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batch: { set: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => undefined) },
  getDocsFromServer: vi.fn(),
  updateDoc: vi.fn(),
  subscribe: vi.fn(),
  nextId: 0,
}));
vi.mock('firebase/firestore', () => ({
  collection: (...parts: unknown[]) => parts.join('/'),
  doc: (...parts: unknown[]) => parts.length === 1 ? `${parts[0]}/auto-${++mocks.nextId}` : parts.join('/'),
  getDocsFromServer: mocks.getDocsFromServer,
  limit: (count: number) => ({ limit: count }),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (...args: unknown[]) => args,
  serverTimestamp: () => 'server-time',
  updateDoc: mocks.updateDoc,
  writeBatch: () => mocks.batch,
}));
vi.mock('./helpers', () => ({ database: () => 'database', BATCH_CHUNK: 450 }));
vi.mock('./work-items', () => ({ subscribeProjectDocsByIds: mocks.subscribe }));

import { cleanupRemovedDocumentCards, DocumentCardCleanupError, pinProjectDocuments, removeDocumentCanvasCards, subscribePinnedDocumentMetadata, unpinProjectDocument, updateDocumentCanvasCard } from './canvas-documents';

describe('independent document canvas cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nextId = 0;
    mocks.batch.commit.mockResolvedValue(undefined);
    mocks.getDocsFromServer.mockResolvedValue({ docs: [] });
  });

  it('creates independent IDs for repeated additions without resetting the original', async () => {
    await pinProjectDocuments('p', ['spec'], [{ x: 1, y: 2 }], { uid: 'me' } as never);
    await pinProjectDocuments('p', ['spec'], [{ x: 3, y: 4 }], { uid: 'other' } as never);
    expect(mocks.batch.set.mock.calls.map(([ref]) => ref)).toEqual(['database/projects/p/stickyNotes/auto-1', 'database/projects/p/stickyNotes/auto-2']);
    expect(mocks.batch.set).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ documentId: 'spec', x: 3, y: 4, createdBy: 'other' }));
    await updateDocumentCanvasCard('p', 'auto-2', { color: '#dbeafe', pinned: true });
    expect(mocks.updateDoc).toHaveBeenCalledWith('database/projects/p/stickyNotes/auto-2', { color: '#dbeafe', pinned: true, updatedAt: 'server-time' });
    await unpinProjectDocument('p', 'auto-1');
    expect(mocks.batch.delete).toHaveBeenCalledExactlyOnceWith('database/projects/p/stickyNotes/auto-1');
  });

  it('rejects incomplete or invalid placement before any writes', async () => {
    await expect(pinProjectDocuments('p', ['a', 'b'], [{ x: 0, y: 0 }], {} as never)).rejects.toThrow('INVALID_CARD_POSITIONS');
    await expect(pinProjectDocuments('p', ['a'], [{ x: NaN, y: 0 }], {} as never)).rejects.toThrow('INVALID_CARD_POSITIONS');
    expect(mocks.batch.set).not.toHaveBeenCalled();
  });

  it('bounds pin batches for rules access calls and deduplicates metadata subscriptions', async () => {
    await pinProjectDocuments('p', ['a', 'b', 'c', 'd', 'e'], Array.from({ length: 5 }, () => ({ x: 0, y: 0 })), {} as never);
    expect(mocks.batch.commit).toHaveBeenCalledTimes(2);
    const callback = vi.fn();
    subscribePinnedDocumentMetadata('p', ['a', 'a', 'b'], callback);
    expect(mocks.subscribe).toHaveBeenCalledWith('p', 'documents', ['a', 'b'], callback);
  });

  it('cleans legacy and new cards in server-read batches', async () => {
    mocks.getDocsFromServer
      .mockResolvedValueOnce({ docs: Array.from({ length: 450 }, (_, i) => ({ ref: `card-${i}` })) })
      .mockResolvedValueOnce({ docs: [{ ref: 'document_spec' }, { ref: 'last-copy' }] })
      .mockResolvedValueOnce({ docs: [] });
    await removeDocumentCanvasCards('p', 'spec');
    expect(mocks.batch.delete).toHaveBeenCalledTimes(452);
    expect(mocks.batch.commit).toHaveBeenCalledTimes(2);
    expect(mocks.getDocsFromServer).toHaveBeenCalledWith({ path: 'database/projects/p/stickyNotes', constraints: [['documentId', '==', 'spec'], { limit: 450 }] });
  });

  it('provides an idempotent retry after partially completed cleanup', async () => {
    mocks.getDocsFromServer.mockResolvedValueOnce({ docs: [{ ref: 'copy' }] }).mockRejectedValueOnce(new Error('offline'));
    let failure: unknown;
    try { await cleanupRemovedDocumentCards('p', ['spec']); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(DocumentCardCleanupError);
    await (failure as DocumentCardCleanupError).retry();
    expect(mocks.batch.delete).toHaveBeenCalledTimes(1);
  });
});
