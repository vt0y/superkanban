import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCountFromServer, onSnapshot, updateDoc } from 'firebase/firestore';
import { loadSiteFeedbackCounts, subscribeSiteFeedback, updateSiteFeedback } from './feedback';

vi.mock('./helpers', () => ({ database: () => ({}), withId: (snapshot: { id: string; data: () => object }) => ({ id: snapshot.id, ...snapshot.data() }) }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, path) => ({ path })),
  doc: vi.fn((_db, path, id) => ({ path, id })),
  query: vi.fn((source, ...constraints) => ({ source, constraints })),
  where: vi.fn((field, operator, value) => ({ field, operator, value })),
  orderBy: vi.fn((field, direction) => ({ order: field, direction })),
  documentId: () => '__name__', limit: (value: number) => ({ limit: value }),
  getCountFromServer: vi.fn(), onSnapshot: vi.fn(() => vi.fn()),
  updateDoc: vi.fn(), serverTimestamp: () => 'server-time',
  addDoc: vi.fn(), deleteDoc: vi.fn(), getDocs: vi.fn(), startAfter: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

describe('admin feedback services', () => {
  it('counts the entire inbox beyond the first page, separately by status', async () => {
    for (const count of [125, 80, 20, 15, 10]) vi.mocked(getCountFromServer).mockResolvedValueOnce({ data: () => ({ count }) } as Awaited<ReturnType<typeof getCountFromServer>>);
    expect(await loadSiteFeedbackCounts()).toEqual({ total: 125, byStatus: { open: 80, in_review: 20, resolved: 15, declined: 10 } });
    expect(getCountFromServer).toHaveBeenCalledTimes(5);
    expect(getCountFromServer).toHaveBeenNthCalledWith(1, { path: 'siteFeedback' });
    expect(getCountFromServer).toHaveBeenNthCalledWith(2, { source: { path: 'siteFeedback' }, constraints: [{ field: 'status', operator: '==', value: 'open' }] });
  });
  it('propagates aggregation failures rather than showing a false zero', async () => {
    vi.mocked(getCountFromServer).mockRejectedValue(new Error('Denied'));
    await expect(loadSiteFeedbackCounts()).rejects.toThrow('Denied');
  });
  it('queries admin status on the server and keeps ordinary users restricted to their submissions', () => {
    subscribeSiteFeedback('staff', true, vi.fn(), vi.fn(), { status: 'open', limitCount: 51 });
    expect(onSnapshot).toHaveBeenLastCalledWith({ source: { path: 'siteFeedback' }, constraints: [
      { field: 'status', operator: '==', value: 'open' }, { order: 'createdAt', direction: 'desc' }, { order: '__name__', direction: undefined }, { limit: 51 },
    ] }, expect.any(Function), expect.any(Function));
    subscribeSiteFeedback('alice', false, vi.fn());
    expect(onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ constraints: expect.arrayContaining([{ field: 'userId', operator: '==', value: 'alice' }]) }), expect.any(Function), undefined);
  });
  it('writes only the requested triage fields and the server timestamp', async () => {
    await updateSiteFeedback('f1', { adminReply: 'Answer', status: 'resolved' });
    expect(updateDoc).toHaveBeenCalledWith({ path: 'siteFeedback', id: 'f1' }, { adminReply: 'Answer', status: 'resolved', updatedAt: 'server-time' });
  });
});
