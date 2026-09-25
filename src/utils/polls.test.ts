import { describe, expect, it } from 'vitest';
import { isPollOpen, tally, toggleOption } from './polls';

describe('polls', () => {
  it('toggles options correctly for single and multi choice', () => {
    expect(toggleOption([], 'a', false)).toEqual(['a']);
    expect(toggleOption(['a'], 'b', false)).toEqual(['b']);
    expect(toggleOption(['a'], 'a', false)).toEqual([]);
    expect(toggleOption(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleOption(['a', 'b'], 'a', true)).toEqual(['b']);
  });

  it('tallies votes and computes voter percentages', () => {
    const poll = { id: 'p1', options: [{ id: 'opt1', label: '1' }, { id: 'opt2', label: '2' }] };
    const votes = [
      { pollId: 'p1', userId: 'u1', optionIds: ['opt1'] },
      { pollId: 'p1', userId: 'u2', optionIds: ['opt1', 'opt2'] },
      { pollId: 'other', userId: 'u3', optionIds: ['opt1'] },
    ];
    const { voters, results } = tally(poll, votes);
    expect(voters).toBe(2);
    expect(results[0]).toMatchObject({ id: 'opt1', count: 2, percent: 100 });
    expect(results[1]).toMatchObject({ id: 'opt2', count: 1, percent: 50 });
  });

  it('checks deadline vs current time', () => {
    expect(isPollOpen({ closed: true, deadline: '' })).toBe(false);
    expect(isPollOpen({ closed: false, deadline: '2020-01-01' }, new Date('2026-01-01'))).toBe(false);
    expect(isPollOpen({ closed: false, deadline: '2099-01-01' }, new Date('2026-01-01'))).toBe(true);
    expect(isPollOpen({ closed: false, deadline: '' })).toBe(true);
  });

  it('closes at the deadline time when set', () => {
    const now = new Date(2026, 8, 25, 15);
    expect(isPollOpen({ closed: false, deadline: '2026-09-25', deadlineTime: '14:59' }, now)).toBe(false);
    expect(isPollOpen({ closed: false, deadline: '2026-09-25', deadlineTime: '15:30' }, now)).toBe(true);
    expect(isPollOpen({ closed: false, deadline: '2026-09-25' }, now)).toBe(true);
  });
});
