import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminCollection } from './useAdminCollection';
import type { AdminPageResult } from '@/services/admin';

// Minimal hook lifecycle driver: effects commit after render and cleanup on dependency changes.
const lifecycle = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', () => ({
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

type Row = { id: string };
const loader = vi.fn<(cursor?: string) => Promise<AdminPageResult<Row>>>();
function render(identity = 'admin') {
  lifecycle.index = 0;
  const value = useAdminCollection(loader, identity);
  lifecycle.effects.splice(0).forEach((commit) => commit());
  return value;
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const page = (ids: string[], hasMore = false): AdminPageResult<Row> => ({ items: ids.map((id) => ({ id })), nextCursor: ids.at(-1) ?? null, hasMore });
beforeEach(() => { lifecycle.slots = []; lifecycle.effects = []; lifecycle.index = 0; loader.mockReset(); });
describe('management pagination', () => {
  it('appends pages, deduplicates IDs, and retries the failed cursor without discarding prior rows', async () => {
    loader.mockResolvedValueOnce(page(['a', 'b'], true)).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(page(['b', 'c']));
    render(); await settle();
    expect(render().items).toEqual([{ id: 'a' }, { id: 'b' }]);
    await render().loadMore();
    expect(render().error).toEqual({ code: 'unknown' });
    expect(render().items).toHaveLength(2);
    render().retry(); await settle();
    expect(render().items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(loader.mock.calls).toEqual([[], ['b'], ['b']]);
    expect(render().hasMore).toBe(false);
  });
  it('ignores a previous page after refresh and blocks duplicate load-more clicks', async () => {
    let finish!: (page: AdminPageResult<Row>) => void;
    loader.mockResolvedValueOnce(page(['a'], true)).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(page(['new']));
    render(); await settle();
    const state = render();
    const pending = state.loadMore();
    await state.loadMore();
    expect(loader).toHaveBeenCalledTimes(2);
    render().refresh(); render(); await settle();
    finish(page(['stale'])); await pending;
    expect(render().items.map((item) => item.id)).toEqual(['new']);
  });
  it('does not deliver late results after unmount', async () => {
    let finish!: (page: AdminPageResult<Row>) => void;
    loader.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render();
    lifecycle.slots.forEach((slot) => (slot as { cleanup?: () => void })?.cleanup?.());
    finish(page(['late'])); await settle();
    expect(render().items).toEqual([]);
  });
  it('supports local updates after successful writes and retry of an initial failure', async () => {
    loader.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(page(['a']));
    render(); await settle();
    expect(render().error).toEqual({ code: 'unknown' });
    render().retry(); render(); await settle();
    expect(render().error).toBeNull();
    render().replace('a', { id: 'updated' });
    expect(render().items).toEqual([{ id: 'updated' }]);
  });
  it('shares a pending request across effect replay on tab remount', async () => {
    let finish!: (value: AdminPageResult<Row>) => void;
    loader.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render();
    const effect = lifecycle.slots.find((slot) => slot && typeof slot === 'object' && 'cleanup' in slot) as { cleanup: () => void };
    effect.cleanup();
    // Start a new component instance for the same tab, as StrictMode/remount does.
    lifecycle.slots = []; lifecycle.effects = [];
    render();
    expect(loader).toHaveBeenCalledOnce();
    finish(page(['current'])); await settle();
    expect(render().items).toEqual([{ id: 'current' }]);
  });
  it('does not share pending data between different accounts', async () => {
    let finish!: (value: AdminPageResult<Row>) => void;
    loader.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(page(['other']));
    render('first');
    render('second'); await settle();
    expect(loader).toHaveBeenCalledTimes(2);
    finish(page(['first'])); await settle();
    expect(render('second').items).toEqual([{ id: 'other' }]);
  });
  it('retains loaded rows if refreshing fails and preserves the error code', async () => {
    loader.mockResolvedValueOnce(page(['a'], true)).mockRejectedValueOnce({ code: 'firestore/permission-denied' });
    render(); await settle();
    render().refresh(); render(); await settle();
    expect(render().items).toEqual([{ id: 'a' }]);
    expect(render().error).toEqual({ code: 'permission-denied' });
  });

});
