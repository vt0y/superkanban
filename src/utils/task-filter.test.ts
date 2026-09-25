import { describe, expect, it } from 'vitest';
import type { Label, Membership, Milestone, Task } from '@/types';
import { matchTask, parseTaskQuery, toggleQueryTerm } from './task-filter';

const task = (values: Partial<Task>): Task => ({
  id: 't', title: 'Build login', description: 'OAuth flow', status: 'todo', priority: 'medium', assigneeIds: [], tags: [], labelIds: [],
  dueDate: '', milestoneId: '', order: 0, createdBy: 'u1', ...values,
});
const labels = [{ id: 'l1', name: 'bug', color: '#f00' }, { id: 'l2', name: 'good first issue', color: '#0f0' }] as Label[];
const members = [{ id: 'm', userId: 'u2', displayName: 'Somchai Dev', email: 'somchai@example.com' }] as Membership[];
const milestones = [{ id: 'ms1', title: 'Sprint 1' }] as Milestone[];
const ctx = { userId: 'u1', labels, members, milestones, today: new Date(2026, 8, 25) };
const match = (query: string, values: Partial<Task>) => matchTask(task(values), parseTaskQuery(query), ctx);

describe('task-filter', () => {
  it('parses qualifiers, negation and quoted values', () => {
    expect(parseTaskQuery('-label:bug milestone:"Sprint 1" login')).toEqual({
      terms: [{ key: 'label', value: 'bug', negated: true }, { key: 'milestone', value: 'sprint 1', negated: false }],
      text: ['login'],
    });
    expect(parseTaskQuery('foo:bar').text).toEqual(['foo:bar']);
  });

  it('matches free text across title, description and labels', () => {
    expect(match('oauth', {})).toBe(true);
    expect(match('first', { labelIds: ['l2'] })).toBe(true);
    expect(match('logout', {})).toBe(false);
  });

  it('matches labels, including legacy tags and negation', () => {
    expect(match('label:bug', { labelIds: ['l1'] })).toBe(true);
    expect(match('label:"good first issue"', { labelIds: ['l2'] })).toBe(true);
    expect(match('label:frontend', { tags: ['Frontend'] })).toBe(true);
    expect(match('-label:bug', { labelIds: ['l1'] })).toBe(false);
  });

  it('matches assignees, milestones, status and priority', () => {
    expect(match('assignee:@me', { assigneeIds: ['u1'] })).toBe(true);
    expect(match('assignee:somchai', { assigneeIds: ['u2'] })).toBe(true);
    expect(match('no:assignee', { assigneeIds: ['u2'] })).toBe(false);
    expect(match('milestone:"sprint 1"', { milestoneId: 'ms1' })).toBe(true);
    expect(match('no:milestone', { milestoneId: 'deleted' })).toBe(true);
    expect(match('status:in-progress priority:high', { status: 'in_progress', priority: 'high' })).toBe(true);
  });

  it('matches due dates and state', () => {
    expect(match('is:overdue', { dueDate: '2026-09-20' })).toBe(true);
    expect(match('is:overdue', { dueDate: '2026-09-20', status: 'done' })).toBe(false);
    expect(matchTask(task({ dueDate: '2026-09-25', dueTime: '09:00' }), parseTaskQuery('is:overdue'), { ...ctx, today: new Date(2026, 8, 25, 10) })).toBe(true);
    expect(matchTask(task({ dueDate: '2026-09-25', dueTime: '11:00' }), parseTaskQuery('is:overdue'), { ...ctx, today: new Date(2026, 8, 25, 10) })).toBe(false);
    expect(match('due:today', { dueDate: '2026-09-25' })).toBe(true);
    expect(match('due:week', { dueDate: '2026-10-01' })).toBe(true);
    expect(match('due:none', {})).toBe(true);
    expect(match('is:open', { status: 'done' })).toBe(false);
  });

  it('toggles a term in a query', () => {
    expect(toggleQueryTerm('login', 'is:open')).toBe('login is:open');
    expect(toggleQueryTerm('login is:open', 'is:open')).toBe('login');
  });
});
