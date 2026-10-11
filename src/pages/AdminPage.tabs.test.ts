import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { AdminManagement } from '@/components/admin/AdminManagement';
import { AdminPage } from './AdminPage';

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


const location = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('react-router-dom', async (original) => ({
  ...await original<typeof import('react-router-dom')>(),
  useSearchParams: () => [location.params, (update: (current: URLSearchParams) => URLSearchParams) => { location.params = update(location.params); }],
}));
const context = { user: { uid: 'admin' }, siteRole: 'admin', locale: 'en', t: (value: string) => value } as AppContextValue;
function render(tab: string, current = context): ReactNode {
  location.params = new URLSearchParams({ tab });
  const page = AdminPage({ context: current });
  if (page.type === Navigate) return page;
  lifecycle.index = 0;
  const tree = (page.type as (props: typeof page.props) => ReactNode)(page.props);
  lifecycle.effects.splice(0).forEach((commit) => commit());
  return tree;
}
function managers(node: ReactNode): { kind: string; hidden: boolean }[] {
  if (Array.isArray(node)) return node.flatMap(managers);
  if (!isValidElement<{ children?: ReactNode; hidden?: boolean }>(node)) return [];
  if (node.type === 'div' && isValidElement<{ kind: string }>(node.props.children) && node.props.children.type === AdminManagement) {
    return [{ kind: node.props.children.props.kind, hidden: !!node.props.hidden }];
  }
  return managers(node.props.children);
}
beforeEach(() => { lifecycle.slots = []; lifecycle.index = 0; lifecycle.effects = []; });
describe('admin tab switching', () => {
  it('mounts management lazily and retains visited tabs rather than restarting requests', () => {
    expect(managers(render('feedback'))).toEqual([]);
    expect(managers(render('users'))).toEqual([{ kind: 'users', hidden: false }]);
    expect(managers(render('projects'))).toEqual([{ kind: 'users', hidden: true }, { kind: 'projects', hidden: false }]);
    expect(managers(render('users'))).toEqual([{ kind: 'users', hidden: false }, { kind: 'projects', hidden: true }]);
    expect(managers(render('feedback'))).toEqual([{ kind: 'users', hidden: true }, { kind: 'projects', hidden: true }]);
  });
  it('removes all management when site access is revoked', () => {
    render('users'); render('projects');
    expect(managers(render('users', { ...context, siteRole: null }))).toEqual([]);
  });
});
