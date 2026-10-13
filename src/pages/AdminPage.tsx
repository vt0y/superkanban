import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '@/config/constants';
import type { FeedbackCategory, FeedbackStatus } from '@/types';
import type { FeedbackCounts } from '@/services/feedback';
import { useSiteFeedbackPage } from '@/hooks/useSiteFeedback';
import { useAdminCounts } from '@/hooks/useAdminCounts';
import { AdminManagement, type AdminStatusFilter } from '@/components/admin/AdminManagement';
import { AdminOverview, type AdminTab } from '@/components/admin/AdminOverview';
import { AppHeader } from '@/components/layout/AppHeader';
import { FeedbackCard } from '@/components/feedback/FeedbackCard';
import { Empty } from '@/components/common/Empty';
import { Icon, type IconName } from '@/components/common/Icon';
import { Segmented } from '@/components/common/Segmented';
import { pick } from '@/utils/formatters';

const TABS: AdminTab[] = ['overview', 'feedback', 'users', 'projects'];
const STATUS_FILTERS: AdminStatusFilter[] = ['all', 'active', 'suspended', 'archived'];

export function AdminPage({ context }: { context: AppContextValue }) {
  // Guard here as well as at the route: no admin hooks run for ordinary users.
  if (context.profile?.accountStatus === 'suspended' || (context.siteRole !== 'owner' && context.siteRole !== 'admin')) return <Navigate to="/" replace />;
  return <AdminShell key={context.user.uid} context={context} />;
}

function AdminShell({ context }: { context: AppContextValue }) {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab') as AdminTab | null;
  const tab: AdminTab = value && TABS.includes(value) ? value : 'overview';
  const requested = params.get('status') as AdminStatusFilter | null;
  const status: AdminStatusFilter = requested && STATUS_FILTERS.includes(requested) ? requested : 'all';
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    if (tab === 'users' || tab === 'projects') setVisited((current) => current.includes(tab) ? current : [...current, tab]);
  }, [tab]);
  const counts = useAdminCounts(context);
  const { locale } = context;
  const navigate = (next: AdminTab, nextStatus?: string) => setParams((current) => {
    const updated = new URLSearchParams(current);
    updated.set('tab', next);
    if (nextStatus) updated.set('status', nextStatus); else updated.delete('status');
    return updated;
  });
  const setStatus = (next: AdminStatusFilter) => setParams((current) => {
    const updated = new URLSearchParams(current);
    if (next === 'all') updated.delete('status'); else updated.set('status', next);
    return updated;
  });
  const items: { id: AdminTab; icon: IconName; label: string; badge?: number }[] = [
    { id: 'overview', icon: 'dashboard', label: pick(locale, 'ภาพรวม', 'Overview') },
    { id: 'feedback', icon: 'feedback', label: pick(locale, 'ฟีดแบ็ก', 'Feedback'), badge: counts.feedback?.byStatus.open },
    { id: 'users', icon: 'team', label: pick(locale, 'ผู้ใช้', 'Users'), badge: counts.overview?.suspendedUsers },
    { id: 'projects', icon: 'folder', label: pick(locale, 'โปรเจกต์', 'Projects'), badge: counts.overview?.archivedProjects },
  ];
  const badgeTitle = (id: AdminTab) => id === 'feedback' ? pick(locale, 'ฟีดแบ็กที่เปิดอยู่', 'Open feedback') : id === 'users' ? pick(locale, 'บัญชีที่ถูกระงับ', 'Suspended accounts') : pick(locale, 'โปรเจกต์ที่เก็บถาวร', 'Archived projects');
  return (
    <>
      <AppHeader context={context} />
      <main className="page-shell feedback-page admin-page">
        <Link className="back-link" to="/"><Icon name="arrowLeft" />{context.t('overview')}</Link>
        <header className="admin-page-title"><span className="eyebrow">PROJECTSPACE · SITE ADMIN</span><h1>{pick(locale, 'ผู้ดูแลเว็บ', 'Site admin')}</h1></header>
        <div className="admin-layout">
          <nav className="admin-nav" role="tablist" aria-label={pick(locale, 'ส่วนจัดการเว็บ', 'Site management')}>
            {items.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.id)}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {!!item.badge && <b title={badgeTitle(item.id)}>{item.badge}</b>}
              </button>
            ))}
          </nav>
          <div className="admin-content">
            {tab === 'overview' && <AdminOverview context={context} overview={counts.overview} feedback={counts.feedback} loading={counts.loading} error={counts.error} onRefresh={counts.refresh} onNavigate={navigate} />}
            {tab === 'feedback' && <AdminInbox context={context} counts={counts.feedback} countsLoading={counts.loading} onCountsChanged={counts.refresh} />}
            {(tab === 'users' || visited.includes('users')) && <div hidden={tab !== 'users'}><AdminManagement context={context} kind="users" status={tab === 'users' ? status : 'all'} onStatusChange={setStatus} onChanged={counts.refresh} /></div>}
            {(tab === 'projects' || visited.includes('projects')) && <div hidden={tab !== 'projects'}><AdminManagement context={context} kind="projects" status={tab === 'projects' ? status : 'all'} onStatusChange={setStatus} onChanged={counts.refresh} /></div>}
          </div>
        </div>
      </main>
    </>
  );
}

