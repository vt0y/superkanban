import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Icon } from '@/components/common/Icon';
import { toast } from '@/components/toast';
import type { TarotCategory } from '@/tarot/deck';
import type { TarotReveal, TarotSelectedCard } from '@/tarot/types';
import type { Locale } from '@/types';
import { pick } from '@/utils/formatters';
import { POSITION_NAMES } from './CardSlots';
import { CardBack, CardFace } from './TarotCard';
import { TAROT_CATEGORIES } from './TarotForm';

const FLIP_GAP = 450;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function MarkdownReading({ markdown, className = '' }: { markdown: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(markdown) as string), [markdown]);
  return <article className={`arc-reading markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

const cardName = (card: TarotSelectedCard, locale: Locale) => (locale === 'th' ? card.nameTh : card.nameEn);

/** The three cards flip one by one, then the reading fades in. */
export function TarotResult({ locale, result, question, category, savePending, onAgain, onRetrySave }: {
  locale: Locale; result: TarotReveal; question: string; category: TarotCategory; savePending: boolean; onAgain: () => void; onRetrySave: () => void;
}) {
  const [flipped, setFlipped] = useState(() => (reducedMotion() ? result.cards.length : 0));
  const [zoom, setZoom] = useState<TarotSelectedCard | null>(null);
  const focus = TAROT_CATEGORIES.find((item) => item.id === category);

  useEffect(() => {
    if (flipped >= result.cards.length) return;
    const timer = window.setTimeout(() => setFlipped((count) => count + 1), flipped === 0 ? 500 : FLIP_GAP);
    return () => window.clearTimeout(timer);
  }, [flipped, result.cards.length]);

  useEffect(() => {
    if (!zoom) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoom(null); };
    addEventListener('keydown', close);
    return () => removeEventListener('keydown', close);
  }, [zoom]);

  const copy = async () => {
    const cards = result.cards.map((card) => `${pick(locale, POSITION_NAMES[card.position].th, POSITION_NAMES[card.position].en)}: ${cardName(card, locale)}${card.reversed ? pick(locale, ' (กลับหัว)', ' (reversed)') : ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(`${question ? `“${question}”\n\n` : ''}${cards}\n\n${result.readingMarkdown}`);
      toast(pick(locale, 'คัดลอกคำทำนายแล้ว', 'Reading copied'), 'success');
    } catch {
      toast(pick(locale, 'คัดลอกไม่สำเร็จ', 'Could not copy'), 'error');
    }
  };

  const done = flipped >= result.cards.length;
  return (
    <section className="arc-result">
      <p className="arc-kicker"><Icon name="star" /> {pick(locale, 'คำทำนายของคุณ', 'Your reading')} <Icon name="star" /></p>
      <h1>{pick(locale, 'สารจากไพ่ทั้งสาม', 'A message from your three cards')}</h1>
      <div className="arc-result-meta">
        {focus && <span className="arc-badge"><Icon name={focus.icon} /> {pick(locale, focus.th, focus.en)}</span>}
        {question && <blockquote>“{question}”</blockquote>}
      </div>

      <div className="arc-revealed">
        {result.cards.map((card, index) => {
          const name = cardName(card, locale);
          return (
            <figure key={`${card.id}-${card.position}`} className={index < flipped ? 'is-flipped' : ''}>
              <figcaption className="arc-position">{pick(locale, POSITION_NAMES[card.position].th, POSITION_NAMES[card.position].en)}</figcaption>
              <button type="button" className="arc-flip" disabled={index >= flipped} onClick={() => setZoom(card)} aria-label={pick(locale, `ดู ${name} ขนาดใหญ่`, `View ${name} larger`)}>
                <span className="arc-flip-inner">
                  <span className="arc-flip-back"><CardBack /></span>
                  <span className="arc-flip-front"><CardFace cardId={card.id} name={name} reversed={card.reversed} /></span>
                </span>
              </button>
              <div className="arc-card-caption">
                <strong>{index < flipped ? name : '· · ·'}</strong>
                {index < flipped && <small className={card.reversed ? 'reversed' : ''}><Icon name={card.reversed ? 'rotate' : 'star'} /> {card.reversed ? pick(locale, 'ไพ่กลับหัว', 'Reversed') : pick(locale, 'ไพ่ตั้งตรง', 'Upright')}</small>}
              </div>
            </figure>
          );
        })}
      </div>

      {done && <>
        <div className="arc-divider" aria-hidden="true"><i /><Icon name="moonStar" /><i /></div>
        <MarkdownReading markdown={result.readingMarkdown} className="arc-reading-scroll" />
        <div className="arc-result-actions">
          {savePending && <button type="button" className="arc-ghost" onClick={onRetrySave}><Icon name="refresh" /> {pick(locale, 'ลองบันทึกประวัติอีกครั้ง', 'Retry saving to history')}</button>}
          <button type="button" className="arc-ghost" onClick={() => void copy()}><Icon name="copy" /> {pick(locale, 'คัดลอกคำทำนาย', 'Copy reading')}</button>
          <button type="button" className="arc-primary" onClick={onAgain}><Icon name="shuffle" /> {pick(locale, 'เปิดไพ่ครั้งใหม่', 'Begin another reading')}</button>
        </div>
      </>}

      {zoom && (
        <div className="arc-lightbox" role="dialog" aria-modal="true" aria-label={cardName(zoom, locale)} onClick={() => setZoom(null)}>
          <figure onClick={(event) => event.stopPropagation()}>
            <CardFace cardId={zoom.id} name={cardName(zoom, locale)} reversed={zoom.reversed} />
            <figcaption>
              <small>{pick(locale, POSITION_NAMES[zoom.position].th, POSITION_NAMES[zoom.position].en)}</small>
              <strong>{cardName(zoom, locale)}</strong>
              <span>{zoom.reversed ? pick(locale, 'ไพ่กลับหัว', 'Reversed') : pick(locale, 'ไพ่ตั้งตรง', 'Upright')}</span>
            </figcaption>
            <button type="button" className="arc-icon-button" onClick={() => setZoom(null)} aria-label={pick(locale, 'ปิด', 'Close')}><Icon name="close" /></button>
          </figure>
        </div>
      )}
    </section>
  );
}
