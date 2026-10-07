import { afterEach, describe, expect, it, vi } from 'vitest';
import { onSnapshot } from 'firebase/firestore';
import { subscribeInvite } from './invites';

const unsubscribe = vi.hoisted(() => vi.fn());
vi.mock('./helpers', () => ({
  database: () => ({}),
  withId: (snapshot: { id: string; data: () => object }) => ({ id: snapshot.id, ...snapshot.data() }),
}));
vi.mock('firebase/firestore', async (original) => ({
  ...await original<typeof import('firebase/firestore')>(),
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => unsubscribe),
}));

afterEach(() => vi.clearAllMocks());
const snapshot = (fromCache: boolean, exists = true) => ({
  id: 'link', metadata: { fromCache }, exists: () => exists, data: () => ({ projectName: 'Cached private name' }),
});
// This test drives the snapshot callback rather than creating a real Firestore connection.
function snapshotHandler() {
  return vi.mocked(onSnapshot).mock.calls[0][2] as unknown as (value: ReturnType<typeof snapshot>) => void;
}

describe('server-authorized invitation previews', () => {
  it('waits for server authorization even when cached data is identical', () => {
    const callback = vi.fn();
    expect(subscribeInvite('link', callback)).toBe(unsubscribe);
    expect(vi.mocked(onSnapshot).mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
    const receive = snapshotHandler();
    receive(snapshot(true));
    expect(callback).not.toHaveBeenCalled();
    receive(snapshot(false));
    expect(callback).toHaveBeenCalledWith({ id: 'link', projectName: 'Cached private name' });
  });
  it('does not mistake an empty local cache for a missing invitation', () => {
    const callback = vi.fn();
    subscribeInvite('missing', callback);
    const receive = snapshotHandler();
    receive(snapshot(true, false));
    expect(callback).not.toHaveBeenCalled();
    receive(snapshot(false, false));
    expect(callback).toHaveBeenCalledWith(null);
  });
  it('forwards permission denial without emitting cached metadata', () => {
    const callback = vi.fn();
    const failed = vi.fn();
    subscribeInvite('link', callback, failed);
    snapshotHandler()(snapshot(true));
    const reject = vi.mocked(onSnapshot).mock.calls[0][3] as unknown as (error: Error) => void;
    const error = Object.assign(new Error('Denied'), { code: 'permission-denied' });
    reject(error);
    expect(failed).toHaveBeenCalledWith(error);
    expect(callback).not.toHaveBeenCalled();
  });
});
