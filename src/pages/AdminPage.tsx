import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '@/config/constants';
import type { FeedbackCategory, FeedbackStatus } from '@/types';
import { loadSiteFeedbackCounts, type FeedbackCounts } from '@/services/feedback';
import { useSiteFeedbackPage } from '@/hooks/useSiteFeedback';
import { AdminManagement } from '@/components/admin/AdminManagement';
import { AppHeader } from '@/components/layout/AppHeader';
import { FeedbackCard } from '@/components/feedback/FeedbackCard';
import { Empty } from '@/components/common/Empty';
import { Icon } from '@/components/common/Icon';
import { Metric } from '@/components/common/Metric';
import { Segmented } from '@/components/common/Segmented';
import { pick } from '@/utils/formatters';

export function AdminPage({ context }: { context: AppContextValue }) {
  // Guard here as well as at the route: no admin hooks run for ordinary users.
  if (context.profile?.accountStatus === 'suspended' || (context.siteRole !== 'owner' && context.siteRole !== 'admin')) return <Navigate to="/" replace />;
  return <AdminShell key={context.user.uid} context={context} />;
}

function AdminShell({ context }: { context: AppContextValue }) {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab');
  const tab = value === 'users' || value === 'projects' ? value : 'feedback';
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    if (tab !== 'feedback') setVisited((current) => current.includes(tab) ? current : [...current, tab]);
  }, [tab]);
  const { locale } = context;
  return (
    <>
      <AppHeader context={context} />
      <main className="page-shell feedback-page admin-page">
        <Link className="back-link" to="/"><Icon name="arrowLeft" />{context.t('overview')}</Link>
        <header className="page-title"><div><span className="eyebrow">PROJECTSPACE · SITE ADMIN</span><h1>{pick(locale, 'ผู้ดูแลเว็บ', 'Site admin')}</h1><p>{pick(locale, 'จัดการฟีดแบ็ก ผู้ใช้ และโปรเจกต์ทั้งระบบ', 'Manage site feedback, users, and projects.')}</p></div></header>
        <nav className="admin-navigation" aria-label={pick(locale, 'ส่วนจัดการเว็บ', 'Site management')}>
          <Segmented value={tab} onChange={(next) => setParams((current) => { const updated = new URLSearchParams(current); updated.set('tab', next); return updated; })} options={[
            { id: 'feedback', label: pick(locale, 'ฟีดแบ็ก', 'Feedback') },
            { id: 'users', label: pick(locale, 'ผู้ใช้', 'Users') },
            { id: 'projects', label: pick(locale, 'โปรเจกต์', 'Projects') },
          ]} />
        </nav>
        {tab === 'feedback' && <AdminInbox context={context} />}
        {(tab === 'users' || visited.includes('users')) && <div hidden={tab !== 'users'}><AdminManagement context={context} kind="users" /></div>}
        {(tab === 'projects' || visited.includes('projects')) && <div hidden={tab !== 'projects'}><AdminManagement context={context} kind="projects" /></div>}
      </main>
    </>
  );
}

