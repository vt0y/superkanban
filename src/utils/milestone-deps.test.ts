import { describe, expect, it } from 'vitest';
import { blockingMilestones, isBlocked, milestoneCompletion, topoOrder, wouldCreateCycle } from './milestone-deps';

describe('milestone-deps', () => {
  it('reports blocking milestones that are not completed', () => {
    const all = [
      { id: 'm1', status: 'completed' as const },
      { id: 'm2', status: 'active' as const },
      { id: 'm3', status: 'active' as const, dependsOn: ['m1', 'm2'] },
    ];
    expect(blockingMilestones(all[2], all).map((m) => m.id)).toEqual(['m2']);
    expect(isBlocked(all[2], all)).toBe(true);
    expect(isBlocked(all[0], all)).toBe(false);
  });

  it('allows completion only when dependencies and assigned tasks are complete', () => {
    const all = [
      { id: 'm1', status: 'completed' as const },
      { id: 'm2', status: 'active' as const, dependsOn: ['m1'] },
    ];
    expect(milestoneCompletion(all[1], all, [
      { milestoneId: 'm2', status: 'done' },
      { milestoneId: 'm2', status: 'review' },
      { milestoneId: 'm1', status: 'todo' },
    ])).toMatchObject({ canComplete: false, incompleteTaskCount: 1, taskCount: 2 });
    expect(milestoneCompletion(all[1], all, [
      { milestoneId: 'm2', status: 'done' },
    ])).toMatchObject({ canComplete: true, incompleteTaskCount: 0, taskCount: 1 });
  });

  it('allows an empty milestone after the UI confirmation step', () => {
    const milestone = { id: 'm1', status: 'active' as const };
    expect(milestoneCompletion(milestone, [milestone], [])).toEqual({
      canComplete: true,
      blockingMilestones: [],
      incompleteTaskCount: 0,
      taskCount: 0,
    });
  });

  it('reports an unfinished prerequisite even when there are no tasks', () => {
    const all = [
      { id: 'm1', status: 'active' as const },
      { id: 'm2', status: 'active' as const, dependsOn: ['m1'] },
    ];
    const state = milestoneCompletion(all[1], all, []);
    expect(state.canComplete).toBe(false);
    expect(state.blockingMilestones.map((item) => item.id)).toEqual(['m1']);
  });

  it('detects direct cycles', () => {
    const all = [{ id: 'a', status: 'active' as const, dependsOn: ['b'] }, { id: 'b', status: 'active' as const }];
    expect(wouldCreateCycle('b', ['a'], all)).toBe(true);
  });

  it('detects transitive cycles', () => {
    const all = [
      { id: 'a', status: 'active' as const, dependsOn: ['b'] },
      { id: 'b', status: 'active' as const, dependsOn: ['c'] },
      { id: 'c', status: 'active' as const },
    ];
    expect(wouldCreateCycle('c', ['a'], all)).toBe(true);
    expect(wouldCreateCycle('c', ['unrelated'], all)).toBe(false);
  });

  it('sorts topologically with prerequisites first', () => {
    const all = [
      { id: 'launch', dueDate: '2026-06-01', status: 'active' as const, dependsOn: ['beta'] },
      { id: 'alpha', dueDate: '2026-03-01', status: 'active' as const },
      { id: 'beta', dueDate: '2026-04-01', status: 'active' as const, dependsOn: ['alpha'] },
    ];
    expect(topoOrder(all).map((m) => m.id)).toEqual(['alpha', 'beta', 'launch']);
  });

  it('puts milestones without a due date last', () => {
    const all = [
      { id: 'someday', dueDate: '', status: 'active' as const },
      { id: 'soon', dueDate: '2026-03-01', status: 'active' as const },
    ];
    expect(topoOrder(all).map((m) => m.id)).toEqual(['soon', 'someday']);
  });
});
