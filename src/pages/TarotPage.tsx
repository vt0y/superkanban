import { useMemo, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { auth } from '@/config/firebase';
import type { AppContextValue } from '@/context/AppContext';
import type { TarotCategory } from '@/tarot/deck';
import { tarotCardById } from '@/tarot/deck';
import type { TarotReading, TarotReveal, TarotSession } from '@/tarot/types';
import {
  clearTarotHistory,
  createTarotSession,
  deleteTarotReading,
  loadTarotHistory,
  revealTarotSession,
  saveTarotReading,
  TarotApiError,
} from '@/services/tarot';
import { toast } from '@/components/toast';
import { formatDateTime, pick } from '@/utils/formatters';

type Stage = 'form' | 'shuffling' | 'selecting' | 'reading' | 'result';
const categories: { id: TarotCategory; icon: string; th: string; en: string }[] = [
  { id: 'general', icon: '✦', th: 'ภาพรวม', en: 'General' },
  { id: 'love', icon: '♡', th: 'ความรัก', en: 'Love' },
  { id: 'work', icon: '◇', th: 'การงาน', en: 'Career' },
  { id: 'finance', icon: '◉', th: 'การเงิน', en: 'Finance' },
];
const positionNames = {
  past: { th: 'อดีต', en: 'Past' },
  present: { th: 'ปัจจุบัน', en: 'Present' },
  future: { th: 'อนาคต', en: 'Future' },
} as const;

export function TarotPage({ context }: { context: AppContextValue }) {
  const { locale, user } = context;
  const [stage, setStage] = useState<Stage>('form');
  const [category, setCategory] = useState<TarotCategory>('general');
  const [question, setQuestion] = useState('');
  const [session, setSession] = useState<TarotSession | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [result, setResult] = useState<TarotReveal | null>(null);
  const [error, setError] = useState('');
  const [savePending, setSavePending] = useState<TarotReveal | null>(null);
  const [history, setHistory] = useState<TarotReading[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);

  const scrollDeck = (direction: -1 | 1) => {
    const deck = deckRef.current;
    if (!deck) return;
    deck.scrollBy({ left: direction * Math.max(320, deck.clientWidth * 0.72), behavior: 'smooth' });
  };

  const handleDeckWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 760px)').matches || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const deck = event.currentTarget;
    const maxScroll = deck.scrollWidth - deck.clientWidth;
    const nextScroll = Math.max(0, Math.min(maxScroll, deck.scrollLeft + event.deltaY));
    if (nextScroll === deck.scrollLeft) return;
    event.preventDefault();
    deck.scrollLeft = nextScroll;
  };

  const handleDeckKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    scrollDeck(event.key === 'ArrowLeft' ? -1 : 1);
  };

  const start = async () => {
    setError('');
    setStage('shuffling');
    try {
      const next = await createTarotSession(user, category, question, locale);
      setSession(next);
      setSelected([]);
      setResult(null);
      setStage('selecting');
    } catch (cause) {
      setError(apiMessage(cause, locale));
      setStage('form');
    }
  };

  const toggleCard = (index: number) => {
    if (stage !== 'selecting') return;
    setSelected((current) => current.includes(index)
      ? current.filter((item) => item !== index)
      : current.length < 3 ? [...current, index] : current);
  };

  const reveal = async () => {
    if (!session || selected.length !== 3) return;
    setError('');
    setStage('reading');
    try {
      const next = await revealTarotSession(user, session.sessionId, selected);
      setResult(next);
      setStage('result');
      await persist(next);
    } catch (cause) {
      setError(apiMessage(cause, locale));
      setStage('selecting');
    }
  };

  const persist = async (reading: TarotReveal) => {
    try {
      await saveTarotReading(user.uid, {
        category,
        question: question.trim(),
        locale,
        cards: reading.cards,
        readingMarkdown: reading.readingMarkdown,
        requestId: reading.requestId,
      });
      setSavePending(null);
      if (history !== null) setHistory(await loadTarotHistory(user.uid));
    } catch (cause) {
      console.error(cause);
      setSavePending(reading);
      toast(pick(locale, 'เปิดไพ่สำเร็จ แต่ยังบันทึกประวัติไม่ได้', 'Cards revealed, but history was not saved.'), 'error');
    }
  };

  const reshuffle = () => {
    setSession(null);
    setSelected([]);
    setResult(null);
    setSavePending(null);
    setError('');
    setStage('form');
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    if (history !== null) return;
    setHistoryBusy(true);
    try {
      setHistory(await loadTarotHistory(user.uid));
    } catch {
      toast(pick(locale, 'โหลดประวัติไม่สำเร็จ', 'Could not load history.'), 'error');
    } finally {
      setHistoryBusy(false);
    }
  };

  const removeReading = async (readingId: string) => {
    if (!confirm(pick(locale, 'ลบคำทำนายนี้?', 'Delete this reading?'))) return;
    try {
      await deleteTarotReading(user.uid, readingId);
      setHistory((current) => current?.filter((item) => item.id !== readingId) ?? null);
    } catch {
      toast(pick(locale, 'ลบไม่สำเร็จ', 'Delete failed.'), 'error');
    }
  };

  const clearHistory = async () => {
    if (!confirm(pick(locale, 'ลบประวัติการดูไพ่ทั้งหมด?', 'Delete all tarot history?'))) return;
    try {
      await clearTarotHistory(user.uid);
      setHistory([]);
    } catch {
      toast(pick(locale, 'ลบประวัติไม่สำเร็จ', 'Could not clear history.'), 'error');
    }
  };

  return (
    <div className="tarot-page">
      <CosmicBackdrop />
      <header className="tarot-nav">
        <Link to="/" className="tarot-back">← <span>ProjectSpace</span></Link>
        <div className="tarot-wordmark"><i>☾</i><strong>ARCANA</strong><small>AI TAROT</small></div>
        <div>
          <button type="button" onClick={() => void openHistory()}>⌛ <span>{pick(locale, 'ประวัติ', 'History')}</span></button>
          <button type="button" onClick={() => context.setLocale(locale === 'th' ? 'en' : 'th')}>{locale === 'th' ? 'EN' : 'ไทย'}</button>
          <button type="button" aria-label={pick(locale, 'ออกจากระบบ', 'Sign out')} onClick={() => signOut(auth!)}>↪</button>
        </div>
      </header>

      <main className={`tarot-stage stage-${stage}`}>
        {(stage === 'form' || stage === 'shuffling') && (
          <section className="tarot-intro">
            <p className="tarot-kicker">✦ THE CARDS ARE LISTENING ✦</p>
            <h1>{pick(locale, 'จักรวาลมีสิ่งใดอยากบอกคุณ', 'What does the universe want you to know?')}</h1>
            <p>{pick(locale, 'ตั้งจิตถึงสิ่งที่อยากรู้ แล้วปล่อยให้ไพ่ทั้งสามนำทาง', 'Hold your question in mind and let three cards illuminate the path.')}</p>
            <div className="tarot-form-glass">
              <fieldset>
                <legend>{pick(locale, 'เลือกเรื่องที่อยากถาม', 'Choose your focus')}</legend>
                <div className="tarot-categories">
                  {categories.map((item) => <button type="button" key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}><i>{item.icon}</i>{pick(locale, item.th, item.en)}</button>)}
                </div>
              </fieldset>
              <label>{pick(locale, 'คำถามถึงไพ่', 'Your question')} <small>{pick(locale, '(ไม่บังคับ)', '(optional)')}</small>
                <textarea maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={pick(locale, 'เช่น เส้นทางข้างหน้าของฉันกำลังมุ่งไปทางใด...', 'For example: Where is my path leading...')} />
                <span>{question.length}/500</span>
              </label>
              {error && <p className="tarot-error">⚠ {error}</p>}
              <button className="tarot-primary" disabled={stage === 'shuffling'} onClick={() => void start()}>{stage === 'shuffling' ? <><i className="tarot-orbit" />{pick(locale, 'กำลังสับชะตา...', 'Shuffling fate...')}</> : <>✦ {pick(locale, 'เริ่มสับไพ่', 'Shuffle the deck')}</>}</button>
              <small className="tarot-privacy">◌ {pick(locale, 'คำถามจะถูกส่งให้ KKU GenAI และบันทึกเป็นประวัติส่วนตัว', 'Your question is processed by KKU GenAI and saved to your private history.')}</small>
            </div>
          </section>
        )}

        {(stage === 'selecting' || stage === 'reading') && session && (
          <section className="tarot-selection">
            <p className="tarot-kicker">✦ CHOOSE WITH INTENTION ✦</p>
            <h1>{pick(locale, 'เลือกไพ่สามใบ', 'Choose three cards')}</h1>
            <p>{pick(locale, 'ใบแรกคืออดีต ใบที่สองคือปัจจุบัน และใบสุดท้ายคืออนาคต', 'First is the past, second the present, and third the future.')}</p>
            <div className="tarot-choice-status" aria-live="polite">
              {(['past', 'present', 'future'] as const).map((position, index) => <span key={position} className={selected[index] !== undefined ? 'filled' : ''}><b>{index + 1}</b>{pick(locale, positionNames[position].th, positionNames[position].en)}</span>)}
            </div>
            <div className="tarot-deck-shell">
              <button type="button" className="tarot-deck-control previous" aria-label={pick(locale, 'เลื่อนไพ่ไปทางซ้าย', 'Scroll cards left')} onClick={() => scrollDeck(-1)}>‹</button>
              <div id="tarot-card-deck" ref={deckRef} className="tarot-deck" role="listbox" tabIndex={0} aria-label={pick(locale, 'สำรับไพ่ 78 ใบ ใช้ล้อเมาส์หรือลูกศรเพื่อเลื่อน', '78-card tarot deck. Use the mouse wheel or arrow keys to scroll.')} aria-multiselectable="true" onWheel={handleDeckWheel} onKeyDown={handleDeckKeyDown}>
                {Array.from({ length: session.deckSize }, (_, index) => {
                  const chosen = selected.indexOf(index);
                  return <button type="button" key={index} role="option" aria-selected={chosen >= 0} aria-label={chosen >= 0 ? `${pick(locale, 'ไพ่ที่เลือก', 'Selected card')} ${chosen + 1}` : `${pick(locale, 'ไพ่คว่ำใบที่', 'Face-down card')} ${index + 1}`} className={chosen >= 0 ? 'chosen' : ''} style={{ '--card-index': index } as React.CSSProperties} disabled={stage === 'reading'} onClick={() => toggleCard(index)}><CardBack /><b>{chosen >= 0 ? chosen + 1 : ''}</b></button>;
                })}
              </div>
              <button type="button" className="tarot-deck-control next" aria-label={pick(locale, 'เลื่อนไพ่ไปทางขวา', 'Scroll cards right')} onClick={() => scrollDeck(1)}>›</button>
              <small className="tarot-deck-hint">↔ {pick(locale, 'วางเมาส์เหนือไพ่แล้วหมุนล้อ หรือใช้ปุ่มลูกศร', 'Hover over the cards and use the wheel or arrow keys')}</small>
            </div>
            {error && <p className="tarot-error">⚠ {error}</p>}
            <div className="tarot-selection-actions">
              <button className="tarot-secondary" disabled={stage === 'reading'} onClick={reshuffle}>{pick(locale, 'สับใหม่', 'Reshuffle')}</button>
              <button className="tarot-primary" disabled={selected.length !== 3 || stage === 'reading'} onClick={() => void reveal()}>{stage === 'reading' ? <><i className="tarot-orbit" />{pick(locale, 'กำลังฟังเสียงจากไพ่...', 'Listening to the cards...')}</> : <>☾ {pick(locale, 'เปิดคำทำนาย', 'Reveal the reading')}</>}</button>
            </div>
          </section>
        )}

        {stage === 'result' && result && (
          <TarotResult locale={locale} result={result} question={question} category={category} onAgain={reshuffle} savePending={Boolean(savePending)} onRetrySave={() => savePending && void persist(savePending)} />
        )}
      </main>

      <footer className="tarot-disclaimer">{pick(locale, 'ไพ่เป็นกระจกสะท้อนใจ มิใช่คำตัดสินอนาคต · โปรดใช้วิจารณญาณในการตัดสินใจสำคัญ', 'The cards are a mirror, not a verdict. Use your judgment for important decisions.')}</footer>
      {historyOpen && <HistoryDrawer locale={locale} history={history || []} busy={historyBusy} onClose={() => setHistoryOpen(false)} onDelete={removeReading} onClear={clearHistory} />}
    </div>
  );
}

