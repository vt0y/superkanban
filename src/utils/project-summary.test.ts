import { describe, expect, it } from 'vitest';
import type { Milestone, Task } from '@/types';
import {
  applyMilestoneChanges,
  applyTaskChanges,
  buildProjectSummary,
  emptyProjectSummary,
  milestoneAffectsSummary,
  summaryCounts,
  summaryMilestoneCounts,
  summaryMilestones,
  summaryTasks,
  taskAffectsSummary,
} from './project-summary';

const task = (id: string, values: Partial<Task> = {}): Task => ({
  id, title: id, description: '', status: 'todo', priority: 'medium', assigneeIds: [], tags: [],
  dueDate: '', dueTime: '', milestoneId: '', order: 0, createdBy: 'u1', ...values,
});
const milestone = (id: string, values: Partial<Milestone> = {}): Milestone => ({
  id, title: id, description: '', dueDate: '', dueTime: '', status: 'active', dependsOn: [], createdBy: 'u1', ...values,
});

describe('project summary task transitions', () => {
  it('tracks create, complete, reopen and moving a completed task', () => {
    const created = applyTaskChanges(emptyProjectSummary(), [{ before: null, after: task('t1', { milestoneId: 'm1' }) }]);
    expect(summaryCounts(created)).toMatchObject({ total: 1, done: 0 });
    expect(created.openByMilestone.m1).toBe(1);

    const completed = applyTaskChanges(created, [{ before: task('t1', { milestoneId: 'm1' }), after: task('t1', { status: 'done', milestoneId: 'm1' }) }]);
    expect(summaryCounts(completed)).toMatchObject({ total: 1, done: 1 });
    expect(summaryMilestoneCounts(completed, 'm1')).toEqual({ total: 1, done: 1 });

    const moved = applyTaskChanges(completed, [{ before: task('t1', { status: 'done', milestoneId: 'm1' }), after: task('t1', { status: 'done', milestoneId: 'm2' }) }]);
    expect(moved.doneByMilestone).toMatchObject({ m1: 0, m2: 1 });

    const reopened = applyTaskChanges(moved, [{ before: task('t1', { status: 'done', milestoneId: 'm2' }), after: task('t1', { status: 'review', milestoneId: 'm2' }) }]);
    expect(summaryCounts(reopened)).toMatchObject({ total: 1, done: 0 });
    expect(reopened.openTasks.t1.status).toBe('review');
  });

  it('ignores reorder/checklist-only updates and notices summary fields', () => {
    expect(taskAffectsSummary(task('t1'), task('t1', { order: 99, checklist: [{ id: 'c', text: 'x', done: true }] }))).toBe(false);
    expect(taskAffectsSummary(task('t1'), task('t1', { dueDate: '2026-10-10' }))).toBe(true);
  });

  it('deletes open and done tasks without negative counts', () => {
    const base = buildProjectSummary([task('open'), task('done', { status: 'done', milestoneId: 'm1' })], [milestone('m1')]);
    const next = applyTaskChanges(base, [{ before: task('open'), after: null }, { before: task('done', { status: 'done', milestoneId: 'm1' }), after: null }]);
    expect(summaryCounts(next)).toMatchObject({ total: 0, done: 0 });
    expect(next.openTasks).toEqual({});
  });

  it('caps task details but keeps exact aggregate counts', () => {
    const tasks = Array.from({ length: 505 }, (_, index) => task(`t${index}`, { dueDate: `2027-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}` }));
    const summary = buildProjectSummary(tasks, []);
    expect(Object.keys(summary.openTasks)).toHaveLength(500);
    expect(summary.openCount).toBe(505);
    expect(summary.openByStatus.todo).toBe(505);
    expect(summary.truncated).toBe(true);
  });
});

describe('project summary milestones and converters', () => {
  it('tracks milestone create/update/delete and clears its counters', () => {
    const made = applyMilestoneChanges(emptyProjectSummary(), [{ before: null, after: milestone('m1') }]);
    expect(milestoneAffectsSummary(milestone('m1'), milestone('m1', { description: 'not summarized' }))).toBe(false);
    const updated = applyMilestoneChanges(made, [{ before: milestone('m1'), after: milestone('m1', { title: 'Renamed' }) }]);
    expect(updated.milestones.m1.title).toBe('Renamed');
    updated.doneByMilestone.m1 = 2;
    updated.openByMilestone.m1 = 3;
    const removed = applyMilestoneChanges(updated, [{ before: milestone('m1'), after: null }]);
    expect(removed.milestones.m1).toBeUndefined();
    expect(removed.doneByMilestone.m1).toBeUndefined();
    expect(removed.openByMilestone.m1).toBeUndefined();
  });

  it('converts compact entries back to the shapes used by the UI', () => {
    const summary = buildProjectSummary([task('t1', { dueDate: '2026-10-10' })], [milestone('m1')]);
    expect(summaryTasks(summary)[0]).toMatchObject({ id: 't1', dueDate: '2026-10-10', description: '' });
    expect(summaryMilestones(summary)[0]).toMatchObject({ id: 'm1', description: '' });
  });
});

describe('rebuilding from open tasks and done counts', () => {
  it('takes done totals from the aggregation and drops counts for deleted milestones', () => {
    const summary = buildProjectSummary(
      [task('t1', { milestoneId: 'm1' }), task('stray', { status: 'done', milestoneId: 'm1' })],
      [milestone('m1')],
      { total: 7, byMilestone: { m1: 3, gone: 2 } },
    );
    expect(summary.doneTotal).toBe(7);
    expect(summary.doneByMilestone).toEqual({ m1: 3 });
    expect(summaryMilestoneCounts(summary, 'm1')).toEqual({ total: 4, done: 3 });
    expect(summaryCounts(summary)).toMatchObject({ total: 8, done: 7 });
  });
});