function AdminInbox({ context, counts, countsLoading, onCountsChanged }: { context: AppContextValue; counts: FeedbackCounts | null; countsLoading: boolean; onCountsChanged: () => void }) {
  const { locale } = context;
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('open');
  const [category, setCategory] = useState<FeedbackCategory | 'all'>('all');
  const { items, hasMore, loading, loadingMore, error, loadMore, refresh } = useSiteFeedbackPage(context, { status: status === 'all' ? undefined : status });
  const visible = items.filter((item) => category === 'all' || item.category === category);
  const label = (text: string, count: number | undefined) => <>{text}{count !== undefined && <b>{count}</b>}</>;

  return (
    <section className="admin-section" aria-labelledby="admin-inbox-title" aria-busy={loading || loadingMore}>
      <header className="admin-section-head">
        <h2 id="admin-inbox-title">{pick(locale, 'กล่องฟีดแบ็ก', 'Feedback inbox')}</h2>
        <button type="button" className="icon-button" aria-label={pick(locale, 'รีเฟรช', 'Refresh')} title={pick(locale, 'รีเฟรช', 'Refresh')} disabled={countsLoading || loading || loadingMore} onClick={() => { onCountsChanged(); refresh(); }}><Icon name="refresh" /></button>
      </header>
      <div className="admin-toolbar">
        <Segmented value={status} onChange={setStatus} options={[
          { id: 'all', label: label(pick(locale, 'ทั้งหมด', 'All'), counts?.total) },
          ...FEEDBACK_STATUSES.map((entry) => ({ id: entry.id, label: label(locale === 'th' ? entry.th : entry.en, counts?.byStatus[entry.id]) })),
        ]} />
        <select aria-label={pick(locale, 'ประเภทฟีดแบ็ก', 'Feedback category')} value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory | 'all')}>
          <option value="all">{pick(locale, 'ทุกประเภท', 'All types')}</option>
          {FEEDBACK_CATEGORIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.icon} {locale === 'th' ? entry.th : entry.en}</option>)}
        </select>
        <span className="admin-loaded" title={pick(locale, 'ตัวกรองประเภทใช้กับรายการที่โหลดแล้ว', 'Category filters apply to loaded feedback')}>{pick(locale, `โหลดแล้ว ${items.length}`, `${items.length} loaded`)}</span>
      </div>
      {error && <div role="alert" className="admin-error"><span>{pick(locale, 'โหลดฟีดแบ็กไม่สำเร็จ กรุณาลองใหม่', 'Could not load feedback. Please retry.')}</span><button type="button" className="secondary small" onClick={refresh}>{pick(locale, 'ลองใหม่', 'Retry')}</button></div>}
      {loading && <p role="status" className="muted">{pick(locale, 'กำลังโหลดฟีดแบ็ก…', 'Loading feedback…')}</p>}
      <div className="site-feedback-list">
        {visible.map((item) => <FeedbackCard key={item.id} item={item} admin context={context} onChanged={onCountsChanged} />)}
      </div>
      {!loading && !error && !visible.length && <Empty icon="inbox" title={pick(locale, 'ยังไม่มีฟีดแบ็กในรายการนี้', 'No feedback here')} description={pick(locale, 'ลองเปลี่ยนตัวกรอง หรือโหลดเพิ่มเติมหากยังมีรายการเหลือ', 'Try another filter, or load more if there are more submissions.')} />}
      {hasMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingMore || !!error} onClick={() => void loadMore()}>{loadingMore ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดฟีดแบ็กเพิ่มเติม', 'Load more feedback')}</button></div>}
    </section>
  );
}
