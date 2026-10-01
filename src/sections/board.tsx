import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SectionProps } from '@/context/AppContext';
import { Avatar, BulkBar, PageTitle, Segmented } from '@/components/common';
import { FilterBar } from '@/components/board/FilterBar';
import { LabelChip } from '@/components/board/LabelChip';
import { LabelManager } from '@/components/board/LabelManager';
import { TaskCard } from '@/components/board/TaskCard';
import { OPEN_WHILE_BLOCKED, PRIORITIES, TaskModal, type TaskDefaults } from '@/components/board/TaskModal';
import { TaskTable, type TaskGroup } from '@/components/board/TaskTable';
import { TASK_COLUMNS } from '@/config/constants';
import { blockingMilestones } from '@/utils/milestone-deps';
import { canDeleteItem } from '@/utils/permissions';
import { isNoopDrop, ordersForDrop } from '@/utils/board-order';
import { matchTask, parseTaskQuery, queryValue, toggleQueryTerm } from '@/utils/task-filter';
import { bulkUpdateWorkItems, createWorkItem, deleteTasksAndUnlinkDocuments } from '@/services';
import type { Label, Milestone, Priority, Task, TaskStatus } from '@/types';
import { attempt, toast } from '@/components/toast';
import { formatDue, pick } from '@/utils/formatters';
import { useBoardTasks, useProjectItems, useSelection } from '@/hooks';

type GroupBy = 'none' | 'assignee' | 'milestone' | 'priority' | 'label';
type View = 'board' | 'table';
/** A swimlane: the tasks in it, and what a card dropped into it should change. */
interface Lane extends TaskGroup { patch?: (task: Task, fromLane: string) => Partial<Task> }
interface DragState { ids: string[]; lane: string }
interface DropTarget { lane: string; status: TaskStatus; index: number }

const PAGE = 50;
const GROUPS: GroupBy[] = ['none', 'assignee', 'milestone', 'priority', 'label'];
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function readCollapsed(projectId: string): Set<TaskStatus> {
  try { return new Set(JSON.parse(localStorage.getItem(`board-collapsed:${projectId}`) || '[]')); } catch { return new Set(); }
}

