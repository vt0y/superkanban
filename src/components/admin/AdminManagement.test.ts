import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '@/context/AppContext';
import type { AdminProject, AdminUser } from '@/services/admin';
import { setAdminAccountStatus, setAdminProjectArchived } from '@/services/admin';
import { toast } from '@/components/toast';
import { AdminManagement } from './AdminManagement';

const state = vi.hoisted(() => ({ items: [] as (AdminUser | AdminProject)[], replace: vi.fn() }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => [initial, vi.fn()], useRef: (initial: unknown) => ({ current: initial }) }));
vi.mock('@/hooks/useAdminCollection', () => ({ useAdminCollection: () => ({ items: state.items, replace: state.replace, loading: false, loadingMore: false, error: false, hasMore: false, refresh: vi.fn() }) }));
vi.mock('@/services/admin', () => ({ loadAdminUsers: vi.fn(), loadAdminProjects: vi.fn(), setAdminAccountStatus: vi.fn(), setAdminProjectArchived: vi.fn() }));
vi.mock('@/components/toast', () => ({ toast: vi.fn() }));
const context = { locale: 'en', user: { uid: 'staff' } } as AppContextValue;
const user = (id = 'member', siteRole: AdminUser['siteRole'] = null): AdminUser => ({ id, displayName: 'Member', email: `${id}@example.com`, siteRole, kind: 'user', locale: 'en', theme: 'system', photoURL: '' });
const project: AdminProject = { id: 'p1', kind: 'project', name: 'Project', ownerId: 'owner', ownerName: 'Owner', ownerEmail: '', memberIds: ['owner'], archived: false, description: '', color: '' };
function buttons(node: ReactNode): { children?: ReactNode; disabled?: boolean; onClick: () => void }[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick: () => void }>(node)) return [];
  return [...(node.type === 'button' ? [node.props] : []), ...buttons(node.props.children)];
}
function button(kind: 'users' | 'projects', label: string) {
  return buttons(AdminManagement({ context, kind })).find((entry) => entry.children === label)!;
}
beforeEach(() => { vi.resetAllMocks(); state.items = []; vi.stubGlobal('confirm', vi.fn(() => true)); });
afterEach(() => vi.unstubAllGlobals());
describe('management actions', () => {
  it('confirms and suspends a legacy active user, prevents duplicate writes, then updates the row', async () => {
    state.items = [user()];
    vi.mocked(setAdminAccountStatus).mockResolvedValue();
    const action = button('users', 'Suspend user');
    action.onClick(); action.onClick();
    expect(setAdminAccountStatus).toHaveBeenCalledOnce();
    expect(setAdminAccountStatus).toHaveBeenCalledWith('member', 'suspended', 'staff');
    await vi.waitFor(() => expect(state.replace).toHaveBeenCalledWith('member', { accountStatus: 'suspended' }));
    expect(toast).toHaveBeenCalledWith('Status updated', 'success');
  });
  it('protects staff and the current account even when invoking their handler directly', () => {
    for (const entry of [user('staff'), user('other', 'owner'), user('other', 'admin')]) {
      state.items = [entry];
      const action = button('users', 'Protected account');
      expect(action.disabled).toBe(true);
      action.onClick();
    }
    expect(confirm).not.toHaveBeenCalled();
    expect(setAdminAccountStatus).not.toHaveBeenCalled();
  });
  it('does not mutate when confirmation is cancelled', () => {
    state.items = [project];
    vi.mocked(confirm).mockReturnValue(false);
    button('projects', 'Archive').onClick();
    expect(setAdminProjectArchived).not.toHaveBeenCalled();
  });
  it('reports errors without changing local state or claiming success', async () => {
    state.items = [project];
    vi.mocked(setAdminProjectArchived).mockRejectedValue(new Error('Denied'));
    button('projects', 'Archive').onClick();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Update failed. Refresh and retry.', 'error'));
    expect(state.replace).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledOnce();
  });
  it('reactivates users and restores archived projects', async () => {
    state.items = [{ ...user(), accountStatus: 'suspended' }];
    vi.mocked(setAdminAccountStatus).mockResolvedValue();
    button('users', 'Reactivate').onClick();
    await vi.waitFor(() => expect(state.replace).toHaveBeenCalledWith('member', { accountStatus: 'active' }));
    state.items = [{ ...project, archived: true }];
    vi.mocked(setAdminProjectArchived).mockResolvedValue();
    button('projects', 'Restore project').onClick();
    await vi.waitFor(() => expect(state.replace).toHaveBeenCalledWith('p1', { archived: false }));
    expect(setAdminProjectArchived).toHaveBeenCalledWith('p1', false);
  });
});
