import { useEffect, useMemo, useState } from 'react';
import { getTaskCounts, subscribeActiveTasks } from '@/services/tasks';
import { subscribeProjectCollection } from '@/services/work-items';
import type { Milestone, Project, Task } from '@/types';
import type { ProjectWork } from '@/utils/home-summary';

interface ProjectState { tasks?: Task[]; milestones?: Milestone[]; counts?: { total: number; done: number }; failed?: boolean }

/**
 * Open tasks, milestones and done/total counts for each project, live. Reuses the same shared queries
 * as Overview and the board, so opening a project right after Home costs no extra reads.
 */
export function useHomeSummary(projects: Project[]): ProjectWork[] {
  const [state, setState] = useState<Record<string, ProjectState>>({});
  const ids = projects.map((project) => project.id).sort().join(',');

  useEffect(() => {
    const stops = (ids ? ids.split(',') : []).map((id) => {
      let live = true;
      const patch = (values: ProjectState) => { if (live) setState((current) => ({ ...current, [id]: { ...current[id], ...values } })); };
      const failed = () => patch({ failed: true });
      const stopTasks = subscribeActiveTasks(id, (tasks) => patch({ tasks }), undefined, failed);
      const stopMilestones = subscribeProjectCollection<Milestone>(id, 'milestones', (milestones) => patch({ milestones }), failed);
      void getTaskCounts(id).then((counts) => patch({ counts })).catch(() => undefined);
      return () => { live = false; stopTasks(); stopMilestones(); };
    });
    return () => stops.forEach((stop) => stop());
  }, [ids]);

  return useMemo(() => projects.map((project) => {
    const current = state[project.id] || {};
    return {
      project,
      tasks: current.tasks || [],
      milestones: current.milestones || [],
      counts: current.counts ?? null,
      loaded: Boolean(current.failed || (current.tasks && current.milestones)),
      failed: current.failed,
    };
  }), [projects, state]);
}
