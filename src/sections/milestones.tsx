import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppContextValue, SectionProps } from '@/context/AppContext';
import { CanvaFileRow, DocumentPickerModal, DriveFileRow, Empty, Modal, PageTitle, TimeField } from '@/components/common';
import { blockingMilestones, topoOrder, wouldCreateCycle } from '@/utils/milestone-deps';
import { canDeleteItem } from '@/utils/permissions';
import { createWorkItem, deleteMilestoneAndUnlinkDocuments, isCanvaProjectDocument, isDriveProjectDocument, subscribeMilestoneDocuments, unlinkProjectDocumentFromMilestone, updateWorkItem } from '@/services';
import type { Membership, Milestone, ProjectDocument, Role, Task } from '@/types';
import { attempt } from '@/components/toast';
import { formatDue, pick } from '@/utils/formatters';
import { useProjectItemsState, useProjectSummary } from '@/hooks';
import { summaryMilestoneCounts, summaryTasks } from '@/utils/project-summary';
import { CommentThread } from '@/components/comments/CommentThread';
import { useTaskModal } from '@/components/board/TaskModalHost';
import { TASK_COLUMNS } from '@/config/constants';
import { Icon } from '@/components/common/Icon';

const STATUS_COLOR = new Map(TASK_COLUMNS.map((column) => [column.id, column.color]));

