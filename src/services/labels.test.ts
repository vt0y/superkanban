import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const batch = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(() => Promise.resolve()) };
  return {
    batch,
    getCountFromServer: vi.fn(),
    getDocs: vi.fn(),
    writeBatch: vi.fn(() => batch),
  };
});

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  doc: vi.fn((...parts: unknown[]) => parts.join('/')),
  getCountFromServer: firestore.getCountFromServer,
  getDocs: firestore.getDocs,
  query: vi.fn((path: string) => path),
  serverTimestamp: vi.fn(() => 'server-time'),
  where: vi.fn(() => 'where'),
  writeBatch: firestore.writeBatch,
}));

vi.mock('./helpers', () => ({
  activityData: vi.fn(),
  BATCH_CHUNK: 450,
  database: vi.fn(() => 'database'),
}));

import { deleteLabel, getLabelUsageCounts } from './labels';

describe('shared label document usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.batch.commit.mockResolvedValue(undefined);
  });

  it('removes a deleted label from tasks and documents before deleting it', async () => {
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [{ ref: 'task-ref', data: () => ({ labelIds: ['keep', 'remove'] }) }] })
      .mockResolvedValueOnce({ docs: [{ ref: 'document-ref', data: () => ({ labelIds: ['remove'] }) }] });

    await deleteLabel('project-1', 'remove');

    expect(firestore.batch.update).toHaveBeenCalledWith('task-ref', { labelIds: ['keep'], updatedAt: 'server-time' });
    expect(firestore.batch.update).toHaveBeenCalledWith('document-ref', { labelIds: [], updatedAt: 'server-time' });
    expect(firestore.batch.delete).toHaveBeenCalledWith('database/projects/project-1/labels/remove');
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
  });

  it('combines task and document counts', async () => {
    firestore.getCountFromServer
      .mockResolvedValueOnce({ data: () => ({ count: 3 }) })
      .mockResolvedValueOnce({ data: () => ({ count: 2 }) });

    await expect(getLabelUsageCounts('project-1', ['label-1'])).resolves.toEqual({ 'label-1': 5 });
  });
});
