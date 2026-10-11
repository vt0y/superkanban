import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '@/config/constants';
import type { FeedbackCategory, FeedbackStatus } from '@/types';
import { useSiteFeedbackPage } from '@/hooks/useSiteFeedback';
import { AppHeader } from '@/components/layout/AppHeader';
import { Icon } from '@/components/common/Icon';
import { Empty } from '@/components/common/Empty';
import { Segmented } from '@/components/common/Segmented';
import { FeedbackCard } from '@/components/feedback/FeedbackCard';
import { SiteFeedbackModal } from '@/components/feedback/SiteFeedbackModal';
import { pick } from '@/utils/formatters';

export function SiteFeedbackPage({ context }: { context: AppContextValue }) {
  const { locale } = context;
  const admin = context.siteRole !== null;
  const { items, hasMore, loading, loadingMore, error, refresh, loadMore } = useSiteFeedbackPage(context);
  const [status, setStatus] = useState<FeedbackStatus | 'all'>(admin ? 'open' : 'all');
  const [category, setCategory] = useState<FeedbackCategory | 'all'>('all');
  const [composing, setComposing] = useState(false);
  const visible = items.filter(
    (item) => (status === 'all' || item.status === status) && (category === 'all' || item.category === category),
  );

  return (
    <>
      <AppHeader context={context} />
      <main className="page-shell feedback-page">
        <Link className="back-link" to="/">
          <Icon name="arrowLeft" /> {context.t('overview')}
        </Link>
        <header className="page-title">
          <div>
            <span className="eyebrow">{admin ? 'SITE ADMIN · FEEDBACK INBOX' : 'SITE FEEDBACK'}</span>
            <h1>
              {admin ? pick(locale, 'กล่องฟีดแบ็กของเว็บ', 'Site feedback inbox') : pick(locale, 'ฟีดแบ็กของฉัน', 'My feedback')}
            </h1>
            <p>
              {admin
                ? pick(
                    locale,
                    'ฟีดแบ็กเกี่ยวกับ ProjectSpace จากผู้ใช้ทุกคน ตั้งสถานะและตอบกลับได้ที่นี่',
                    'Feedback about ProjectSpace from every user — set a status and reply here',
                  )
                : pick(
                    locale,
                    'สิ่งที่คุณส่งถึงผู้ดูแลเว็บ พร้อมสถานะและคำตอบ',
                    'What you sent to the site admin, with its status and replies',
                  )}
            </p>
          </div>
          <button className="primary" onClick={() => setComposing(true)}>
            <Icon name="add" /> {pick(locale, 'ส่งฟีดแบ็ก', 'Send feedback')}
          </button>
        </header>
        <div className="list-toolbar wrap">
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              {
                id: 'all',
                label: (
                  <>
                    {pick(locale, 'ทั้งหมด', 'All')} <b>{items.length}</b>
                  </>
                ),
              },
              ...FEEDBACK_STATUSES.map((s) => ({
                id: s.id,
                label: (
                  <>
                    {locale === 'th' ? s.th : s.en} <b>{items.filter((item) => item.status === s.id).length}</b>
                  </>
                ),
              })),
            ]}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory | 'all')}>
            <option value="all">{pick(locale, 'ทุกประเภท', 'All types')}</option>
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {locale === 'th' ? c.th : c.en}
              </option>
            ))}
          </select>
        </div>
        {loading && <p role="status">{pick(locale, 'กำลังโหลด…', 'Loading…')}</p>}
        {error && <div role="alert"><p>{pick(locale, 'โหลดฟีดแบ็กไม่สำเร็จ', 'Could not load feedback')}</p><button type="button" className="secondary" onClick={refresh}>{pick(locale, 'ลองใหม่', 'Retry')}</button></div>}
        <div className="site-feedback-list">
          {visible.map((item) => (
            <FeedbackCard key={item.id} item={item} admin={admin} context={context} />
          ))}
        </div>
        {!loading && !error && !visible.length && (
          <Empty
            icon="feedback"
            title={pick(locale, 'ยังไม่มีฟีดแบ็ก', 'No feedback here')}
            description={
              admin
                ? pick(locale, 'ยังไม่มีฟีดแบ็กในสถานะนี้', 'Nothing with this status yet')
                : pick(locale, 'เจอปัญหาหรือมีไอเดีย? ส่งถึงผู้ดูแลเว็บได้เลย', 'Found a problem or have an idea? Send it to the site admin.')
            }
          />
        )}
        {hasMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingMore || !!error} onClick={() => void loadMore()}>{loadingMore ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดฟีดแบ็กเพิ่มเติม', 'Load more feedback')}</button></div>}
        {composing && <SiteFeedbackModal context={context} onClose={() => setComposing(false)} />}
      </main>
    </>
  );
}
