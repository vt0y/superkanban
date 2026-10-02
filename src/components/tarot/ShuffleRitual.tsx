import type { Locale } from '@/types';
import { pick } from '@/utils/formatters';
import { CardBack } from './TarotCard';

/** Shown while the deck is being prepared: a stack of backs that splits, riffles and merges. */
export function ShuffleRitual({ locale }: { locale: Locale }) {
  return (
    <section className="arc-ritual" aria-live="polite">
      <div className="arc-shuffle" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className="arc-shuffle-card" style={{ '--i': index } as React.CSSProperties}><CardBack /></span>
        ))}
        <i className="arc-spark a" /><i className="arc-spark b" /><i className="arc-spark c" />
      </div>
      <h2>{pick(locale, 'กำลังสับชะตา…', 'Shuffling fate…')}</h2>
      <p>{pick(locale, 'หายใจลึก ๆ แล้วนึกถึงคำถามของคุณ', 'Breathe slowly and hold your question in mind')}</p>
    </section>
  );
}
