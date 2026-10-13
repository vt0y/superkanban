import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GachaDraw, Locale } from '@/types';
import { pick } from '@/utils/formatters';
import { CosmicBackdrop } from '@/components/tarot/CosmicBackdrop';
import { ArcanaFace, ArcanaRound, toRoman } from './ArcanaStage';
import { GoldenRound, GoldenSummary } from './GoldenStage';
import { PackRound, PackSummary } from './PackStage';

const ROUND_MS = 3400;
const REVEAL_AT = 2450;

type ToneStyle = GachaDraw['animationStyle'];
/** [wave, start Hz, end Hz, seconds] for the round-start cue and the winner cue of each animation. */
const TONES: Record<ToneStyle, Record<'spin' | 'winner', [OscillatorType, number, number, number]>> = {
  golden: { spin: ['triangle', 520, 1040, .22], winner: ['square', 988, 1976, .45] },
  pack: { spin: ['sawtooth', 90, 620, .6], winner: ['sine', 160, 50, .6] },
  // Arcana rings a soft bell instead of an arcade buzz.
  arcana: { spin: ['sine', 660, 700, .3], winner: ['sine', 880, 1320, .3] },
};

function playTone(kind: 'spin' | 'winner', style: ToneStyle) {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const [wave, from, to, seconds] = TONES[style][kind];
    const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(from, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(to, context.currentTime + seconds * .8);
    gain.gain.setValueAtTime(.045, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + seconds);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + seconds + .01);
    oscillator.addEventListener('ended', () => void context.close());
  } catch { /* Sound is optional when autoplay is blocked. */ }
}

