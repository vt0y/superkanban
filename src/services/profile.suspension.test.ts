import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { getDoc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { ensureUserProfile, subscribeEnsuredProfile } from './profile';

vi.mock('./helpers', () => ({ database: () => ({}), withId: (snapshot: { id: string; data: () => object }) => ({ id: snapshot.id, ...snapshot.data() }) }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(() => ({})), getDoc: vi.fn(), onSnapshot: vi.fn(() => vi.fn()), setDoc: vi.fn(), updateDoc: vi.fn(), serverTimestamp: () => 'server-time' }));
const user = { uid: 'alice', email: 'alice@example.com', displayName: 'New name', photoURL: '' } as User;
const profile = (accountStatus?: string) => ({ id: 'alice', exists: () => true, data: () => ({ email: user.email, displayName: 'Old name', accountStatus, locale: 'en', theme: 'system' }) });
beforeEach(() => vi.clearAllMocks());
describe('profile ensuring during suspension', () => {
  it('does not try to update a suspended profile when ensuring explicitly', async () => {
    vi.mocked(getDoc).mockResolvedValue(profile('suspended') as unknown as Awaited<ReturnType<typeof getDoc>>);
    await ensureUserProfile(user);
    expect(setDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });
  it('delivers suspended status without an automatic profile update, then resumes on reactivation', async () => {
    const callback = vi.fn();
    vi.mocked(updateDoc).mockResolvedValue();
    subscribeEnsuredProfile(user, callback);
    const receive = vi.mocked(onSnapshot).mock.calls[0][1] as unknown as (snapshot: ReturnType<typeof profile>) => void;
    receive(profile('suspended'));
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ accountStatus: 'suspended' }));
    expect(updateDoc).not.toHaveBeenCalled();
    receive(profile('active'));
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ accountStatus: 'active' }));
    expect(updateDoc).toHaveBeenCalledWith({}, { displayName: 'New name', email: user.email, photoURL: '', updatedAt: 'server-time' });
  });
});
