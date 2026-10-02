import { useEffect, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '@/config/constants';
import { deleteSiteFeedback, updateSiteFeedback } from '@/services/feedback';
import type { SiteFeedback } from '@/types';
import { attempt, toast } from '@/components/toast';
import { pick, relativeTime } from '@/utils/formatters';
import { Icon } from '@/components/common/Icon';

export function FeedbackCard({ item, admin, context }: { item: SiteFeedback; admin: boolean; context: AppContextValue }) {
  const { locale, user } = context;
  const [reply, setReply] = useState(item.adminReply);
  useEffect(() => setReply(item.adminReply), [item.adminReply]);
  const cat = FEEDBACK_CATEGORIES.find((c) => c.id === item.category);
  const st = FEEDBACK_STATUSES.find((s) => s.id === item.status);
  const canDelete = admin || (item.userId === user.uid && item.status === 'open');
  const failed = pick(locale, 'อัปเดตไม่สำเร็จ', 'Update failed');
  return (
    <article className="site-feedback-card">
      <header>
        <div className="feedback-chips">
          <span className="chip">
            {cat?.icon} {cat ? (locale === 'th' ? cat.th : cat.en) : item.category}
          </span>
          <span className="chip status" style={{ '--chip': st?.color } as React.CSSProperties}>
            {st ? (locale === 'th' ? st.th : st.en) : item.status}
          </span>
        </div>
        {canDelete && (
          <button
            className="icon-button"
            title={context.t('delete')}
            onClick={() => {
              if (confirm(pick(locale, 'ลบฟีดแบ็กนี้?', 'Delete this feedback?')))
                void attempt(() => deleteSiteFeedback(item.id), failed);
            }}
          >
            <Icon name="close" />
          </button>
        )}
      </header>
      <h3>{item.title}</h3>
      {item.body && <p className="feedback-text">{item.body}</p>}
      <small className="muted">
        {admin && (
          <>
            <b>{item.userName}</b> · {item.userEmail} ·{' '}
          </>
        )}
        {relativeTime(item.createdAt?.toDate(), locale)}
        {item.page && (
          <>
            {' '}
            · <code>{item.page}</code>
          </>
        )}
      </small>
      {admin ? (
        <div className="admin-triage">
          <div className="status-picker">
            <div>
              {FEEDBACK_STATUSES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={item.status === s.id ? 'active' : ''}
                  style={{ '--chip': s.color } as React.CSSProperties}
                  onClick={() => void attempt(() => updateSiteFeedback(item.id, { status: s.id }), failed)}
                >
                  {locale === 'th' ? s.th : s.en}
                </button>
              ))}
            </div>
          </div>
          <div className="reply-row">
            <textarea
              rows={2}
              value={reply}
              maxLength={3000}
              placeholder={pick(locale, 'ตอบกลับผู้ส่ง (ผู้ส่งจะเห็นข้อความนี้)', 'Reply to the sender (they will see this)')}
              onChange={(e) => setReply(e.target.value)}
            />
            <button
              className="secondary small"
              disabled={reply === item.adminReply}
              onClick={() =>
                void attempt(() => updateSiteFeedback(item.id, { adminReply: reply.trim() }), failed).then(() =>
                  toast(pick(locale, 'บันทึกคำตอบแล้ว', 'Reply saved'), 'success'),
                )
              }
            >
              {pick(locale, 'บันทึกคำตอบ', 'Save reply')}
            </button>
          </div>
        </div>
      ) : (
        item.adminReply && (
          <div className="admin-reply">
            <small>{pick(locale, 'คำตอบจากผู้ดูแลเว็บ', 'Reply from the site admin')}</small>
            <p>{item.adminReply}</p>
          </div>
        )
      )}
    </article>
  );
}
