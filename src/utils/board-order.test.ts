import { describe, expect, it } from 'vitest';
import { isNoopDrop, orderBetween, ordersForDrop } from './board-order';

const column = [{ id: 'a', order: 100 }, { id: 'b', order: 200 }, { id: 'c', order: 300 }];
const sorted = (orders: Map<string, number>, items = column) =>
  items.map((item) => ({ ...item, order: orders.get(item.id) ?? item.order })).sort((x, y) => x.order - y.order).map((item) => item.id);

describe('board-order', () => {
  it('finds a value between neighbours', () => {
    expect(orderBetween(100, 200)).toBe(150);
    expect(orderBetween(100)).toBeGreaterThan(100);
    expect(orderBetween(undefined, 100)).toBeLessThan(100);
  });

  it('moves a card inside its column', () => {
    expect(sorted(ordersForDrop(column, 0, ['c']))).toEqual(['c', 'a', 'b']);
    expect(sorted(ordersForDrop(column, 3, ['a']))).toEqual(['b', 'c', 'a']);
    expect(sorted(ordersForDrop(column, 2, ['a']))).toEqual(['b', 'a', 'c']);
  });

  it('inserts several cards keeping their relative order', () => {
    const incoming = [...column, { id: 'x', order: 5 }, { id: 'y', order: 6 }];
    expect(sorted(ordersForDrop(column, 1, ['x', 'y']), incoming)).toEqual(['a', 'x', 'y', 'b', 'c']);
    expect(sorted(ordersForDrop(column, 0, ['x', 'y']), incoming)).toEqual(['x', 'y', 'a', 'b', 'c']);
  });

  it('handles an empty column', () => {
    expect(ordersForDrop([], 0, ['a']).get('a')).toBeGreaterThan(0);
  });

  it('detects drops that change nothing', () => {
    expect(isNoopDrop(column, 1, ['b'])).toBe(true);
    expect(isNoopDrop(column, 2, ['b'])).toBe(true);
    expect(isNoopDrop(column, 0, ['b'])).toBe(false);
    expect(isNoopDrop(column, 1, ['z'])).toBe(false);
  });
});
