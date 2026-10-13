import type { CSSProperties, ReactNode } from 'react';
import { Avatar } from '@/components/common';
import { CardBack } from '@/components/tarot/TarotCard';
import type { GachaMemberSnapshot, Locale } from '@/types';
import { pick } from '@/utils/formatters';
import { useDisplayFonts } from '@/hooks/useDisplayFonts';

/** Phase boundaries inside one 3400ms round; the reveal starts at the same 2450ms mark as the other animations. */
const SHUFFLE_END = 900;
const DEAL_END = 1800;
const REVEAL_AT = 2450;
const FAN = 7;

const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function toRoman(value: number): string {
  let rest = value;
  return ROMAN.reduce((out, [size, glyph]) => { while (rest >= size) { out += glyph; rest -= size; } return out; }, '');
}

/** A tarot-style face card for a chosen member: numeral, haloed avatar, name, and the draw as its caption. */
export function ArcanaFace({ member, fallbackName, numeral, caption, small = false }: { member?: Pick<GachaMemberSnapshot, 'displayName' | 'photoURL'>; fallbackName: string; numeral: string; caption: string; small?: boolean }) {
  const name = member?.displayName || fallbackName;
  return (
    <span className={`arcana-face ${small ? 'small' : ''}`}>
      <span className="arcana-face-frame" aria-hidden="true" />
      <b className="arcana-face-numeral" lang="en">{numeral}</b>
      <span className="arcana-face-halo"><Avatar name={name} src={member?.photoURL} size="lg" /></span>
      <strong>{name}</strong>
      <small>{caption}</small>
    </span>
  );
}

/** One automatic round: shuffle → deal a fan → fate lifts one card → it flips to show the winner. */
export function ArcanaRound({ round, total, withinRound, title, winner, winnerId, locale, kicker, footer }: {
  round: number;
  total: number;
  withinRound: number;
  title: string;
  winner?: GachaMemberSnapshot;
  winnerId: string;
  locale: Locale;
  kicker: string;
  footer: ReactNode;
}) {
  useDisplayFonts();
  const phase = withinRound < SHUFFLE_END ? 'shuffle' : withinRound < DEAL_END ? 'deal' : withinRound < REVEAL_AT ? 'choose' : 'reveal';
  const countdown = withinRound < 650 ? '3' : withinRound < 1300 ? '2' : '1';
  // Vary which fanned card fate lifts, but the same for every viewer of the same round.
  const chosen = (round * 5 + 3) % FAN;
  const numeral = toRoman(round + 1);
  const status = {
    shuffle: pick(locale, 'กำลังสับชะตา…', 'Shuffling fate…'),
    deal: pick(locale, 'ไพ่กำลังถูกวางลง…', 'The cards are dealt…'),
    choose: pick(locale, 'ชะตากำลังเลือก…', 'Fate is choosing…'),
    reveal: '',
  }[phase];

  return (
    <section className={`arcana-round phase-${phase}`}>
      <p className="arcana-kicker"><span aria-hidden="true">☾</span> {kicker} · {numeral} / {toRoman(total)} <span aria-hidden="true">☽</span></p>
      <h1>{title}</h1>
      <div className="arcana-table">
        {phase === 'shuffle' && (
          <div className="arc-shuffle arcana-shuffle" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <span key={index} className="arc-shuffle-card" style={{ '--i': index } as CSSProperties}><CardBack /></span>)}
            <i className="arc-spark a" /><i className="arc-spark b" /><i className="arc-spark c" />
          </div>
        )}
        {(phase === 'deal' || phase === 'choose') && (
          <div className="arcana-fan" aria-hidden="true">
            {Array.from({ length: FAN }, (_, index) => (
              <span key={index} className={`arcana-fan-card ${index === chosen ? 'chosen' : ''}`} style={{ '--i': index, '--a': `${(index - (FAN - 1) / 2) * 11}deg` } as CSSProperties}>
                <CardBack />
              </span>
            ))}
            {phase === 'choose' && <i className="arcana-ring" />}
          </div>
        )}
        {phase === 'reveal' && (
          <div className="arcana-reveal">
            <i className="arcana-burst" aria-hidden="true" />
            <span className="arcana-flip">
              <span className="arcana-flip-back" aria-hidden="true"><CardBack /></span>
              <span className="arcana-flip-front"><ArcanaFace member={winner} fallbackName={winnerId} numeral={numeral} caption={title} /></span>
            </span>
          </div>
        )}
        {phase !== 'reveal' && <div className="arcana-countdown" key={`${round}:${countdown}`} aria-hidden="true">{countdown}</div>}
      </div>
      {phase === 'reveal'
        ? <div className="arcana-verdict"><small>{pick(locale, 'ไพ่แห่งโชคชะตาเลือก', 'The cards have chosen')}</small><h2>{winner?.displayName || winnerId}</h2><p>{footer}</p></div>
        : <strong className="arcana-status">{status}</strong>}
    </section>
  );
}
