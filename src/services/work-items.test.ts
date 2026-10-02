import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const batch = {
    update: vi.fn(),
    set: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  };
  const transaction = { get: vi.fn(), update: vi.fn(), set: vi.fn(), delete: vi.fn() };
  return {
    batch,
    transaction,
    writeBatch: vi.fn(() => batch),
    runTransaction: vi.fn(async (_store: unknown, callback: (value: typeof transaction) => unknown) => callback(transaction)),
  };
});

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  deleteDoc: vi.fn(),
  doc: vi.fn((...parts: unknown[]) => parts.join('/')),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: firestore.runTransaction,
  serverTimestamp: vi.fn(() => 'server-time'),
  writeBatch: firestore.writeBatch,
}));

vi.mock('./project-summary', () => ({
  readSummaryForTransaction: vi.fn(() => Promise.resolve({ version: 1 })),
  withProjectSummaryRetry: vi.fn((_id: string, operation: () => Promise<void>) => operation()),
  writeSummaryInTransaction: vi.fn(),
}));

vi.mock('@/utils/project-summary', () => ({
  applyMilestoneChanges: vi.fn((summary) => summary),
  applyTaskChanges: vi.fn((summary) => summary),
  milestoneAffectsSummary: vi.fn(() => true),
  taskAffectsSummary: vi.fn(() => true),
}));

vi.mock('./helpers', () => ({
  activityData: vi.fn(),
  database: vi.fn(() => 'database'),
  withId: vi.fn(),
  BATCH_CHUNK: 450,
}));

import { projectQueryCacheKey, updateWorkItem } from './work-items';

describe('updateWorkItem resource usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.batch.commit.mockResolvedValue(undefined);
    firestore.transaction.get.mockResolvedValue({ exists: () => true, id: 'milestone-1', data: () => ({ title: 'M', status: 'active' }) });
  });

  it('changes milestone status in one transaction and no activity write', async () => {
    await updateWorkItem('project-1', 'milestones', 'milestone-1', { status: 'completed' });

    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(firestore.transaction.update).toHaveBeenCalledTimes(1);
    expect(firestore.transaction.update).toHaveBeenCalledWith(
      'database/projects/project-1/milestones/milestone-1',
      { status: 'completed', updatedAt: 'server-time' },
    );
    expect(firestore.transaction.set).not.toHaveBeenCalled();
    expect(firestore.writeBatch).not.toHaveBeenCalled();
  });

  it('keeps unrelated collections on the offline-capable batch path', async () => {
    await updateWorkItem('project-1', 'labels', 'label-1', { name: 'Bug' });
    expect(firestore.writeBatch).toHaveBeenCalledTimes(1);
    expect(firestore.batch.update).toHaveBeenCalledWith(
      'database/projects/project-1/labels/label-1',
      { name: 'Bug', updatedAt: 'server-time' },
    );
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });
});

describe('shared query cache keys', () => {
  it('separates collection, scope, limit, and cursor descriptions', () => {
    expect(projectQueryCacheKey('p1', 'tasks', 'active:*')).not.toBe(projectQueryCacheKey('p1', 'tasks', 'done:*:50'));
    expect(projectQueryCacheKey('p1', 'tasks', 'done:*:50')).not.toBe(projectQueryCacheKey('p1', 'tasks', 'done:*:100'));
    expect(projectQueryCacheKey('p1', 'tasks', 'page:cursor-a')).not.toBe(projectQueryCacheKey('p1', 'tasks', 'page:cursor-b'));
  });
});
