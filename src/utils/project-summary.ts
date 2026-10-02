import type {
  Milestone,
  ProjectSummary,
  ProjectSummaryMilestone,
  ProjectSummaryTask,
  Task,
  TaskStatus,
} from '@/types';

export const PROJECT_SUMMARY_VERSION = 1 as const;
export const PROJECT_SUMMARY_TASK_LIMIT = 500;
export const OPEN_STATUSES = ['backlog', 'todo', 'in_progress', 'review'] as const;
type OpenStatus = (typeof OPEN_STATUSES)[number];

const emptyByStatus = (): Record<OpenStatus, number> => ({ backlog: 0, todo: 0, in_progress: 0, review: 0 });

export function emptyProjectSummary(): ProjectSummary {
  return {
    version: PROJECT_SUMMARY_VERSION,
    openTasks: {},
    openCount: 0,
    openByStatus: emptyByStatus(),
    openByMilestone: {},
    truncated: false,
    milestones: {},
    doneTotal: 0,
    doneByMilestone: {},
  };
}

export function summaryTask(task: Pick<Task, 'title' | 'status' | 'priority' | 'dueDate' | 'dueTime' | 'assigneeIds' | 'milestoneId'>): ProjectSummaryTask | null {
  if (task.status === 'done') return null;
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate || '',
    dueTime: task.dueTime || '',
    assigneeIds: [...(task.assigneeIds || [])],
    milestoneId: task.milestoneId || '',
  };
}

