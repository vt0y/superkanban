import { TAROT_POSITIONS } from '@/tarot/deck';
import type { Locale } from '@/types';
import { pick } from '@/utils/formatters';
import { CardBack } from './TarotCard';

export const POSITION_NAMES = {
  past: { th: 'อดีต', en: 'Past' },
  present: { th: 'ปัจจุบัน', en: 'Present' },
  future: { th: 'อนาคต', en: 'Future' },
} as const;

/** Past / Present / Future. A filled slot holds a card back; clicking it puts the card back in the deck. */
export function CardSlots({ selected, locale, reading, onReturn }: { selected: number[]; locale: Locale; reading: boolean; onReturn: (deckIndex: number) => void }) {
  return (
    <div className={`arc-slots ${reading ? 'is-reading' : ''}`} aria-live="polite">
      {TAROT_POSITIONS.map((position, index) => {
        const card = selected[index];
        const label = pick(locale, POSITION_NAMES[position].th, POSITION_NAMES[position].en);
        return (
          <div key={position} className={`arc-slot ${card !== undefined ? 'filled' : ''} ${index === selected.length && !reading ? 'next' : ''}`} style={{ '--i': index } as React.CSSProperties}>
            {card !== undefined
              ? <button type="button" disabled={reading} onClick={() => onReturn(card)} aria-label={pick(locale, `คืนไพ่${label}กลับสำรับ`, `Return the ${label.toLowerCase()} card`)}><CardBack /></button>
              : <span className="arc-slot-empty"><b>{index + 1}</b></span>}
            <small>{label}</small>
          </div>
        );
      })}
    </div>
  );
}
