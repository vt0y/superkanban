import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '@/context/AppContext';
import type { AdminProject, AdminUser } from '@/services/admin';
import { setAdminAccountStatus, setAdminProjectArchived, setAdminStaffRole } from '@/services/admin';
import { toast } from '@/components/toast';
import { AdminManagement } from './AdminManagement';

const state = vi.hoisted(() => ({ items: [] as (AdminUser | AdminProject)[], replace: vi.fn(), changed: vi.fn() }));
const hooks = vi.hoisted(() => ({ index: 0, slots: [] as unknown[] }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));
vi.mock('@/hooks/useAdminCollection', () => ({ useAdminCollection: () => ({ items: state.items, replace: state.replace, loading: false, loadingMore: false, error: false, hasMore: false, refresh: vi.fn() }) }));
vi.mock('@/services/admin', () => ({ loadAdminUsers: vi.fn(), loadAdminProjects: vi.fn(), setAdminAccountStatus: vi.fn(), setAdminProjectArchived: vi.fn(), setAdminStaffRole: vi.fn() }));
vi.mock('@/components/toast', () => ({ toast: vi.fn() }));
const context = { siteRole: 'admin', locale: 'en', user: { uid: 'staff' } } as AppContextValue;
const user = (id = 'member', siteRole: AdminUser['siteRole'] = null): AdminUser => ({ id, displayName: 'Member', email: `${id}@example.com`, siteRole, kind: 'user', locale: 'en', theme: 'system', photoURL: '' });
const project: AdminProject = { id: 'p1', kind: 'project', name: 'Project', ownerId: 'owner', ownerName: 'Owner', ownerEmail: '', memberIds: ['owner'], archived: false, description: '', color: '' };
type Props = { children?: ReactNode; disabled?: boolean; onClick: () => void; onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => void };
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : '';
}
function elements(node: ReactNode, type: string): Props[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!isValidElement<Props>(node)) return [];
  return [...(node.type === type ? [node.props] : []), ...elements(node.props.children, type)];
}
function renderManagement(kind: 'users' | 'projects', current = context) {
  hooks.index = 0;
  return AdminManagement({ context: current, kind, status: 'all', onStatusChange: vi.fn(), onChanged: state.changed });
}
function button(kind: 'users' | 'projects', label: string, current = context) {
  return elements(renderManagement(kind, current), 'button').find((entry) => text(entry.children) === label);
}
const form = (kind: 'users' | 'projects') => elements(renderManagement(kind), 'form')[0];
const submit = (kind: 'users' | 'projects') => form(kind)!.onSubmit!({ preventDefault: vi.fn() });
beforeEach(() => { vi.resetAllMocks(); hooks.slots = []; hooks.index = 0; state.items = []; state.changed = vi.fn(); });
describe('management actions', () => {
  it('opens a reason dialog before archiving, without writing immediately', () => {
    state.items = [project];
    button('projects', 'Archive')!.onClick();
    expect(setAdminProjectArchived).not.toHaveBeenCalled();
    expect(form('projects')).toBeDefined();
  });
  it('submits a required moderation reason and closes only after the archive succeeds', async () => {
    state.items = [project];
    vi.mocked(setAdminProjectArchived).mockResolvedValue();
    button('projects', 'Archive')!.onClick();
    submit('projects');
    expect(setAdminProjectArchived).not.toHaveBeenCalled();
    elements(renderManagement('projects'), 'textarea')[0].onChange!({ target: { value: 'Spam review' } });
    submit('projects'); submit('projects');
    expect(setAdminProjectArchived).toHaveBeenCalledOnce();
    expect(setAdminProjectArchived).toHaveBeenCalledWith('p1', true, 'staff', 'Spam review');
    await vi.waitFor(() => expect(state.replace).toHaveBeenCalledWith('p1', expect.objectContaining({ archived: true, moderationArchived: true, moderationReason: 'Spam review' })));
    await vi.waitFor(() => expect(form('projects')).toBeUndefined());
    expect(state.changed).toHaveBeenCalledOnce();
  });
  it('offers inspection without granting project membership', () => {
    state.items = [project];
    expect(button('projects', 'Inspect')).toBeDefined();
  });
  it('shows staff controls only for site owners and protects suspended targets and owners', async () => {
    state.items = [user()];
    expect(button('users', 'Grant site admin')).toBeUndefined();
    const ownerContext = { ...context, siteRole: 'owner' as const };
    vi.mocked(setAdminStaffRole).mockResolvedValue();
    button('users', 'Grant site admin', ownerContext)!.onClick();
    expect(setAdminStaffRole).not.toHaveBeenCalled();
    hooks.index = 0;
    elements(AdminManagement({ context: ownerContext, kind: 'users', status: 'all', onStatusChange: vi.fn() }), 'form')[0].onSubmit!({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(setAdminStaffRole).toHaveBeenCalledWith('member', true, 'staff'));
    expect(state.replace).toHaveBeenCalledWith('member', { siteRole: 'admin' });
    hooks.slots = [];
    state.items = [user('other-owner', 'owner'), { ...user('suspended'), accountStatus: 'suspended' }];
    const grants = elements(renderManagement('users', ownerContext), 'button').filter((entry) => text(entry.children) === 'Grant site admin');
    expect(grants).toHaveLength(1);
    expect(grants[0].disabled).toBe(true);
    grants[0].onClick();
    expect(elements(renderManagement('users', ownerContext), 'form')).toHaveLength(0);
    expect(setAdminStaffRole).toHaveBeenCalledOnce();
  });
  it('confirms and suspends a legacy active user, prevents duplicate writes, then updates the row', async () => {
    state.items = [user()];
    vi.mocked(setAdminAccountStatus).mockResolvedValue();
    button('users', 'Suspend user')!.onClick();
    expect(setAdminAccountStatus).not.toHaveBeenCalled();
    submit('users'); submit('users');
    expect(setAdminAccountStatus).toHaveBeenCalledOnce();
    expect(setAdminAccountStatus).toHaveBeenCalledWith('member', 'suspended', 'staff');
    await vi.waitFor(() => expect(state.replace).toHaveBeenCalledWith('member', { accountStatus: 'suspended' }));
    expect(toast).toHaveBeenCalledWith('Status updated', 'success');
  });
  it('offers no status action for staff or the current account and marks them protected', () => {
    for (const entry of [user('staff'), user('other', 'owner'), user('other', 'admin')]) {
      state.items = [entry];
      const tree = renderManagement('users');
      expect(elements(tree, 'button').find((item) => text(item.children) === 'Suspend user')).toBeUndefined();
      expect(text(tree)).toContain('Protected');
    }
    expect(setAdminAccountStatus).not.toHaveBeenCalled();
  });
  it('does not mutate when confirmation is cancelled', () => {
    state.items = [{ ...project, archived: true }];
    button('projects', 'Restore project')!.onClick();
    elements(renderManagement('projects'), 'button').find((entry) => text(entry.children) === 'Cancel')!.onClick();
    expect(form('projects')).toBeUndefined();
    expect(setAdminProjectArchived).not.toHaveBeenCalled();
  });
  it('reports errors without changing local state or claiming success', async () => {
    state.items = [{ ...project, archived: true }];
    vi.mocked(setAdminProjectArchived).mockRejectedValue(new Error('Denied'));
    button('projects', 'Restore project')!.onClick();
    submit('projects');
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Update failed. Refresh and retry.', 'error'));
    expect(state.replace).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledOnce();
    expect(form('projects')).toBeDefined();
  });
  it('reactivates users and restores archived projects', async () => {
    state.items = [{ ...user(), accountStatus: 'suspended' }];
    vi.mocked(setAdminAccountStatus).mockResolvedValue();
    button('users', 'Reactivate')!.onClick();
    submit('users');
    await vi.waitFor(() => expect(state.replace).toHaveBeenCalledWith('member', { accountStatus: 'active' }));
    hooks.slots = [];
    state.items = [{ ...project, archived: true }];
    vi.mocked(setAdminProjectArchived).mockResolvedValue();
    button('projects', 'Restore project')!.onClick();
    submit('projects');
    await vi.waitFor(() => expect(state.replace).toHaveBeenCalledWith('p1', { archived: false, moderationArchived: false, moderationReason: '' }));
    expect(setAdminProjectArchived).toHaveBeenCalledWith('p1', false, 'staff', undefined);
  });
});
