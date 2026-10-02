import { useEffect, useState } from 'react';
import { Icon } from '@/components/common/Icon';
import type { TarotReading } from '@/tarot/types';
import type { Locale } from '@/types';
import { formatDateTime, pick } from '@/utils/formatters';
import { lockBodyScroll } from '@/utils/scroll-lock';
import { POSITION_NAMES } from './CardSlots';
import { CardFace } from './TarotCard';
import { TAROT_CATEGORIES } from './TarotForm';
import { MarkdownReading } from './TarotResult';

const monthKey = (reading: TarotReading) => {
  const date = reading.createdAt?.toDate();
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : '';
};

/** Past readings grouped by month; a row opens its detail inside the panel. */
export function HistoryPanel({ locale, history, busy, onClose, onDelete, onClear }: {
  locale: Locale; history: TarotReading[]; busy: boolean; onClose: () => void; onDelete: (id: string) => Promise<void> | void; onClear: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = history.find((item) => item.id === openId) ?? null;

  useEffect(() => lockBodyScroll(), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openId) setOpenId(null); else onClose();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [openId, onClose]);

  const months = history.reduce<{ key: string; items: TarotReading[] }[]>((groups, item) => {
    const key = monthKey(item);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item); else groups.push({ key, items: [item] });
    return groups;
  }, []);
  const monthLabel = (key: string) => (key
    ? new Date(`${key}-01T12:00:00`).toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { month: 'long', year: 'numeric' })
    : pick(locale, 'ไม่ทราบวันที่', 'Undated'));
  const focusOf = (item: TarotReading) => TAROT_CATEGORIES.find((category) => category.id === item.category);
  const cardName = (card: TarotReading['cards'][number]) => (locale === 'th' ? card.nameTh : card.nameEn);

  return (
    <div className="arc-history-layer">
      <button type="button" className="arc-history-scrim" aria-label={pick(locale, 'ปิด', 'Close')} onClick={onClose} />
      <aside className="arc-history" role="dialog" aria-modal="true" aria-label={pick(locale, 'ประวัติคำทำนาย', 'Reading history')}>
        <header>
          {open
            ? <button type="button" className="arc-icon-button" onClick={() => setOpenId(null)} aria-label={pick(locale, 'กลับ', 'Back')}><Icon name="arrowLeft" /></button>
            : <span className="arc-history-mark"><Icon name="history" /></span>}
          <div>
            <small>{pick(locale, 'หอจดหมายเหตุ', 'The archive')}</small>
            <h2>{open ? (open.question || pick(locale, 'คำทำนายทั่วไป', 'General reading')) : pick(locale, 'ประวัติคำทำนาย', 'Reading history')}</h2>
          </div>
          <button type="button" className="arc-icon-button" onClick={onClose} aria-label={pick(locale, 'ปิด', 'Close')}><Icon name="close" /></button>
        </header>

        {busy ? (
          <div className="arc-history-empty"><i className="arc-orbit" />{pick(locale, 'กำลังเปิดหอจดหมายเหตุ…', 'Opening the archive…')}</div>
        ) : open ? (
          <div className="arc-history-detail">
            <p className="arc-history-meta">
              {focusOf(open) && <span className="arc-badge"><Icon name={focusOf(open)!.icon} /> {pick(locale, focusOf(open)!.th, focusOf(open)!.en)}</span>}
              <small>{open.createdAt ? formatDateTime(open.createdAt, locale) : '—'}</small>
            </p>
            <div className="arc-history-cards">
              {open.cards.map((card) => (
                <figure key={card.position}>
                  <CardFace cardId={card.id} name={cardName(card)} reversed={card.reversed} />
                  <figcaption><small>{pick(locale, POSITION_NAMES[card.position].th, POSITION_NAMES[card.position].en)}</small>{cardName(card)}{card.reversed && <em>{pick(locale, 'กลับหัว', 'Reversed')}</em>}</figcaption>
                </figure>
              ))}
            </div>
            <MarkdownReading markdown={open.readingMarkdown} />
            <button type="button" className="arc-danger" onClick={async () => { await onDelete(open.id); setOpenId(null); }}><Icon name="trash" /> {pick(locale, 'ลบคำทำนายนี้', 'Delete this reading')}</button>
          </div>
        ) : history.length ? (
          <div className="arc-history-list">
            {months.map((month) => (
              <section key={month.key}>
                <h3>{monthLabel(month.key)}</h3>
                {month.items.map((item) => {
                  const focus = focusOf(item);
                  return (
                    <button type="button" key={item.id} className="arc-history-row" onClick={() => setOpenId(item.id)}>
                      <span className="arc-history-thumbs" aria-hidden="true">
                        {item.cards.map((card) => <CardFace key={card.position} cardId={card.id} name={cardName(card)} reversed={card.reversed} />)}
                      </span>
                      <span className="arc-history-text">
                        <strong>{item.question || pick(locale, 'คำทำนายทั่วไป', 'General reading')}</strong>
                        <small>{focus && <><Icon name={focus.icon} /> {pick(locale, focus.th, focus.en)} · </>}{item.createdAt ? formatDateTime(item.createdAt, locale) : '—'}</small>
                        <em>{item.cards.map(cardName).join(' · ')}</em>
                      </span>
                      <Icon name="chevronRight" />
                    </button>
                  );
                })}
              </section>
            ))}
            <button type="button" className="arc-danger subtle" onClick={onClear}><Icon name="trash" /> {pick(locale, 'ลบประวัติทั้งหมด', 'Clear all history')}</button>
          </div>
        ) : (
          <div className="arc-history-empty">
            <span className="arc-history-moon"><Icon name="moonStar" /></span>
            <strong>{pick(locale, 'ยังไม่มีคำทำนาย', 'No readings yet')}</strong>
            <span>{pick(locale, 'เมื่อคุณเปิดไพ่ ผลจะถูกเก็บไว้ที่นี่', 'Your readings will appear here.')}</span>
          </div>
        )}
      </aside>
    </div>
  );
}
