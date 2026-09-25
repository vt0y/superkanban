import { memo, type DragEvent, type MouseEvent } from 'react';
import { Avatar } from '@/components/common';
import { TASK_COLUMNS } from '@/config/constants';
import type { Label, Membership, Milestone, Task, TaskStatus } from '@/types';
import { dueState } from '@/utils/calendar';
import { formatDue, pick } from '@/utils/formatters';
import { LabelChip } from './LabelChip';

export const TaskCard = memo(function TaskCard({ task, members, labels, locale, selected, selectMode, comments, locked, milestone, readOnly, dragging, onClick, onToggle, onMove, onDragStart, onDragEnd, onLabelClick }: {
  task: Task; members: Membership[]; labels: Label[]; locale: string; selected: boolean; selectMode: boolean; comments: number; locked: boolean; milestone?: Milestone;
  readOnly: boolean; dragging: boolean; onClick: (event: MouseEvent, task: Task) => void; onToggle: (id: string) => void; onMove: (task: Task, status: TaskStatus) => void;
  onDragStart: (event: DragEvent, task: Task) => void; onDragEnd: () => void; onLabelClick: (label: Label) => void;
}) {
  const assignees = members.filter((member) => task.assigneeIds.includes(member.userId));
  const taskLabels = (task.labelIds || []).map((id) => labels.find((label) => label.id === id)).filter((label): label is Label => !!label);
  const due = task.status === 'done' ? 'normal' : dueState(task.dueDate, undefined, undefined, task.dueTime);
  const checklist = task.checklist || [];
  const checked = checklist.filter((item) => item.done).length;
  return <article className={`task-card ${selected ? 'selected' : ''} ${selectMode ? 'select-mode' : ''} ${dragging ? 'dragging' : ''} ${task.status === 'done' ? 'is-done' : ''}`} data-task-id={task.id}
    draggable={!readOnly} onDragStart={(e) => onDragStart(e, task)} onDragEnd={onDragEnd} onClick={(e) => onClick(e, task)}>
    {!readOnly && <input type="checkbox" className="card-check" checked={selected} onClick={(e) => e.stopPropagation()} onChange={() => onToggle(task.id)} aria-label="Select task" />}
    <div className="task-tags"><span className={`priority ${task.priority}`}>{task.priority}</span>{locked && <span title="Milestone blocked">🔒</span>}</div>
    <h3>{task.title}</h3>{task.description && <p>{task.description}</p>}
    {(taskLabels.length > 0 || (task.tags || []).length > 0) && <div className="card-labels">{taskLabels.map((label) => <LabelChip key={label.id} label={label} onClick={() => onLabelClick(label)} />)}{(task.tags || []).slice(0, 3).map((tag) => <span key={tag} className="legacy-tag">{tag}</span>)}</div>}
    {milestone && <small className="task-milestone">◇ {milestone.title}</small>}
    {checklist.length > 0 && <div className={`card-checklist ${checked === checklist.length ? 'complete' : ''}`} title={pick(locale, 'เช็กลิสต์', 'Checklist')}><span>☑ {checked}/{checklist.length}</span><i><b style={{ width: `${(checked / checklist.length) * 100}%` }} /></i></div>}
    <div className="task-foot"><div className="avatar-stack">{assignees.slice(0, 3).map((member) => <Avatar key={member.id} name={member.displayName} src={member.photoURL} size="sm" />)}{assignees.length > 3 && <span className="avatar-more">+{assignees.length - 3}</span>}</div>
      <span className="task-meta">{comments > 0 && <span>💬 {comments}</span>}{task.dueDate && <span className={`due ${due}`} title={due === 'overdue' ? pick(locale, 'เกินกำหนด', 'Overdue') : due === 'soon' ? pick(locale, 'ใกล้ครบกำหนด', 'Due soon') : ''}>◷ {formatDue(task.dueDate, task.dueTime, locale)}</span>}</span>
      {!readOnly && <select className="mobile-status" value={task.status} onClick={(e) => e.stopPropagation()} onChange={(e) => onMove(task, e.target.value as TaskStatus)}>{TASK_COLUMNS.map((item) => <option key={item.id} value={item.id}>{locale === 'th' ? item.th : item.en}</option>)}</select>}</div>
  </article>;
});
