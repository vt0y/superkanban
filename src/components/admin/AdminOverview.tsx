import type { AppContextValue } from '@/context/AppContext';
import type { AdminOverviewCounts } from '@/services/admin';
import type { FeedbackCounts } from '@/services/feedback';
import { FEEDBACK_CATEGORIES } from '@/config/constants';
import { useSiteFeedbackPage } from '@/hooks/useSiteFeedback';
import { Metric } from '@/components/common/Metric';
import { Icon, type IconName } from '@/components/common/Icon';
import { pick } from '@/utils/formatters';

export type AdminTab = 'overview' | 'feedback' | 'users' | 'projects';

export function AdminOverview({ context, overview, feedback, loading, error, onRefresh, onNavigate }: {
  context: AppContextValue;
  overview: AdminOverviewCounts | null;
  feedback: FeedbackCounts | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNavigate: (tab: AdminTab, status?: string) => void;
}) {
  const { locale } = context;
  const recent = useSiteFeedbackPage(context, { status: 'open', limitCount: 5 });
  const value = (count: number | undefined) => loading ? null : count ?? null;
  const tiles: { icon: IconName; color: string; value: number | null; label: string; tab: AdminTab; status?: string }[] = [
    { icon: 'team', color: 'blue', value: value(overview?.users), label: pick(locale, 'ผู้ใช้ทั้งหมด', 'All users'), tab: 'users' },
    { icon: 'lock', color: 'rose', value: value(overview?.suspendedUsers), label: pick(locale, 'บัญชีที่ถูกระงับ', 'Suspended accounts'), tab: 'users', status: 'suspended' },
    { icon: 'folder', color: 'blue', value: value(overview?.projects), label: pick(locale, 'โปรเจกต์ทั้งหมด', 'All projects'), tab: 'projects' },
    { icon: 'archive', color: 'purple', value: value(overview?.archivedProjects), label: pick(locale, 'โปรเจกต์ที่เก็บถาวร', 'Archived projects'), tab: 'projects', status: 'archived' },
    { icon: 'inbox', color: 'green', value: value(feedback?.byStatus.open), label: pick(locale, 'ฟีดแบ็กที่เปิดอยู่', 'Open feedback'), tab: 'feedback' },
  ];
  const date = (item: { createdAt?: { toDate(): Date } }) => item.createdAt?.toDate().toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short' }) ?? '';
  return <section className="admin-section" aria-busy={loading} aria-label={pick(locale, 'ภาพรวมเว็บ', 'Site overview')}>
    <header className="admin-section-head">
      <h2>{pick(locale, 'ภาพรวมเว็บ', 'Site overview')}</h2>
      <button type="button" className="icon-button" disabled={loading} aria-label={pick(locale, 'รีเฟรช', 'Refresh')} title={pick(locale, 'จำนวนทั้งระบบ อัปเดตเมื่อเปิดหน้านี้หรือรีเฟรช', 'Site-wide counts; updated on open or refresh')} onClick={onRefresh}><Icon name="refresh" /></button>
    </header>
    {error && <div className="admin-error" role="alert"><span>{error}</span><button type="button" className="secondary small" onClick={onRefresh}>{pick(locale, 'ลองใหม่', 'Retry')}</button></div>}
    <div className="metric-grid admin-metrics">
      {tiles.map((tile) => <button key={tile.label} type="button" className="admin-tile" onClick={() => onNavigate(tile.tab, tile.status)}>
        <Metric icon={tile.icon} color={tile.color} value={tile.value} label={tile.label} />
      </button>)}
    </div>
    <section className="panel admin-attention" aria-labelledby="admin-attention-title" aria-busy={recent.loading}>
      <header className="admin-section-head">
        <h3 id="admin-attention-title">{pick(locale, 'ฟีดแบ็กล่าสุดที่รอดำเนินการ', 'Latest open feedback')}</h3>
        <button type="button" className="link-button" onClick={() => onNavigate('feedback')}>{pick(locale, 'ดูทั้งหมด', 'View all')}<Icon name="chevronRight" /></button>
      </header>
      {recent.error && <p className="admin-error" role="alert">{pick(locale, 'โหลดฟีดแบ็กไม่สำเร็จ', 'Could not load feedback.')}</p>}
      {recent.loading && <p role="status" className="muted">{pick(locale, 'กำลังโหลด…', 'Loading…')}</p>}
      {!recent.loading && !recent.error && !recent.items.length && <p className="muted">{pick(locale, 'ไม่มีฟีดแบ็กที่รอดำเนินการ', 'Nothing waiting. All caught up.')}</p>}
      <ul className="admin-attention-list">
        {recent.items.map((item) => <li key={item.id}>
          <button type="button" onClick={() => onNavigate('feedback')}>
            <span aria-hidden="true">{FEEDBACK_CATEGORIES.find((entry) => entry.id === item.category)?.icon ?? '💬'}</span>
            <span className="admin-attention-text"><strong>{item.title || item.body}</strong><small>{item.userName || item.userEmail}</small></span>
            <time className="muted">{date(item)}</time>
          </button>
        </li>)}
      </ul>
    </section>
  </section>;
}
