import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '@/context/AppContext';
import { useSiteFeedbackPage } from '@/hooks/useSiteFeedback';
import { AdminPage } from './AdminPage';

vi.mock('@/components/layout/AppHeader', () => ({ AppHeader: () => null }));
vi.mock('@/hooks/useSiteFeedback', () => ({ useSiteFeedbackPage: vi.fn(() => ({ items: [], hasMore: false, loading: false, loadingMore: false, error: null, loadMore: vi.fn(), refresh: vi.fn() })) }));
vi.mock('@/services/feedback', () => ({ loadSiteFeedbackCounts: vi.fn() }));
function markup(siteRole: AppContextValue['siteRole'], locale = 'en', path = '/admin?tab=feedback') {
  const context = { siteRole, locale, user: { uid: 'staff' }, t: () => 'Overview' } as unknown as AppContextValue;
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(AdminPage, { context })));
}
beforeEach(() => vi.clearAllMocks());
describe('admin page access and presentation', () => {
  it('never starts admin data hooks for an ordinary user or revoked role', () => {
    markup(null);
    expect(useSiteFeedbackPage).not.toHaveBeenCalled();
    markup('admin');
    vi.clearAllMocks();
    markup(null);
    expect(useSiteFeedbackPage).not.toHaveBeenCalled();
  });
  it.each(['owner', 'admin'] as const)('opens the inbox for site %s with open status by default', (role) => {
    expect(markup(role)).toContain('Feedback inbox');
    expect(useSiteFeedbackPage).toHaveBeenCalledWith(expect.objectContaining({ siteRole: role }), { status: 'open' });
  });
  it.each(['users', 'projects'])('opens the %s deep link without loading the feedback inbox', (tab) => {
    const html = markup('admin', 'en', `/admin?tab=${tab}`);
    expect(html).toContain(tab === 'users' ? 'User management' : 'Project management');
    expect(useSiteFeedbackPage).not.toHaveBeenCalled();
    expect(html).toContain('Search and filters apply to loaded records');
  });
  it('uses overview for the default and an unknown tab, loading only a short open-feedback preview', () => {
    expect(markup('admin', 'en', '/admin')).toContain('Site overview');
    expect(markup('admin', 'en', '/admin?tab=unknown')).toContain('Latest open feedback');
    expect(useSiteFeedbackPage).toHaveBeenCalledWith(expect.anything(), { status: 'open', limitCount: 5 });
    expect(useSiteFeedbackPage).not.toHaveBeenCalledWith(expect.anything(), { status: 'open' });
  });
  it('applies a status deep link to the management filter', () => {
    expect(markup('admin', 'en', '/admin?tab=users&status=suspended')).toMatch(/<option value="suspended" selected="">/);
  });
  it('renders Thai labels, side navigation, status filters, and category filter', () => {
    const html = markup('admin', 'th');
    expect(html).toContain('ผู้ดูแลเว็บ');
    expect(html).toContain('กล่องฟีดแบ็ก');
    expect(html).toContain('ประเภทฟีดแบ็ก');
    expect(html).toContain('admin-nav');
    expect(html).toContain('กำลังพิจารณา');
    expect(html).not.toContain('admin-metrics');
  });
});
