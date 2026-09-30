import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  doc: vi.fn((...parts: unknown[]) => parts.join('/')),
  limit: vi.fn((count: number) => `limit:${count}`),
  onSnapshot: firestore.onSnapshot,
  orderBy: vi.fn((field: string, direction: string) => `order:${field}:${direction}`),
  query: vi.fn((...parts: unknown[]) => parts),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}));

vi.mock('./helpers', () => ({
  activityData: vi.fn(),
  database: vi.fn(() => 'database'),
  withId: vi.fn((item: { id: string }) => ({ id: item.id })),
}));

import { subscribeGachaDraws, subscribeLatestGachaDraw } from './gacha';

describe('gacha subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.onSnapshot.mockReturnValue(firestore.stop);
  });

  it('uses one bounded listener for the requested history size', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeGachaDraws('project-1', 15, callback);

    expect(firestore.onSnapshot).toHaveBeenCalledTimes(1);
    expect(firestore.onSnapshot.mock.calls[0][0]).toEqual([
      'database/projects/project-1/gachaDraws',
      'order:createdAt:desc',
      'limit:15',
    ]);

    const snapshot = firestore.onSnapshot.mock.calls[0][1] as (value: { docs: Array<{ id: string }> }) => void;
    snapshot({ docs: [{ id: 'draw-2' }, { id: 'draw-1' }] });
    expect(callback).toHaveBeenCalledWith([{ id: 'draw-2' }, { id: 'draw-1' }]);
    expect(unsubscribe).toBe(firestore.stop);
  });

  it('adapts the same listener to the latest-draw API', () => {
    const callback = vi.fn();
    subscribeLatestGachaDraw('project-1', callback);

    expect(firestore.onSnapshot).toHaveBeenCalledTimes(1);
    expect(firestore.onSnapshot.mock.calls[0][0]).toContain('limit:1');
    const snapshot = firestore.onSnapshot.mock.calls[0][1] as (value: { docs: Array<{ id: string }> }) => void;
    snapshot({ docs: [] });
    snapshot({ docs: [{ id: 'draw-1' }] });
    expect(callback).toHaveBeenNthCalledWith(1, null);
    expect(callback).toHaveBeenNthCalledWith(2, { id: 'draw-1' });
  });
});
