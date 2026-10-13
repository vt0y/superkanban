import type { CSSProperties, ReactNode } from 'react';
import { Avatar } from '@/components/common';
import type { GachaMemberSnapshot, Locale } from '@/types';
import { pick } from '@/utils/formatters';
import type { WinnerGroup } from './GoldenStage';

/** Phase boundaries inside one 3400ms round; the pull lands at the same 2450ms mark as the other animations. */
const CHARGE_AT = 700;
const OVERLOAD_AT = 1300;
const TEAR_AT = 1800;
const REVEAL_AT = 2450;
const SHARDS = Array.from({ length: 18 }, (_, index) => {
  const angle = (index / 18) * Math.PI * 2;
  const reach = 180 + (index * 53) % 160;
  return { dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach, spin: (index * 67) % 360 };
});
const BOLTS = ['M60 10 L48 60 L66 64 L40 130', 'M240 20 L256 70 L238 76 L262 140', 'M30 220 L70 236 L62 254 L110 270', 'M270 230 L232 246 L240 262 L190 280'];

function PackFace({ title }: { title: string }) {
  return (
    <span className="pack-face">
      <span className="pack-foil" />
      <span className="pack-crimp top" /><span className="pack-crimp bottom" />
      <span className="pack-seal">✦</span>
      <b lang="en">MYTHIC PACK</b>
      <small>{title}</small>
    </span>
  );
}

/** A holographic trading card for one winner. */
export function HoloCard({ member, fallbackName, caption, small = false }: { member?: GachaMemberSnapshot; fallbackName: string; caption: string; small?: boolean }) {
  const name = member?.displayName || fallbackName;
  return (
    <span className={`holo-card ${small ? 'small' : ''}`}>
      <span className="holo-card-foil" aria-hidden="true" />
      <span className="holo-card-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} style={{ '--i': index } as CSSProperties}>✦</i>)}</span>
      <span className="holo-card-art"><Avatar name={name} src={member?.photoURL} size="lg" /></span>
      <strong>{name}</strong>
      <small><em lang="en">MYTHIC</em> · {caption}</small>
      <span className="holo-card-shine" aria-hidden="true" />
    </span>
  );
}

/** One round of the Mythic Pack: the pack descends → charges with lightning → tears in two → a card rises on a pillar of light. */
export function PackRound({ round, total, withinRound, title, winner, winnerId, locale, kicker, footer }: {
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
  const phase = withinRound < CHARGE_AT ? 'descend' : withinRound < TEAR_AT ? 'charge' : withinRound < REVEAL_AT ? 'tear' : 'pull';
  const overload = phase === 'charge' && withinRound >= OVERLOAD_AT;
  const countdown = withinRound < 650 ? '3' : withinRound < 1300 ? '2' : '1';
  const status = {
    descend: pick(locale, 'แพ็กกำลังลงมา…', 'The pack descends…'),
    charge: overload ? pick(locale, 'พลังล้นแล้ว!', 'OVERLOAD!') : pick(locale, 'กำลังชาร์จพลัง…', 'Charging…'),
    tear: pick(locale, 'ฉีก!', 'TEAR IT OPEN!'),
    pull: '',
  }[phase];

  return (
    <section className={`pack-stage phase-${phase} ${overload ? 'overload' : ''}`}>
      <p className="pack-kicker">✦ {kicker} · {round + 1} / {total} ✦</p>
      <h1>{title}</h1>
      <div className="pack-table">
        {phase !== 'pull' ? (
          <>
            <i className="pack-beam" aria-hidden="true" />
            {phase === 'charge' && <span className="pack-rings" aria-hidden="true"><i /><i /><i /></span>}
            {phase === 'charge' && (
              <svg className="pack-bolts" viewBox="0 0 300 300" aria-hidden="true">
                {BOLTS.map((path, index) => <path key={index} d={path} style={{ '--i': index } as CSSProperties} />)}
              </svg>
            )}
            <span className="pack-body">
              <span className="pack-half top"><PackFace title={title} /></span>
              <span className="pack-half bottom"><PackFace title={title} /></span>
              {phase !== 'tear' && <i className="pack-seam" aria-hidden="true" />}
            </span>
            {phase === 'tear' && <i className="pack-flash" aria-hidden="true" />}
            <div className="pack-count" key={countdown} aria-hidden="true">{countdown}</div>
          </>
        ) : (
          <div className="pack-pull">
            <i className="pack-pillar" aria-hidden="true" />
            <span className="pack-shards" aria-hidden="true">
              {SHARDS.map((shard, index) => <i key={index} style={{ '--dx': `${shard.dx}px`, '--dy': `${shard.dy}px`, '--r': `${shard.spin}deg` } as CSSProperties} />)}
            </span>
            <span className="pack-rising"><HoloCard member={winner} fallbackName={winnerId} caption={title} /></span>
          </div>
        )}
      </div>
      {phase === 'pull'
        ? <div className="pack-verdict"><small lang="en">✦✦✦✦✦ MYTHIC PULL</small><h2>{winner?.displayName || winnerId}</h2><p>{footer}</p></div>
        : <strong className="pack-status">{status}</strong>}
    </section>
  );
}

/** The haul: every winner as a holo card you can tilt. */
export function PackSummary({ heading, title, sub, groups, onDone, locale }: { heading: string; title: string; sub: string; groups: WinnerGroup[]; onDone: () => void; locale: Locale }) {
  let order = 0;
  return (
    <section className="pack-summary">
      <p className="pack-kicker">✦ {heading} ✦</p>
      <h1>{title}</h1>
      <p className="pack-sub">{sub}</p>
      {groups.map((group) => (
        <article key={group.key} className={group.label ? 'grouped' : ''}>
          {group.label && <header>{group.label}</header>}
          <div className="pack-haul">
            {group.winners.map(({ winnerId, member }, index) => {
              order += 1;
              return <span key={`${winnerId}:${index}`} className="pack-landed" style={{ '--i': order - 1 } as CSSProperties}><HoloCard small={Boolean(group.label)} member={member} fallbackName={winnerId} caption={group.caption ?? title} /></span>;
            })}
          </div>
        </article>
      ))}
      <button className="pack-done" onClick={onDone}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button>
    </section>
  );
}
