import { describe, expect, it } from 'vitest';
import { cryptoRandomIndex, drawFromBag, oddsFor } from './gacha';

const target = (winnerCount = 1, previousAssigneeIds: string[] = []) => ({ targetType: 'task' as const, targetId: 't', targetTitle: 'Task', winnerCount, previousAssigneeIds });

describe('gacha shuffle bag', () => {
  it('only gives odds to the least-used tier', () => {
    expect(oddsFor(['a', 'b', 'c'], { a: 0, b: 0, c: 2 })).toEqual({ a: .5, b: .5, c: 0 });
  });
  it('does not repeat a winner within one task and refills the lowest tier', () => {
    const result = drawFromBag(['a', 'b', 'c'], [target(3)], { a: 0, b: 0, c: 1 }, () => 0);
    expect(new Set(result.results[0].winnerIds).size).toBe(3);
    expect(result.results[0].winnerIds).toEqual(['a', 'b', 'c']);
  });
  it('carries counts across targets and excludes existing assignees', () => {
    const result = drawFromBag(['a', 'b'], [target(1, ['a']), { ...target(), targetId: 'two' }], {}, () => 0);
    expect(result.results[0].winnerIds).toEqual(['b']);
    expect(result.results[1].winnerIds).toEqual(['a']);
  });
  it('starts a fresh bag when caller supplies no counts', () => {
    expect(drawFromBag(['new'], [target()], {}, () => 0).winCounts).toEqual({ new: 1 });
  });
  it('rejects impossible targets and invalid random bounds', () => {
    expect(() => drawFromBag(['a'], [target(2)], {}, () => 0)).toThrow('NOT_ENOUGH');
    expect(() => cryptoRandomIndex(0)).toThrow('INVALID_RANDOM_BOUND');
  });
});
