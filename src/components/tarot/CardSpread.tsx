import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/common/Icon';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { fanPosition } from '@/tarot/spread';
import type { Locale } from '@/types';
import { pick } from '@/utils/formatters';
import { CardBack } from './TarotCard';

const HINT_KEY = 'ps.tarot.swiped';
const readHintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };

/**
 * The face-down deck. Desktop: two concentric arcs. Smaller screens: an overlapping row you swipe through.
 * It is one listbox with a roving tab stop: arrows move, Enter/Space picks.
 */
export function CardSpread({ deckSize, selected, disabled, locale, onToggle }: { deckSize: number; selected: number[]; disabled: boolean; locale: Locale; onToggle: (index: number) => void }) {
  const fan = useMediaQuery('(min-width: 1024px)');
  const [focus, setFocus] = useState(Math.floor(deckSize / 4));
  const [hintSeen, setHintSeen] = useState(readHintSeen);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const river = useRef<HTMLDivElement>(null);
  const autoScrolled = useRef(false);
  const full = selected.length >= 3;

  // Start the phone row near the middle of the deck so both directions feel open.
  useEffect(() => {
    if (fan || !river.current) return;
    autoScrolled.current = true;
    river.current.scrollLeft = (river.current.scrollWidth - river.current.clientWidth) / 2;
  }, [fan]);

  const move = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? deckSize - 1 : step !== undefined ? Math.max(0, Math.min(deckSize - 1, focus + step)) : null;
    if (target === null) return;
    event.preventDefault();
    setFocus(target);
    cards.current[target]?.focus();
    cards.current[target]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };

  const dismissHint = () => {
    // The centring above fires a scroll event too; only a real swipe dismisses the hint.
    if (autoScrolled.current) { autoScrolled.current = false; return; }
    if (hintSeen) return;
    setHintSeen(true);
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage blocked: the hint shows again next time */ }
  };

  return (
    <div className={`arc-spread ${fan ? 'is-fan' : 'is-river'} ${full ? 'is-full' : ''}`}>
      <div ref={river} className="arc-deck" role="listbox" aria-multiselectable="true" onKeyDown={move} onScroll={dismissHint}
        aria-label={pick(locale, `สำรับไพ่ ${deckSize} ใบ ใช้ลูกศรเพื่อเลื่อน และ Enter เพื่อเลือก`, `${deckSize}-card deck. Use the arrow keys to move and Enter to choose.`)}>
        {Array.from({ length: deckSize }, (_, index) => {
          const chosen = selected.indexOf(index);
          const { row, angle } = fanPosition(index, deckSize);
          return (
            <button
              type="button"
              key={index}
              ref={(element) => { cards.current[index] = element; }}
              role="option"
              aria-selected={chosen >= 0}
              tabIndex={index === focus ? 0 : -1}
              className={`arc-deck-card ${chosen >= 0 ? 'chosen' : ''}`}
              style={{ '--a': `${angle}deg`, '--row': row, '--i': index } as React.CSSProperties}
              disabled={disabled || (full && chosen < 0)}
              aria-label={chosen >= 0 ? pick(locale, `ไพ่ใบที่ ${chosen + 1} ที่เลือกแล้ว`, `Chosen card ${chosen + 1}`) : pick(locale, `ไพ่คว่ำใบที่ ${index + 1}`, `Face-down card ${index + 1}`)}
              onFocus={() => setFocus(index)}
              onClick={() => onToggle(index)}
            >
              <CardBack />
              {chosen >= 0 && <b>{chosen + 1}</b>}
            </button>
          );
        })}
      </div>
      {!fan && !hintSeen && <p className="arc-swipe-hint"><Icon name="hand" /> {pick(locale, 'ปัดเพื่อดูไพ่ทั้งสำรับ', 'Swipe to browse the whole deck')}</p>}
    </div>
  );
}
