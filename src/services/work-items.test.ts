import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  const batch = {
    update: vi.fn(),
    set: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  };
  return {
    batch,
    writeBatch: vi.fn(() => batch),
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
  serverTimestamp: vi.fn(() => 'server-time'),
  writeBatch: firestore.writeBatch,
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
  });

  it('changes milestone status with one document update and no activity write', async () => {
    await updateWorkItem('project-1', 'milestones', 'milestone-1', { status: 'completed' });

    expect(firestore.writeBatch).toHaveBeenCalledTimes(1);
    expect(firestore.batch.update).toHaveBeenCalledTimes(1);
    expect(firestore.batch.update).toHaveBeenCalledWith(
      'database/projects/project-1/milestones/milestone-1',
      { status: 'completed', updatedAt: 'server-time' },
    );
    expect(firestore.batch.set).not.toHaveBeenCalled();
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1);
  });
});

describe('shared query cache keys', () => {
  it('separates collection, scope, limit, and cursor descriptions', () => {
    expect(projectQueryCacheKey('p1', 'tasks', 'active:*')).not.toBe(projectQueryCacheKey('p1', 'tasks', 'done:*:50'));
    expect(projectQueryCacheKey('p1', 'tasks', 'done:*:50')).not.toBe(projectQueryCacheKey('p1', 'tasks', 'done:*:100'));
    expect(projectQueryCacheKey('p1', 'tasks', 'page:cursor-a')).not.toBe(projectQueryCacheKey('p1', 'tasks', 'page:cursor-b'));
  });
});
