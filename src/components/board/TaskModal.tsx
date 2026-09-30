import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { Avatar, DriveAttachmentControl, DriveFileRow, Modal, TimeField } from '@/components/common';
import { CommentThread } from '@/components/comments/CommentThread';
import { attempt, toast } from '@/components/toast';
import { TASK_COLUMNS } from '@/config/constants';
import { attachDriveTaskFile, createWorkItem, deleteTasksWithAttachments, detachDriveTaskFile, subscribeTaskAttachments, updateWorkItem } from '@/services';
import type { ChecklistItem, Label, Membership, Milestone, Priority, Role, Task, TaskAttachment, TaskStatus } from '@/types';
import { isGoogleDriveEnabled } from '@/config/features';
import { blockingMilestones } from '@/utils/milestone-deps';
import { canDeleteItem } from '@/utils/permissions';
import { pick } from '@/utils/formatters';
import { Checklist } from './Checklist';
import { LabelPicker } from './LabelPicker';

/** Statuses a task may still use while its milestone waits on unfinished prerequisites. */
export const OPEN_WHILE_BLOCKED: TaskStatus[] = ['backlog', 'todo'];
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

export type TaskDefaults = Partial<Pick<Task, 'status' | 'milestoneId' | 'dueDate' | 'dueTime' | 'order' | 'priority' | 'assigneeIds' | 'labelIds'>>;

