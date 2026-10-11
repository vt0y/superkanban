import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '@/context/AppContext';
import type { SiteFeedback, FeedbackStatus } from '@/types';
import { subscribeSiteFeedback } from '@/services/feedback';
import { useSiteFeedbackPage } from './useSiteFeedback';

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
vi.mock('@/services/feedback', () => ({ subscribeSiteFeedback: vi.fn(() => vi.fn()) }));
const context = { user: { uid: 'staff' }, siteRole: 'admin' } as AppContextValue;
function render(status?: FeedbackStatus, current = context) {
  lifecycle.index = 0;
  const value = useSiteFeedbackPage(current, { status });
  lifecycle.effects.splice(0).forEach((commit) => commit());
  return value;
}
function receive(rows: SiteFeedback[], call = vi.mocked(subscribeSiteFeedback).mock.calls.length - 1) {
  vi.mocked(subscribeSiteFeedback).mock.calls[call][2](rows);
}
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `f${index}`, status: 'open' } as SiteFeedback));
beforeEach(() => { lifecycle.slots = []; lifecycle.effects = []; lifecycle.index = 0; vi.clearAllMocks(); });

describe('live feedback pagination', () => {
  it('loads in increments of 50 and replaces snapshots after deletion or status changes', async () => {
    expect(render('open').loading).toBe(true);
    receive(rows(51));
    let page = render('open');
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    await page.loadMore();
    await page.loadMore(); // No duplicate click while a request is pending.
    expect(render('open').loadingMore).toBe(true);
    expect(vi.mocked(subscribeSiteFeedback).mock.lastCall?.[4]?.limitCount).toBe(101);
    receive(rows(81));
    page = render('open');
    expect(page.items).toHaveLength(81);
    expect(page.hasMore).toBe(false);
    receive(rows(81).filter((item) => item.id !== 'f65'));
    expect(render('open').items.some((item) => item.id === 'f65')).toBe(false);
  });
  it('clears old rows on filter or user changes and ignores late callbacks', () => {
    render('open'); receive(rows(51));
    expect(render('open').items).toHaveLength(50);
    const changed = render('resolved');
    expect(changed.items).toEqual([]);
    expect(changed.loading).toBe(true);
    receive(rows(3), 0);
    expect(render('resolved').items).toEqual([]);
    receive([{ id: 'resolved', status: 'resolved' } as SiteFeedback]);
    expect(render('resolved').items[0].id).toBe('resolved');
    expect(render(undefined, { user: { uid: 'alice' }, siteRole: null } as AppContextValue).items).toEqual([]);
    expect(vi.mocked(subscribeSiteFeedback).mock.lastCall?.slice(0, 2)).toEqual(['alice', false]);
  });
  it('starts again at 50 when returning to a previously expanded filter', async () => {
    render('open'); receive(rows(51));
    await render('open').loadMore();
    render('open'); receive(rows(101)); render('open');
    render('resolved'); receive([]); render('resolved');
    render('open');
    expect(vi.mocked(subscribeSiteFeedback).mock.lastCall?.[4]?.limitCount).toBe(51);
  });
  it('shows an error and can retry an unsuccessful subscription', () => {
    render('open');
    vi.mocked(subscribeSiteFeedback).mock.lastCall?.[3]?.(new Error('Offline'));
    let page = render('open');
    expect(page.error?.message).toBe('Offline');
    expect(page.loading).toBe(false);
    page.refresh(); render('open');
    receive([]);
    page = render('open');
    expect(page.error).toBeNull();
    expect(page.loading).toBe(false);
    expect(page.hasMore).toBe(false);
  });
  it('marks exactly 50 results as complete rather than offering an empty extra page', () => {
    render(); receive(rows(50));
    expect(render().hasMore).toBe(false);
  });
});
