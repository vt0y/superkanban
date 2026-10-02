import type { IconName } from '@/components/common/Icon';
import { Icon } from '@/components/common/Icon';
import type { TarotCategory } from '@/tarot/deck';
import { TAROT_SUGGESTIONS } from '@/tarot/suggestions';
import type { Locale } from '@/types';
import { pick } from '@/utils/formatters';

export const TAROT_CATEGORIES: { id: TarotCategory; icon: IconName; th: string; en: string; hintTh: string; hintEn: string }[] = [
  { id: 'general', icon: 'sparkles', th: 'ภาพรวม', en: 'General', hintTh: 'ชีวิตโดยรวม', hintEn: 'Life as a whole' },
  { id: 'love', icon: 'heart', th: 'ความรัก', en: 'Love', hintTh: 'หัวใจและความสัมพันธ์', hintEn: 'Heart & bonds' },
  { id: 'work', icon: 'briefcase', th: 'การงาน', en: 'Career', hintTh: 'งานและการเรียน', hintEn: 'Work & study' },
  { id: 'finance', icon: 'coins', th: 'การเงิน', en: 'Finance', hintTh: 'เงินและโอกาส', hintEn: 'Money & luck' },
];

export function TarotForm({ locale, category, question, error, onCategory, onQuestion, onStart }: {
  locale: Locale; category: TarotCategory; question: string; error: string;
  onCategory: (category: TarotCategory) => void; onQuestion: (question: string) => void; onStart: () => void;
}) {
  return (
    <section className="arc-intro">
      <p className="arc-kicker"><Icon name="star" /> {pick(locale, 'ไพ่กำลังรับฟัง', 'The cards are listening')} <Icon name="star" /></p>
      <h1>{pick(locale, 'จักรวาลมีสิ่งใดอยากบอกคุณ', 'What does the universe want you to know?')}</h1>
      <p className="arc-lede">{pick(locale, 'ตั้งจิตถึงสิ่งที่อยากรู้ แล้วปล่อยให้ไพ่ทั้งสามนำทาง', 'Hold your question in mind and let three cards illuminate the path.')}</p>

      <form className="arc-panel arc-form" onSubmit={(event) => { event.preventDefault(); onStart(); }}>
        <fieldset>
          <legend>{pick(locale, 'เลือกเรื่องที่อยากถาม', 'Choose your focus')}</legend>
          <div className="arc-focus">
            {TAROT_CATEGORIES.map((item) => (
              <button type="button" key={item.id} className={category === item.id ? 'active' : ''} aria-pressed={category === item.id} onClick={() => onCategory(item.id)}>
                <span className="arc-focus-icon"><Icon name={item.icon} /></span>
                <strong>{pick(locale, item.th, item.en)}</strong>
                <small>{pick(locale, item.hintTh, item.hintEn)}</small>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="arc-question">
          <span>{pick(locale, 'คำถามถึงไพ่', 'Your question')} <small>{pick(locale, '(ไม่บังคับ)', '(optional)')}</small></span>
          <textarea maxLength={500} rows={3} value={question} onChange={(event) => onQuestion(event.target.value)}
            placeholder={pick(locale, 'เช่น เส้นทางข้างหน้าของฉันกำลังมุ่งไปทางใด…', 'For example: where is my path leading…')} />
          <em>{question.length}/500</em>
        </label>
        <div className="arc-suggestions" aria-label={pick(locale, 'คำถามแนะนำ', 'Suggested questions')}>
          {TAROT_SUGGESTIONS[category].map((item) => {
            const text = pick(locale, item.th, item.en);
            return <button type="button" key={item.en} className={question === text ? 'active' : ''} onClick={() => onQuestion(text)}>{text}</button>;
          })}
        </div>

        {error && <p className="arc-error" role="alert"><Icon name="alert" /> {error}</p>}
        <button type="submit" className="arc-primary"><Icon name="shuffle" /> {pick(locale, 'เริ่มสับไพ่', 'Shuffle the deck')}</button>
        <small className="arc-privacy"><Icon name="lock" /> {pick(locale, 'คำถามจะถูกส่งให้ KKU GenAI และบันทึกเป็นประวัติส่วนตัวของคุณเท่านั้น', 'Your question is processed by KKU GenAI and saved only to your private history.')}</small>
      </form>
    </section>
  );
}
