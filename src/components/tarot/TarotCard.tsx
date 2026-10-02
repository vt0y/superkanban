import { useState } from 'react';
import { tarotCardById } from '@/tarot/deck';

export function cardImageUrl(cardId: string): string {
  const base = ((import.meta.env.VITE_TAROT_CDN_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');
  const card = tarotCardById(cardId);
  return base && card ? `${base}/deck-v1/${card.slug}.webp` : '';
}

/** The shared card back: gold sigil over a star field inside a filigree border. */
export function CardBack() {
  return (
    <span className="arc-card-back" aria-hidden="true">
      <span className="arc-card-frame" />
      <svg viewBox="0 0 60 60" className="arc-sigil">
        <circle cx="30" cy="30" r="21" />
        <circle cx="30" cy="30" r="14" />
        <path d="M30 6v48M6 30h48M13 13l34 34M47 13 13 47" />
        <path className="arc-sigil-moon" d="M35 22a9 9 0 1 0 0 16 7 7 0 1 1 0-16Z" />
      </svg>
      {/* lang=en: Thai pages get a browser minimum font size that would blow this tiny label up */}
      <em lang="en">ARCANA</em>
    </span>
  );
}

/** A card's face (CDN artwork). Falls back to the back with the card's name when the image can't load. */
export function CardFace({ cardId, name, reversed = false }: { cardId: string; name: string; reversed?: boolean }) {
  const src = cardImageUrl(cardId);
  const [failed, setFailed] = useState(!src);
  return (
    <span className={`arc-card-face ${reversed ? 'reversed' : ''} ${failed ? 'failed' : ''}`}>
      {!failed && <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} />}
      {failed && <><CardBack /><strong className="arc-card-name">{name}</strong></>}
    </span>
  );
}
