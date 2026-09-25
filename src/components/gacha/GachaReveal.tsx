import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Avatar } from '@/components/common';
import { subscribeLatestGachaDraw } from '@/services';
import type { GachaDraw, Locale } from '@/types';
import { pick } from '@/utils/formatters';

const ROUND_MS = 3400;
const REVEAL_AT = 2450;
const PARTICLES = Array.from({ length: 28 });

function playTone(kind: 'spin' | 'winner') {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = kind === 'spin' ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(kind === 'spin' ? 150 : 480, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'spin' ? 320 : 980, context.currentTime + .25);
    gain.gain.setValueAtTime(.045, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .3);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .31);
    oscillator.addEventListener('ended', () => void context.close());
  } catch { /* Sound is optional when autoplay is blocked. */ }
}

export function GachaReveal({ projectId, locale }: { projectId: string; locale: Locale }) {
  const [draw, setDraw] = useState<GachaDraw | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem('gacha-muted') === '1');
  const previousCue = useRef('');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cards = useMemo(() => draw?.results.flatMap((result) => result.winnerIds.map((winnerId) => ({ result, winnerId }))) || [], [draw]);
  const round = Math.floor(elapsed / ROUND_MS);
  const withinRound = elapsed % ROUND_MS;
  const revealing = withinRound >= REVEAL_AT;
  const summary = reduced || round >= cards.length;
  const current = cards[Math.min(round, cards.length - 1)];
  const animation = draw?.animationStyle || 'pack';
  const countdown = withinRound < 650 ? '3' : withinRound < 1300 ? '2' : '1';

  useEffect(() => subscribeLatestGachaDraw(projectId, (next) => {
    if (!next || localStorage.getItem(`gacha-seen:${projectId}`) === next.id) return;
    const age = next.createdAt ? Date.now() - next.createdAt.toMillis() : 0;
    const cardTotal = next.results.reduce((sum, result) => sum + result.winnerIds.length, 0);
    if (age > cardTotal * ROUND_MS + 15000) return;
    setDraw(next); setElapsed(Math.max(0, age)); setMinimized(localStorage.getItem(`gacha-minimized:${projectId}`) === next.id); previousCue.current = '';
  }), [projectId]);

  useEffect(() => {
    if (!draw || summary) return;
    const started = draw.createdAt?.toMillis() || Date.now() - elapsed;
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 60);
    return () => clearInterval(timer);
  }, [draw, summary]);

  useEffect(() => {
    if (!draw || muted || summary) return;
    const cue = `${round}:${revealing ? 'winner' : 'spin'}`;
    if (cue !== previousCue.current) { playTone(revealing ? 'winner' : 'spin'); previousCue.current = cue; }
  }, [draw, muted, revealing, round, summary]);

  if (!draw || !cards.length) return null;
  const close = () => { localStorage.setItem(`gacha-seen:${projectId}`, draw.id); localStorage.removeItem(`gacha-minimized:${projectId}`); setDraw(null); };
  const minimize = () => { localStorage.setItem(`gacha-minimized:${projectId}`, draw.id); setMinimized(true); };
  const reopen = () => { localStorage.removeItem(`gacha-minimized:${projectId}`); setMinimized(false); };
  if (minimized) return <button className="gacha-reveal-toast" onClick={reopen}><span>✦</span><div><strong>{pick(locale, 'กำลังสุ่มผู้รับผิดชอบ', 'Assignment reveal in progress')}</strong><small>{Math.min(round + 1, cards.length)}/{cards.length} · {pick(locale, 'แตะเพื่อเปิด', 'tap to reopen')}</small></div></button>;

  const currentMember = draw.candidates.find((member) => member.userId === current?.winnerId);
  const reel = [...draw.candidates, ...draw.candidates, ...draw.candidates, ...draw.candidates];
  return <div className={`generic-reveal assignment ${animation} ${summary ? 'finished' : ''}`} role="dialog" aria-modal="true" aria-label={pick(locale, 'ผลการสุ่มผู้รับผิดชอบ', 'Gacha assignment results')}>
    <div className="gacha-reveal-actions"><button onClick={minimize}>—</button><button onClick={() => { const next = !muted; setMuted(next); localStorage.setItem('gacha-muted', next ? '1' : '0'); }}>{muted ? '🔇' : '🔊'}</button>{summary && <button onClick={close}>×</button>}</div>
    <div className="gacha-particles" aria-hidden="true">{PARTICLES.map((_, index) => <i key={index} style={{ '--particle': index } as CSSProperties} />)}</div>
    {!summary && !revealing && animation === 'golden' && <section className="golden-machine" key={`golden:${round}`}><div className="gacha-round-label">ASSIGNMENT · ROUND {round + 1} / {cards.length}</div><div className="gacha-countdown" key={`${round}:${countdown}`}>{countdown}</div><span className="golden-crown">✦ GOLDEN ROULETTE ✦</span><h1>{current.result.targetTitle}</h1><div className="golden-lights">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div><div className="golden-reel-window"><div className="golden-pointer top">▼</div><div className="golden-pointer bottom">▲</div><div className="golden-reel">{reel.map((member, index) => <div key={`${member.userId}:${index}`}><Avatar name={member.displayName} src={member.photoURL} size="lg" /><strong>{member.displayName}</strong></div>)}</div><div className="reel-speed-lines" /></div><strong className="rolling-label">{withinRound < 1700 ? 'MAXIMUM SPEED!' : 'LOCKING IN…'}</strong></section>}
    {!summary && !revealing && animation === 'pack' && <section className={`generic-pack-stage phase-${Math.min(3, Math.floor(withinRound / 700))}`} key={`pack:${round}`}><div className="gacha-round-label">ASSIGNMENT · ROUND {round + 1} / {cards.length}</div><div className="gacha-countdown" key={`${round}:${countdown}`}>{countdown}</div><span>✦ MYSTERY PACK ✦</span><h1>{current.result.targetTitle}</h1><div className="generic-pack-object"><div className="pack-rune">✦</div><b>WHO'S NEXT?</b><div className="pack-seam" /></div><strong>{withinRound < 1800 ? 'CHARGE BUILDING…' : 'BREAK OPEN!'}</strong></section>}
    {!summary && revealing && <section className="generic-round-winner" key={`winner:${round}`}><small>ROUND {round + 1} WINNER · {current.result.targetTitle}</small><div className="winner-aura" /><Avatar name={currentMember?.displayName || current.winnerId} src={currentMember?.photoURL} size="lg" /><h1>{currentMember?.displayName || current.winnerId}</h1><p>{round + 1 < cards.length ? pick(locale, 'เตรียมรอบถัดไป…', 'Next round incoming…') : pick(locale, 'ครบทุกการ์ดแล้ว!', 'All cards revealed!')}</p></section>}
    {!summary && <div className="gacha-round-progress">{cards.map((card, index) => <span key={`${card.result.targetId}:${card.winnerId}:${index}`} className={index < round ? 'done' : index === round ? 'active' : ''}>{index < round ? '✓' : index + 1}</span>)}</div>}
    {summary && <section className="gacha-final"><span className="gacha-final-mark">✦</span><h1>{pick(locale, 'มอบหมายครบแล้ว!', 'Assignments revealed!')}</h1><p>{pick(locale, 'ผลถูกบันทึกก่อนเริ่ม animation เรียบร้อยแล้ว', 'Results were committed before the animation began.')}</p><div>{draw.results.map((result) => <article key={`${result.targetType}:${result.targetId}`}><span className={`gacha-kind ${result.targetType}`}>{result.targetType === 'task' ? 'TASK' : 'UC'}</span><strong>{result.targetTitle}</strong><div>{result.winnerIds.map((winnerId, index) => { const member = draw.candidates.find((candidate) => candidate.userId === winnerId); return <span key={`${winnerId}:${index}`}><Avatar name={member?.displayName || winnerId} src={member?.photoURL} size="sm" />{member?.displayName || winnerId}</span>; })}</div></article>)}</div><button className="primary" onClick={close}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button></section>}
  </div>;
}
