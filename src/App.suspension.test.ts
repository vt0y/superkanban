import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import type { UserProfile } from '@/types';
import { subscribeEnsuredProfile, subscribeProjects, subscribeSiteRole } from '@/services';
import { AccountSuspended } from '@/pages/AccountSuspended';
import App from './App';

// Minimal hook lifecycle driver: effects commit after render and cleanup on dependency changes.
const lifecycle = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = lifecycle.index++;
    if (!(index in lifecycle.slots)) lifecycle.slots[index] = initial;
    return [lifecycle.slots[index], (value: unknown) => { lifecycle.slots[index] = typeof value === 'function' ? value(lifecycle.slots[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = lifecycle.index++;
    if (!(index in lifecycle.slots)) lifecycle.slots[index] = { current: initial };
    return lifecycle.slots[index];
  },
  useEffect: (effect: () => (() => void), dependencies: unknown[]) => {
    const index = lifecycle.index++;
    const previous = lifecycle.slots[index] as { dependencies: unknown[]; cleanup?: () => void } | undefined;
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      lifecycle.effects.push(() => {
        previous?.cleanup?.();
        lifecycle.slots[index] = { dependencies, cleanup: effect() };
      });
    }
  },
}));

vi.mock('@/config/firebase', () => ({ auth: {}, googleProvider: {}, missingFirebaseConfig: [] }));
vi.mock('@/config/auth-domains', () => ({ isAllowedUser: () => true }));
vi.mock('firebase/auth', async (original) => ({ ...await original<typeof import('firebase/auth')>(), onAuthStateChanged: vi.fn(() => vi.fn()), signOut: vi.fn(), signInWithPopup: vi.fn() }));
vi.mock('@/services', () => ({ subscribeEnsuredProfile: vi.fn(() => vi.fn()), subscribeProjects: vi.fn(() => vi.fn()), subscribeSiteRole: vi.fn(() => vi.fn()), updatePreferences: vi.fn() }));
function render() {
  lifecycle.index = 0;
  const gate = App();
  const tree = (gate.type as () => ReactNode)();
  lifecycle.effects.splice(0).forEach((commit) => commit());
  return tree;
}
function hasType(node: ReactNode, type: unknown): boolean {
  if (Array.isArray(node)) return node.some((child) => hasType(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  return node.type === type || hasType(node.props.children, type);
}
const user = { uid: 'alice', email: 'alice@example.com' } as User;
const profile = (accountStatus?: 'active' | 'suspended') => ({ id: 'alice', locale: 'en', theme: 'system', accountStatus }) as UserProfile;
function deliverProfile(accountStatus?: 'active' | 'suspended') { vi.mocked(subscribeEnsuredProfile).mock.lastCall?.[1](profile(accountStatus)); }
beforeEach(() => { lifecycle.slots = []; lifecycle.effects = []; lifecycle.index = 0; vi.clearAllMocks(); });
describe('account suspension in AuthGate', () => {
  it('waits for the profile, stops project subscriptions on suspension, and resumes on reactivation', async () => {
    render();
    const signedIn = vi.mocked(onAuthStateChanged).mock.calls[0][1] as (user: User | null) => Promise<void>;
    await signedIn(user); render();
    expect(subscribeProjects).not.toHaveBeenCalled();
    deliverProfile();
    vi.mocked(subscribeSiteRole).mock.lastCall?.[1](null);
    render();
    expect(subscribeProjects).toHaveBeenCalledOnce();
    const stopProjects = vi.mocked(subscribeProjects).mock.results[0].value;
    deliverProfile('suspended');
    expect(hasType(render(), AccountSuspended)).toBe(true);
    expect(stopProjects).toHaveBeenCalledOnce();
    deliverProfile('active');
    expect(hasType(render(), AccountSuspended)).toBe(false);
    expect(subscribeProjects).toHaveBeenCalledTimes(2);
  });
  it('shows suspension on initial login without subscribing to projects', async () => {
    render();
    await (vi.mocked(onAuthStateChanged).mock.calls[0][1] as (user: User) => Promise<void>)(user);
    render(); deliverProfile('suspended');
    expect(hasType(render(), AccountSuspended)).toBe(true);
    expect(subscribeProjects).not.toHaveBeenCalled();
  });
});
