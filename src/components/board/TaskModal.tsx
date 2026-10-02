import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { CanvaFileRow, DocumentPickerModal, DriveFileRow, Modal, TimeField } from '@/components/common';
import { CommentThread } from '@/components/comments/CommentThread';
import { attempt, toast } from '@/components/toast';
import { TASK_COLUMNS } from '@/config/constants';
import { createWorkItem, deleteTasksAndUnlinkDocuments, isCanvaProjectDocument, isDriveProjectDocument, subscribeTaskDocuments, unlinkProjectDocumentFromTask, updateWorkItem } from '@/services';
import type { ChecklistItem, Label, Membership, Milestone, Priority, ProjectDocument, Role, Task, TaskStatus } from '@/types';
import { blockingMilestones } from '@/utils/milestone-deps';
import { canDeleteItem } from '@/utils/permissions';
import { pick } from '@/utils/formatters';
import { Checklist } from './Checklist';
import { LabelPicker } from './LabelPicker';
import { AssigneePicker } from './AssigneePicker';
import { Icon } from '@/components/common/Icon';

/** Statuses a task may still use while its milestone waits on unfinished prerequisites. */
export const OPEN_WHILE_BLOCKED: TaskStatus[] = ['backlog', 'todo'];
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

export type TaskDefaults = Partial<Pick<Task, 'status' | 'milestoneId' | 'dueDate' | 'dueTime' | 'order' | 'priority' | 'assigneeIds' | 'labelIds'>>;

