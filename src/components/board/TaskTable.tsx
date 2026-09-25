import { useState, type MouseEvent, type ReactNode } from 'react';
import { Avatar } from '@/components/common';
import { TASK_COLUMNS } from '@/config/constants';
import type { Selection } from '@/hooks';
import type { Label, Membership, Milestone, Priority, Task, TaskStatus } from '@/types';
import { compareDueDate, dueState } from '@/utils/calendar';
import { formatDue, pick } from '@/utils/formatters';
import { LabelChip } from './LabelChip';
import { PRIORITIES } from './TaskModal';

export interface TaskGroup { key: string; title: ReactNode; tasks: Task[] }
type SortKey = 'order' | 'title' | 'status' | 'priority' | 'milestone' | 'dueDate' | 'checklist';

const STATUS_RANK = new Map(TASK_COLUMNS.map((column, index) => [column.id, index]));
const PRIORITY_RANK = new Map(PRIORITIES.map((priority, index) => [priority, index]));

export function TaskTable({ groups, members, labels, milestones, locale, selection, readOnly, onOpen, onRowClick, onStatus, onPriority, onLabelClick }: {
  groups: TaskGroup[]; members: Membership[]; labels: Label[]; milestones: Milestone[]; locale: string; selection: Selection; readOnly: boolean;
  onOpen: (task: Task) => void; onRowClick: (event: MouseEvent, task: Task) => void; onStatus: (task: Task, status: TaskStatus) => void; onPriority: (task: Task, priority: Priority) => void; onLabelClick: (label: Label) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'order', dir: 1 });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const milestoneTitle = (id: string) => milestones.find((item) => item.id === id)?.title || '';
  const compare = (a: Task, b: Task): number => {
    const progress = (task: Task) => (task.checklist?.length ? task.checklist.filter((item) => item.done).length / task.checklist.length : -1);
    switch (sort.key) {
      case 'title': return a.title.localeCompare(b.title);
      case 'status': return (STATUS_RANK.get(a.status) ?? 0) - (STATUS_RANK.get(b.status) ?? 0) || a.order - b.order;
      case 'priority': return (PRIORITY_RANK.get(b.priority) ?? 0) - (PRIORITY_RANK.get(a.priority) ?? 0);
      case 'milestone': return compareDueDate(milestoneTitle(a.milestoneId), milestoneTitle(b.milestoneId));
      case 'dueDate': return compareDueDate(a.dueDate, b.dueDate, a.dueTime, b.dueTime);
      case 'checklist': return progress(a) - progress(b);
      default: return (STATUS_RANK.get(a.status) ?? 0) - (STATUS_RANK.get(b.status) ?? 0) || a.order - b.order;
    }
  };
  const header = (key: SortKey, label: string) => <th><button type="button" onClick={() => setSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: 1 })}>{label}{sort.key === key && (sort.dir === 1 ? ' ↑' : ' ↓')}</button></th>;
  const allIds = groups.flatMap((group) => group.tasks.map((task) => task.id));
  const allSelected = allIds.length > 0 && allIds.every((id) => selection.has(id));

  return <div className="task-table-wrap"><table className="task-table">
    <thead><tr>
      <th className="col-check">{!readOnly && <input type="checkbox" checked={allSelected} onChange={() => (allSelected ? selection.clear() : selection.set(allIds))} aria-label="Select all" />}</th>
      {header('title', pick(locale, 'ชื่องาน', 'Title'))}{header('status', pick(locale, 'สถานะ', 'Status'))}<th>{pick(locale, 'ผู้รับผิดชอบ', 'Assignees')}</th><th>Labels</th>
      {header('priority', pick(locale, 'ความสำคัญ', 'Priority'))}{header('milestone', 'Milestone')}{header('dueDate', pick(locale, 'กำหนดส่ง', 'Due'))}{header('checklist', '☑')}
    </tr></thead>
    {groups.map((group) => {
      const rows = [...group.tasks].sort((a, b) => compare(a, b) * sort.dir);
      const isCollapsed = collapsed.has(group.key);
      return <tbody key={group.key}>
        {groups.length > 1 && <tr className="group-row"><td colSpan={9}><button type="button" onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}>
          {isCollapsed ? '▸' : '▾'} {group.title} <b>{group.tasks.length}</b></button></td></tr>}
        {!isCollapsed && rows.map((task) => {
          const assignees = members.filter((member) => task.assigneeIds.includes(member.userId));
          const due = task.status === 'done' ? 'normal' : dueState(task.dueDate, undefined, undefined, task.dueTime);
          const checklist = task.checklist || [];
          return <tr key={task.id} className={selection.has(task.id) ? 'selected' : ''} onClick={(e) => onRowClick(e, task)}>
            <td className="col-check" onClick={(e) => e.stopPropagation()}>{!readOnly && <input type="checkbox" checked={selection.has(task.id)} onChange={() => selection.toggle(task.id)} aria-label="Select task" />}</td>
            <td className="col-title"><button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); onOpen(task); }}>{task.title}</button></td>
            <td onClick={(e) => e.stopPropagation()}><select value={task.status} disabled={readOnly} onChange={(e) => onStatus(task, e.target.value as TaskStatus)} className={`status-select s-${task.status}`}>{TASK_COLUMNS.map((column) => <option key={column.id} value={column.id}>{locale === 'th' ? column.th : column.en}</option>)}</select></td>
            <td><div className="avatar-stack">{assignees.slice(0, 4).map((member) => <Avatar key={member.id} name={member.displayName} src={member.photoURL} size="sm" />)}</div></td>
            <td><div className="card-labels">{(task.labelIds || []).map((id) => labels.find((label) => label.id === id)).filter((label): label is Label => !!label).map((label) => <LabelChip key={label.id} label={label} onClick={() => onLabelClick(label)} />)}{(task.tags || []).map((tag) => <span key={tag} className="legacy-tag">{tag}</span>)}</div></td>
            <td onClick={(e) => e.stopPropagation()}><select value={task.priority} disabled={readOnly} onChange={(e) => onPriority(task, e.target.value as Priority)} className={`priority-select priority ${task.priority}`}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></td>
            <td className="muted">{milestoneTitle(task.milestoneId) || '—'}</td>
            <td className={`due ${due}`}>{task.dueDate ? formatDue(task.dueDate, task.dueTime, locale) : '—'}</td>
            <td className="muted">{checklist.length ? `${checklist.filter((item) => item.done).length}/${checklist.length}` : ''}</td>
          </tr>;
        })}
      </tbody>;
    })}
  </table>{!allIds.length && <p className="muted table-empty">{pick(locale, 'ไม่มีงานที่ตรงกับตัวกรอง', 'No tasks match this filter')}</p>}</div>;
}
