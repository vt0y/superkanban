import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import { estimatedBoardInitialTaskReads, mergeTaskStreams } from './tasks';

const task = (id: string, status: Task['status'], order: number, updated = 0): Task => ({
  id, status, order, title: id, description: '', priority: 'medium', assigneeIds: [], tags: [],
  dueDate: '', milestoneId: '', createdBy: 'u',
  updatedAt: { toMillis: () => updated } as Task['updatedAt'],
});

describe('task query merging', () => {
  it('deduplicates transitions and keeps active tasks before newest completed tasks', () => {
    const result = mergeTaskStreams(
      [task('b', 'todo', 2), task('a', 'todo', 1)],
      [task('b', 'done', 2, 30), task('old', 'done', 0, 10), task('new', 'done', 0, 20)],
    );
    expect(result.map(({ id, status }) => `${id}:${status}`)).toEqual(['a:todo', 'b:done', 'new:done', 'old:done']);
  });

  it('handles empty datasets and histories larger than one page without dropping unique ids', () => {
    expect(mergeTaskStreams([], [])).toEqual([]);
    const history = Array.from({ length: 1000 }, (_, index) => task(`done-${index}`, 'done', 0, index));
    expect(mergeTaskStreams([], history)).toHaveLength(1000);
    expect(mergeTaskStreams([], history)[0].id).toBe('done-999');
  });

  it('cuts initial task reads by at least 60% for a 1,000-document history', () => {
    const legacyReads = 1020;
    const scopedReads = estimatedBoardInitialTaskReads(20, 1000);
    expect(scopedReads).toBe(70);
    expect(1 - scopedReads / legacyReads).toBeGreaterThanOrEqual(0.6);
  });
});
