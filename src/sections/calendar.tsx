import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { SectionProps } from '@/context/AppContext';
import { PageTitle } from '@/components/common';
import { FilterBar } from '@/components/board/FilterBar';
import { TaskModal, type TaskDefaults } from '@/components/board/TaskModal';
import { attempt } from '@/components/toast';
import { TASK_COLUMNS } from '@/config/constants';
import { useCalendarTasks, useProjectItems } from '@/hooks';
import { updateWorkItem } from '@/services';
import type { Label, Milestone, Task } from '@/types';
import { dueState, monthGrid, monthKey, parseMonthKey, toISODate } from '@/utils/calendar';
import { formatDate, pick } from '@/utils/formatters';
import { blockingMilestones } from '@/utils/milestone-deps';
import { matchTask, parseTaskQuery } from '@/utils/task-filter';

const MAX_CHIPS = 3;
const STATUS_COLOR = new Map(TASK_COLUMNS.map((column) => [column.id, column.color]));
type Item = { kind: 'task'; task: Task } | { kind: 'milestone'; milestone: Milestone };
const itemKey = (item: Item) => (item.kind === 'task' ? `task:${item.task.id}` : `milestone:${item.milestone.id}`);

export function Calendar({ context, project, members, role, readOnly }: SectionProps) {
  const milestones = useProjectItems<Milestone>(project.id, 'milestones');
  const labels = useProjectItems<Label>(project.id, 'labels');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { locale, user } = context;
  const { year, month } = parseMonthKey(params.get('month'));
  const monthStart = toISODate(new Date(year, month, 1));
  const monthEnd = toISODate(new Date(year, month + 1, 1));
  const tasks = useCalendarTasks(project.id, monthStart, monthEnd);
  const query = params.get('q') || '';
  const [showDone, setShowDone] = useState(true);
  const [expanded, setExpanded] = useState('');
  const [overDay, setOverDay] = useState('');
  const [modal, setModal] = useState<{ task: Task | null; defaults?: TaskDefaults } | null>(null);
  const today = toISODate(new Date());

  const setParam = (key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: key === 'q' });

  const visibleTasks = useMemo(() => {
    const blockedMilestoneIds = new Set(milestones.filter((m) => blockingMilestones(m, milestones).length).map((m) => m.id));
    const parsed = parseTaskQuery(query);
    return tasks.filter((task) => (showDone || task.status !== 'done') && matchTask(task, parsed, { userId: user.uid, labels, members, milestones, blockedMilestoneIds }));
  }, [tasks, milestones, labels, members, query, showDone, user.uid]);
  const visibleMilestones = milestones.filter((m) => showDone || m.status !== 'completed');

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const add = (day: string, item: Item) => map.set(day, [...(map.get(day) || []), item]);
    visibleMilestones.filter((m) => m.dueDate).forEach((milestone) => add(milestone.dueDate, { kind: 'milestone', milestone }));
    [...visibleTasks].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') || a.order - b.order).filter((task) => task.dueDate).forEach((task) => add(task.dueDate, { kind: 'task', task }));
    return map;
  }, [visibleTasks, visibleMilestones]);
  const unscheduled: Item[] = [
    ...visibleMilestones.filter((m) => !m.dueDate).map((milestone) => ({ kind: 'milestone' as const, milestone })),
    ...visibleTasks.filter((task) => !task.dueDate && task.status !== 'done').sort((a, b) => a.order - b.order).map((task) => ({ kind: 'task' as const, task })),
  ];
  const grid = monthGrid(year, month);
  const monthDays = grid.filter((day) => day.getMonth() === month);
  const overdueCount = visibleTasks.filter((task) => task.status !== 'done' && dueState(task.dueDate, undefined, undefined, task.dueTime) === 'overdue').length;
  const weekdays = grid.slice(0, 7).map((day) => day.toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { weekday: 'short' }));
  const title = new Date(year, month, 1).toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { month: 'long', year: 'numeric' });

  /** Moves a task or milestone to `day` ('' clears the date). */
  const reschedule = (key: string, day: string) => {
    const [kind, id] = key.split(':');
    if (kind === 'task') {
      const task = tasks.find((item) => item.id === id);
      if (!task || task.dueDate === day) return;
      void attempt(() => updateWorkItem(project.id, 'tasks', id, day ? { dueDate: day } : { dueDate: '', dueTime: '' }, user, day
        ? { type: 'task_rescheduled', th: `เลื่อนกำหนด “${task.title}” เป็น ${formatDate(day, 'th')}`, en: `rescheduled “${task.title}” to ${formatDate(day, 'en')}` }
        : { type: 'task_rescheduled', th: `ยกเลิกวันกำหนดของ “${task.title}”`, en: `cleared the due date of “${task.title}”` }), pick(locale, 'เลื่อนกำหนดไม่สำเร็จ', 'Could not reschedule'));
    } else if (kind === 'milestone') {
      const milestone = milestones.find((item) => item.id === id);
      if (!milestone || milestone.dueDate === day) return;
      void attempt(() => updateWorkItem(project.id, 'milestones', id, day ? { dueDate: day } : { dueDate: '', dueTime: '' }), pick(locale, 'เลื่อนกำหนดไม่สำเร็จ', 'Could not reschedule'));
    }
  };
  const dropProps = (day: string, marker = day) => readOnly ? {} : {
    onDragOver: (event: DragEvent) => { if (!event.dataTransfer.types.includes('text/calendar-item')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (overDay !== marker) setOverDay(marker); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOverDay((current) => (current === marker ? '' : current)); },
    onDrop: (event: DragEvent) => { event.preventDefault(); setOverDay(''); const key = event.dataTransfer.getData('text/calendar-item'); if (key) reschedule(key, day); },
  };

  const chip = (item: Item): ReactNode => {
    const drag = readOnly ? {} : { draggable: true, onDragStart: (event: DragEvent) => { event.dataTransfer.setData('text/calendar-item', itemKey(item)); event.dataTransfer.effectAllowed = 'move'; event.stopPropagation(); } };
    if (item.kind === 'milestone') {
      const { milestone } = item;
      return <button key={itemKey(item)} type="button" className={`cal-chip milestone ${milestone.status === 'completed' ? 'done' : ''}`} {...drag} onClick={(e) => { e.stopPropagation(); navigate(`/p/${project.id}/board?m=${milestone.id}`); }} title={milestone.title}>◇ {milestone.dueTime && <small className="cal-time">{milestone.dueTime}</small>}{milestone.title}</button>;
    }
    const { task } = item;
    const state = task.status === 'done' ? 'done' : dueState(task.dueDate, undefined, undefined, task.dueTime);
    return <button key={itemKey(item)} type="button" className={`cal-chip task ${state} ${task.status === 'done' ? 'done' : ''}`} style={{ borderLeftColor: STATUS_COLOR.get(task.status) }} {...drag}
      onClick={(e) => { e.stopPropagation(); setModal({ task }); }} title={`${task.title} · ${task.priority}`}><i className={`dot ${task.priority}`} />{task.dueTime && <small className="cal-time">{task.dueTime}</small>}{task.title}</button>;
  };
  const openNew = (day: string) => { if (!readOnly) setModal({ task: null, defaults: { dueDate: day } }); };

  return <>
    <PageTitle eyebrow="PROJECT CALENDAR" title={context.t('calendar')} description={pick(locale, 'ดูกำหนดส่งของงานและ milestone ลากเพื่อเลื่อนวัน หรือคลิกวันเพื่อเพิ่มงาน', 'See task and milestone due dates. Drag to reschedule, click a day to add a task')}
      action={<div className="action-row cal-nav">
        <button className="secondary" onClick={() => setParam('month', monthKey(year, month - 1))} aria-label={pick(locale, 'เดือนก่อน', 'Previous month')}>‹</button>
        <button className="secondary" onClick={() => setParam('month', '')}>{pick(locale, 'วันนี้', 'Today')}</button>
        <button className="secondary" onClick={() => setParam('month', monthKey(year, month + 1))} aria-label={pick(locale, 'เดือนถัดไป', 'Next month')}>›</button>
      </div>} />
    <div className="board-toolbar">
      <FilterBar value={query} onChange={(value) => setParam('q', value)} labels={labels} members={members} milestones={milestones} locale={locale} />
      <label className="toggle"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {pick(locale, 'แสดงที่เสร็จแล้ว', 'Show completed')}</label>
    </div>
    <div className="calendar-layout">
      <section className="calendar-main">
        <header className="calendar-head"><h2>{title}</h2>{overdueCount > 0 && <span className="cal-overdue">! {overdueCount} {pick(locale, 'งานเกินกำหนด', 'overdue')}</span>}</header>
        <div className="calendar-grid" role="grid">
          {weekdays.map((name) => <div key={name} className="cal-weekday" role="columnheader">{name}</div>)}
          {grid.map((date) => {
            const day = toISODate(date);
            const items = byDay.get(day) || [];
            const open = expanded === day;
            const shown = open ? items : items.slice(0, MAX_CHIPS);
            return <div key={day} role="gridcell" className={`cal-day ${date.getMonth() !== month ? 'outside' : ''} ${day === today ? 'today' : ''} ${day < today ? 'past' : ''} ${overDay === day ? 'drop-target' : ''} ${open ? 'expanded' : ''}`}
              onClick={() => openNew(day)} {...dropProps(day)}>
              <span className="cal-date">{date.getDate()}</span>
              <div className="cal-items">{shown.map(chip)}
                {items.length > MAX_CHIPS && <button type="button" className="cal-more" onClick={(e) => { e.stopPropagation(); setExpanded(open ? '' : day); }}>{open ? pick(locale, 'ย่อ', 'Less') : `+${items.length - MAX_CHIPS} ${pick(locale, 'เพิ่มเติม', 'more')}`}</button>}
              </div>
            </div>;
          })}
        </div>
        <div className="calendar-agenda">{monthDays.map((date) => {
          const day = toISODate(date);
          const items = byDay.get(day) || [];
          if (!items.length && day !== today) return null;
          return <div key={day} className={`agenda-day ${day === today ? 'today' : ''}`}>
            <header><b>{date.getDate()}</b><span>{date.toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { weekday: 'long' })}</span>{!readOnly && <button type="button" onClick={() => openNew(day)} aria-label={context.t('addTask')}>＋</button>}</header>
            <div className="cal-items">{items.map(chip)}{!items.length && <small className="muted">{pick(locale, 'ไม่มีกำหนดส่ง', 'Nothing due')}</small>}</div>
          </div>;
        })}{!monthDays.some((date) => byDay.has(toISODate(date))) && <p className="muted">{pick(locale, 'ไม่มีกำหนดส่งในเดือนนี้', 'Nothing due this month')}</p>}</div>
      </section>
      <aside className={`calendar-tray ${overDay === '__tray' ? 'drop-target' : ''}`} {...dropProps('', '__tray')}>
        <header><strong>{pick(locale, 'ยังไม่กำหนดวัน', 'Unscheduled')}</strong><b>{unscheduled.length}</b></header>
        <small className="muted">{readOnly ? pick(locale, 'งานและ milestone ที่ยังไม่มีวันครบกำหนด', 'Tasks and milestones without a due date') : pick(locale, 'ลากลงปฏิทินเพื่อกำหนดวัน หรือลากกลับมาเพื่อล้างวัน', 'Drag onto a day to schedule, or back here to clear the date')}</small>
        <div className="cal-items">{unscheduled.map(chip)}{!unscheduled.length && <p className="muted">{pick(locale, 'ทุกอย่างมีกำหนดแล้ว 🎉', 'Everything is scheduled 🎉')}</p>}</div>
      </aside>
    </div>
    {modal && <TaskModal task={modal.task} defaults={modal.defaults} projectId={project.id} projectName={project.name} members={members} milestones={milestones} labels={labels} context={context} role={role} readOnly={readOnly} onClose={() => setModal(null)} />}
  </>;
}
