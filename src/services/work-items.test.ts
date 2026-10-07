vi.mock('@/config/firebase', () => ({ auth: null }));
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
  documentId: vi.fn(() => '__name__'),
  where: vi.fn((...args) => args),
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

vi.mock('@/utils/project-summary', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/utils/project-summary')>(),
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

import { onSnapshot } from 'firebase/firestore';
import { readSummaryForTransaction } from './project-summary';
import { taskAffectsSummary } from '@/utils/project-summary';
import { bulkUpdateWorkItems, projectQueryCacheKey, subscribeProjectDocsByIds, subscribeProjectQuery, updateWorkItem } from './work-items';

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

  it('writes checklist, description, labels and board order with zero explicit reads', async () => {
    await updateWorkItem('project-1', 'tasks', 'task-1', { checklist: [], description: 'Details', labelIds: ['label'], order: 2 });
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(firestore.transaction.get).not.toHaveBeenCalled();
    expect(readSummaryForTransaction).not.toHaveBeenCalled();
    expect(firestore.batch.commit).toHaveBeenCalledOnce();
  });

  it('bulk non-summary patches use zero explicit reads', async () => {
    await bulkUpdateWorkItems('project-1', 'tasks', ['a', 'b'], (id) => ({ description: id }));
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(firestore.batch.update).toHaveBeenCalledTimes(2);
    expect(readSummaryForTransaction).not.toHaveBeenCalled();
  });

  it('reads the item but skips summary when its representation does not change', async () => {
    vi.mocked(taskAffectsSummary).mockReturnValueOnce(false);
    await updateWorkItem('project-1', 'tasks', 'task-1', { title: 'M' });
    expect(firestore.transaction.get).toHaveBeenCalledOnce();
    expect(readSummaryForTransaction).not.toHaveBeenCalled();
    expect(firestore.transaction.update).toHaveBeenCalledOnce();
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

describe('shared subscription demand', () => {
  it('canonicalizes reordered duplicate IDs and shares deterministic 30-ID chunks', () => {
    vi.useFakeTimers();
    const stops: ReturnType<typeof vi.fn>[] = [];
    vi.mocked(onSnapshot).mockImplementation((() => { const stop = vi.fn(); stops.push(stop); return stop; }) as typeof onSnapshot);
    const ids = Array.from({ length: 35 }, (_, index) => `id-${index}`);
    const first = subscribeProjectDocsByIds('canonical-project', 'tasks', [...ids, ids[0]], vi.fn());
    const second = subscribeProjectDocsByIds('canonical-project', 'tasks', [...ids].reverse(), vi.fn());
    expect(stops).toHaveLength(2);
    first(); vi.runAllTimers(); expect(stops.every((stop) => stop.mock.calls.length === 0)).toBe(true);
    second(); vi.runAllTimers(); expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    vi.useRealTimers();
  });

  it('shares the canonical unfiltered 50-document query while preserving the 100 picker', () => {
    vi.useFakeTimers();
    const stops: ReturnType<typeof vi.fn>[] = [];
    vi.mocked(onSnapshot).mockImplementation((() => { const stop = vi.fn(); stops.push(stop); return stop; }) as typeof onSnapshot);
    const first = subscribeProjectQuery('picker-project', 'documents', 'recent:50:labels:*:tasks:*:milestones:*', [], vi.fn());
    const second = subscribeProjectQuery('picker-project', 'documents', 'recent:50:labels:*:tasks:*:milestones:*', [], vi.fn());
    const hundred = subscribeProjectQuery('picker-project', 'documents', 'picker:recent:100', [], vi.fn());
    expect(stops).toHaveLength(2);
    first(); second(); hundred(); vi.runAllTimers(); vi.useRealTimers();
  });
});