function TarotResult({ locale, result, question, category, onAgain, savePending, onRetrySave }: { locale: string; result: TarotReveal; question: string; category: TarotCategory; onAgain: () => void; savePending: boolean; onRetrySave: () => void }) {
  return <section className="tarot-result">
    <p className="tarot-kicker">✦ YOUR READING ✦</p>
    <h1>{pick(locale, 'สารจากไพ่ทั้งสาม', 'A message from your three cards')}</h1>
    {question && <blockquote>“{question}”</blockquote>}
    <div className="tarot-revealed-cards">{result.cards.map((card, index) => <article key={`${card.id}-${card.position}`} style={{ '--reveal-delay': `${index * 180}ms` } as React.CSSProperties}><span>{pick(locale, positionNames[card.position].th, positionNames[card.position].en)}</span><div className={card.reversed ? 'reversed' : ''}><TarotCardImage cardId={card.id} alt={locale === 'th' ? card.nameTh : card.nameEn} /></div><h2>{locale === 'th' ? card.nameTh : card.nameEn}</h2><small>{card.reversed ? pick(locale, 'ไพ่กลับหัว', 'Reversed') : pick(locale, 'ไพ่ตั้งตรง', 'Upright')}</small></article>)}</div>
    <MarkdownReading markdown={result.readingMarkdown} />
    {savePending && <button className="tarot-save-retry" onClick={onRetrySave}>↻ {pick(locale, 'ลองบันทึกประวัติอีกครั้ง', 'Retry saving to history')}</button>}
    <button className="tarot-primary" onClick={onAgain}>✦ {pick(locale, 'เปิดไพ่ครั้งใหม่', 'Begin another reading')}</button>
    <span className="tarot-category-mark">{category.toUpperCase()}</span>
  </section>;
}

