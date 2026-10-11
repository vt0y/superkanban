import { useEffect, useRef, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '@/config/constants';
import { deleteSiteFeedback, updateSiteFeedback } from '@/services/feedback';
import type { SiteFeedback } from '@/types';
import { toast } from '@/components/toast';
import { pick, relativeTime } from '@/utils/formatters';
import { Icon } from '@/components/common/Icon';

export function FeedbackCard({ item, admin, context, onChanged }: { item: SiteFeedback; admin: boolean; context: AppContextValue; onChanged?: () => void }) {
  const { locale, user } = context;
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [reply, setReply] = useState(item.adminReply);
  useEffect(() => setReply(item.adminReply), [item.adminReply]);
  const cat = FEEDBACK_CATEGORIES.find((c) => c.id === item.category);
  const st = FEEDBACK_STATUSES.find((s) => s.id === item.status);
  const canDelete = admin || (item.userId === user.uid && item.status === 'open');
  const failed = pick(locale, 'อัปเดตไม่สำเร็จ', 'Update failed');
  const save = async (work: () => Promise<void>, success?: string) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await work();
      if (success) toast(success, 'success');
      onChanged?.();
    } catch {
      toast(failed, 'error');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
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
            type="button"
            disabled={saving}
            aria-label={context.t('delete')}
            title={context.t('delete')}
            onClick={() => {
              if (confirm(pick(locale, 'ลบฟีดแบ็กนี้?', 'Delete this feedback?')))
                void save(() => deleteSiteFeedback(item.id));
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
                  disabled={saving || item.status === s.id}
                  onClick={() => void save(() => updateSiteFeedback(item.id, { status: s.id }))}
                >
                  {locale === 'th' ? s.th : s.en}
                </button>
              ))}
            </div>
          </div>
          <div className="reply-row">
            <textarea
              rows={2}
              disabled={saving}
              aria-label={pick(locale, 'คำตอบถึงผู้ส่ง', 'Reply to sender')}
              value={reply}
              maxLength={3000}
              placeholder={pick(locale, 'ตอบกลับผู้ส่ง (ผู้ส่งจะเห็นข้อความนี้)', 'Reply to the sender (they will see this)')}
              onChange={(e) => setReply(e.target.value)}
            />
            <button
              className="secondary small"
              type="button"
              disabled={saving || reply.trim() === item.adminReply}
              onClick={() =>
                void save(() => updateSiteFeedback(item.id, { adminReply: reply.trim() }), pick(locale, 'บันทึกคำตอบแล้ว', 'Reply saved'))
              }
            >
              {saving ? pick(locale, 'กำลังบันทึก…', 'Saving…') : pick(locale, 'บันทึกคำตอบ', 'Save reply')}
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
