import { useEffect, useState, type CSSProperties } from 'react';
import { Avatar } from '@/components/common';
import type { GachaMemberSnapshot, Locale } from '@/types';
import { pick } from '@/utils/formatters';

export type GenericAnimation = 'golden' | 'pack';
export interface GenericRevealData {
  title: string;
  candidates: GachaMemberSnapshot[];
  winnerIds: string[];
  animation: GenericAnimation;
}

const PARTICLES = Array.from({ length: 28 });

export function GenericGachaReveal({ draw, locale, onClose }: { draw: GenericRevealData; locale: Locale; onClose: () => void }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [elapsed, setElapsed] = useState(reduced ? Number.MAX_SAFE_INTEGER : 0);
  useEffect(() => {
    if (reduced) return;
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - started), 50);
    return () => clearInterval(timer);
  }, [reduced]);
  const roundDuration = 3400;
  const round = Math.floor(elapsed / roundDuration);
  const withinRound = elapsed % roundDuration;
  const finished = round >= draw.winnerIds.length;
  const revealing = withinRound >= 2450;
  const currentWinnerId = draw.winnerIds[Math.min(round, draw.winnerIds.length - 1)];
  const currentWinner = draw.candidates.find((item) => item.userId === currentWinnerId);
  const reel = [...draw.candidates, ...draw.candidates, ...draw.candidates, ...draw.candidates];
  const countdown = withinRound < 650 ? '3' : withinRound < 1300 ? '2' : '1';

  return <div className={`generic-reveal ${draw.animation} ${finished ? 'finished' : ''}`} role="dialog" aria-modal="true" aria-label={draw.title}>
    <button className="generic-reveal-close" onClick={onClose}>×</button>
    <div className="gacha-particles" aria-hidden="true">{PARTICLES.map((_, index) => <i key={index} style={{ '--particle': index } as CSSProperties} />)}</div>
    {!finished && !revealing && draw.animation === 'golden' && <section className="golden-machine" key={`golden:${round}`}>
      <div className="gacha-round-label">ROUND {round + 1} / {draw.winnerIds.length}</div><div className="gacha-countdown" key={`${round}:${countdown}`}>{countdown}</div><span className="golden-crown">✦ GOLDEN ROULETTE ✦</span><h1>{draw.title}</h1>
      <div className="golden-lights">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
      <div className="golden-reel-window"><div className="golden-pointer top">▼</div><div className="golden-pointer bottom">▲</div><div className="golden-reel">{reel.map((member, index) => <div key={`${member.userId}:${index}`}><Avatar name={member.displayName} src={member.photoURL} size="lg" /><strong>{member.displayName}</strong></div>)}</div><div className="reel-speed-lines" /></div>
      <strong className="rolling-label">{withinRound < 1700 ? pick(locale, 'เร่งความเร็ว!', 'MAXIMUM SPEED!') : pick(locale, 'กำลังหยุด…', 'LOCKING IN…')}</strong>
    </section>}
    {!finished && !revealing && draw.animation === 'pack' && <section className={`generic-pack-stage phase-${Math.min(3, Math.floor(withinRound / 700))}`} key={`pack:${round}`}>
      <div className="gacha-round-label">ROUND {round + 1} / {draw.winnerIds.length}</div><div className="gacha-countdown" key={`${round}:${countdown}`}>{countdown}</div><span>✦ MYSTERY PACK ✦</span><h1>{draw.title}</h1>
      <div className="generic-pack-object"><div className="pack-rune">✦</div><b>WHO'S NEXT?</b><div className="pack-seam" /></div>
      <strong>{withinRound < 1800 ? pick(locale, 'พลังงานกำลังเพิ่มขึ้น…', 'CHARGE BUILDING…') : pick(locale, 'เปิด!', 'BREAK OPEN!')}</strong>
    </section>}
    {!finished && revealing && <section className="generic-round-winner" key={`winner:${round}`}><small>ROUND {round + 1} WINNER</small><div className="winner-aura" /><Avatar name={currentWinner?.displayName || currentWinnerId} src={currentWinner?.photoURL} size="lg" /><h1>{currentWinner?.displayName || currentWinnerId}</h1><p>{pick(locale, 'ผู้ชนะคนถัดไปกำลังมา…', 'Next winner incoming…')}</p></section>}
    {!finished && <div className="gacha-round-progress">{draw.winnerIds.map((winnerId, index) => <span key={winnerId} className={index < round ? 'done' : index === round ? 'active' : ''}>{index < round ? '✓' : index + 1}</span>)}</div>}
    {finished && <section className="generic-winners">
      <span>✦ {draw.animation === 'golden' ? 'JACKPOT' : 'LEGENDARY PULL'} ✦</span><h1>{draw.title}</h1><p>{pick(locale, `${draw.winnerIds.length} คนที่ถูกเลือก`, `${draw.winnerIds.length} selected`)}</p>
      <div>{draw.winnerIds.map((winnerId, index) => { const member = draw.candidates.find((item) => item.userId === winnerId); return <article key={winnerId} style={{ animationDelay: `${index * 130}ms` }}><b>#{index + 1}</b><div className="winner-aura" /><Avatar name={member?.displayName || winnerId} src={member?.photoURL} size="lg" /><strong>{member?.displayName || winnerId}</strong></article>; })}</div>
      <button className="golden-done" onClick={onClose}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button>
    </section>}
  </div>;
}
