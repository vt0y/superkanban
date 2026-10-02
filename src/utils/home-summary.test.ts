import { describe, expect, it } from 'vitest';
import type { Milestone, Project, Task } from '@/types';
import { bucketFor, bucketMyTasks, projectStats, summarize, upcomingDeadlines, type ProjectWork } from './home-summary';

// Friday 2 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 2, 10, 0);
const project = (id: string): Project => ({ id, name: id.toUpperCase(), description: '', color: '#000', ownerId: 'u1', memberIds: ['u1'], archived: false });
let seq = 0;
const task = (values: Partial<Task>): Task => ({
  id: `t${++seq}`, title: `Task ${seq}`, description: '', status: 'todo', priority: 'medium', assigneeIds: [], tags: [], labelIds: [], checklist: [],
  dueDate: '', dueTime: '', milestoneId: '', order: seq, createdBy: 'u1', ...values,
} as Task);
const milestone = (values: Partial<Milestone>): Milestone => ({ id: `m${++seq}`, title: `M ${seq}`, description: '', dueDate: '', status: 'active', createdBy: 'u1', ...values });
const work = (id: string, tasks: Task[], milestones: Milestone[] = [], counts: ProjectWork['counts'] = null): ProjectWork => ({ project: project(id), tasks, milestones, counts, loaded: true });

describe('bucketFor', () => {
  it.each([
    ['', '', 'none'],
    ['2026-10-01', '', 'overdue'],
    ['2026-10-02', '09:00', 'overdue'],
    ['2026-10-02', '', 'today'],
    ['2026-10-02', '18:00', 'today'],
    ['2026-10-03', '', 'week'],
    ['2026-10-09', '', 'week'],
    ['2026-10-10', '', 'later'],
  ])('%s %s → %s', (dueDate, dueTime, expected) => {
    expect(bucketFor({ dueDate, dueTime }, NOW)).toBe(expected);
  });

  it('treats the moment just after midnight as a new day', () => {
    expect(bucketFor({ dueDate: '2026-10-02', dueTime: '' }, new Date(2026, 9, 2, 0, 0, 1))).toBe('today');
    expect(bucketFor({ dueDate: '2026-10-01', dueTime: '' }, new Date(2026, 9, 2, 0, 0, 1))).toBe('overdue');
  });
});

describe('bucketMyTasks', () => {
  it('keeps only my open tasks and sorts by date, time, then priority', () => {
    const a = task({ assigneeIds: ['me'], dueDate: '2026-10-05', priority: 'low' });
    const b = task({ assigneeIds: ['me'], dueDate: '2026-10-05', priority: 'urgent' });
    const c = task({ assigneeIds: ['me'], dueDate: '2026-10-04' });
    const theirs = task({ assigneeIds: ['other'], dueDate: '2026-10-04' });
    const done = task({ assigneeIds: ['me'], dueDate: '2026-10-04', status: 'done' });
    const groups = bucketMyTasks([work('p1', [a, b, theirs]), work('p2', [c, done])], 'me', NOW);
    expect(groups.week.map((item) => item.task.id)).toEqual([c.id, b.id, a.id]);
    expect(groups.week[0].project.id).toBe('p2');
    expect(groups.overdue).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts tiles across projects', () => {
    const totals = summarize([
      work('p1', [task({ dueDate: '2026-09-30' }), task({ dueDate: '2026-10-04', assigneeIds: ['me'] }), task({})], [milestone({ dueDate: '2026-10-15' }), milestone({ dueDate: '2026-10-20' })]),
      work('p2', [task({ dueDate: '2026-10-09', assigneeIds: ['me'] }), task({ dueDate: '2026-10-10' })], [milestone({ dueDate: '2026-10-03', status: 'completed' }), milestone({ dueDate: '2026-09-01' })]),
    ], 'me', NOW);
    expect(totals).toEqual({ active: 5, overdue: 1, dueWeek: 2, mine: 2, milestonesSoon: 2 });
  });
});

describe('projectStats', () => {
  it('reports progress and the next milestone', () => {
    const next = milestone({ dueDate: '2026-10-05' });
    const stats = projectStats(work('p1', [task({ dueDate: '2026-10-01' }), task({})], [milestone({ dueDate: '2026-11-01' }), next, milestone({})], { total: 8, done: 6 }), NOW);
    expect(stats).toEqual({ active: 2, overdue: 1, progress: 75, nextMilestone: next });
  });

  it('has no progress before counts load or for an empty project', () => {
    expect(projectStats(work('p1', []), NOW).progress).toBeNull();
    expect(projectStats(work('p1', [], [], { total: 0, done: 0 }), NOW).progress).toBeNull();
  });
});

describe('upcomingDeadlines', () => {
  const overdue = task({ dueDate: '2026-09-28', assigneeIds: ['me'] });
  const mineSoon = task({ dueDate: '2026-10-03', dueTime: '09:00', assigneeIds: ['me'] });
  const theirsSoon = task({ dueDate: '2026-10-03', dueTime: '08:00', assigneeIds: ['other'] });
  const tooFar = task({ dueDate: '2026-10-17', assigneeIds: ['me'] });
  const edge = task({ dueDate: '2026-10-16', assigneeIds: ['me'] });
  const ms = milestone({ dueDate: '2026-10-03' });
  const list = [work('p1', [overdue, mineSoon, theirsSoon, tooFar, edge], [ms, milestone({ dueDate: '2026-10-03', status: 'completed' })])];

  it('merges tasks and milestones by day within the window', () => {
    const days = upcomingDeadlines(list, NOW);
    expect(days.map((day) => day.date)).toEqual(['2026-09-28', '2026-10-03', '2026-10-16']);
    expect(days[0].items[0].overdue).toBe(true);
    expect(days[1].items.map((item) => (item.kind === 'task' ? item.task.id : item.milestone.id))).toEqual([ms.id, theirsSoon.id, mineSoon.id]);
  });

  it('filters tasks to mine but keeps milestones', () => {
    const days = upcomingDeadlines(list, NOW, { mineUid: 'me' });
    expect(days[1].items.map((item) => (item.kind === 'task' ? item.task.id : item.milestone.id))).toEqual([ms.id, mineSoon.id]);
  });
});
