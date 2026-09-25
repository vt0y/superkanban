import { useId, useState, type FormEvent } from 'react';
import type { AppContextValue, SectionProps } from '@/context/AppContext';
import { Avatar, Empty, Modal, PageTitle, Segmented, TimeField } from '@/components/common';
import { canDeleteItem, canManageProject } from '@/utils/permissions';
import { isPollOpen, tally, toggleOption } from '@/utils/polls';
import { castVote, createWorkItem, deleteWorkItem, updateWorkItem } from '@/services';
import type { Membership, Poll, PollOption, PollVote, Role } from '@/types';
import { attempt } from '@/components/toast';
import { formatDue, pick, relativeTime } from '@/utils/formatters';
import { usePolls } from '@/hooks';

export function Votes({ context, project, members, role, readOnly }: SectionProps) {
  const [expandedClosed, setExpandedClosed] = useState<Set<string>>(new Set());
  const { polls, votes, hasMore, loadingMore, loadMore } = usePolls(project.id, [...expandedClosed]);
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [editing, setEditing] = useState<Poll | 'new' | null>(null);
  const { locale } = context;
  const visible = polls
    .filter((poll) => filter === 'all' || (filter === 'open') === isPollOpen(poll))
    .sort((a, b) => (b.createdAt?.toMillis() ?? Date.now()) - (a.createdAt?.toMillis() ?? Date.now()));
  const openCount = polls.filter((poll) => isPollOpen(poll)).length;

  return <>
    <PageTitle eyebrow="TEAM DECISIONS" title={context.t('votes')} description={pick(locale, 'ตั้งคำถามให้ทีมโหวต เลือกได้คำตอบเดียวหรือหลายคำตอบ ผลอัปเดตแบบเรียลไทม์', 'Ask the team — single or multiple choice, results update live')} action={!readOnly && <button className="primary" onClick={() => setEditing('new')}>＋ {pick(locale, 'สร้างโพล', 'New poll')}</button>} />
    <div className="list-toolbar"><Segmented value={filter} onChange={setFilter} options={[{ id: 'open', label: <>{pick(locale, 'เปิดโหวต', 'Open')} <b>{openCount}</b></> }, { id: 'closed', label: <>{pick(locale, 'ปิดแล้ว', 'Closed')} <b>{polls.length - openCount}</b></> }, { id: 'all', label: pick(locale, 'ทั้งหมด', 'All') }]} /></div>
    <div className="poll-grid">{visible.map((poll) => <PollCard key={poll.id} poll={poll} votes={votes} members={members} context={context} role={role} projectId={project.id} readOnly={readOnly} details={isPollOpen(poll) || expandedClosed.has(poll.id)} onDetails={() => setExpandedClosed((current) => new Set([...current, poll.id]))} onEdit={() => setEditing(poll)} />)}</div>
    {(filter === 'closed' || filter === 'all') && hasMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดโพลเก่าเพิ่มเติม', 'Load more closed polls')}</button></div>}
    {!visible.length && <Empty icon="☑" title={pick(locale, 'ยังไม่มีโพล', 'No polls here')} description={pick(locale, 'สร้างโพลเพื่อให้ทีมช่วยกันตัดสินใจ', 'Create a poll to let the team decide together')} action={!readOnly ? <button className="primary" onClick={() => setEditing('new')}>＋ {pick(locale, 'สร้างโพล', 'New poll')}</button> : undefined} />}
    {editing && !readOnly && <PollModal poll={editing === 'new' ? null : editing} projectId={project.id} context={context} role={role} onClose={() => setEditing(null)} />}
  </>;
}

function PollCard({ poll, votes, members, context, role, projectId, readOnly, details, onDetails, onEdit }: { poll: Poll; votes: PollVote[]; members: Membership[]; context: AppContextValue; role: Role | null; projectId: string; readOnly: boolean; details: boolean; onDetails: () => void; onEdit: () => void }) {
  const { locale, user } = context;
  const open = isPollOpen(poll);
  const { voters, results } = tally(poll, votes);
  const mine = votes.find((vote) => vote.pollId === poll.id && vote.userId === user.uid)?.optionIds || [];
  const canManage = poll.createdBy === user.uid || canManageProject(role);
  const leader = Math.max(0, ...results.map((result) => result.count));
  const vote = (optionId: string) => {
    if (!open) return;
    void attempt(() => castVote(projectId, poll.id, user.uid, toggleOption(mine, optionId, poll.multiple)), pick(locale, 'โหวตไม่สำเร็จ', 'Vote failed'));
  };
  const memberFor = (uid: string) => members.find((member) => member.userId === uid);

  return <article className={`poll-card ${open ? '' : 'closed'}`}>
    <header>
      <div className="poll-badges"><span className={`chip ${poll.multiple ? 'violet' : 'blue'}`}>{poll.multiple ? pick(locale, 'เลือกได้หลายข้อ', 'Multiple choice') : pick(locale, 'เลือกได้ 1 ข้อ', 'Single choice')}</span>{poll.anonymous && <span className="chip">🙈 {pick(locale, 'ไม่แสดงชื่อ', 'Names hidden')}</span>}<span className={`chip ${open ? 'green' : ''}`}>{open ? pick(locale, '● เปิดโหวต', '● Open') : pick(locale, 'ปิดแล้ว', 'Closed')}</span></div>
      {canManage && !readOnly && <button className="icon-button" onClick={onEdit} title={pick(locale, 'แก้ไข', 'Edit')}>•••</button>}
    </header>
    <h3>{poll.question}</h3>
    {poll.description && <p className="muted">{poll.description}</p>}
    {!details && <button type="button" className="secondary" onClick={onDetails}>{pick(locale, 'ดูผลโหวต', 'View results')}</button>}
    {details && <div className="poll-options" role={poll.multiple ? 'group' : 'radiogroup'}>{results.map((result) => {
      const chosen = mine.includes(result.id);
      return <button key={result.id} type="button" className={`poll-option ${chosen ? 'chosen' : ''} ${result.count && result.count === leader ? 'leading' : ''}`} disabled={!open || readOnly} onClick={() => vote(result.id)} role={poll.multiple ? 'checkbox' : 'radio'} aria-checked={chosen}>
        <i className="poll-fill" style={{ width: `${result.percent}%` }} />
        <span className={`poll-mark ${poll.multiple ? 'square' : ''}`}>{chosen ? '✓' : ''}</span>
        <span className="poll-label">{result.label}</span>
        {!poll.anonymous && result.voterIds.length > 0 && <span className="avatar-stack mini">{result.voterIds.slice(0, 4).map((uid) => { const member = memberFor(uid); return <Avatar key={uid} name={member?.displayName || '?'} src={member?.photoURL} size="sm" />; })}</span>}
        <b>{result.count} · {result.percent}%</b>
      </button>;
    })}</div>}
    <footer>
      <span>{details ? `👥 ${voters}/${members.length} ${pick(locale, 'คนโหวต', 'voted')}` : ''}{poll.deadline ? ` · ◷ ${pick(locale, 'ถึง', 'until')} ${formatDue(poll.deadline, poll.deadlineTime, locale)}` : ''}</span>
      <span>{!readOnly && mine.length > 0 && open && <button className="link-button" onClick={() => void attempt(() => castVote(projectId, poll.id, user.uid, []), pick(locale, 'ล้างโหวตไม่สำเร็จ', 'Could not clear vote'))}>{pick(locale, 'ล้างโหวตของฉัน', 'Clear my vote')}</button>}
        {!readOnly && canManage && <button className="link-button" onClick={() => void attempt(() => updateWorkItem(projectId, 'polls', poll.id, { closed: !poll.closed }), pick(locale, 'อัปเดตไม่สำเร็จ', 'Update failed'))}>{poll.closed ? pick(locale, 'เปิดโหวตอีกครั้ง', 'Reopen') : pick(locale, 'ปิดโหวต', 'Close poll')}</button>}</span>
    </footer>
    <small className="poll-meta">{pick(locale, 'สร้าง', 'Created')} {relativeTime(poll.createdAt?.toDate(), locale)} · {memberFor(poll.createdBy)?.displayName || '—'}</small>
  </article>;
}

function PollModal({ poll, projectId, context, role, onClose }: { poll: Poll | null; projectId: string; context: AppContextValue; role: Role | null; onClose: () => void }) {
  const { user, t, locale } = context;
  const newOption = (): PollOption => ({ id: crypto.randomUUID().slice(0, 8), label: '' });
  const [form, setForm] = useState({ question: poll?.question || '', description: poll?.description || '', multiple: poll?.multiple ?? false, anonymous: poll?.anonymous ?? false, deadline: poll?.deadline || '', deadlineTime: poll?.deadlineTime || '' });
  const [options, setOptions] = useState<PollOption[]>(poll?.options || [newOption(), newOption()]);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const filled = options.map((option) => ({ ...option, label: option.label.trim() })).filter((option) => option.label);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (filled.length < 2) return;
    setBusy(true);
    const values = { ...form, options: filled };
    const ok = await attempt(() => (poll
      ? updateWorkItem(projectId, 'polls', poll.id, values)
      : createWorkItem(projectId, 'polls', { ...values, closed: false }, user, { type: 'poll_created', th: `สร้างโพล “${form.question}”`, en: `created poll “${form.question}”` })).then(() => true), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    setBusy(false);
    if (ok) onClose();
  };
  return <Modal title={poll ? t('edit') : pick(locale, 'สร้างโพล', 'New poll')} onClose={onClose} actions={<button form={formId} className="primary" disabled={busy || filled.length < 2}>{t('save')}</button>}>
    <form id={formId} className="stack-form" onSubmit={submit}>
      <label>{pick(locale, 'คำถาม', 'Question')}<input autoFocus value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required maxLength={200} placeholder={pick(locale, 'เช่น ใช้ framework ไหนดี?', 'e.g. Which framework should we use?')} /></label>
      <label>{pick(locale, 'รายละเอียด (ไม่บังคับ)', 'Details (optional)')}<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={600} /></label>
      <fieldset><legend>{pick(locale, 'ตัวเลือก', 'Options')} ({filled.length}/10)</legend>
        <div className="option-editor">{options.map((option, index) => <div key={option.id}>
          <span>{index + 1}</span>
          <input value={option.label} maxLength={120} placeholder={`${pick(locale, 'ตัวเลือก', 'Option')} ${index + 1}`} onChange={(e) => setOptions(options.map((item) => item.id === option.id ? { ...item, label: e.target.value } : item))} />
          <button type="button" className="icon-button" disabled={options.length <= 2} onClick={() => setOptions(options.filter((item) => item.id !== option.id))} title={t('delete')}>×</button>
        </div>)}</div>
        {options.length < 10 && <button type="button" className="add-inline" onClick={() => setOptions([...options, newOption()])}>＋ {pick(locale, 'เพิ่มตัวเลือก', 'Add option')}</button>}
      </fieldset>
      <div className="toggle-cards">
        <label className={`toggle-card ${!form.multiple ? 'on' : ''}`}><input type="radio" name="mode" checked={!form.multiple} onChange={() => setForm({ ...form, multiple: false })} /><strong>◉ {pick(locale, 'เลือกได้ 1 ข้อ', 'Single choice')}</strong><small>{pick(locale, 'แต่ละคนเลือกคำตอบเดียว', 'Each member picks one answer')}</small></label>
        <label className={`toggle-card ${form.multiple ? 'on' : ''}`}><input type="radio" name="mode" checked={form.multiple} onChange={() => setForm({ ...form, multiple: true })} /><strong>☑ {pick(locale, 'เลือกได้หลายข้อ', 'Multiple choice')}</strong><small>{pick(locale, 'เลือกได้หลายคำตอบพร้อมกัน', 'Members can pick several answers')}</small></label>
      </div>
      <div className="field-row">
        <label>{pick(locale, 'ปิดโหวตอัตโนมัติ (ไม่บังคับ)', 'Auto-close on (optional)')}<span className="date-clear"><input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value, deadlineTime: e.target.value ? form.deadlineTime : '' })} /><TimeField label={pick(locale, 'เวลา (ไม่บังคับ)', 'Time (optional)')} value={form.deadlineTime} disabled={!form.deadline} onChange={(deadlineTime) => setForm((current) => ({ ...current, deadlineTime }))} /></span></label>
        <label className="simple-check align-end"><input type="checkbox" checked={form.anonymous} onChange={(e) => setForm({ ...form, anonymous: e.target.checked })} /> {pick(locale, 'ไม่แสดงชื่อผู้โหวต', 'Hide voter names')}</label>
      </div>
      <div className="form-actions">{poll && canDeleteItem(role, poll.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={async () => { if (confirm(`${t('delete')}?`)) { await attempt(() => deleteWorkItem(projectId, 'polls', poll.id), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); onClose(); } }}>{t('delete')}</button>}<span /><button type="button" className="secondary" onClick={onClose}>{t('cancel')}</button><button className="primary" disabled={busy || filled.length < 2}>{t('save')}</button></div>
    </form>
  </Modal>;
}