function HistoryDrawer({ locale, history, busy, onClose, onDelete, onClear }: { locale: string; history: TarotReading[]; busy: boolean; onClose: () => void; onDelete: (id: string) => void; onClear: () => void }) {
  return <div className="tarot-history-layer"><button className="tarot-history-scrim" aria-label={pick(locale, 'ปิด', 'Close')} onClick={onClose} /><aside className="tarot-history"><header><div><small>THE ARCHIVE</small><h2>{pick(locale, 'ประวัติคำทำนาย', 'Reading history')}</h2></div><button onClick={onClose}>×</button></header>{busy ? <div className="tarot-history-empty"><i className="tarot-orbit" />{pick(locale, 'กำลังเปิดหอจดหมายเหตุ...', 'Opening the archive...')}</div> : history.length ? <><div className="tarot-history-list">{history.map((item) => <details key={item.id}><summary><div><strong>{item.question || pick(locale, 'คำทำนายทั่วไป', 'General reading')}</strong><small>{item.createdAt ? formatDateTime(item.createdAt, locale) : '—'} · {item.category}</small></div><span>{item.cards.map((card) => locale === 'th' ? card.nameTh : card.nameEn).join(' · ')}</span></summary><div className="tarot-history-body"><div className="tarot-history-mini-cards">{item.cards.map((card) => <img key={card.position} className={card.reversed ? 'reversed' : ''} src={cardImageUrl(card.id)} alt={locale === 'th' ? card.nameTh : card.nameEn} />)}</div><MarkdownReading markdown={item.readingMarkdown} /><button className="tarot-delete" onClick={() => void onDelete(item.id)}>{pick(locale, 'ลบคำทำนายนี้', 'Delete this reading')}</button></div></details>)}</div><button className="tarot-clear" onClick={() => void onClear()}>{pick(locale, 'ลบประวัติทั้งหมด', 'Clear all history')}</button></> : <div className="tarot-history-empty">☾<strong>{pick(locale, 'ยังไม่มีคำทำนาย', 'No readings yet')}</strong><span>{pick(locale, 'เมื่อคุณเปิดไพ่ ผลจะถูกเก็บไว้ที่นี่', 'Your readings will appear here.')}</span></div>}</aside></div>;
}

