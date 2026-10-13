import { useState, type CSSProperties, type ReactNode } from 'react';
import { Avatar } from '@/components/common';
import type { GachaMemberSnapshot, Locale } from '@/types';
import { pick } from '@/utils/formatters';

/** Phase boundaries inside one 3400ms round; the jackpot lands at the same 2450ms mark as the other animations. */
const SPIN_AT = 500;
const LOCK_AT = 2200;
const REVEAL_AT = 2450;
const REEL_COPIES = 6;
const BULBS = 16;
const COINS = Array.from({ length: 26 }, (_, index) => {
  // A fixed fan of arcs so every viewer sees the same shower.
  const angle = (index / 26) * Math.PI * 2 + (index % 3) * .21;
  const reach = 160 + (index * 37) % 140;
  return { dx: Math.cos(angle) * reach, peak: -Math.abs(Math.sin(angle)) * reach - 90, delay: (index % 7) * 45 };
});

export interface WinnerGroup { key: string; label?: ReactNode; caption?: string; winners: { winnerId: string; member?: GachaMemberSnapshot }[] }

function Coins({ falling = false }: { falling?: boolean }) {
  return (
    <div className={`golden-coins ${falling ? 'falling' : ''}`} aria-hidden="true">
      {COINS.map((coin, index) => <i key={index} style={{ '--dx': `${coin.dx}px`, '--peak': `${coin.peak}px`, '--d': `${coin.delay}ms`, '--x': `${(index * 37) % 100}%`, '--i': index } as CSSProperties} />)}
    </div>
  );
}

function Medallion({ member, fallbackName, rank }: { member?: GachaMemberSnapshot; fallbackName: string; rank?: number }) {
  const name = member?.displayName || fallbackName;
  return (
    <span className="golden-medallion">
      {rank !== undefined && <b className="golden-rank">#{rank}</b>}
      <span className="golden-medallion-rim"><Avatar name={name} src={member?.photoURL} size="lg" /></span>
      <strong>{name}</strong>
    </span>
  );
}

/** One round of the Grand Jackpot: marquee lights up → the reel spins and lands on the real winner → lock → coin shower. */
export function GoldenRound({ round, total, withinRound, title, winner, winnerId, candidates, locale, kicker, footer }: {
  round: number;
  total: number;
  withinRound: number;
  title: string;
  winner?: GachaMemberSnapshot;
  winnerId: string;
  candidates: GachaMemberSnapshot[];
  locale: Locale;
  kicker: string;
  footer: ReactNode;
}) {
  // Someone opening the reveal mid-round joins the reel where everyone else already is.
  const [joinedAt] = useState(withinRound);
  const phase = withinRound < SPIN_AT ? 'ignite' : withinRound < LOCK_AT ? 'spin' : withinRound < REVEAL_AT ? 'lock' : 'jackpot';
  const countdown = withinRound < 650 ? '3' : withinRound < 1300 ? '2' : '1';
  const pool = candidates.length ? candidates : [{ userId: winnerId, displayName: winnerId, photoURL: '' }];
  const landing = pool.length * (REEL_COPIES - 2) + Math.max(0, pool.findIndex((member) => member.userId === winnerId));
  const reel = Array.from({ length: REEL_COPIES }, () => pool).flat();
  const bulbs = Array.from({ length: BULBS }, (_, index) => <i key={index} style={{ '--i': index } as CSSProperties} />);

  return (
    <section className={`golden-stage phase-${phase}`}>
      <i className="golden-spot left" aria-hidden="true" /><i className="golden-spot right" aria-hidden="true" />
      <p className="golden-kicker">✦ {kicker} · {round + 1} / {total} ✦</p>
      <div className="golden-marquee" aria-hidden="true">GRAND JACKPOT</div>
      <h1>{title}</h1>
      {phase !== 'jackpot' ? (
        <div className="golden-cabinet">
          <div className="golden-bulbs top" aria-hidden="true">{bulbs}</div>
          <div className="golden-window">
            <i className="golden-pointer top" aria-hidden="true" /><i className="golden-pointer bottom" aria-hidden="true" />
            <div className="golden-reel" style={{ '--land-i': landing, animationDelay: `${SPIN_AT - joinedAt}ms` } as CSSProperties}>
              {reel.map((member, index) => (
                <span key={`${member.userId}:${index}`} className={`golden-tile ${index === landing ? 'win' : ''}`}>
                  <span className="golden-tile-coin"><Avatar name={member.displayName} src={member.photoURL} size="lg" /></span>
                  <strong>{member.displayName}</strong>
                </span>
              ))}
            </div>
          </div>
          <div className="golden-bulbs bottom" aria-hidden="true">{bulbs}</div>
          <div className="golden-count" key={countdown} aria-hidden="true">{phase === 'lock' ? '★' : countdown}</div>
        </div>
      ) : (
        <div className="golden-jackpot">
          <i className="golden-flash" aria-hidden="true" />
          <i className="golden-rays" aria-hidden="true" />
          <Coins />
          <div className="golden-stamp" aria-hidden="true">JACKPOT!</div>
          <Medallion member={winner} fallbackName={winnerId} />
          <p>{footer}</p>
        </div>
      )}
      {phase !== 'jackpot' && <strong className="golden-status">{phase === 'ignite' ? pick(locale, 'ไฟกำลังเปิด…', 'Lights up…') : phase === 'spin' ? (withinRound < 1500 ? pick(locale, 'หมุนเต็มสปีด!', 'MAXIMUM SPEED!') : pick(locale, 'กำลังชะลอ…', 'Slowing down…')) : pick(locale, 'ล็อก!', 'LOCKED!')}</strong>}
    </section>
  );
}

/** The final board: every winner as a gold medallion, with coins still drifting down. */
export function GoldenSummary({ heading, title, sub, groups, onDone, locale }: { heading: string; title: string; sub: string; groups: WinnerGroup[]; onDone: () => void; locale: Locale }) {
  let rank = 0;
  return (
    <section className="golden-summary">
      <Coins falling />
      <p className="golden-kicker">✦ {heading} ✦</p>
      <div className="golden-marquee static" aria-hidden="true">JACKPOT</div>
      <h1>{title}</h1>
      <p className="golden-sub">{sub}</p>
      {groups.map((group) => (
        <article key={group.key} className={group.label ? 'grouped' : ''}>
          {group.label && <header>{group.label}</header>}
          <div className="golden-podium">
            {group.winners.map(({ winnerId, member }, index) => {
              rank += 1;
              return <span key={`${winnerId}:${index}`} className="golden-landed" style={{ '--i': rank - 1 } as CSSProperties}><Medallion member={member} fallbackName={winnerId} rank={rank} /></span>;
            })}
          </div>
        </article>
      ))}
      <button className="golden-done" onClick={onDone}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button>
    </section>
  );
}