export function TaskModal({ task, defaults = {}, projectId, projectName, members, milestones, labels, context, role, readOnly, onClose }: {
  task: Task | null; defaults?: TaskDefaults; projectId: string; projectName: string; members: Membership[]; milestones: Milestone[]; labels: Label[];
  context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void;
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
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const formId = useId();
  const checklistTimer = useRef(0);
  const selectedMilestone = milestones.find((item) => item.id === form.milestoneId);
  const locked = selectedMilestone ? blockingMilestones(selectedMilestone, milestones).length > 0 : false;

  useEffect(() => task && isGoogleDriveEnabled ? subscribeTaskAttachments(projectId, task.id, setAttachments) : undefined, [projectId, task?.id]);

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
    const ok = await attempt(() => (task
      ? updateWorkItem(projectId, 'tasks', task.id, values, user, { type: 'task_updated', th: `แก้ไขงาน “${values.title}”`, en: `updated task “${values.title}”` })
      : createWorkItem(projectId, 'tasks', values, user, { type: 'task_created', th: `เพิ่มงาน “${values.title}”`, en: `created task “${values.title}”` })).then(() => true), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    setBusy(false);
    if (ok) onClose();
  };
  const remove = async () => { if (task && confirm(`${t('delete')} ${task.title}?`)) { await attempt(() => deleteTasksWithAttachments(projectId, [task.id]), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); onClose(); } };

  const actions = <>
    {task && <button type="button" className="comment-toggle" onClick={() => setCommentsOpen(true)} aria-label={pick(locale, 'ความคิดเห็น', 'Comments')}>💬 {commentCount}</button>}
    {!readOnly && <button form={formId} className="primary" disabled={busy}>{t('save')}</button>}
  </>;

  return <Modal title={task ? t('edit') : t('addTask')} onClose={commentsOpen ? () => setCommentsOpen(false) : onClose} wide actions={actions}>
    <div className={task ? `modal-split ${commentsOpen ? 'comments-open' : ''}` : ''}>
      <form id={formId} className="stack-form two-col edit-form" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit(); } }}>
        <fieldset className="read-only-fields span-2" disabled={readOnly}>
        <label className="span-2"><span className="field-name">{pick(locale, 'ชื่องาน', 'Title')}</span><input className="title-input" autoFocus={!task} placeholder={pick(locale, 'ชื่องาน', 'Task title')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={160} /></label>
        <label className="span-2"><span className="field-name">{pick(locale, 'รายละเอียด', 'Description')}</span><textarea className="description-input" rows={4} placeholder={pick(locale, 'เพิ่มรายละเอียด…', 'Add details…')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="chip-row span-2">
        <label><span className="field-name">{pick(locale, 'สถานะ', 'Status')}</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>{TASK_COLUMNS.map((item) => <option key={item.id} value={item.id} disabled={locked && !OPEN_WHILE_BLOCKED.includes(item.id)}>{locale === 'th' ? item.th : item.en}</option>)}</select></label>
        <label><span className="field-name">{pick(locale, 'ความสำคัญ', 'Priority')}</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></label>
        <label><span className="field-name">{pick(locale, 'วันครบกำหนด', 'Due date')}</span><span className="date-clear"><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value, dueTime: e.target.value ? form.dueTime : '' })} /><TimeField label={pick(locale, 'เวลา (ไม่บังคับ)', 'Time (optional)')} value={form.dueTime} disabled={!form.dueDate} onChange={(dueTime) => setForm((current) => ({ ...current, dueTime }))} /></span></label>
        <label><span className="field-name">Milestone</span><select value={form.milestoneId} onChange={(e) => setForm({ ...form, milestoneId: e.target.value })}><option value="">—</option>{milestones.map((item) => <option key={item.id} value={item.id}>{blockingMilestones(item, milestones).length ? '🔒 ' : ''}{item.title}</option>)}</select></label>
        </div>
        {locked && <p className="span-2 inline-warning">🔒 {pick(locale, 'Milestone นี้รอ milestone ก่อนหน้า งานจึงเริ่มได้เฉพาะสถานะ งานค้าง/ต้องทำ', 'This milestone waits on a prerequisite, so tasks stay in Backlog / To do')}</p>}
        <fieldset className="span-2"><legend>{pick(locale, 'ผู้รับผิดชอบ', 'Assignees')}</legend><div className="member-checks">{members.map((member) => <label key={member.id}><input type="checkbox" checked={form.assigneeIds.includes(member.userId)} onChange={(e) => setForm({ ...form, assigneeIds: e.target.checked ? [...form.assigneeIds, member.userId] : form.assigneeIds.filter((id) => id !== member.userId) })} /><Avatar name={member.displayName} src={member.photoURL} size="sm" />{member.displayName}</label>)}</div></fieldset>
        <fieldset className="span-2"><legend>Labels</legend>
          <LabelPicker labels={labels} value={form.labelIds} onChange={(labelIds) => setForm((current) => ({ ...current, labelIds }))} projectId={projectId} context={context} readOnly={readOnly} />
          {form.tags.length > 0 && <div className="legacy-tags"><small>{pick(locale, 'Tag เดิม:', 'Old tags:')}</small>{form.tags.map((tag) => <span key={tag}>{tag}{!readOnly && <button type="button" onClick={() => setForm({ ...form, tags: form.tags.filter((item) => item !== tag) })} aria-label="Remove">×</button>}</span>)}</div>}
        </fieldset>
        </fieldset>
        <div className="span-2"><Checklist items={form.checklist} onChange={setChecklist} locale={locale} readOnly={readOnly} /></div>
        {task && isGoogleDriveEnabled && <section className="task-attachments span-2">
          <h3>☁ {pick(locale, 'ไฟล์แนบ', 'Attachments')} <b>{attachments.length}</b></h3>
          {attachments.length > 0 && <div className="drive-file-list">{attachments.map((attachment) => <DriveFileRow key={attachment.id} file={attachment} locale={locale} uploader={members.find((member) => member.userId === attachment.createdBy)?.displayName}
            canDetach={!readOnly && (canDeleteItem(role, attachment.createdBy, user.uid) || task.createdBy === user.uid)} onDetach={() => {
              if (!confirm(pick(locale, 'นำไฟล์แนบนี้ออกจาก SuperKanban หรือไม่? ไฟล์ต้นฉบับและสิทธิ์การแชร์ใน Google Drive จะไม่เปลี่ยนแปลง', 'Remove this attachment from SuperKanban? The original file and its Google Drive sharing permissions will stay unchanged.'))) return false;
              return attempt(() => detachDriveTaskFile(projectId, attachment.id).then(() => true), pick(locale, 'นำไฟล์ออกไม่สำเร็จ', 'Could not detach file')).then((ok) => ok === true);
            }} />)}</div>}
          {!readOnly && <DriveAttachmentControl project={{ id: projectId, name: projectName }} members={members} user={user} locale={locale} existingFileIds={new Set(attachments.map((item) => item.driveFileId))}
            onAttach={(file, mode, sharing) => attachDriveTaskFile(projectId, task.id, file, mode, sharing, user)} />}
        </section>}
        <div className="form-actions span-2">{!readOnly && task && canDeleteItem(role, task.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={remove}>{t('delete')}</button>}<span />{!readOnly && <small className="muted kbd-hint">Ctrl + Enter</small>}<button type="button" className="secondary" onClick={onClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : t('cancel')}</button>{!readOnly && <button className="primary" disabled={busy}>{t('save')}</button>}</div>
      </form>
      {task && <div className="comments-scrim" onClick={() => setCommentsOpen(false)} />}
      {task && <CommentThread projectId={projectId} targetType="task" targetId={task.id} context={context} role={role} readOnly={readOnly} onCount={setCommentCount} onClose={() => setCommentsOpen(false)} />}
    </div>
  </Modal>;
}