function MarkdownReading({ markdown }: { markdown: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(markdown) as string), [markdown]);
  return <article className="tarot-reading markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function CardBack() {
  return <span className="tarot-card-back" aria-hidden="true"><i>☾</i><b>✦</b><em>ARCANA</em></span>;
}

function TarotCardImage({ cardId, alt }: { cardId: string; alt: string }) {
  const src = cardImageUrl(cardId);
  return <>{src && <img src={src} alt={alt} onError={(event) => { event.currentTarget.hidden = true; event.currentTarget.parentElement?.classList.add('image-failed'); }} />}<CardBack /></>;
}

function CosmicBackdrop() {
  return <div className="cosmic-backdrop" aria-hidden="true"><i /><i /><i /><div className="cosmic-stars" /></div>;
}

function cardImageUrl(cardId: string): string {
  const base = ((import.meta.env.VITE_TAROT_CDN_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');
  const card = tarotCardById(cardId);
  return base && card ? `${base}/deck-v1/${card.slug}.webp` : '';
}

function apiMessage(cause: unknown, locale: string): string {
  if (cause instanceof TarotApiError) return cause.message;
  return pick(locale, 'เส้นทางสู่ไพ่ขัดข้อง กรุณาลองอีกครั้ง', 'The path to the cards is blocked. Please try again.');
}
