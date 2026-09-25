import type { Milestone } from '@/types';
import { compareDueDate } from './calendar';

type DepNode = Pick<Milestone, 'id' | 'status'> & { dependsOn?: string[] };
type MilestoneTask = { milestoneId: string; status: string };

export interface MilestoneCompletion {
  canComplete: boolean;
  blockingMilestones: DepNode[];
  incompleteTaskCount: number;
  taskCount: number;
}

/** Prerequisites of `milestone` that are not completed yet (unknown ids are ignored). */
export function blockingMilestones<T extends DepNode>(milestone: DepNode, all: T[]): T[] {
  const deps = new Set(milestone.dependsOn || []);
  return all.filter((item) => deps.has(item.id) && item.status !== 'completed');
}

export function isBlocked(milestone: DepNode, all: DepNode[]): boolean {
  return blockingMilestones(milestone, all).length > 0;
}

/** Completion is derived entirely from collections already loaded by the caller. */
export function milestoneCompletion(
  milestone: DepNode,
  all: DepNode[],
  tasks: MilestoneTask[],
): MilestoneCompletion {
  const dependencies = blockingMilestones(milestone, all);
  const relatedTasks = tasks.filter((task) => task.milestoneId === milestone.id);
  const incompleteTaskCount = relatedTasks.filter((task) => task.status !== 'done').length;
  return {
    canComplete: dependencies.length === 0 && incompleteTaskCount === 0,
    blockingMilestones: dependencies,
    incompleteTaskCount,
    taskCount: relatedTasks.length,
  };
}

/** True when giving `id` the prerequisites `deps` would create a dependency cycle. */
export function wouldCreateCycle(id: string, deps: string[], all: DepNode[]): boolean {
  const graph = new Map(all.map((item) => [item.id, item.dependsOn || []]));
  graph.set(id, deps);
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === id) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.get(current) || []));
  }
  return false;
}

/** Prerequisites first; ties broken by due date (undated last). Items inside a cycle fall back to due-date order. */
export function topoOrder<T extends DepNode & { dueDate: string; dueTime?: string }>(all: T[]): T[] {
  const byDate = [...all].sort((a, b) => compareDueDate(a.dueDate, b.dueDate, a.dueTime, b.dueTime));
  const ids = new Set(all.map((item) => item.id));
  const placed = new Set<string>();
  const result: T[] = [];
  while (result.length < byDate.length) {
    const next = byDate.find((item) => !placed.has(item.id) && (item.dependsOn || []).every((dep) => !ids.has(dep) || placed.has(dep)))
      || byDate.find((item) => !placed.has(item.id))!;
    placed.add(next.id);
    result.push(next);
  }
  return result;
}
