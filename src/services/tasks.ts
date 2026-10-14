import { measuredFirestore } from '@/services/firestore-diagnostics';
import {
  collection,
  doc,
  documentId,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Task, TaskStatus } from '@/types';
import { database, withId } from './helpers';
import { subscribeProjectQuery } from './work-items';

const { getDocs, onSnapshot } = measuredFirestore('tasks');

export const ACTIVE_TASK_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review'];
export const TASK_HISTORY_PAGE_SIZE = 50;
export const estimatedBoardInitialTaskReads = (activeCount: number, completedCount: number, doneLimit = TASK_HISTORY_PAGE_SIZE) =>
  activeCount + Math.min(completedCount, doneLimit);

export interface TaskScope { milestoneId?: string }
export interface TaskCursor { updatedAt: Timestamp; id: string }
export interface TaskPage {
  items: Task[];
  /** Opaque Firestore cursor; intentionally kept out of URLs and persistence. */
  nextCursor: TaskCursor | null;
  hasMore: boolean;
}

export function mergeTaskStreams(active: Task[], completed: Task[]): Task[] {
  const byId = new Map<string, Task>();
  [...active, ...completed].forEach((task) => byId.set(task.id, task));
  return [...byId.values()].sort((a, b) => {
    if (a.status !== 'done' && b.status === 'done') return -1;
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done') return a.order - b.order;
    return (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0) || a.id.localeCompare(b.id);
  });
}

function scopeConstraints(scope?: TaskScope): QueryConstraint[] {
  return scope?.milestoneId ? [where('milestoneId', '==', scope.milestoneId)] : [];
}

export function subscribeActiveTasks(
  projectId: string,
  callback: (tasks: Task[]) => void,
  scope?: TaskScope,
  onError?: (error: Error) => void,
): Unsubscribe {
  const constraints = [...scopeConstraints(scope), where('status', 'in', ACTIVE_TASK_STATUSES)];
  return subscribeProjectQuery(projectId, 'tasks', `active:${scope?.milestoneId || '*'}`, constraints, callback, onError);
}

/** One task, live; `null` once it is known not to exist (deleted, or a bad `?task=` link). */
export function subscribeTask(
  projectId: string,
  taskId: string,
  callback: (task: Task | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(doc(database(), 'projects', projectId, 'tasks', taskId), (snap) => callback(snap.exists() ? withId<Task>(snap) : null), onError);
}

export function subscribeRecentCompletedTasks(
  projectId: string,
  callback: (tasks: Task[]) => void,
  doneLimit = TASK_HISTORY_PAGE_SIZE,
  scope?: TaskScope,
): Unsubscribe {
  const constraints = [
    ...scopeConstraints(scope),
    where('status', '==', 'done'),
    orderBy('updatedAt', 'desc'),
    orderBy(documentId()),
    limit(doneLimit),
  ];
  return subscribeProjectQuery(projectId, 'tasks', `done:${scope?.milestoneId || '*'}:${doneLimit}`, constraints, callback);
}

export function subscribeBoardTaskStreams(
  projectId: string,
  callback: (active: Task[], done: Task[]) => void,
  options: TaskScope & { doneLimit?: number } = {},
): Unsubscribe {
  let active: Task[] = [];
  let done: Task[] = [];
  const emit = () => callback(active, done);
  const stopActive = subscribeActiveTasks(projectId, (items) => { active = items; emit(); }, options);
  const stopDone = subscribeRecentCompletedTasks(projectId, (items) => { done = items; emit(); }, options.doneLimit, options);
  return () => { stopActive(); stopDone(); };
}

export async function loadCompletedTasksPage(
  projectId: string,
  cursor: TaskCursor | null,
  pageSize = TASK_HISTORY_PAGE_SIZE,
  scope?: TaskScope,
): Promise<TaskPage> {
  const constraints: QueryConstraint[] = [
    ...scopeConstraints(scope),
    where('status', '==', 'done'),
    orderBy('updatedAt', 'desc'),
    orderBy(documentId()),
  ];
  if (cursor) constraints.push(startAfter(cursor.updatedAt, cursor.id));
  constraints.push(limit(pageSize + 1));
  const snapshot = await getDocs(query(collection(database(), 'projects', projectId, 'tasks'), ...constraints));
  const hasMore = snapshot.docs.length > pageSize;
  const pageDocs = snapshot.docs.slice(0, pageSize);
  return {
    items: pageDocs.map((item) => withId<Task>(item)),
    nextCursor: pageDocs.length ? {
      updatedAt: pageDocs.at(-1)!.get('updatedAt') as Timestamp,
      id: pageDocs.at(-1)!.id,
    } : null,
    hasMore,
  };
}

export function subscribeCalendarTasks(
  projectId: string,
  startDate: string,
  endDateExclusive: string,
  callback: (tasks: Task[]) => void,
): Unsubscribe {
  let dated: Task[] = [];
  let unscheduled: Task[] = [];
  const emit = () => callback(mergeTaskStreams([...dated, ...unscheduled].filter((task) => task.status !== 'done'), [...dated, ...unscheduled].filter((task) => task.status === 'done')));
  const datedQuery = query(collection(database(), 'projects', projectId, 'tasks'), where('dueDate', '>=', startDate), where('dueDate', '<', endDateExclusive), orderBy('dueDate'));
  const unscheduledQuery = query(collection(database(), 'projects', projectId, 'tasks'), where('dueDate', '==', ''), where('status', 'in', ACTIVE_TASK_STATUSES));
  const stopDated = onSnapshot(datedQuery, (snap) => { dated = snap.docs.map((item) => withId<Task>(item)); emit(); });
  const stopUnscheduled = onSnapshot(unscheduledQuery, (snap) => { unscheduled = snap.docs.map((item) => withId<Task>(item)); emit(); });
  return () => { stopDated(); stopUnscheduled(); };
}
