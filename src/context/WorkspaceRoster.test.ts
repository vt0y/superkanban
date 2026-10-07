import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// A deterministic hook lifecycle harness: render, commit effects, deliver snapshots, rerender.
const harness = vi.hoisted(() => {
  type Frame = { values: any[]; effects: Array<{ deps: unknown[]; stop?: () => void }>; pending: Array<() => void>; index: number };
  let frame: Frame;
  let context: any;
  const frames: Frame[] = [];
  return {
    frame: () => { const next: Frame = { values: [], effects: [], pending: [], index: 0 }; frames.push(next); return next; },
    render: <T>(next: Frame, render: () => T): T => { frame = next; frame.index = 0; const result = render(); const effects = frame.pending.splice(0); effects.forEach((effect) => effect()); return result; },
    cleanup: (next: Frame) => next.effects.forEach((effect) => effect?.stop?.()),
    reset: () => { frames.forEach((next) => next.effects.forEach((effect) => effect?.stop?.())); frames.length = 0; },
    setContext: (value: any) => { context = value; },
    useContext: () => context,
    useState: (initial: any) => {
      const owner = frame; const index = frame.index++;
      if (!(index in owner.values)) owner.values[index] = typeof initial === 'function' ? initial() : initial;
      return [owner.values[index], (value: any) => { owner.values[index] = typeof value === 'function' ? value(owner.values[index]) : value; }];
    },
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      const owner = frame; const index = frame.index++; const previous = owner.effects[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      owner.pending.push(() => { previous?.stop?.(); owner.effects[index] = { deps, stop: effect() }; });
    },
  };
});
const snapshots = vi.hoisted(() => ({ subscriptions: [] as Array<{ ref: any; callback: (snapshot: any) => void; stop: ReturnType<typeof vi.fn> }> }));
vi.mock('react', () => ({ createContext: () => ({ Provider: 'provider' }), useState: harness.useState, useEffect: harness.useEffect, useContext: harness.useContext, useMemo: (callback: () => unknown) => callback(), useCallback: (callback: unknown) => callback }));
vi.mock('@/services/helpers', () => ({ database: () => 'db', withId: (snapshot: any) => ({ id: snapshot.id, ...snapshot.data() }) }));
vi.mock('firebase/firestore', () => ({
  doc: (...parts: string[]) => parts.slice(1).join('/'), collection: (...parts: string[]) => parts.slice(1).join('/'),
  query: (path: string, ...constraints: any[]) => ({ path, constraints }), where: (...args: any[]) => args, limit: (count: number) => ({ limit: count }),
  onSnapshot: (ref: any, callback: (snapshot: any) => void) => { const stop = vi.fn(); snapshots.subscriptions.push({ ref, callback, stop }); return stop; },
}));
vi.mock('@/services/tasks', () => ({ subscribeActiveTasks: (projectId: string, callback: (items: any[]) => void) => {
  const stop = vi.fn(); snapshots.subscriptions.push({ ref: `active:${projectId}`, callback, stop }); return stop;
} }));
vi.mock('@/services/work-items', () => ({ subscribeProjectCollection: (projectId: string, name: string, callback: (items: any[]) => void) => {
  const stop = vi.fn(); snapshots.subscriptions.push({ ref: `${name}:${projectId}`, callback, stop }); return stop;
} }));
import { useActiveTasksState } from '@/hooks/useTasks';
import { useProjectItemsState } from '@/hooks/useProjectItems';
import { WorkspaceRosterProvider, useFullProjectMembers } from './WorkspaceRoster';

function session(projectId = 'project', userId = 'me') {
  const element = WorkspaceRosterProvider({ projectId, userId, children: null }) as ReactElement<any>;
  const frame = harness.frame();
  const render = () => harness.render(frame, () => ((element.type as any)(element.props) as ReactElement<any>).props.value);
  return { render, frame, key: element.key };
}
const ownSnapshot = (role: string | null) => ({ exists: () => role !== null, id: 'membership', data: () => ({ userId: 'me', role }) });
const rosterSnapshot = (count: number) => ({ docs: Array.from({ length: count }, (_, index) => ({ id: `member-${index}`, data: () => ({ userId: `user-${index}`, displayName: `Member ${index}`, role: 'member' }) })) });
beforeEach(() => { harness.reset(); snapshots.subscriptions.length = 0; });