export function summaryMilestone(item: Pick<Milestone, 'title' | 'dueDate' | 'dueTime' | 'status' | 'dependsOn'>): ProjectSummaryMilestone {
  return {
    title: item.title,
    dueDate: item.dueDate || '',
    dueTime: item.dueTime || '',
    status: item.status,
    dependsOn: [...(item.dependsOn || [])],
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const taskAffectsSummary = (before: Task | null, after: Task | null) => !same(before && summaryTask(before), after && summaryTask(after)) || (before?.status === 'done') !== (after?.status === 'done') || (before?.status === 'done' && after?.status === 'done' && before.milestoneId !== after.milestoneId);
export const milestoneAffectsSummary = (before: Milestone | null, after: Milestone | null) => !same(before && summaryMilestone(before), after && summaryMilestone(after));

function rankTask([id, task]: [string, ProjectSummaryTask]): string {
  return `${task.dueDate || '9999-99-99'}T${task.dueTime || '99:99'}\u0000${id}`;
}

function trimTasks(summary: ProjectSummary) {
  const entries = Object.entries(summary.openTasks).sort((a, b) => rankTask(a).localeCompare(rankTask(b)));
  summary.openTasks = Object.fromEntries(entries.slice(0, PROJECT_SUMMARY_TASK_LIMIT));
  summary.truncated = summary.openCount > Object.keys(summary.openTasks).length;
}

/** Apply exact before/after task transitions to a cloned summary. */
export function applyTaskChanges(base: ProjectSummary, changes: Array<{ before: Task | null; after: Task | null }>): ProjectSummary {
  const next: ProjectSummary = {
    ...base,
    openTasks: { ...base.openTasks },
    openByStatus: { ...base.openByStatus },
    openByMilestone: { ...base.openByMilestone },
    doneByMilestone: { ...base.doneByMilestone },
    milestones: { ...base.milestones },
  };
  changes.forEach(({ before, after }) => {
    if (before && before.status !== 'done') {
      next.openCount = Math.max(0, next.openCount - 1);
      next.openByStatus[before.status] = Math.max(0, (next.openByStatus[before.status] || 0) - 1);
      if (before.milestoneId) next.openByMilestone[before.milestoneId] = Math.max(0, (next.openByMilestone[before.milestoneId] || 0) - 1);
      delete next.openTasks[before.id];
    } else if (before?.status === 'done') {
      next.doneTotal = Math.max(0, next.doneTotal - 1);
      if (before.milestoneId) next.doneByMilestone[before.milestoneId] = Math.max(0, (next.doneByMilestone[before.milestoneId] || 0) - 1);
    }
    if (after && after.status !== 'done') {
      next.openCount += 1;
      next.openByStatus[after.status] = (next.openByStatus[after.status] || 0) + 1;
      if (after.milestoneId) next.openByMilestone[after.milestoneId] = (next.openByMilestone[after.milestoneId] || 0) + 1;
      const compact = summaryTask(after);
      if (compact) next.openTasks[after.id] = compact;
    } else if (after?.status === 'done') {
      next.doneTotal += 1;
      if (after.milestoneId) next.doneByMilestone[after.milestoneId] = (next.doneByMilestone[after.milestoneId] || 0) + 1;
    }
  });
  trimTasks(next);
  return next;
}

export function applyMilestoneChanges(base: ProjectSummary, changes: Array<{ before: Milestone | null; after: Milestone | null }>): ProjectSummary {
  const next: ProjectSummary = { ...base, openTasks: { ...base.openTasks }, openByStatus: { ...base.openByStatus }, openByMilestone: { ...base.openByMilestone }, milestones: { ...base.milestones }, doneByMilestone: { ...base.doneByMilestone } };
  changes.forEach(({ before, after }) => {
    if (before) delete next.milestones[before.id];
    if (after) next.milestones[after.id] = summaryMilestone(after);
    if (before && !after) { delete next.doneByMilestone[before.id]; delete next.openByMilestone[before.id]; }
  });
  return next;
}

/**
 * Full summary from task and milestone documents. Pass `done` (from count aggregations) when `tasks`
 * holds only open tasks, so a rebuild doesn't have to download every completed task.
 */
export function buildProjectSummary(tasks: Task[], milestones: Milestone[], done?: { total: number; byMilestone: Record<string, number> }): ProjectSummary {
  const summary = emptyProjectSummary();
  summary.milestones = Object.fromEntries(milestones.map((item) => [item.id, summaryMilestone(item)]));
  if (done) {
    summary.doneTotal = done.total;
    summary.doneByMilestone = Object.fromEntries(Object.entries(done.byMilestone).filter(([id, count]) => summary.milestones[id] && count > 0));
  }
  tasks.forEach((task) => {
    if (task.status === 'done') {
      if (done) return;
      summary.doneTotal += 1;
      if (task.milestoneId && summary.milestones[task.milestoneId]) summary.doneByMilestone[task.milestoneId] = (summary.doneByMilestone[task.milestoneId] || 0) + 1;
      return;
    }
    summary.openCount += 1;
    summary.openByStatus[task.status] += 1;
    if (task.milestoneId && summary.milestones[task.milestoneId]) summary.openByMilestone[task.milestoneId] = (summary.openByMilestone[task.milestoneId] || 0) + 1;
    const compact = summaryTask(task);
    if (compact) summary.openTasks[task.id] = compact;
  });
  trimTasks(summary);
  return summary;
}

/**
 * Open tasks rebuilt from the summary. They lack description, checklist, labels and order, so they are
 * for display only: open them with `openTask(task.id)`, never by passing the object (the editor would
 * seed its form from these blanks and a save would wipe the real fields).
 */
export function summaryTasks(summary: ProjectSummary): Task[] {
  return Object.entries(summary.openTasks).map(([id, task]) => ({ id, ...task, description: '', tags: [], labelIds: [], checklist: [], order: 0, createdBy: '' }));
}

export function summaryMilestones(summary: ProjectSummary): Milestone[] {
  return Object.entries(summary.milestones).map(([id, item]) => ({ id, ...item, description: '', createdBy: '' }));
}

export function summaryCounts(summary: ProjectSummary) {
  return { total: summary.openCount + summary.doneTotal, done: summary.doneTotal, byStatus: { ...summary.openByStatus, done: summary.doneTotal } as Record<TaskStatus, number> };
}

export function summaryMilestoneCounts(summary: ProjectSummary, milestoneId: string) {
  const open = summary.openByMilestone[milestoneId] || 0;
  const done = summary.doneByMilestone[milestoneId] || 0;
  return { total: open + done, done };
}