export function Milestones({ context, project, members, role, readOnly }: SectionProps) {
  const { items, loaded: milestonesLoaded } = useProjectItemsState<Milestone>(project.id, 'milestones');
  const { summary, loaded: summaryLoaded, failed: summaryFailed } = useProjectSummary(project);
  const tasks = summary ? summaryTasks(summary) : [];
  const counts = Object.fromEntries(items.map((item) => [item.id, summary ? summaryMilestoneCounts(summary, item.id) : { total: 0, done: 0 }]));
  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);
  const navigate = useNavigate();
  const { openTask } = useTaskModal();
  const { locale } = context;
  const byId = new Map(items.map((item) => [item.id, item]));
  const setStatus = async (item: Milestone, status: Milestone['status'], taskCount: number) => {
    if (status === 'completed' && taskCount === 0 && !confirm(pick(locale, 'Milestone นี้ยังไม่มี Task ต้องการปิดเลยหรือไม่?', 'This milestone has no tasks. Complete it anyway?'))) return;
    await attempt(
      () => updateWorkItem(project.id, 'milestones', item.id, { status }),
      pick(locale, 'เปลี่ยนสถานะ milestone ไม่สำเร็จ', 'Could not update milestone status'),
    );
  };

  if (!milestonesLoaded || !summaryLoaded) return <div className="section-loader"><span className="loader" /></div>;

  return <>
    <PageTitle eyebrow="PROJECT TIMELINE" title={context.t('milestones')} description={pick(locale, 'กำหนดเป้าหมาย ลำดับการพึ่งพา และเปิดบอร์ดงานของแต่ละเป้าหมาย', 'Set goals, their dependencies, and open each goal’s task board')} action={!readOnly && <button className="primary" onClick={() => setEditing('new')}><Icon name="add" /> {context.t('addMilestone')}</button>} />
    {summaryFailed && !summary && <p className="inline-warning"><Icon name="alert" /> {pick(locale, 'โหลดความคืบหน้าของ milestone ไม่สำเร็จ ตัวเลขด้านล่างอาจไม่ครบ', 'Couldn’t load milestone progress; the numbers below may be incomplete')}</p>}
    <div className="milestone-list">{topoOrder(items).map((item) => {
      const related = tasks.filter((task) => task.milestoneId === item.id);
      const count = counts[item.id] ?? { total: related.length, done: 0 };
      const complete = count.done;
      const pct = count.total ? Math.round(complete / count.total * 100) : 0;
      const blockers = blockingMilestones(item, items);
      const completion = { taskCount: count.total, incompleteTaskCount: count.total - count.done, canComplete: blockers.length === 0 && count.total === count.done };
      const deps = (item.dependsOn || []).map((id) => byId.get(id)).filter((dep): dep is Milestone => !!dep);
      const state = item.status === 'completed' ? 'completed' : blockers.length ? 'blocked' : 'active';
      const completionHint = blockers.length
        ? pick(locale, `ยังรอ ${blockers.length} milestone`, `Waiting on ${blockers.length} milestone(s)`)
        : completion.incompleteTaskCount
          ? pick(locale, `ยังมี ${completion.incompleteTaskCount} Task ที่ไม่เสร็จ`, `${completion.incompleteTaskCount} task(s) remaining`)
          : '';
      return <article key={item.id} className={state}>
        <div className="milestone-symbol"><Icon name={state === 'completed' ? 'check' : state === 'blocked' ? 'lock' : 'milestone'} /></div>
        <div className="milestone-body">
          <header><div><span className={`state ${state}`}>{state === 'blocked' ? pick(locale, 'ถูกล็อก', 'blocked') : state === 'completed' ? pick(locale, 'เสร็จแล้ว', 'completed') : pick(locale, 'กำลังดำเนินการ', 'active')}</span><h3>{item.title}</h3></div><button onClick={() => setEditing(item)} title={context.t('edit')} aria-label={context.t('edit')}><Icon name="more" /></button></header>
          {item.description && <p>{item.description}</p>}
          {deps.length > 0 && <div className="dep-chips"><small>{pick(locale, 'ต้องเสร็จก่อน:', 'Depends on:')}</small>{deps.map((dep) => <span key={dep.id} className={dep.status === 'completed' ? 'done' : ''}><Icon name={dep.status === 'completed' ? 'check' : 'clock'} /> {dep.title}</span>)}</div>}
          <div className="milestone-progress"><span><b>{pct}%</b><small>{complete}/{count.total} tasks</small></span><div><i style={{ width: `${pct}%` }} /></div></div>
          {related.length > 0 && <details className="milestone-tasks">
            <summary><Icon name="chevronRight" /> {pick(locale, `งานที่ยังไม่เสร็จ (${related.length})`, `Open tasks (${related.length})`)}</summary>
            <div className="task-mini-list">{related.map((task) => <button key={task.id} type="button" onClick={() => openTask(task.id)}><i style={{ background: STATUS_COLOR.get(task.status) }} /><strong>{task.title}</strong>{task.dueDate && <small>{formatDue(task.dueDate, task.dueTime, locale)}</small>}</button>)}</div>
          </details>}
          <footer><span className={item.dueDate ? '' : 'muted'}><Icon name="calendarSingle" /> {item.dueDate ? formatDue(item.dueDate, item.dueTime, locale) : pick(locale, 'ไม่มีกำหนด', 'No due date')}</span><div className="milestone-actions"><button className="link-button" onClick={() => navigate(`/p/${project.id}/tasks?m=${item.id}`)}>{pick(locale, 'เปิดบอร์ดงาน →', 'Open board →')}</button>{!readOnly && (item.status === 'completed'
            ? <button className="secondary compact" onClick={() => void setStatus(item, 'active', completion.taskCount)}>{pick(locale, 'เปิดอีกครั้ง', 'Reopen')}</button>
            : <button className="primary compact" disabled={!completion.canComplete} title={completionHint} onClick={() => void setStatus(item, 'completed', completion.taskCount)}><Icon name="check" /> {pick(locale, 'ปิด Milestone', 'Complete')}</button>)}</div></footer>
        </div>
      </article>;
    })}</div>
    {!items.length && <Empty icon="milestone" title={context.t('noData')} description={pick(locale, 'สร้าง milestone แรกของโปรเจกต์', 'Create the first milestone for this project')} />}
    {editing && <MilestoneModal item={editing === 'new' ? null : editing} all={items} tasks={tasks} taskCount={editing === 'new' ? undefined : counts[editing.id]} project={{ id: project.id, name: project.name }} members={members} context={context} role={role} readOnly={readOnly} onClose={() => setEditing(null)} />}
  </>;
}