function AdminInbox({ context }: { context: AppContextValue }) {
  const { locale } = context;
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('open');
  const [category, setCategory] = useState<FeedbackCategory | 'all'>('all');
  const { items, hasMore, loading, loadingMore, error, loadMore, refresh } = useSiteFeedbackPage(context, { status: status === 'all' ? undefined : status });
  const [counts, setCounts] = useState<FeedbackCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState(false);
  const [revision, setRevision] = useState(0);
  const refreshCounts = () => setRevision((value) => value + 1);
  useEffect(() => {
    let current = true;
    setCountsLoading(true);
    setCountsError(false);
    void loadSiteFeedbackCounts().then((next) => {
      if (current) setCounts(next);
    }).catch(() => {
      if (current) setCountsError(true);
    }).finally(() => {
      if (current) setCountsLoading(false);
    });
    return () => { current = false; };
  }, [context.user.uid, revision]);
  const visible = items.filter((item) => category === 'all' || item.category === category);
  const countValue = (value: number | undefined) => countsError ? null : value ?? null;

  return (
    <div>
        <header className="page-title">
          <div>
            <h2>{pick(locale, 'ภาพรวมฟีดแบ็ก', 'Feedback overview')}</h2>
            <p>{pick(locale, 'ภาพรวมฟีดแบ็กจากผู้ใช้ทุกคน พร้อมจัดการสถานะและตอบกลับ', 'Feedback from every user, with status management and replies.')}</p>
          </div>
          <button type="button" className="secondary" disabled={countsLoading || loading || loadingMore} onClick={() => { refreshCounts(); refresh(); }}>
            <Icon name="refresh" />{pick(locale, 'รีเฟรช', 'Refresh')}
          </button>
        </header>
        <section aria-label={pick(locale, 'ภาพรวมฟีดแบ็ก', 'Feedback overview')} aria-busy={countsLoading}>
          <div className="metric-grid admin-metrics">
            <Metric icon="feedback" color="purple" value={countValue(counts?.total)} label={pick(locale, 'ฟีดแบ็กทั้งหมด', 'All feedback')} />
            {FEEDBACK_STATUSES.map((entry) => (
              <Metric key={entry.id} icon={entry.id === 'resolved' ? 'circleCheck' : entry.id === 'open' ? 'inbox' : entry.id === 'in_review' ? 'clock' : 'archive'} color={entry.id === 'resolved' ? 'green' : entry.id === 'in_review' ? 'blue' : 'purple'} value={countValue(counts?.byStatus[entry.id])} label={locale === 'th' ? entry.th : entry.en} />
            ))}
          </div>
          <p className="muted admin-count-note">{pick(locale, 'จำนวนจากฟีดแบ็กทั้งระบบ อัปเดตเมื่อเปิดหน้า รีเฟรช หรือจัดการฟีดแบ็กสำเร็จ', 'Counts cover the whole inbox and update on opening, refreshing, or a successful change.')}</p>
          {countsError && <div role="alert" className="admin-error"><span>{pick(locale, 'โหลดภาพรวมไม่สำเร็จ', 'Could not load the overview.')}</span><button type="button" className="secondary small" onClick={refreshCounts}>{pick(locale, 'ลองใหม่', 'Retry')}</button></div>}
        </section>
        <section className="admin-inbox" aria-labelledby="admin-inbox-title" aria-busy={loading || loadingMore}>
          <h2 id="admin-inbox-title">{pick(locale, 'กล่องฟีดแบ็ก', 'Feedback inbox')}</h2>
          <div className="list-toolbar wrap">
            <Segmented value={status} onChange={setStatus} options={[{ id: 'all', label: pick(locale, 'ทั้งหมด', 'All') }, ...FEEDBACK_STATUSES.map((entry) => ({ id: entry.id, label: locale === 'th' ? entry.th : entry.en }))]} />
            <select aria-label={pick(locale, 'ประเภทฟีดแบ็ก', 'Feedback category')} value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory | 'all')}>
              <option value="all">{pick(locale, 'ทุกประเภท', 'All types')}</option>
              {FEEDBACK_CATEGORIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.icon} {locale === 'th' ? entry.th : entry.en}</option>)}
            </select>
          </div>
          <p className="muted admin-count-note">{pick(locale, `โหลดแล้ว ${items.length} รายการ · ตัวกรองประเภทใช้กับรายการที่โหลดแล้ว`, `${items.length} loaded · Category filters apply to loaded feedback.`)}</p>
          {error && <div role="alert" className="admin-error"><span>{pick(locale, 'โหลดฟีดแบ็กไม่สำเร็จ กรุณาลองใหม่', 'Could not load feedback. Please retry.')}</span><button type="button" className="secondary small" onClick={refresh}>{pick(locale, 'ลองใหม่', 'Retry')}</button></div>}
          {loading && <p role="status" className="muted">{pick(locale, 'กำลังโหลดฟีดแบ็ก…', 'Loading feedback…')}</p>}
          <div className="site-feedback-list">
            {visible.map((item) => <FeedbackCard key={item.id} item={item} admin context={context} onChanged={refreshCounts} />)}
          </div>
          {!loading && !error && !visible.length && <Empty icon="inbox" title={pick(locale, 'ยังไม่มีฟีดแบ็กในรายการนี้', 'No feedback here')} description={pick(locale, 'ลองเปลี่ยนตัวกรอง หรือโหลดเพิ่มเติมหากยังมีรายการเหลือ', 'Try another filter, or load more if there are more submissions.')} />}
          {hasMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingMore || !!error} onClick={() => void loadMore()}>{loadingMore ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดฟีดแบ็กเพิ่มเติม', 'Load more feedback')}</button></div>}
        </section>
    </div>
  );
}
