import { useEffect, useState, type CSSProperties } from 'react';
import type { GachaMemberSnapshot, Locale } from '@/types';
import { pick } from '@/utils/formatters';
import { CosmicBackdrop } from '@/components/tarot/CosmicBackdrop';
import { ArcanaFace, ArcanaRound, toRoman } from './ArcanaStage';
import { GoldenRound, GoldenSummary } from './GoldenStage';
import { PackRound, PackSummary } from './PackStage';

export type GenericAnimation = 'golden' | 'pack' | 'arcana';
export interface GenericRevealData {
  title: string;
  candidates: GachaMemberSnapshot[];
  winnerIds: string[];
  animation: GenericAnimation;
}

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
  const currentWinnerId = draw.winnerIds[Math.min(round, draw.winnerIds.length - 1)];
  const currentWinner = draw.candidates.find((item) => item.userId === currentWinnerId);
  const arcana = draw.animation === 'arcana';
  return <div className={`generic-reveal ${draw.animation} ${arcana ? 'arcana-theme' : ''} ${finished ? 'finished' : ''}`} role="dialog" aria-modal="true" aria-label={draw.title}>
    <button className="generic-reveal-close" onClick={onClose}>×</button>
    {arcana && <CosmicBackdrop />}
    {!finished && arcana && <ArcanaRound key={`arcana:${round}`} round={round} total={draw.winnerIds.length} withinRound={withinRound} title={draw.title} winner={currentWinner} winnerId={currentWinnerId} locale={locale} kicker={pick(locale, 'รอบ', 'ROUND')} footer={round + 1 < draw.winnerIds.length ? pick(locale, 'สับไพ่ใหม่สำหรับรอบถัดไป…', 'Reshuffling for the next round…') : pick(locale, 'ครบทุกใบแล้ว', 'Every card is revealed')} />}
    {!finished && draw.animation === 'golden' && <GoldenRound key={`golden:${round}`} round={round} total={draw.winnerIds.length} withinRound={withinRound} title={draw.title} winner={currentWinner} winnerId={currentWinnerId} locale={locale} kicker={pick(locale, 'รอบ', 'ROUND')} footer={round + 1 < draw.winnerIds.length ? pick(locale, 'ผู้โชคดีคนถัดไปกำลังมา…', 'Next winner incoming…') : pick(locale, 'ครบทุกคนแล้ว!', 'Everyone is revealed!')} candidates={draw.candidates} />}
    {!finished && draw.animation === 'pack' && <PackRound key={`pack:${round}`} round={round} total={draw.winnerIds.length} withinRound={withinRound} title={draw.title} winner={currentWinner} winnerId={currentWinnerId} locale={locale} kicker={pick(locale, 'รอบ', 'ROUND')} footer={round + 1 < draw.winnerIds.length ? pick(locale, 'ผู้โชคดีคนถัดไปกำลังมา…', 'Next winner incoming…') : pick(locale, 'ครบทุกคนแล้ว!', 'Everyone is revealed!')} />}
    {!finished && <div className="gacha-round-progress">{draw.winnerIds.map((winnerId, index) => <span key={winnerId} className={index < round ? 'done' : index === round ? 'active' : ''}>{index < round ? '✓' : index + 1}</span>)}</div>}
    {finished && arcana && <section className="arcana-summary">
      <p className="arcana-kicker"><span aria-hidden="true">☾</span> {pick(locale, 'คำพยากรณ์', 'THE READING')} <span aria-hidden="true">☽</span></p><h1>{draw.title}</h1><p>{pick(locale, `ไพ่ ${draw.winnerIds.length} ใบได้เผยผู้ถูกเลือก`, `${draw.winnerIds.length} card(s) have spoken`)}</p>
      <div className="arcana-spread">{draw.winnerIds.map((winnerId, index) => <span key={winnerId} className="arcana-landed" style={{ '--i': index } as CSSProperties}><ArcanaFace member={draw.candidates.find((item) => item.userId === winnerId)} fallbackName={winnerId} numeral={toRoman(index + 1)} caption={draw.title} /></span>)}</div>
      <button className="arcana-done" onClick={onClose}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button>
    </section>}
    {finished && !arcana && (() => {
      const groups = [{ key: 'all', winners: draw.winnerIds.map((winnerId) => ({ winnerId, member: draw.candidates.find((item) => item.userId === winnerId) })) }];
      const summary = { title: draw.title, groups, onDone: onClose, locale, sub: pick(locale, `${draw.winnerIds.length} คนที่ถูกเลือก`, `${draw.winnerIds.length} selected`) };
      return draw.animation === 'golden' ? <GoldenSummary heading={pick(locale, 'ผู้ชนะ', 'WINNERS')} {...summary} /> : <PackSummary heading={pick(locale, 'ผลการเปิดแพ็ก', 'YOUR PULLS')} {...summary} />;
    })()}
  </div>;
}
