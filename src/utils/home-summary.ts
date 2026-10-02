import type { Milestone, Priority, Project, Task } from '@/types';
import { compareDueDate, dueDeadline, parseISODate, toISODate } from './calendar';

/** Everything Home knows about one active project: its open tasks, milestones and done/total counts. */
export interface ProjectWork {
  project: Project;
  /** Open (not done) tasks. */
  tasks: Task[];
  milestones: Milestone[];
  counts: { total: number; done: number } | null;
  /** Exact active count from the summary even when its detail list is capped. */
  openCount?: number;
  loaded: boolean;
  failed?: boolean;
}

export interface WorkItem { project: Project; task: Task }

export type Deadline =
  | { kind: 'task'; project: Project; task: Task; date: string; time: string; overdue: boolean }
  | { kind: 'milestone'; project: Project; milestone: Milestone; date: string; time: string; overdue: boolean };

export interface DeadlineDay { date: string; items: Deadline[] }

export const MY_WORK_BUCKETS = ['overdue', 'today', 'week', 'later', 'none'] as const;
export type MyWorkBucket = (typeof MY_WORK_BUCKETS)[number];

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const DAY = 86_400_000;

/** Whole days from `now`'s date to `date` (negative in the past). */
export function daysUntil(date: string, now: Date): number {
  return Math.round((parseISODate(date).getTime() - parseISODate(toISODate(now)).getTime()) / DAY);
}

const isOverdue = (date: string, time: string, now: Date) => Boolean(date) && dueDeadline(date, time) < now;
const isOpen = (task: Task) => task.status !== 'done';
const isMine = (task: Task, uid: string) => task.assigneeIds.includes(uid);

function compareTasks(a: Task, b: Task): number {
  return compareDueDate(a.dueDate, b.dueDate, a.dueTime, b.dueTime) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title);
}

/** Which "My work" group a task falls in. */
export function bucketFor(task: Pick<Task, 'dueDate' | 'dueTime'>, now: Date): MyWorkBucket {
  if (!task.dueDate) return 'none';
  if (isOverdue(task.dueDate, task.dueTime || '', now)) return 'overdue';
  const days = daysUntil(task.dueDate, now);
  if (days <= 0) return 'today';
  return days <= 7 ? 'week' : 'later';
}

/** My open tasks across projects, grouped by due date and sorted by date, time, then priority. */
export function bucketMyTasks(work: ProjectWork[], uid: string, now: Date): Record<MyWorkBucket, WorkItem[]> {
  const groups: Record<MyWorkBucket, WorkItem[]> = { overdue: [], today: [], week: [], later: [], none: [] };
  work.forEach(({ project, tasks }) => tasks.filter((task) => isOpen(task) && isMine(task, uid)).forEach((task) => groups[bucketFor(task, now)].push({ project, task })));
  MY_WORK_BUCKETS.forEach((bucket) => groups[bucket].sort((a, b) => compareTasks(a.task, b.task)));
  return groups;
}

export interface HomeTotals { active: number; overdue: number; dueWeek: number; mine: number; milestonesSoon: number }

/** Numbers for the Home summary tiles, across every project in `work`. */
export function summarize(work: ProjectWork[], uid: string, now: Date): HomeTotals {
  const totals: HomeTotals = { active: 0, overdue: 0, dueWeek: 0, mine: 0, milestonesSoon: 0 };
  work.forEach(({ tasks, milestones, openCount }) => {
    if (openCount !== undefined) totals.active += openCount - tasks.filter(isOpen).length;
    tasks.filter(isOpen).forEach((task) => {
      totals.active += 1;
      if (isMine(task, uid)) totals.mine += 1;
      if (!task.dueDate) return;
      if (isOverdue(task.dueDate, task.dueTime || '', now)) totals.overdue += 1;
      else if (daysUntil(task.dueDate, now) <= 7) totals.dueWeek += 1;
    });
    totals.milestonesSoon += milestones.filter((m) => m.status === 'active' && m.dueDate && daysUntil(m.dueDate, now) <= 14).length;
  });
  return totals;
}

export interface ProjectStats { active: number; overdue: number; progress: number | null; nextMilestone: Milestone | null }

/** Mini stats for a project card on Home. */
export function projectStats({ tasks, milestones, counts }: ProjectWork, now: Date): ProjectStats {
  const open = tasks.filter(isOpen);
  const nextMilestone = milestones
    .filter((m) => m.status === 'active' && m.dueDate)
    .sort((a, b) => compareDueDate(a.dueDate, b.dueDate, a.dueTime, b.dueTime))[0] ?? null;
  return {
    active: counts ? counts.total - counts.done : open.length,
    overdue: open.filter((task) => task.dueDate && isOverdue(task.dueDate, task.dueTime || '', now)).length,
    progress: counts && counts.total ? Math.round((counts.done / counts.total) * 100) : null,
    nextMilestone,
  };
}

/**
 * Open task and active milestone deadlines from now to `days` ahead, plus anything already overdue,
 * grouped by day (overdue items share the earliest groups). `mineUid` keeps only tasks assigned to that
 * user; milestones are shared by the whole team so they always stay.
 */
export function upcomingDeadlines(work: ProjectWork[], now: Date, { days = 14, mineUid }: { days?: number; mineUid?: string } = {}): DeadlineDay[] {
  const items: Deadline[] = [];
  work.forEach(({ project, tasks, milestones }) => {
    tasks.forEach((task) => {
      if (!isOpen(task) || !task.dueDate || daysUntil(task.dueDate, now) > days) return;
      if (mineUid && !isMine(task, mineUid)) return;
      items.push({ kind: 'task', project, task, date: task.dueDate, time: task.dueTime || '', overdue: isOverdue(task.dueDate, task.dueTime || '', now) });
    });
    milestones.forEach((milestone) => {
      if (milestone.status !== 'active' || !milestone.dueDate || daysUntil(milestone.dueDate, now) > days) return;
      items.push({ kind: 'milestone', project, milestone, date: milestone.dueDate, time: milestone.dueTime || '', overdue: isOverdue(milestone.dueDate, milestone.dueTime || '', now) });
    });
  });
  // Within a day, milestones (team-wide) come first, then tasks by time.
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'milestone' ? -1 : 1) || compareDueDate(a.date, b.date, a.time, b.time));
  const byDay = new Map<string, Deadline[]>();
  items.forEach((item) => byDay.set(item.date, [...(byDay.get(item.date) || []), item]));
  return [...byDay].map(([date, dayItems]) => ({ date, items: dayItems }));
}
