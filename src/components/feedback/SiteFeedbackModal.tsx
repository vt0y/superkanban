import { useId, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { FEEDBACK_CATEGORIES } from '@/config/constants';
import { submitSiteFeedback } from '@/services/feedback';
import type { FeedbackCategory } from '@/types';
import { attempt, toast } from '@/components/toast';
import { Modal } from '@/components/common/Modal';
import { pick } from '@/utils/formatters';

/** The "Feedback about ProjectSpace" form, reachable from the top bar on every page. */
export function SiteFeedbackModal({ context, onClose }: { context: AppContextValue; onClose: () => void }) {
  const { locale, user } = context;
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ category: 'idea' as FeedbackCategory, title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const formId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const ok = await attempt(
      () =>
        submitSiteFeedback(user, {
          ...form,
          title: form.title.trim(),
          body: form.body.trim(),
          page: location.pathname + location.search,
        }).then(() => true),
      pick(locale, 'ส่งฟีดแบ็กไม่สำเร็จ', 'Could not send feedback'),
    );
    setBusy(false);
    if (ok) {
      toast(pick(locale, 'ขอบคุณสำหรับฟีดแบ็ก!', 'Thanks for your feedback!'), 'success');
      onClose();
    }
  };

  return (
    <Modal title={pick(locale, 'ฟีดแบ็กถึงทีมพัฒนา ProjectSpace', 'Feedback about ProjectSpace')} onClose={onClose}
      actions={
        <button form={formId} className="primary" disabled={busy || !form.title.trim()}>
          {pick(locale, 'ส่ง', 'Send')}
        </button>
      }
    >
      <form id={formId} className="stack-form" onSubmit={submit}>
        <p className="muted form-intro">
          {pick(
            locale,
            'เจอปัญหาหรือมีไอเดียอยากให้เว็บดีขึ้น? บอกเราได้เลย เฉพาะคุณและผู้ดูแลเว็บเท่านั้นที่เห็นข้อความนี้',
            'Found a problem or have an idea for the site? Only you and the site admin can see what you send.',
          )}
        </p>
        <fieldset>
          <legend>{pick(locale, 'ประเภท', 'Type')}</legend>
          <div className="category-picker">
            {FEEDBACK_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={form.category === c.id ? 'active' : ''}
                onClick={() => setForm({ ...form, category: c.id })}
              >
                {c.icon} {locale === 'th' ? c.th : c.en}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          {pick(locale, 'หัวข้อ', 'Summary')}
          <input
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            maxLength={160}
            placeholder={
              form.category === 'bug'
                ? pick(locale, 'เช่น ลากโน้ตแล้วตำแหน่งไม่บันทึก', 'e.g. Dragged notes don’t keep their position')
                : pick(locale, 'สรุปสั้น ๆ', 'One-line summary')
            }
          />
        </label>
        <label>
          {pick(locale, 'รายละเอียด', 'Details')}
          <textarea
            rows={5}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            maxLength={3000}
            placeholder={
              form.category === 'bug'
                ? pick(locale, 'ทำอะไร แล้วเกิดอะไรขึ้น คาดว่าควรเป็นอย่างไร', 'What did you do, what happened, what did you expect?')
                : ''
            }
          />
        </label>
        <small className="muted">
          {pick(locale, 'หน้าที่ส่งจาก: ', 'Sent from page: ')}
          <code>{location.pathname}</code>
        </small>
        <div className="form-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onClose();
              navigate('/feedback');
            }}
          >
            {pick(locale, 'ดูฟีดแบ็กของฉัน →', 'View my feedback →')}
          </button>
          <span />
          <button type="button" className="secondary" onClick={onClose}>
            {context.t('cancel')}
          </button>
          <button className="primary" disabled={busy || !form.title.trim()}>
            {pick(locale, 'ส่ง', 'Send')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
