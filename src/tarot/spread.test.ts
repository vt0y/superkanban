import { describe, expect, it } from 'vitest';
import { fanPosition } from './spread';

describe('fanPosition', () => {
  const all = Array.from({ length: 78 }, (_, index) => fanPosition(index, 78));

  it('splits the deck into two arcs of 39', () => {
    expect(all.filter((item) => item.row === 0)).toHaveLength(39);
    expect(all.filter((item) => item.row === 1)).toHaveLength(39);
  });

  it('spreads each arc symmetrically across the span', () => {
    const front = all.slice(0, 39).map((item) => item.angle);
    expect(front[0]).toBe(-56);
    expect(front[38]).toBe(56);
    expect(front[19]).toBe(0);
    front.forEach((angle, i) => expect(angle).toBeCloseTo(-front[38 - i]));
    all.forEach(({ angle }) => expect(Math.abs(angle)).toBeLessThanOrEqual(56));
  });

  it('handles an uneven split and a single card', () => {
    expect(fanPosition(4, 5, 2)).toEqual({ row: 1, angle: 56 });
    expect(fanPosition(0, 1, 2)).toEqual({ row: 0, angle: 0 });
  });
});
