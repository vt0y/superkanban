import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Avatar, PageTitle } from '@/components/common';
import { attempt, toast } from '@/components/toast';
import type { SectionProps } from '@/context/AppContext';
import { useActiveTasks, useProjectItems } from '@/hooks';
import { MAX_GACHA_CARDS, MAX_GACHA_TARGETS, runGachaDraw } from '@/services';
import type { GachaBag, GachaDraw, GachaTargetType, ProjectUseCase, Task } from '@/types';
import { oddsFor } from '@/utils/gacha';
import { formatDateTime, pick } from '@/utils/formatters';
import { drawFromBag } from '@/utils/gacha';
import { GenericGachaReveal, type GenericAnimation, type GenericRevealData } from '@/components/gacha/GenericGachaReveal';
import { Icon } from '@/components/common/Icon';

type Filter = 'all' | GachaTargetType;

export function Gacha({ context, project, members, readOnly, draws }: SectionProps & { draws: GachaDraw[] }) {
  const [modeParams, setModeParams] = useSearchParams();
  const tasks = useActiveTasks(project.id);
  const useCases = useProjectItems<ProjectUseCase>(project.id, 'useCases');
  const bags = useProjectItems<GachaBag>(project.id, 'gachaBags');
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [winnerCounts, setWinnerCounts] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const mode = modeParams.get('mode') === 'generic' ? 'generic' : 'assignment';
  const [assignmentAnimation, setAssignmentAnimation] = useState<GenericAnimation>('pack');
  const [genericTitle, setGenericTitle] = useState('');
  const [genericWinnerCount, setGenericWinnerCount] = useState(1);
  const [genericAnimation, setGenericAnimation] = useState<GenericAnimation>('golden');
  const [genericReveal, setGenericReveal] = useState<GenericRevealData | null>(null);
  const poolInitialized = useRef(false);
  const { locale, user } = context;

  useEffect(() => {
    setCandidateIds((current) => {
      if (!poolInitialized.current && members.length) { poolInitialized.current = true; return members.map((member) => member.userId); }
      return current.filter((id) => members.some((member) => member.userId === id));
    });
  }, [members]);

  const targets = useMemo(() => [
    ...tasks.map((task) => ({ key: `task:${task.id}`, type: 'task' as const, id: task.id, title: task.title, assigned: task.assigneeIds || [], disabled: false })),
    ...useCases.map((item) => ({ key: `useCase:${item.id}`, type: 'useCase' as const, id: item.id, title: `${item.code ? `${item.code} · ` : ''}${item.title}`, assigned: item.assigneeId ? [item.assigneeId] : [], disabled: Boolean(item.assigneeId) || item.status !== 'open' })),
  ], [tasks, useCases]);
  const visible = targets.filter((target) => (filter === 'all' || target.type === filter) && target.title.toLowerCase().includes(query.toLowerCase()));
  const bag = bags.find((item) => [...item.candidateIds].sort().join('|') === [...candidateIds].sort().join('|'));
  const selectedTargets = selected.map((key) => targets.find((target) => target.key === key)).filter(Boolean) as typeof targets;
  const cardCount = selectedTargets.reduce((sum, target) => sum + (target.type === 'useCase' ? 1 : winnerCounts[target.key] || 1), 0);
  const invalid = selectedTargets.some((target) => candidateIds.filter((id) => !target.assigned.includes(id)).length < (target.type === 'useCase' ? 1 : winnerCounts[target.key] || 1));

  const toggleTarget = (key: string) => setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const pull = async () => {
    if (!selectedTargets.length || !candidateIds.length || invalid) return;
    if (!confirm(pick(locale, `ยืนยันสุ่ม ${selectedTargets.length} รายการ ${cardCount} ใบ? ผลจะถูกบันทึกทันที`, `Pull ${cardCount} card(s) for ${selectedTargets.length} item(s)? Results are committed immediately.`))) return;
    setBusy(true);
    const result = await attempt(() => runGachaDraw({
      projectId: project.id,
      candidateIds,
      targets: selectedTargets.map((target) => ({ targetType: target.type, targetId: target.id, winnerCount: target.type === 'useCase' ? 1 : winnerCounts[target.key] || 1 })),
      user,
      animationStyle: assignmentAnimation,
    }), pick(locale, 'สุ่มไม่สำเร็จ ข้อมูลอาจเปลี่ยนแล้ว กรุณารีเฟรชและลองใหม่', 'Draw failed. Data may have changed; refresh and try again.'));
    setBusy(false);
    if (result) {
      setSelected([]);
      toast(pick(locale, 'บันทึกผลแล้ว กำลังเปิดแพ็ก…', 'Results committed. Opening pack…'), 'success');
    }
  };
  const pullGeneric = () => {
    const title = genericTitle.trim();
    if (!title || !candidateIds.length || genericWinnerCount < 1 || genericWinnerCount > candidateIds.length) return;
    const result = drawFromBag(candidateIds, [{ targetType: 'task', targetId: 'generic', targetTitle: title, winnerCount: genericWinnerCount, previousAssigneeIds: [] }], {});
    setGenericReveal({
      title,
      animation: genericAnimation,
      winnerIds: result.results[0].winnerIds,
      candidates: members.filter((member) => candidateIds.includes(member.userId)).map((member) => ({ userId: member.userId, displayName: member.displayName, photoURL: member.photoURL || '' })),
    });
  };

  return <>
    <PageTitle eyebrow="SHUFFLE BAG" title={context.t('gacha')} description={pick(locale, 'สุ่มผู้รับผิดชอบอย่างยุติธรรมจากสมาชิกที่เลือก', 'Fairly assign work from a shared candidate pool')} />
    {readOnly && <div className="gacha-notice"><Icon name="archive" /> {pick(locale, 'โปรเจกต์ถูกเก็บแล้ว จึงเปิดดูได้เฉพาะประวัติ', 'Archived projects show history only.')}</div>}
    {!readOnly && <div className="gacha-mode-tabs" role="tablist"><button role="tab" aria-selected={mode === 'assignment'} className={mode === 'assignment' ? 'active' : ''} onClick={() => setModeParams({})}><Icon name="board" /> {pick(locale, 'มอบหมายงาน', 'Assignment Gacha')}</button><button role="tab" aria-selected={mode === 'generic'} className={mode === 'generic' ? 'active golden' : ''} onClick={() => setModeParams({ mode: 'generic' })}><Icon name="sparkles" /> {pick(locale, 'สุ่มทั่วไป', 'Generic Gacha')}</button></div>}
    {!readOnly && <div className="gacha-layout">
      {mode === 'assignment' ? <section className="panel gacha-targets">
        <header><strong>1 · {pick(locale, 'เลือกรายการ', 'Choose work')}</strong><span>{selected.length}/{MAX_GACHA_TARGETS}</span></header>
        <div className="gacha-tools"><label className="search"><span><Icon name="search" /></span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={pick(locale, 'ค้นหา Task / Use Case', 'Search tasks / use cases')} /></label><select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="all">{pick(locale, 'ทั้งหมด', 'All')}</option><option value="task">Task</option><option value="useCase">Use Case</option></select></div>
        <fieldset className="animation-picker compact"><legend>{pick(locale, 'Animation ที่ทุกคนจะเห็น', 'Animation everyone will see')}</legend><button type="button" className={assignmentAnimation === 'golden' ? 'active' : ''} onClick={() => setAssignmentAnimation('golden')}><i>◆</i><span><strong>Golden Roulette</strong><small>{pick(locale, 'หมุนทีละคน', 'One reel per winner')}</small></span></button><button type="button" className={assignmentAnimation === 'pack' ? 'active' : ''} onClick={() => setAssignmentAnimation('pack')}><i>✦</i><span><strong>Pack Burst</strong><small>{pick(locale, 'เปิดทีละคน', 'One pack per winner')}</small></span></button></fieldset>
        <div className="gacha-target-list">{visible.map((target) => {
          const checked = selected.includes(target.key);
          const eligible = candidateIds.filter((id) => !target.assigned.includes(id));
          const count = target.type === 'useCase' ? 1 : winnerCounts[target.key] || 1;
          return <label key={target.key} className={`${checked ? 'selected' : ''} ${target.disabled ? 'disabled' : ''}`}>
            <input type="checkbox" checked={checked} disabled={target.disabled || (!checked && selected.length >= MAX_GACHA_TARGETS)} onChange={() => toggleTarget(target.key)} />
            <span className={`gacha-kind ${target.type}`}>{target.type === 'task' ? 'TASK' : 'UC'}</span><span className="gacha-target-name"><strong>{target.title}</strong><small>{target.disabled ? pick(locale, 'มอบหมายแล้ว — เลือกไม่ได้', 'Already assigned') : pick(locale, `${eligible.length} คนมีสิทธิ์`, `${eligible.length} eligible`)}</small></span>
            {target.type === 'task' && checked && <input className="winner-count" type="number" min="1" max={Math.min(eligible.length, MAX_GACHA_CARDS)} value={count} onClick={(event) => event.stopPropagation()} onChange={(event) => setWinnerCounts({ ...winnerCounts, [target.key]: Math.max(1, Number(event.target.value)) })} aria-label="Winner count" />}
          </label>;
        })}</div>
      </section> : <section className="panel generic-gacha-config"><header><strong>1 · {pick(locale, 'ตั้งค่าการสุ่มทั่วไป', 'Set up a generic draw')}</strong><span>LOCAL</span></header><div className="generic-gacha-form"><label>{pick(locale, 'หัวข้อการสุ่ม', 'Draw title')}<input autoFocus value={genericTitle} onChange={(event) => setGenericTitle(event.target.value)} maxLength={120} placeholder={pick(locale, 'เช่น สุ่มคนไป present', 'e.g. Pick someone to present')} /></label><label>{pick(locale, 'จำนวนคนที่จะเลือก', 'Number to pick')}<input type="number" min="1" max={Math.min(candidateIds.length, MAX_GACHA_CARDS)} value={genericWinnerCount} onChange={(event) => setGenericWinnerCount(Math.max(1, Number(event.target.value)))} /></label><fieldset className="animation-picker"><legend>{pick(locale, 'รูปแบบ Animation', 'Animation style')}</legend><button type="button" className={genericAnimation === 'golden' ? 'active' : ''} onClick={() => setGenericAnimation('golden')}><i>◆</i><span><strong>Golden Roulette</strong><small>{pick(locale, 'วงล้อทอง เร่งความเร็วแล้วหยุดทีละคน', 'High-speed golden reel')}</small></span></button><button type="button" className={genericAnimation === 'pack' ? 'active' : ''} onClick={() => setGenericAnimation('pack')}><i>✦</i><span><strong>Pack Burst</strong><small>{pick(locale, 'ชาร์จพลัง ฉีกแพ็ก และระเบิดแสง', 'Charge, tear, and burst')}</small></span></button></fieldset><div className="generic-private-note"><span>◉</span><div><strong>{pick(locale, 'สุ่มและเปิดทีละคนบนเครื่องนี้', 'One winner per round on this screen')}</strong><small>{pick(locale, `ถ้าเลือก ${genericWinnerCount} คน จะเล่น ${genericWinnerCount} รอบ · ไม่บันทึกหรือแจ้งสมาชิกคนอื่น`, `${genericWinnerCount} selected means ${genericWinnerCount} rounds · no history or team notification`)}</small></div></div></div></section>}
      <aside className="panel gacha-pool">
        <header><strong>2 · {pick(locale, 'Candidate pool', 'Candidate pool')}</strong><button className="link-button" onClick={() => setCandidateIds(candidateIds.length === members.length ? [] : members.map((member) => member.userId))}>{candidateIds.length === members.length ? pick(locale, 'ล้างทั้งหมด', 'Clear') : pick(locale, 'เลือกทั้งหมด', 'All')}</button></header>
        <div className="gacha-member-list">{members.map((member) => <label key={member.id}><input type="checkbox" checked={candidateIds.includes(member.userId)} onChange={() => setCandidateIds((current) => current.includes(member.userId) ? current.filter((id) => id !== member.userId) : [...current, member.userId])} /><Avatar name={member.displayName} src={member.photoURL} size="sm" /><span><strong>{member.displayName}</strong><small>{mode === 'assignment' ? pick(locale, `ชนะ ${bag?.winCounts?.[member.userId] || 0} ครั้ง`, `${bag?.winCounts?.[member.userId] || 0} wins`) : pick(locale, candidateIds.includes(member.userId) ? 'อยู่ในวงล้อ' : 'ไม่ได้เลือก', candidateIds.includes(member.userId) ? 'On the reel' : 'Not selected')}</small></span></label>)}</div>
        {mode === 'assignment' ? <div className="gacha-summary"><strong>3 · {pick(locale, 'ตรวจสอบก่อน Pull', 'Review')}</strong><p>{pick(locale, `${selectedTargets.length} รายการ · ${cardCount} การ์ด · ${candidateIds.length} ผู้สมัคร`, `${selectedTargets.length} items · ${cardCount} cards · ${candidateIds.length} candidates`)}</p>{selectedTargets.slice(0, 5).map((target) => {
          const eligible = candidateIds.filter((id) => !target.assigned.includes(id));
          const odds = oddsFor(eligible, bag?.winCounts || {});
          return <small key={target.key}>{target.title}: {eligible.map((id) => `${members.find((member) => member.userId === id)?.displayName || id} ${Math.round((odds[id] || 0) * 100)}%`).join(' · ')}</small>;
        })}{invalid && <b className="danger-text">{pick(locale, 'ผู้มีสิทธิ์ไม่พอสำหรับจำนวนการ์ดที่ตั้งไว้', 'Not enough eligible candidates.')}</b>}<button className="primary gacha-pull" disabled={busy || !selected.length || !candidateIds.length || invalid || cardCount > MAX_GACHA_CARDS} onClick={() => void pull()}>{busy ? pick(locale, 'กำลัง commit…', 'Committing…') : `✦ ${pick(locale, 'เปิดแพ็ก', 'Pull')} (${cardCount}/${MAX_GACHA_CARDS})`}</button></div> : <div className="gacha-summary generic"><strong>3 · {pick(locale, 'พร้อมเริ่มสุ่ม', 'Ready to draw')}</strong><p>{pick(locale, `${candidateIds.length} ผู้สมัคร · ${genericWinnerCount} คน · ${genericWinnerCount} รอบ`, `${candidateIds.length} candidates · ${genericWinnerCount} winners · ${genericWinnerCount} rounds`)}</p>{genericWinnerCount > candidateIds.length && <b className="danger-text">{pick(locale, 'จำนวนผู้ชนะมากกว่าจำนวนผู้สมัคร', 'Winner count exceeds candidates.')}</b>}<button className="gacha-pull golden-button" disabled={!genericTitle.trim() || !candidateIds.length || genericWinnerCount > candidateIds.length || genericWinnerCount > MAX_GACHA_CARDS} onClick={pullGeneric}>✦ {genericAnimation === 'golden' ? pick(locale, 'เริ่ม Golden Roulette', 'Start Golden Roulette') : pick(locale, 'เปิด Pack Burst', 'Open Pack Burst')}</button></div>}
      </aside>
    </div>}
    <section className="panel gacha-history"><header><strong>{pick(locale, 'ประวัติการสุ่ม', 'Draw history')}</strong><span>{draws.length}</span></header>{[...draws].sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)).map((draw) => <details key={draw.id}><summary><span>✦</span><div><strong>{draw.initiatedByName}</strong><small>{draw.createdAt ? formatDateTime(draw.createdAt, locale) : '—'} · {draw.results.length} {pick(locale, 'รายการ', 'items')}</small></div><b><Icon name="chevronDown" /></b></summary><div>{draw.results.map((result) => <p key={`${result.targetType}:${result.targetId}`}><span className={`gacha-kind ${result.targetType}`}>{result.targetType === 'task' ? 'TASK' : 'UC'}</span><strong>{result.targetTitle}</strong><small>{pick(locale, 'เดิม', 'Previous')}: {result.previousAssigneeIds.map((id) => draw.candidates.find((member) => member.userId === id)?.displayName || id).join(', ') || '—'}<br />{pick(locale, 'ผู้ชนะ', 'Winner')}: {result.winnerIds.map((id) => draw.candidates.find((member) => member.userId === id)?.displayName || id).join(', ')}</small></p>)}</div></details>)}{!draws.length && <p className="muted">{pick(locale, 'ยังไม่มีประวัติการสุ่ม', 'No draws yet.')}</p>}</section>
    {genericReveal && <GenericGachaReveal draw={genericReveal} locale={locale} onClose={() => setGenericReveal(null)} />}
  </>;
}