describe('workspace roster demand and access', () => {
  it('idle Notes/Documents load own membership and only a five-member preview', () => {
    const provider = session(); provider.render();
    expect(snapshots.subscriptions).toHaveLength(1);
    snapshots.subscriptions[0].callback(ownSnapshot('member'));
    provider.render();
    expect(snapshots.subscriptions).toHaveLength(2);
    expect(snapshots.subscriptions[1].ref.constraints).toContainEqual({ limit: 5 });
    expect(provider.render().full.loaded).toBe(false);
  });

  it('shares one complete roster for two consumers and releases it after the last closes', () => {
    const provider = session(); provider.render(); snapshots.subscriptions[0].callback(ownSnapshot('member'));
    const preview = provider.render(); harness.setContext(preview);
    const first = harness.frame(); const second = harness.frame();
    expect(harness.render(first, () => useFullProjectMembers(true)).loaded).toBe(false);
    harness.render(second, () => useFullProjectMembers(true));
    provider.render();
    const fullSubscription = snapshots.subscriptions[2];
    expect(fullSubscription.ref.constraints).not.toContainEqual({ limit: 5 });
    expect(snapshots.subscriptions[1].stop).toHaveBeenCalledOnce();
    fullSubscription.callback(rosterSnapshot(12));
    harness.setContext(provider.render());
    expect(harness.render(first, () => useFullProjectMembers(true)).members).toHaveLength(12);
    expect(harness.render(second, () => useFullProjectMembers(true)).loaded).toBe(true);
    harness.cleanup(first); provider.render(); expect(fullSubscription.stop).not.toHaveBeenCalled();
    harness.cleanup(second); provider.render(); expect(fullSubscription.stop).toHaveBeenCalledOnce();
  });

  it('updates roles independently and removes access immediately when own membership disappears', () => {
    const provider = session(); provider.render(); const subscription = snapshots.subscriptions[0];
    subscription.callback(ownSnapshot('admin')); expect(provider.render().own.role).toBe('admin');
    subscription.callback(ownSnapshot('member')); expect(provider.render().own.role).toBe('member');
    subscription.callback(ownSnapshot(null)); const removed = provider.render();
    expect(removed.ownLoaded).toBe(true); expect(removed.own).toBeNull(); expect(removed.full.members).toEqual([]);
    expect(snapshots.subscriptions[1].stop).toHaveBeenCalledOnce();
  });

  it('keys sessions by both project and account and starts them with cleared state', () => {
    const first = session('project', 'me'); first.render(); snapshots.subscriptions[0].callback(ownSnapshot('owner'));
    expect(first.render().own.role).toBe('owner');
    const otherAccount = session('project', 'other'); const otherProject = session('other', 'me');
    expect(otherAccount.key).not.toBe(first.key); expect(otherProject.key).not.toBe(first.key);
    expect(otherAccount.render().ownLoaded).toBe(false); expect(otherProject.render().own).toBeNull();
  });
});

describe('screen-specific choice hooks', () => {
  it('disabled active-task choices stay cleared, enable once, and unsubscribe on close', () => {
    const frame = harness.frame();
    expect(harness.render(frame, () => useActiveTasksState('p', false))).toMatchObject({ items: [], loaded: true });
    expect(snapshots.subscriptions).toHaveLength(0);
    expect(harness.render(frame, () => useActiveTasksState('p', true)).loaded).toBe(false);
    snapshots.subscriptions[0].callback([{ id: 'task', title: 'Task' }]);
    expect(harness.render(frame, () => useActiveTasksState('p', true)).items).toHaveLength(1);
    expect(snapshots.subscriptions).toHaveLength(1);
    expect(harness.render(frame, () => useActiveTasksState('p', false)).items).toEqual([]);
    expect(snapshots.subscriptions[0].stop).toHaveBeenCalledOnce();
  });

  it('label/milestone readiness is false immediately on enable and project switching', () => {
    const frame = harness.frame();
    harness.render(frame, () => useProjectItemsState('p', 'labels', false));
    expect(harness.render(frame, () => useProjectItemsState('p', 'labels', true)).loaded).toBe(false);
    snapshots.subscriptions[0].callback([{ id: 'label' }]);
    expect(harness.render(frame, () => useProjectItemsState('p', 'labels', true)).loaded).toBe(true);
    expect(harness.render(frame, () => useProjectItemsState('other', 'labels', true))).toMatchObject({ items: [], loaded: false });
    expect(snapshots.subscriptions[0].stop).toHaveBeenCalledOnce();
  });
});
