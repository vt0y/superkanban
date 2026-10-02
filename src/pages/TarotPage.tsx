import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';
import type { AppContextValue } from '@/context/AppContext';
import type { TarotCategory } from '@/tarot/deck';
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
import { Icon } from '@/components/common/Icon';
import { CardSlots } from '@/components/tarot/CardSlots';
import { CardSpread } from '@/components/tarot/CardSpread';
import { CosmicBackdrop } from '@/components/tarot/CosmicBackdrop';
import { HistoryPanel } from '@/components/tarot/HistoryPanel';
import { ShuffleRitual } from '@/components/tarot/ShuffleRitual';
import { TarotForm } from '@/components/tarot/TarotForm';
import { TarotNav } from '@/components/tarot/TarotNav';
import { TarotResult } from '@/components/tarot/TarotResult';
import { pick } from '@/utils/formatters';

type Stage = 'form' | 'shuffling' | 'selecting' | 'reading' | 'result';
/** Long enough for the shuffle animation to read as a ritual rather than a flash. */
const MIN_SHUFFLE_MS = 1400;
const DISPLAY_FONTS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Noto+Serif+Thai:wght@500;600&display=swap';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The serif display faces are only used here, so load them on this page instead of for every visitor. */
function useDisplayFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${DISPLAY_FONTS}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = DISPLAY_FONTS;
    document.head.append(link);
  }, []);
}

const READING_PHRASES: [string, string][] = [
  ['กำลังฟังเสียงจากไพ่…', 'Listening to the cards…'],
  ['ดวงดาวกำลังเรียงตัว…', 'The stars are aligning…'],
  ['กำลังถักทอคำทำนาย…', 'Weaving your reading…'],
];

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
  const [phrase, setPhrase] = useState(0);
  useDisplayFonts();

  useEffect(() => {
    if (stage !== 'reading') return;
    setPhrase(0);
    const timer = window.setInterval(() => setPhrase((index) => (index + 1) % READING_PHRASES.length), 2200);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [stage]);

  const start = async () => {
    setError('');
    setStage('shuffling');
    try {
      const [next] = await Promise.all([createTarotSession(user, category, question, locale), delay(MIN_SHUFFLE_MS)]);
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

  const reading = stage === 'reading';
  return (
    <div className={`tarot-page arc ${locale}`} lang={locale}>
      <CosmicBackdrop />
      <TarotNav locale={locale} onHistory={() => void openHistory()} onToggleLocale={() => context.setLocale(locale === 'th' ? 'en' : 'th')} onSignOut={() => void signOut(auth!)} />

      <main className={`arc-stage stage-${stage}`}>
        {stage === 'form' && (
          <TarotForm locale={locale} category={category} question={question} error={error} onCategory={setCategory} onQuestion={setQuestion} onStart={() => void start()} />
        )}

        {stage === 'shuffling' && <ShuffleRitual locale={locale} />}

        {(stage === 'selecting' || reading) && session && (
          <section className="arc-selection">
            <p className="arc-kicker"><Icon name="star" /> {pick(locale, 'เลือกด้วยใจ', 'Choose with intention')} <Icon name="star" /></p>
            <h1>{reading ? pick(locale, READING_PHRASES[phrase][0], READING_PHRASES[phrase][1]) : pick(locale, 'เลือกไพ่สามใบ', 'Choose three cards')}</h1>
            <p className="arc-lede">
              {reading
                ? pick(locale, 'ไพ่ทั้งสามกำลังเผยความหมาย', 'Your three cards are revealing their meaning')
                : selected.length < 3
                  ? pick(locale, `เลือกอีก ${3 - selected.length} ใบ · ใบแรกคืออดีต ใบที่สองคือปัจจุบัน ใบสุดท้ายคืออนาคต`, `${3 - selected.length} to go · first is the past, second the present, third the future`)
                  : pick(locale, 'ครบสามใบแล้ว พร้อมเปิดคำทำนาย', 'All three chosen. Ready when you are.')}
            </p>
            <CardSlots selected={selected} locale={locale} reading={reading} onReturn={toggleCard} />
            {!reading && <CardSpread deckSize={session.deckSize} selected={selected} disabled={reading} locale={locale} onToggle={toggleCard} />}
            {error && <p className="arc-error" role="alert"><Icon name="alert" /> {error}</p>}
            {!reading && (
              <div className="arc-selection-actions">
                <button type="button" className="arc-ghost" onClick={reshuffle}><Icon name="shuffle" /> {pick(locale, 'สับใหม่', 'Reshuffle')}</button>
                <button type="button" className="arc-primary" disabled={selected.length !== 3} onClick={() => void reveal()}><Icon name="moonStar" /> {pick(locale, 'เปิดคำทำนาย', 'Reveal the reading')}</button>
              </div>
            )}
            {reading && <i className="arc-orbit large" aria-hidden="true" />}
          </section>
        )}

        {stage === 'result' && result && (
          <TarotResult locale={locale} result={result} question={question} category={category} onAgain={reshuffle} savePending={Boolean(savePending)} onRetrySave={() => savePending && void persist(savePending)} />
        )}
      </main>

      <footer className="arc-disclaimer">{pick(locale, 'ไพ่เป็นกระจกสะท้อนใจ มิใช่คำตัดสินอนาคต · โปรดใช้วิจารณญาณในการตัดสินใจสำคัญ', 'The cards are a mirror, not a verdict. Use your judgment for important decisions.')}</footer>
      {historyOpen && <HistoryPanel locale={locale} history={history || []} busy={historyBusy} onClose={() => setHistoryOpen(false)} onDelete={removeReading} onClear={() => void clearHistory()} />}
    </div>
  );
}

function apiMessage(cause: unknown, locale: string): string {
  if (cause instanceof TarotApiError) return cause.message;
  return pick(locale, 'เส้นทางสู่ไพ่ขัดข้อง กรุณาลองอีกครั้ง', 'The path to the cards is blocked. Please try again.');
}