export function GachaReveal({ projectId, locale, latestDraw }: { projectId: string; locale: Locale; latestDraw: GachaDraw | null }) {
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

  useEffect(() => {
    if (!latestDraw || localStorage.getItem(`gacha-seen:${projectId}`) === latestDraw.id) {
      setDraw(null);
      return;
    }
    const age = latestDraw.createdAt ? Date.now() - latestDraw.createdAt.toMillis() : 0;
    const cardTotal = latestDraw.results.reduce((sum, result) => sum + result.winnerIds.length, 0);
    if (age > cardTotal * ROUND_MS + 15000) {
      setDraw(null);
      return;
    }
    setDraw(latestDraw); setElapsed(Math.max(0, age)); setMinimized(localStorage.getItem(`gacha-minimized:${projectId}`) === latestDraw.id); previousCue.current = '';
  }, [latestDraw, projectId]);

  useEffect(() => {
    if (!draw || summary) return;
    const started = draw.createdAt?.toMillis() || Date.now() - elapsed;
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 60);
    return () => clearInterval(timer);
  }, [draw, summary]);

  useEffect(() => {
    if (!draw || muted || summary) return;
    const cue = `${round}:${revealing ? 'winner' : 'spin'}`;
    if (cue !== previousCue.current) { playTone(revealing ? 'winner' : 'spin', animation); previousCue.current = cue; }
  }, [animation, draw, muted, revealing, round, summary]);

  if (!draw || !cards.length) return null;
  const close = () => { localStorage.setItem(`gacha-seen:${projectId}`, draw.id); localStorage.removeItem(`gacha-minimized:${projectId}`); setDraw(null); };
  const minimize = () => { localStorage.setItem(`gacha-minimized:${projectId}`, draw.id); setMinimized(true); };
  const reopen = () => { localStorage.removeItem(`gacha-minimized:${projectId}`); setMinimized(false); };
  if (minimized) return <button className="gacha-reveal-toast" onClick={reopen}><span>✦</span><div><strong>{pick(locale, 'กำลังสุ่มผู้รับผิดชอบ', 'Assignment reveal in progress')}</strong><small>{Math.min(round + 1, cards.length)}/{cards.length} · {pick(locale, 'แตะเพื่อเปิด', 'tap to reopen')}</small></div></button>;

  const currentMember = draw.candidates.find((member) => member.userId === current?.winnerId);
  const arcana = animation === 'arcana';
  return <div className={`generic-reveal assignment ${animation} ${arcana ? 'arcana-theme' : ''} ${summary ? 'finished' : ''}`} role="dialog" aria-modal="true" aria-label={pick(locale, 'ผลการสุ่มผู้รับผิดชอบ', 'Gacha assignment results')}>
    <div className="gacha-reveal-actions"><button onClick={minimize}>—</button><button onClick={() => { const next = !muted; setMuted(next); localStorage.setItem('gacha-muted', next ? '1' : '0'); }}>{muted ? '🔇' : '🔊'}</button>{summary && <button onClick={close}>×</button>}</div>
    {arcana && <CosmicBackdrop />}
    {!summary && arcana && <ArcanaRound key={`arcana:${round}`} round={round} total={cards.length} withinRound={withinRound} title={current.result.targetTitle} winner={currentMember} winnerId={current.winnerId} locale={locale} kicker={pick(locale, 'มอบหมายงาน', 'ASSIGNMENT')} footer={round + 1 < cards.length ? pick(locale, 'สับไพ่ใหม่สำหรับงานถัดไป…', 'Reshuffling for the next card…') : pick(locale, 'ครบทุกใบแล้ว', 'Every card is revealed')} />}
    {!summary && animation === 'golden' && <GoldenRound key={`golden:${round}`} round={round} total={cards.length} withinRound={withinRound} title={current.result.targetTitle} winner={currentMember} winnerId={current.winnerId} locale={locale} kicker={pick(locale, 'มอบหมายงาน', 'ASSIGNMENT')} footer={round + 1 < cards.length ? pick(locale, 'เตรียมรอบถัดไป…', 'Next round incoming…') : pick(locale, 'ครบทุกการ์ดแล้ว!', 'All cards revealed!')} candidates={draw.candidates} />}
    {!summary && animation === 'pack' && <PackRound key={`pack:${round}`} round={round} total={cards.length} withinRound={withinRound} title={current.result.targetTitle} winner={currentMember} winnerId={current.winnerId} locale={locale} kicker={pick(locale, 'มอบหมายงาน', 'ASSIGNMENT')} footer={round + 1 < cards.length ? pick(locale, 'เตรียมรอบถัดไป…', 'Next round incoming…') : pick(locale, 'ครบทุกการ์ดแล้ว!', 'All cards revealed!')} />}
    {!summary && <div className="gacha-round-progress">{cards.map((card, index) => <span key={`${card.result.targetId}:${card.winnerId}:${index}`} className={index < round ? 'done' : index === round ? 'active' : ''}>{index < round ? '✓' : index + 1}</span>)}</div>}
    {summary && arcana && <section className="arcana-summary assignment">
      <p className="arcana-kicker"><span aria-hidden="true">☾</span> {pick(locale, 'คำพยากรณ์', 'THE READING')} <span aria-hidden="true">☽</span></p><h1>{pick(locale, 'มอบหมายครบแล้ว!', 'Assignments revealed!')}</h1><p>{pick(locale, 'ผลถูกบันทึกก่อนเริ่ม animation เรียบร้อยแล้ว', 'Results were committed before the animation began.')}</p>
      {draw.results.map((result, resultIndex) => <article key={`${result.targetType}:${result.targetId}`}><header><span className={`gacha-kind ${result.targetType}`}>{result.targetType === 'task' ? 'TASK' : 'UC'}</span><strong>{result.targetTitle}</strong></header><div className="arcana-spread">{result.winnerIds.map((winnerId, index) => <span key={`${winnerId}:${index}`} className="arcana-landed" style={{ '--i': resultIndex + index } as CSSProperties}><ArcanaFace small member={draw.candidates.find((candidate) => candidate.userId === winnerId)} fallbackName={winnerId} numeral={toRoman(resultIndex + 1)} caption={result.targetTitle} /></span>)}</div></article>)}
      <button className="arcana-done" onClick={close}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button>
    </section>}
    {summary && !arcana && (() => {
      const groups = draw.results.map((result) => ({
        key: `${result.targetType}:${result.targetId}`,
        label: <><span className={`gacha-kind ${result.targetType}`}>{result.targetType === 'task' ? 'TASK' : 'UC'}</span><strong>{result.targetTitle}</strong></>,
        caption: result.targetTitle,
        winners: result.winnerIds.map((winnerId) => ({ winnerId, member: draw.candidates.find((candidate) => candidate.userId === winnerId) })),
      }));
      const props = { title: pick(locale, 'มอบหมายครบแล้ว!', 'Assignments revealed!'), sub: pick(locale, 'ผลถูกบันทึกก่อนเริ่ม animation เรียบร้อยแล้ว', 'Results were committed before the animation began.'), groups, onDone: close, locale };
      return animation === 'golden' ? <GoldenSummary heading={pick(locale, 'ผู้ชนะ', 'WINNERS')} {...props} /> : <PackSummary heading={pick(locale, 'ผลการเปิดแพ็ก', 'YOUR PULLS')} {...props} />;
    })()}
  </div>;
}
