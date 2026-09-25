import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task } from '@/types';
import {
  getTaskCounts,
  loadCompletedTasksPage,
  mergeTaskStreams,
  subscribeActiveTasks,
  subscribeBoardTaskStreams,
  subscribeCalendarTasks,
  TASK_HISTORY_PAGE_SIZE,
  type TaskCounts,
  type TaskCursor,
  type TaskScope,
} from '@/services/tasks';

export function useActiveTasks(projectId: string, scope?: TaskScope): Task[] {
  const [items, setItems] = useState<Task[]>([]);
  const milestoneId = scope?.milestoneId;
  useEffect(() => {
    setItems([]);
    return subscribeActiveTasks(projectId, setItems, milestoneId ? { milestoneId } : undefined);
  }, [projectId, milestoneId]);
  return items;
}

export function useBoardTasks(
  projectId: string,
  options: TaskScope & { doneLimit?: number } = {},
): { items: Task[]; hasMore: boolean; loadingMore: boolean; loadMore: () => Promise<void> } {
  const doneLimit = options.doneLimit ?? TASK_HISTORY_PAGE_SIZE;
  const milestoneId = options.milestoneId;
  const [active, setActive] = useState<Task[]>([]);
  const [done, setDone] = useState<Task[]>([]);
  const [olderDone, setOlderDone] = useState<Task[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setActive([]); setDone([]); setOlderDone([]); setHasMore(true);
    return subscribeBoardTaskStreams(projectId, (nextActive, nextDone) => {
      setActive(nextActive); setDone(nextDone); setHasMore(nextDone.length >= doneLimit);
    }, { doneLimit, ...(milestoneId ? { milestoneId } : {}) });
  }, [projectId, milestoneId, doneLimit]);

  const cursor = useMemo<TaskCursor | null>(() => {
    const last = olderDone.at(-1) ?? done.at(-1);
    return last?.updatedAt ? { updatedAt: last.updatedAt, id: last.id } : null;
  }, [done, olderDone]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await loadCompletedTasksPage(projectId, cursor, doneLimit, milestoneId ? { milestoneId } : undefined);
      setOlderDone((current) => mergeTaskStreams([], [...current, ...page.items]));
      setHasMore(page.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, cursor, doneLimit, milestoneId, hasMore, loadingMore]);

  return { items: useMemo(() => mergeTaskStreams(active, [...done, ...olderDone]), [active, done, olderDone]), hasMore, loadingMore, loadMore };
}

export function useTaskCounts(projectId: string, milestoneId?: string): TaskCounts | null {
  const [counts, setCounts] = useState<TaskCounts | null>(null);
  useEffect(() => {
    let current = true;
    setCounts(null);
    void getTaskCounts(projectId, milestoneId).then((value) => { if (current) setCounts(value); });
    return () => { current = false; };
  }, [projectId, milestoneId]);
  return counts;
}

export function useMilestoneTaskCounts(projectId: string, milestoneIds: string[], refreshKey = ''): Record<string, TaskCounts> {
  const [counts, setCounts] = useState<Record<string, TaskCounts>>({});
  const idsKey = [...milestoneIds].sort().join(',');
  useEffect(() => {
    let current = true;
    void Promise.all((idsKey ? idsKey.split(',') : []).map(async (id) => [id, await getTaskCounts(projectId, id)] as const))
      .then((entries) => { if (current) setCounts(Object.fromEntries(entries)); });
    return () => { current = false; };
  }, [projectId, idsKey, refreshKey]);
  return counts;
}

export function useCalendarTasks(projectId: string, startDate: string, endDateExclusive: string): Task[] {
  const [items, setItems] = useState<Task[]>([]);
  useEffect(() => {
    setItems([]);
    return subscribeCalendarTasks(projectId, startDate, endDateExclusive, setItems);
  }, [projectId, startDate, endDateExclusive]);
  return items;
}