function MilestoneModal({ item, all, tasks, taskCount, project, members, context, role, readOnly, onClose }: { item: Milestone | null; all: Milestone[]; tasks: Task[]; taskCount?: { total: number; done: number }; project: { id: string; name: string }; members: Membership[]; context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void }) {
  const { user, t, locale } = context;
  const [form, setForm] = useState({ title: item?.title || '', description: item?.description || '', dueDate: item?.dueDate || '', dueTime: item?.dueTime || '', status: item?.status || 'active', dependsOn: item?.dependsOn || [] as string[] });
  const selfId = item?.id || '__new__';
  const dependencyBlockers = blockingMilestones({ id: selfId, status: 'active', dependsOn: form.dependsOn } as Milestone, all);
  const activeCount = tasks.filter((task) => task.milestoneId === selfId).length;
  const completion = { taskCount: taskCount?.total ?? activeCount, incompleteTaskCount: taskCount ? taskCount.total - taskCount.done : activeCount, blockingMilestones: dependencyBlockers, canComplete: dependencyBlockers.length === 0 && (item ? !!taskCount && taskCount.total === taskCount.done : activeCount === 0) };
  const isCompleting = form.status === 'completed' && item?.status !== 'completed';
  const completionBlocked = !completion.canComplete && item?.status !== 'completed';
  const others = all.filter((other) => other.id !== item?.id);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const formId = useId();
  useEffect(() => item ? subscribeMilestoneDocuments(project.id, item.id, setDocuments) : undefined, [project.id, item?.id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isCompleting && !completion.canComplete) return;
    if (isCompleting && completion.taskCount === 0 && !confirm(pick(locale, 'Milestone นี้ยังไม่มี Task ต้องการปิดเลยหรือไม่?', 'This milestone has no tasks. Complete it anyway?'))) return;
    const values = { ...form };
    const ok = await attempt(() => (item
      ? updateWorkItem(project.id, 'milestones', item.id, values)
      : createWorkItem(project.id, 'milestones', values, user, { type: 'milestone_created', th: `เพิ่ม milestone “${form.title}”`, en: `created milestone “${form.title}”` })).then(() => true), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    if (ok) onClose();
  };
  const actions = <>
    {item && <button type="button" className="comment-toggle" onClick={() => setCommentsOpen(true)} aria-label={pick(locale, 'ความคิดเห็น', 'Comments')}><Icon name="comment" /> {commentCount}</button>}
    {!readOnly && <button form={formId} className="primary">{t('save')}</button>}
  </>;
  return <Modal title={item ? t('edit') : t('addMilestone')} onClose={documentPickerOpen ? () => setDocumentPickerOpen(false) : commentsOpen ? () => setCommentsOpen(false) : onClose} wide={!!item} actions={actions}>
    <div className={item ? `modal-split ${commentsOpen ? 'comments-open' : ''}` : ''}>
      <form id={formId} className="stack-form edit-form" onSubmit={submit}>
        <fieldset className="read-only-fields" disabled={readOnly}>
        <label><span className="field-name">{pick(locale, 'ชื่อ', 'Title')}</span><input className="title-input" placeholder={pick(locale, 'ชื่อ milestone', 'Milestone title')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
        <label><span className="field-name">{pick(locale, 'รายละเอียด', 'Description')}</span><textarea className="description-input" placeholder={pick(locale, 'เพิ่มรายละเอียด…', 'Add details…')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="field-row chip-row">
          <label><span className="field-name">{pick(locale, 'วันครบกำหนด (ไม่บังคับ)', 'Due date (optional)')}</span><span className="date-clear"><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value, dueTime: e.target.value ? form.dueTime : '' })} /><TimeField label={pick(locale, 'เวลา (ไม่บังคับ)', 'Time (optional)')} value={form.dueTime} disabled={!form.dueDate} onChange={(dueTime) => setForm((current) => ({ ...current, dueTime }))} />{form.dueDate && <button type="button" className="link-button" onClick={() => setForm({ ...form, dueDate: '', dueTime: '' })}>{pick(locale, 'ไม่มีกำหนด', 'No due date')}</button>}</span></label>
          <label><span className="field-name">{pick(locale, 'สถานะ', 'Status')}</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'completed' })}><option value="active">Active</option><option value="completed" disabled={completionBlocked}>Completed{completionBlocked ? ' 🔒' : ''}</option></select></label>
        </div>
        <fieldset><legend>{pick(locale, 'ต้องรอ milestone เหล่านี้เสร็จก่อน', 'Depends on (must be completed first)')}</legend>
          <div className="dep-picker">{others.map((other) => {
            const checked = form.dependsOn.includes(other.id);
            const cycle = !checked && wouldCreateCycle(selfId, [...form.dependsOn, other.id], all);
            return <label key={other.id} className={cycle ? 'disabled' : ''} title={cycle ? pick(locale, 'จะทำให้เกิดการพึ่งพาวน', 'Would create a circular dependency') : ''}>
              <input type="checkbox" checked={checked} disabled={cycle} onChange={(e) => setForm({ ...form, dependsOn: e.target.checked ? [...form.dependsOn, other.id] : form.dependsOn.filter((id) => id !== other.id) })} />
              <span><Icon name={other.status === 'completed' ? 'check' : 'milestone'} /> {other.title}</span>{cycle && <small><Icon name="refresh" /></small>}
            </label>;
          })}{!others.length && <p className="muted">{pick(locale, 'ยังไม่มี milestone อื่น', 'No other milestones yet')}</p>}</div>
        </fieldset>
        {completionBlocked && <p className="inline-warning"><Icon name="lock" /> {completion.blockingMilestones.length
          ? pick(locale, 'ยังปิด milestone นี้ไม่ได้จนกว่า milestone ที่ต้องรอจะเสร็จ', 'Can’t be completed until its prerequisites are completed')
          : pick(locale, `ยังมี ${completion.incompleteTaskCount} Task ที่ต้องทำให้เสร็จ`, `${completion.incompleteTaskCount} task(s) must be completed first`)}</p>}
        </fieldset>
        {item && <section className="task-attachments">
          <div className="task-documents-head"><h3><Icon name="document" /> {pick(locale, 'เอกสาร', 'Documents')} <b>{documents.length}</b></h3>{!readOnly && <button type="button" className="secondary small" onClick={() => setDocumentPickerOpen(true)}><Icon name="add" /> {pick(locale, 'เพิ่มเอกสาร', 'Add documents')}</button>}</div>
          {documents.length > 0 && <div className="drive-file-list">{documents.map((document) => isDriveProjectDocument(document) ? <DriveFileRow key={document.id} file={document} locale={locale} uploader={members.find((member) => member.userId === document.createdBy)?.displayName} canDetach={!readOnly} iconOnlyDetach detachLabel={pick(locale, 'ยกเลิกการเชื่อม', 'Unlink')} onDetach={() => attempt(() => unlinkProjectDocumentFromMilestone(project.id, document.id, item.id).then(() => true), pick(locale, 'ยกเลิกการเชื่อมไม่สำเร็จ', 'Could not unlink document')).then((ok) => ok === true)} />
            : isCanvaProjectDocument(document) ? <CanvaFileRow key={document.id} file={document} locale={locale} uploader={members.find((member) => member.userId === document.createdBy)?.displayName} canDetach={!readOnly} iconOnlyDetach detachLabel={pick(locale, 'ยกเลิกการเชื่อม', 'Unlink')} onDetach={() => attempt(() => unlinkProjectDocumentFromMilestone(project.id, document.id, item.id).then(() => true), pick(locale, 'ยกเลิกการเชื่อมไม่สำเร็จ', 'Could not unlink document')).then((ok) => ok === true)} />
            : <div className="task-document-row" key={document.id}><a href={`/p/${project.id}/docs/${document.id}`}><span><Icon name="document" /></span><span><strong>{document.title}</strong><small>{document.excerpt || pick(locale, 'เอกสาร Markdown', 'Markdown document')}</small></span><b><Icon name="open" /></b></a>{!readOnly && <button type="button" className="drive-detach icon-only" aria-label={pick(locale, 'ยกเลิกการเชื่อม', 'Unlink')} onClick={() => void attempt(() => unlinkProjectDocumentFromMilestone(project.id, document.id, item.id), pick(locale, 'ยกเลิกการเชื่อมไม่สำเร็จ', 'Could not unlink document'))}><Icon name="close" /></button>}</div>)}</div>}
          {!documents.length && <p className="muted task-documents-empty">{pick(locale, 'ยังไม่มีเอกสารที่เชื่อมกับ Milestone นี้', 'No documents linked to this milestone')}</p>}
        </section>}
        <div className="form-actions">{!readOnly && item && canDeleteItem(role, item.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={async () => { if (confirm(`${t('delete')}?`)) { await attempt(() => deleteMilestoneAndUnlinkDocuments(project.id, item.id), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); onClose(); } }}>{t('delete')}</button>}<span /><button type="button" className="secondary" onClick={onClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : t('cancel')}</button>{!readOnly && <button className="primary">{t('save')}</button>}</div>
      </form>
      {item && <div className="comments-scrim" onClick={() => setCommentsOpen(false)} />}
      {item && <CommentThread projectId={project.id} targetType="milestone" targetId={item.id} context={context} role={role} readOnly={readOnly} onCount={setCommentCount} onClose={() => setCommentsOpen(false)} />}
    </div>
    {item && documentPickerOpen && <DocumentPickerModal project={project} target={{ type: 'milestone', id: item.id }} members={members} user={user} locale={locale} linkedIds={new Set(documents.map((document) => document.id))} onClose={() => setDocumentPickerOpen(false)} />}
  </Modal>;
}