export function TaskModal({ task, defaults = {}, projectId, projectName, members, milestones, labels, context, role, readOnly, onClose, onCreated, initialPanel }: {
  task: Task | null; defaults?: TaskDefaults; projectId: string; projectName: string; members: Membership[]; milestones: Milestone[]; labels: Label[];
  context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void;
  /** "Save & add documents" on a new task: called with the new id instead of closing. */
  onCreated?: (taskId: string) => void;
  initialPanel?: 'documents';
}) {
  const { user, t, locale } = context;
  const [form, setForm] = useState({
    title: task?.title || '', description: task?.description || '', status: task?.status || defaults.status || 'todo' as TaskStatus,
    priority: task?.priority || defaults.priority || 'medium' as Priority, assigneeIds: task?.assigneeIds || defaults.assigneeIds || [] as string[], tags: task?.tags || [] as string[],
    labelIds: (task?.labelIds || defaults.labelIds || []).filter((id) => labels.some((label) => label.id === id)), checklist: task?.checklist || [] as ChecklistItem[],
    dueDate: task?.dueDate ?? defaults.dueDate ?? '', dueTime: task?.dueTime ?? defaults.dueTime ?? '', milestoneId: task?.milestoneId ?? defaults.milestoneId ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const formId = useId();
  const checklistTimer = useRef(0);
  const afterSave = useRef<'close' | 'documents'>('close');
  const selectedMilestone = milestones.find((item) => item.id === form.milestoneId);
  const blockers = selectedMilestone ? blockingMilestones(selectedMilestone, milestones) : [];
  const locked = blockers.length > 0;
  const lockReason = pick(locale, `รอ milestone ก่อนหน้า: ${blockers.map((item) => item.title).join(', ')}`, `Waiting on: ${blockers.map((item) => item.title).join(', ')}`);
  // Existing tasks autosave their checklist, so it never counts as an unsaved change there.
  const snapshot = (values: typeof form) => JSON.stringify({ ...values, checklist: task ? null : values.checklist });
  const initial = useRef(snapshot(form));
  const requestClose = () => {
    if (!readOnly && snapshot(form) !== initial.current && !confirm(pick(locale, 'ยังไม่ได้บันทึกการแก้ไข ปิดโดยไม่บันทึกใช่ไหม?', 'You have unsaved changes. Close without saving?'))) return;
    onClose();
  };

  useEffect(() => task ? subscribeTaskDocuments(projectId, task.id, setDocuments) : undefined, [projectId, task?.id]);
  // Open the requested panel after mount: the picker is its own portal and must land above this modal's.
  useEffect(() => { if (initialPanel === 'documents' && task) setDocumentPickerOpen(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On an existing task, checklist edits save by themselves (debounced), like GitHub task lists.
  const setChecklist = (checklist: ChecklistItem[]) => {
    setForm((current) => ({ ...current, checklist }));
    if (!task || readOnly) return;
    clearTimeout(checklistTimer.current);
    checklistTimer.current = window.setTimeout(() => void attempt(() => updateWorkItem(projectId, 'tasks', task.id, { checklist: checklist.filter((item) => item.text.trim()) }), pick(locale, 'บันทึกเช็กลิสต์ไม่สำเร็จ', 'Could not save checklist')), 500);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || readOnly) return;
    if (locked && !OPEN_WHILE_BLOCKED.includes(form.status)) { toast(pick(locale, 'Milestone ถูกล็อก: ใช้ได้เฉพาะสถานะ งานค้าง/ต้องทำ', 'Milestone is blocked: only Backlog / To do allowed'), 'error'); return; }
    clearTimeout(checklistTimer.current);
    setBusy(true);
    const values = { ...form, title: form.title.trim(), checklist: form.checklist.filter((item) => item.text.trim()), order: task?.order ?? defaults.order ?? Date.now() };
    const savedId = await attempt(() => (task
      ? updateWorkItem(projectId, 'tasks', task.id, values, user, { type: 'task_updated', th: `แก้ไขงาน “${values.title}”`, en: `updated task “${values.title}”` }).then(() => task.id)
      : createWorkItem(projectId, 'tasks', values, user, { type: 'task_created', th: `เพิ่มงาน “${values.title}”`, en: `created task “${values.title}”` })), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    setBusy(false);
    if (!savedId) return;
    if (!task && afterSave.current === 'documents' && onCreated) onCreated(savedId);
    else onClose();
  };
  const remove = async () => { if (task && confirm(`${t('delete')} ${task.title}?`)) { await attempt(() => deleteTasksAndUnlinkDocuments(projectId, [task.id]), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); onClose(); } };

  const actions = <>
    {task && <button type="button" className="comment-toggle" onClick={() => setCommentsOpen(true)} aria-label={pick(locale, 'ความคิดเห็น', 'Comments')}><Icon name="comment" /> {commentCount}</button>}
    {!readOnly && <button form={formId} className="primary" disabled={busy} onClick={() => { afterSave.current = 'close'; }}>{t('save')}</button>}
  </>;

  return <Modal title={task ? t('edit') : t('addTask')} onClose={documentPickerOpen ? () => setDocumentPickerOpen(false) : commentsOpen ? () => setCommentsOpen(false) : requestClose} wide actions={actions} className="task-editor-modal">
    <div className={task ? `modal-split ${commentsOpen ? 'comments-open' : ''}` : ''}>
      <form id={formId} className="stack-form two-col edit-form" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); afterSave.current = 'close'; e.currentTarget.requestSubmit(); } }}>
        <fieldset className="read-only-fields span-2" disabled={readOnly}>
        <label className="span-2"><span className="field-name">{pick(locale, 'ชื่องาน', 'Title')}</span><input className="title-input" autoFocus={!task} placeholder={pick(locale, 'ชื่องาน', 'Task title')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={160} /></label>
        <label className="span-2"><span className="field-name">{pick(locale, 'รายละเอียด', 'Description')}</span><textarea className="description-input" rows={4} placeholder={pick(locale, 'เพิ่มรายละเอียด…', 'Add details…')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="chip-row span-2">
        <label><span className="field-name">{pick(locale, 'สถานะ', 'Status')}</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>{TASK_COLUMNS.map((item) => <option key={item.id} value={item.id} disabled={locked && !OPEN_WHILE_BLOCKED.includes(item.id)} title={locked && !OPEN_WHILE_BLOCKED.includes(item.id) ? lockReason : undefined}>{locale === 'th' ? item.th : item.en}</option>)}</select></label>
        <label><span className="field-name">{pick(locale, 'ความสำคัญ', 'Priority')}</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></label>
        <label><span className="field-name">{pick(locale, 'วันครบกำหนด', 'Due date')}</span><span className="date-clear"><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value, dueTime: e.target.value ? form.dueTime : '' })} /><TimeField label={pick(locale, 'เวลา (ไม่บังคับ)', 'Time (optional)')} value={form.dueTime} disabled={!form.dueDate} onChange={(dueTime) => setForm((current) => ({ ...current, dueTime }))} /></span></label>
        <label><span className="field-name">Milestone</span><select value={form.milestoneId} onChange={(e) => setForm({ ...form, milestoneId: e.target.value })}><option value="">—</option>{milestones.map((item) => <option key={item.id} value={item.id}>{blockingMilestones(item, milestones).length ? '🔒 ' : ''}{item.title}</option>)}</select></label>
        </div>
        {locked && <p className="span-2 inline-warning"><Icon name="lock" /> {pick(locale, `Milestone นี้รอ “${blockers.map((item) => item.title).join('”, “')}” ให้เสร็จก่อน งานจึงอยู่ได้เฉพาะสถานะ งานค้าง/ต้องทำ`, `This milestone waits on “${blockers.map((item) => item.title).join('”, “')}”, so its tasks stay in Backlog / To do until then`)}</p>}
        <fieldset className="span-2"><legend>{pick(locale, 'ผู้รับผิดชอบ', 'Assignees')}</legend><AssigneePicker members={members} value={form.assigneeIds} onChange={(assigneeIds) => setForm((current) => ({ ...current, assigneeIds }))} currentUserId={user.uid} locale={locale} readOnly={readOnly} /></fieldset>
        <fieldset className="span-2"><legend>Labels</legend>
          <LabelPicker labels={labels} value={form.labelIds} onChange={(labelIds) => setForm((current) => ({ ...current, labelIds }))} projectId={projectId} context={context} readOnly={readOnly} />
          {form.tags.length > 0 && <div className="legacy-tags"><small>{pick(locale, 'Tag เดิม:', 'Old tags:')}</small>{form.tags.map((tag) => <span key={tag}>{tag}{!readOnly && <button type="button" onClick={() => setForm({ ...form, tags: form.tags.filter((item) => item !== tag) })} aria-label="Remove"><Icon name="close" /></button>}</span>)}</div>}
        </fieldset>
        </fieldset>
        <div className="span-2"><Checklist items={form.checklist} onChange={setChecklist} locale={locale} readOnly={readOnly} /></div>
        {task && <section className="task-attachments span-2">
          <div className="task-documents-head"><h3><Icon name="document" /> {pick(locale, 'เอกสาร', 'Documents')} <b>{documents.length}</b></h3>{!readOnly && <button type="button" className="secondary small" onClick={() => setDocumentPickerOpen(true)}><Icon name="add" /> {pick(locale, 'เพิ่มเอกสาร', 'Add documents')}</button>}</div>
          {documents.length > 0 && <div className="drive-file-list">{documents.map((document) => isDriveProjectDocument(document) ? <DriveFileRow key={document.id} file={document} locale={locale} uploader={members.find((member) => member.userId === document.createdBy)?.displayName}
            canDetach={!readOnly} iconOnlyDetach detachLabel={pick(locale, 'ยกเลิกการเชื่อม', 'Unlink')} onDetach={() => attempt(() => unlinkProjectDocumentFromTask(projectId, document.id, task.id).then(() => true), pick(locale, 'ยกเลิกการเชื่อมไม่สำเร็จ', 'Could not unlink document')).then((ok) => ok === true)} />
            : isCanvaProjectDocument(document) ? <CanvaFileRow key={document.id} file={document} locale={locale} uploader={members.find((member) => member.userId === document.createdBy)?.displayName}
            canDetach={!readOnly} iconOnlyDetach detachLabel={pick(locale, 'ยกเลิกการเชื่อม', 'Unlink')} onDetach={() => attempt(() => unlinkProjectDocumentFromTask(projectId, document.id, task.id).then(() => true), pick(locale, 'ยกเลิกการเชื่อมไม่สำเร็จ', 'Could not unlink document')).then((ok) => ok === true)} />
            : <div className="task-document-row" key={document.id}><a href={`/p/${projectId}/docs/${document.id}`}><span><Icon name="document" /></span><span><strong>{document.title}</strong><small>{document.excerpt || pick(locale, 'เอกสาร Markdown', 'Markdown document')}</small></span><b><Icon name="open" /></b></a>{!readOnly && <button type="button" className="drive-detach icon-only" aria-label={pick(locale, 'ยกเลิกการเชื่อม', 'Unlink')} title={pick(locale, 'ยกเลิกการเชื่อม', 'Unlink')} onClick={() => void attempt(() => unlinkProjectDocumentFromTask(projectId, document.id, task.id), pick(locale, 'ยกเลิกการเชื่อมไม่สำเร็จ', 'Could not unlink document'))}><Icon name="close" /></button>}</div>)}</div>}
          {!documents.length && <p className="muted task-documents-empty">{pick(locale, 'ยังไม่มีเอกสารที่เชื่อมกับ Task นี้', 'No documents linked to this task')}</p>}
        </section>}
        <div className="form-actions span-2">{!readOnly && task && canDeleteItem(role, task.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={remove}>{t('delete')}</button>}<span />{!readOnly && <small className="muted kbd-hint">Ctrl + Enter</small>}<button type="button" className="secondary" onClick={requestClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : t('cancel')}</button>{!readOnly && !task && onCreated && <button className="secondary" disabled={busy} onClick={() => { afterSave.current = 'documents'; }}><Icon name="attach" /> {pick(locale, 'บันทึกแล้วแนบเอกสาร', 'Save & add documents')}</button>}{!readOnly && <button className="primary" disabled={busy} onClick={() => { afterSave.current = 'close'; }}>{t('save')}</button>}</div>
      </form>
      {task && <div className="comments-scrim" onClick={() => setCommentsOpen(false)} />}
      {task && <CommentThread projectId={projectId} targetType="task" targetId={task.id} context={context} role={role} readOnly={readOnly} onCount={setCommentCount} onClose={() => setCommentsOpen(false)} />}
    </div>
    {task && documentPickerOpen && <DocumentPickerModal project={{ id: projectId, name: projectName }} taskId={task.id} members={members} user={user} locale={locale} linkedIds={new Set(documents.map((item) => item.id))} onClose={() => setDocumentPickerOpen(false)} />}
  </Modal>;
}