export function Board({ context, project, members, role, readOnly }: SectionProps) {
  const [params, setParams] = useSearchParams();
  const scope = params.get('m') || '';
  const { items: tasks, hasMore, loadingMore, loadMore } = useBoardTasks(project.id, { doneLimit: PAGE, ...(scope && scope !== 'none' ? { milestoneId: scope } : {}) });
  const milestones = useProjectItems<Milestone>(project.id, 'milestones');
  const labels = useProjectItems<Label>(project.id, 'labels');
  const query = params.get('q') || '';
  const view: View = params.get('view') === 'table' ? 'table' : 'board';
  const groupBy: GroupBy = GROUPS.includes(params.get('group') as GroupBy) ? params.get('group') as GroupBy : 'none';
  const [modal, setModal] = useState<{ task: Task | null; defaults?: TaskDefaults } | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>('todo');
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(() => readCollapsed(project.id));
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState<{ lane: string; status: TaskStatus } | null>(null);
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const { locale, user } = context;

  const setParam = useCallback((key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: key === 'q' }), [setParams]);

  const activeMilestone = milestones.find((item) => item.id === scope) || null;
  const blockers = activeMilestone ? blockingMilestones(activeMilestone, milestones) : [];
  const blockedMilestoneIds = useMemo(() => new Set(milestones.filter((m) => blockingMilestones(m, milestones).length).map((m) => m.id)), [milestones]);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const parsed = useMemo(() => parseTaskQuery(query), [query]);
  const filtered = useMemo(() => {
    const ctx = { userId: user.uid, labels, members, milestones, blockedMilestoneIds };
    return tasks.filter((task) => (scope === '' || (scope === 'none' ? !milestones.some((m) => m.id === task.milestoneId) : task.milestoneId === scope)) && matchTask(task, parsed, ctx));
  }, [tasks, scope, parsed, user.uid, labels, members, milestones, blockedMilestoneIds]);
  const ordered = useMemo(() => TASK_COLUMNS.flatMap((column) => filtered.filter((task) => task.status === column.id).sort((a, b) => a.order - b.order)), [filtered]);
  const selection = useSelection(ordered.map((task) => task.id));

  const lanes = useMemo((): Lane[] => {
    const none = pick(locale, 'ไม่ระบุ', 'None');
    switch (groupBy) {
      case 'assignee': return [
        ...members.map((member) => ({ key: member.userId, title: <><Avatar name={member.displayName} src={member.photoURL} size="sm" />{member.displayName}</>, tasks: ordered.filter((task) => task.assigneeIds.includes(member.userId)),
          patch: (task: Task, from: string) => ({ assigneeIds: [...new Set([...task.assigneeIds.filter((id) => id !== from), member.userId])] }) })),
        { key: '__none', title: <>👤 {pick(locale, 'ไม่มีผู้รับผิดชอบ', 'No assignee')}</>, tasks: ordered.filter((task) => !members.some((member) => task.assigneeIds.includes(member.userId))), patch: () => ({ assigneeIds: [] }) },
      ];
      case 'milestone': return [
        ...milestones.filter((m) => !scope || m.id === scope).map((m) => ({ key: m.id, title: <>{blockedMilestoneIds.has(m.id) ? '🔒' : m.status === 'completed' ? '✓' : '◇'} {m.title}{m.dueDate && <small>{formatDue(m.dueDate, m.dueTime, locale)}</small>}</>, tasks: ordered.filter((task) => task.milestoneId === m.id), patch: () => ({ milestoneId: m.id }) })),
        ...(!scope || scope === 'none' ? [{ key: '__none', title: <>◇ {pick(locale, 'ไม่มี milestone', 'No milestone')}</>, tasks: ordered.filter((task) => !milestones.some((m) => m.id === task.milestoneId)), patch: () => ({ milestoneId: '' }) }] : []),
      ];
      case 'priority': return [...PRIORITIES].reverse().map((priority) => ({ key: priority, title: <span className={`priority ${priority}`}>{priority}</span>, tasks: ordered.filter((task) => task.priority === priority), patch: () => ({ priority }) }));
      case 'label': return [
        ...[...labels].sort((a, b) => a.name.localeCompare(b.name)).map((label) => ({ key: label.id, title: <LabelChip label={label} />, tasks: ordered.filter((task) => task.labelIds?.includes(label.id)) })),
        { key: '__none', title: <>{pick(locale, 'ไม่มี label', 'No label')}</>, tasks: ordered.filter((task) => !(task.labelIds || []).some((id) => labels.some((label) => label.id === id))) },
      ];
      default: return [{ key: 'all', title: none, tasks: ordered }];
    }
  }, [groupBy, ordered, members, milestones, labels, scope, blockedMilestoneIds, locale]);

  const blockersFor = useCallback((milestoneId: string) => blockedMilestoneIds.has(milestoneId), [blockedMilestoneIds]);
  const lockedIds = (ids: string[], status: TaskStatus, milestoneFor: (id: string) => string) => OPEN_WHILE_BLOCKED.includes(status) ? [] : ids.filter((id) => blockersFor(milestoneFor(id)));

  /** Moves cards to `status` (and into `lane`), placing them at `index` of `column` or at its end. */
  const moveTasks = (ids: string[], status: TaskStatus, drop?: { column: Task[]; index: number; lane?: Lane; fromLane?: string }) => {
    const patchFor = (task: Task) => (drop?.lane?.patch && drop.fromLane !== drop.lane.key ? drop.lane.patch(task, drop.fromLane || '') : {});
    const locked = lockedIds(ids, status, (id) => { const task = byId.get(id)!; return patchFor(task).milestoneId ?? task.milestoneId; });
    const allowed = ids.filter((id) => !locked.includes(id) && byId.has(id));
    if (locked.length) toast(pick(locale, `ย้ายไม่ได้ ${locked.length} งาน: milestone ยังรอ milestone ก่อนหน้า`, `${locked.length} task(s) locked: their milestone is waiting on a prerequisite`), 'error');
    if (!allowed.length) return;
    const column = drop?.column ?? ordered.filter((task) => task.status === status);
    const index = drop?.index ?? column.length;
    const sameLane = !drop?.lane?.patch || drop.fromLane === drop.lane.key;
    if (sameLane && allowed.every((id) => byId.get(id)!.status === status) && isNoopDrop(column, index, allowed)) return;
    const orders = ordersForDrop(column, index, allowed);
    const statusChanged = allowed.some((id) => byId.get(id)!.status !== status) || !sameLane;
    const activity = statusChanged ? { type: 'task_moved', th: allowed.length > 1 ? `ย้าย ${allowed.length} งาน` : 'ย้ายสถานะงาน', en: allowed.length > 1 ? `moved ${allowed.length} tasks` : 'moved a task' } : undefined;
    void attempt(() => bulkUpdateWorkItems(project.id, 'tasks', allowed, (id) => ({ status, order: orders.get(id)!, ...patchFor(byId.get(id)!) }), activity && user, activity), pick(locale, 'ย้ายงานไม่สำเร็จ', 'Could not move task'));
  };
  const moveOne = useCallback((task: Task, status: TaskStatus) => moveTasks([task.id], status), [moveTasks]);

  const selectedIds = [...selection.selected];
  const bulkSet = (values: Partial<Task>, th: string, en: string) => {
    void attempt(() => bulkUpdateWorkItems(project.id, 'tasks', selectedIds, values, user, { type: 'task_bulk', th, en }), pick(locale, 'อัปเดตไม่สำเร็จ', 'Bulk update failed'))
      .then((done) => { if (done !== undefined) toast(pick(locale, `อัปเดต ${selectedIds.length} งานแล้ว`, `Updated ${selectedIds.length} tasks`), 'success'); });
  };
  const bulkArray = (field: 'assigneeIds' | 'labelIds', value: string, add: boolean, th: string, en: string) => {
    void attempt(() => bulkUpdateWorkItems(project.id, 'tasks', selectedIds, (id) => {
      const current = byId.get(id)?.[field] || [];
      return { [field]: add ? [...new Set([...current, value])] : current.filter((item) => item !== value) };
    }, user, { type: 'task_bulk', th, en }), pick(locale, 'อัปเดตไม่สำเร็จ', 'Bulk update failed'));
  };
  const bulkDelete = async () => {
    const deletable = tasks.filter((task) => selection.has(task.id) && canDeleteItem(role, task.createdBy, user.uid)).map((task) => task.id);
    const skipped = selectedIds.length - deletable.length;
    if (!deletable.length) { toast(pick(locale, 'ไม่มีสิทธิ์ลบงานที่เลือก', 'You cannot delete the selected tasks'), 'error'); return; }
    if (!confirm(pick(locale, `ลบ ${deletable.length} งาน?`, `Delete ${deletable.length} tasks?`) + (skipped ? pick(locale, ` (ข้าม ${skipped} งานที่ไม่มีสิทธิ์)`, ` (${skipped} skipped — no permission)`) : ''))) return;
    const done = await attempt(() => deleteTasksAndUnlinkDocuments(project.id, deletable).then(() => true), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed'));
    if (done) { selection.clear(); toast(pick(locale, `ลบ ${deletable.length} งานแล้ว`, `Deleted ${deletable.length} tasks`), 'success'); }
  };

  const onCardClick = useCallback((event: MouseEvent, task: Task) => {
    if (readOnly) { setModal({ task }); return; }
    if (event.shiftKey) { event.preventDefault(); selection.range(task.id, ordered.map((item) => item.id)); return; }
    if (selectMode || event.ctrlKey || event.metaKey) { selection.toggle(task.id); return; }
    setModal({ task });
  }, [readOnly, selection, ordered, selectMode]);
  const filterLabel = useCallback((label: Label) => setParam('q', toggleQueryTerm(query, `label:${queryValue(label.name)}`)), [query, setParam]);

  // Drag & drop: the drop position comes from the pointer against the card midpoints.
  const onDragStart = useCallback((event: DragEvent, task: Task, lane: string) => {
    const ids = selection.has(task.id) ? ordered.filter((item) => selection.has(item.id)).map((item) => item.id) : [task.id];
    event.dataTransfer.setData('text/task', task.id);
    event.dataTransfer.effectAllowed = 'move';
    setTimeout(() => setDragging({ ids, lane }), 0);
  }, [selection, ordered]);
  const endDrag = useCallback(() => { setDragging(null); setDropTarget(null); }, []);
  const dragOver = (event: DragEvent<HTMLElement>, lane: string, status: TaskStatus) => {
    if (readOnly || !dragging) return;
    event.preventDefault();
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')];
    const found = cards.findIndex((card) => { const rect = card.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
    const index = found < 0 ? cards.length : found;
    if (dropTarget?.lane !== lane || dropTarget.status !== status || dropTarget.index !== index) setDropTarget({ lane, status, index });
  };
  const drop = (event: DragEvent, lane: Lane, status: TaskStatus, column: Task[]) => {
    event.preventDefault();
    const state = dragging;
    const index = dropTarget?.lane === lane.key && dropTarget.status === status ? dropTarget.index : column.length;
    endDrag();
    if (readOnly || !state) return;
    moveTasks(state.ids, status, { column, index, lane, fromLane: state.lane });
  };

  const toggleColumn = (status: TaskStatus) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(status)) next.delete(status); else next.add(status);
    try { localStorage.setItem(`board-collapsed:${project.id}`, JSON.stringify([...next])); } catch { /* storage unavailable */ }
    return next;
  });

  /** Field values a new task gets when it is created inside `lane`. */
  const laneDefaults = (lane: Lane): TaskDefaults => {
    if (groupBy === 'label') return lane.key === '__none' ? {} : { labelIds: [lane.key] };
    return lane.patch ? lane.patch({ assigneeIds: [] as string[] } as Task, '') as TaskDefaults : {};
  };

  const quickAdd = async (lane: Lane, status: TaskStatus) => {
    const title = draft.trim();
    if (!title) return;
    const defaults = laneDefaults(lane);
    const milestoneId = defaults.milestoneId ?? activeMilestone?.id ?? '';
    if (blockersFor(milestoneId) && !OPEN_WHILE_BLOCKED.includes(status)) { toast(pick(locale, 'Milestone ถูกล็อก: ใช้ได้เฉพาะสถานะ งานค้าง/ต้องทำ', 'Milestone is blocked: only Backlog / To do allowed'), 'error'); return; }
    const column = ordered.filter((task) => task.status === status);
    const data = { title, description: '', status, priority: defaults.priority || 'medium', assigneeIds: defaults.assigneeIds || [], tags: [], labelIds: defaults.labelIds || [], checklist: [], dueDate: '', milestoneId, order: ordersForDrop(column, column.length, ['new']).get('new')! };
    setDraft('');
    await attempt(() => createWorkItem(project.id, 'tasks', data, user, { type: 'task_created', th: `เพิ่มงาน “${title}”`, en: `created task “${title}”` }), pick(locale, 'เพิ่มงานไม่สำเร็จ', 'Could not add task'));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || modal || labelsOpen) return;
      if (event.key === '/') { event.preventDefault(); filterRef.current?.focus(); }
      else if ((event.key === 'n' || event.key === 'N') && !readOnly) { event.preventDefault(); setModal({ task: null, defaults: { milestoneId: activeMilestone?.id || '' } }); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [modal, labelsOpen, readOnly, activeMilestone?.id]);

  const scopeOptions = [{ id: '', label: pick(locale, 'ทั้งหมด', 'All tasks') }, ...milestones.map((m) => ({ id: m.id, label: `${blockedMilestoneIds.has(m.id) ? '🔒 ' : m.status === 'completed' ? '✓ ' : '◇ '}${m.title}` })), { id: 'none', label: pick(locale, 'ไม่มี milestone', 'No milestone') }];
  const groupLabels: Record<GroupBy, string> = { none: pick(locale, 'ไม่แบ่งกลุ่ม', 'No grouping'), assignee: pick(locale, 'ผู้รับผิดชอบ', 'Assignee'), milestone: 'Milestone', priority: pick(locale, 'ความสำคัญ', 'Priority'), label: 'Label' };
  const renderCard = (task: Task, lane: string) => <TaskCard key={task.id} task={task} members={members} labels={labels} locale={locale} selected={selection.has(task.id)} selectMode={selectMode || selection.selected.size > 0} comments={0}
    locked={blockersFor(task.milestoneId)} milestone={scope || groupBy === 'milestone' ? undefined : milestones.find((m) => m.id === task.milestoneId)} readOnly={readOnly} dragging={!!dragging?.ids.includes(task.id)}
    onClick={onCardClick} onToggle={selection.toggle} onMove={moveOne} onDragStart={(event, item) => onDragStart(event, item, lane)} onDragEnd={endDrag} onLabelClick={filterLabel} />;

  const renderColumns = (lane: Lane) => <div className="kanban">{TASK_COLUMNS.map((column) => {
    const columnTasks = lane.tasks.filter((task) => task.status === column.id);
    const locked = blockers.length > 0 && !OPEN_WHILE_BLOCKED.includes(column.id);
    const isCollapsed = collapsed.has(column.id);
    const limitKey = `${lane.key}:${column.id}`;
    const limit = limits[limitKey] || PAGE;
    const target = dropTarget?.lane === lane.key && dropTarget.status === column.id ? dropTarget.index : -1;
    const isAdding = adding?.lane === lane.key && adding.status === column.id;
    const cards: ReactNode[] = columnTasks.slice(0, limit).map((task) => renderCard(task, lane.key));
    if (target >= 0) cards.splice(Math.min(target, cards.length), 0, <div key="drop-indicator" className="drop-indicator" />);
    return <section key={column.id} className={`kanban-column ${locked ? 'locked' : ''} ${isCollapsed ? 'collapsed' : ''} ${target >= 0 ? 'drop-target' : ''} ${mobileStatus === column.id ? 'mobile-active' : ''}`}
      onDragOver={(e) => dragOver(e, lane.key, column.id)} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((current) => (current?.lane === lane.key && current.status === column.id ? null : current)); }}
      onDrop={(e) => drop(e, lane, column.id, columnTasks)}>
      <header><button type="button" className="column-toggle" onClick={() => toggleColumn(column.id)} title={isCollapsed ? pick(locale, 'ขยาย', 'Expand') : pick(locale, 'ย่อ', 'Collapse')}><i style={{ background: column.color }} />{locale === 'th' ? column.th : column.en}{locked && ' 🔒'}</button><b>{columnTasks.length}</b>
        {!readOnly && <button type="button" className="column-add" onClick={() => { setAdding({ lane: lane.key, status: column.id }); setDraft(''); }} title={context.t('addTask')}>＋</button>}</header>
      <div className="column-cards">{cards}
        {columnTasks.length > limit && <button type="button" className="show-more" onClick={() => setLimits({ ...limits, [limitKey]: limit + PAGE })}>{pick(locale, `แสดงเพิ่ม ${Math.min(PAGE, columnTasks.length - limit)} งาน`, `Show ${Math.min(PAGE, columnTasks.length - limit)} more`)} ({columnTasks.length - limit})</button>}
        {!readOnly && (isAdding
          ? <div className="quick-add"><textarea autoFocus rows={2} value={draft} maxLength={160} placeholder={pick(locale, 'ชื่องาน แล้วกด Enter', 'Task title, press Enter')} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void quickAdd(lane, column.id); } if (e.key === 'Escape') { e.stopPropagation(); setAdding(null); } }} onBlur={() => { if (!draft.trim()) setAdding(null); }} />
              <div><button type="button" className="primary" onMouseDown={(e) => e.preventDefault()} onClick={() => void quickAdd(lane, column.id)}>{pick(locale, 'เพิ่ม', 'Add')}</button>
                <button type="button" className="link-button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setModal({ task: null, defaults: { status: column.id, milestoneId: activeMilestone?.id || '', ...laneDefaults(lane) } }); setAdding(null); }}>{pick(locale, 'กรอกรายละเอียด…', 'More fields…')}</button>
                <button type="button" className="secondary" onClick={() => setAdding(null)}>×</button></div></div>
          : <button type="button" className="add-inline" onClick={() => { setAdding({ lane: lane.key, status: column.id }); setDraft(''); }}>＋ {context.t('addTask')}</button>)}
      </div>
    </section>;
  })}</div>;

  return <>
    <PageTitle eyebrow={activeMilestone ? `MILESTONE BOARD${activeMilestone.dueDate ? ` · ${formatDue(activeMilestone.dueDate, activeMilestone.dueTime, locale).toUpperCase()}` : ''}` : 'KANBAN BOARD'} title={activeMilestone ? activeMilestone.title : context.t('board')}
      description={activeMilestone ? (activeMilestone.description || pick(locale, 'บอร์ดงานของ milestone นี้', 'Tasks for this milestone')) : pick(locale, 'วางแผน มอบหมาย และติดตามงานของทีม', 'Plan, assign and track your team’s work')}
      action={<div className="action-row"><button className="secondary" onClick={() => setLabelsOpen(true)}>🏷 Labels</button>{!readOnly && <><button className={`secondary ${selectMode ? 'on' : ''}`} onClick={() => { setSelectMode(!selectMode); if (selectMode) selection.clear(); }}>☑ {pick(locale, 'เลือกหลายรายการ', 'Select')}</button><button className="primary" onClick={() => setModal({ task: null, defaults: { milestoneId: activeMilestone?.id || '' } })} title="N">＋ {context.t('addTask')}</button></>}</div>} />
    <div className="milestone-scope" role="tablist" aria-label="Milestone">{scopeOptions.map((option) => <button key={option.id || 'all'} role="tab" aria-selected={scope === option.id} className={scope === option.id ? 'active' : ''} onClick={() => { selection.clear(); setParam('m', option.id); }}>{option.label}</button>)}</div>
    {blockers.length > 0 && <div className="blocked-banner"><span>🔒</span><div><strong>{pick(locale, 'Milestone นี้ถูกล็อก', 'This milestone is blocked')}</strong><small>{pick(locale, 'รอให้เสร็จก่อน: ', 'Waiting on: ')}{blockers.map((item) => <button key={item.id} onClick={() => setParam('m', item.id)}>{item.title}</button>)} — {pick(locale, 'งานเริ่มได้เมื่อ milestone ก่อนหน้าเสร็จ', 'tasks can’t start until these are completed')}</small></div></div>}
    <div className="board-toolbar">
      <FilterBar ref={filterRef} value={query} onChange={(value) => setParam('q', value)} labels={labels} members={members} milestones={milestones} locale={locale} />
      <div className="view-controls">
        <Segmented<View> value={view} onChange={(value) => setParam('view', value === 'board' ? '' : value)} options={[{ id: 'board', label: <>▦ {pick(locale, 'บอร์ด', 'Board')}</> }, { id: 'table', label: <>☰ {pick(locale, 'ตาราง', 'Table')}</> }]} />
        <label className="group-select"><span>{pick(locale, 'จัดกลุ่ม', 'Group')}</span><select value={groupBy} onChange={(e) => setParam('group', e.target.value === 'none' ? '' : e.target.value)}>{GROUPS.map((group) => <option key={group} value={group}>{groupLabels[group]}</option>)}</select></label>
      </div>
    </div>
    {query && <p className="filter-summary">{pick(locale, `พบ ${filtered.length} จาก ${tasks.length} งาน`, `${filtered.length} of ${tasks.length} tasks`)} · <button type="button" className="link-button" onClick={() => setParam('q', '')}>{pick(locale, 'ล้างตัวกรอง', 'Clear filter')}</button></p>}
    {view === 'table'
      ? <TaskTable groups={lanes} members={members} labels={labels} milestones={milestones} locale={locale} selection={selection} readOnly={readOnly} onOpen={(task) => setModal({ task })} onRowClick={onCardClick}
          onStatus={moveOne} onPriority={(task, priority: Priority) => void attempt(() => bulkUpdateWorkItems(project.id, 'tasks', [task.id], { priority }), pick(locale, 'อัปเดตไม่สำเร็จ', 'Update failed'))} onLabelClick={filterLabel} />
      : <>
        <div className="mobile-status-tabs" role="tablist" aria-label={pick(locale, 'สถานะงาน', 'Task status')}>{TASK_COLUMNS.map((column) => {
          const count = ordered.filter((task) => task.status === column.id).length;
          return <button key={column.id} type="button" role="tab" aria-selected={mobileStatus === column.id} className={mobileStatus === column.id ? 'active' : ''} onClick={() => setMobileStatus(column.id)}><i style={{ background: column.color }} />{locale === 'th' ? column.th : column.en}<b>{count}</b></button>;
        })}</div>
        {groupBy === 'none' ? renderColumns(lanes[0]) : <div className="swimlanes">{lanes.map((lane) => {
          const isCollapsed = collapsedLanes.has(lane.key);
          return <section key={lane.key} className={`swimlane ${isCollapsed ? 'collapsed' : ''}`}>
            <header><button type="button" onClick={() => setCollapsedLanes((current) => { const next = new Set(current); if (next.has(lane.key)) next.delete(lane.key); else next.add(lane.key); return next; })}>{isCollapsed ? '▸' : '▾'} {lane.title}<b>{lane.tasks.length}</b></button></header>
            {!isCollapsed && renderColumns(lane)}
          </section>;
        })}</div>}
      </>}
    {hasMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดงานที่เสร็จแล้วเพิ่มเติม', 'Load more completed tasks')}</button></div>}
    {!readOnly && <BulkBar count={selection.selected.size} locale={locale} onClear={selection.clear}>
      <select value="" onChange={(e) => e.target.value && moveTasks(selectedIds, e.target.value as TaskStatus)} aria-label="Status"><option value="">{pick(locale, 'ย้ายไป…', 'Move to…')}</option>{TASK_COLUMNS.map((c) => <option key={c.id} value={c.id}>{locale === 'th' ? c.th : c.en}</option>)}</select>
      <select value="" onChange={(e) => e.target.value && bulkSet({ priority: e.target.value as Priority }, 'เปลี่ยนความสำคัญหลายงาน', 'changed priority on several tasks')} aria-label="Priority"><option value="">{pick(locale, 'ความสำคัญ…', 'Priority…')}</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
      <select value="" onChange={(e) => e.target.value && bulkSet({ milestoneId: e.target.value === '-' ? '' : e.target.value }, 'ย้าย milestone หลายงาน', 'moved several tasks to a milestone')} aria-label="Milestone"><option value="">Milestone…</option><option value="-">— {pick(locale, 'ไม่มี', 'None')}</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
      <select value="" onChange={(e) => { const [op, id] = e.target.value.split(':'); if (id) bulkArray('assigneeIds', id, op === 'add', `เปลี่ยนผู้รับผิดชอบ ${selectedIds.length} งาน`, `changed assignees on ${selectedIds.length} tasks`); }} aria-label="Assignee"><option value="">{pick(locale, 'ผู้รับผิดชอบ…', 'Assignee…')}</option><optgroup label={pick(locale, 'เพิ่ม', 'Add')}>{members.map((m) => <option key={m.id} value={`add:${m.userId}`}>＋ {m.displayName}</option>)}</optgroup><optgroup label={pick(locale, 'เอาออก', 'Remove')}>{members.map((m) => <option key={m.id} value={`remove:${m.userId}`}>− {m.displayName}</option>)}</optgroup></select>
      {labels.length > 0 && <select value="" onChange={(e) => { const [op, id] = e.target.value.split(':'); if (id) bulkArray('labelIds', id, op === 'add', `เปลี่ยน label ${selectedIds.length} งาน`, `changed labels on ${selectedIds.length} tasks`); }} aria-label="Label"><option value="">Label…</option><optgroup label={pick(locale, 'เพิ่ม', 'Add')}>{labels.map((l) => <option key={l.id} value={`add:${l.id}`}>＋ {l.name}</option>)}</optgroup><optgroup label={pick(locale, 'เอาออก', 'Remove')}>{labels.map((l) => <option key={l.id} value={`remove:${l.id}`}>− {l.name}</option>)}</optgroup></select>}
      <button type="button" className="danger ghost" onClick={() => void bulkDelete()}>{context.t('delete')}</button>
    </BulkBar>}
    {labelsOpen && <LabelManager labels={labels} tasks={tasks} projectId={project.id} context={context} role={role} readOnly={readOnly} onClose={() => setLabelsOpen(false)} onFilter={filterLabel} />}
    {modal && <TaskModal task={modal.task} defaults={modal.defaults} projectId={project.id} projectName={project.name} members={members} milestones={milestones} labels={labels} context={context} role={role} readOnly={readOnly} onClose={() => setModal(null)} />}
  </>;
}
