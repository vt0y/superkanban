import { useEffect, useMemo, useState } from 'react';
import { rebuildProjectSummary, subscribeProjectSummary, summaryNeedsRebuild } from '@/services/project-summary';
import type { Project, ProjectSummary } from '@/types';
import type { ProjectWork } from '@/utils/home-summary';
import { summaryCounts, summaryMilestones, summaryTasks } from '@/utils/project-summary';

interface ProjectState { summary?: ProjectSummary; failed?: boolean }

/**
 * Home reads one compact live summary document per active project.
 */
export function useHomeSummary(projects: Project[]): ProjectWork[] {
  const [state, setState] = useState<Record<string, ProjectState>>({});
  const ids = projects.map((project) => project.id).sort().join(',');

  useEffect(() => {
    const stops = (ids ? ids.split(',') : []).map((id) => {
      let live = true;
      const patch = (values: ProjectState) => { if (live) setState((current) => ({ ...current, [id]: { ...current[id], ...values } })); };
      const project = projects.find((item) => item.id === id)!;
      const stop = subscribeProjectSummary(id, (summary) => {
        if (summary?.version === 1) patch({ summary, failed: false });
        if (!project.archived && summaryNeedsRebuild(summary)) void rebuildProjectSummary(id).catch(() => patch({ failed: true }));
      }, () => patch({ failed: true }));
      return () => { live = false; stop(); };
    });
    return () => stops.forEach((stop) => stop());
    // Project metadata does not affect subscriptions; ids is the stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return useMemo(() => projects.map((project) => {
    const current = state[project.id] || {};
    const summary = current.summary;
    return {
      project,
      tasks: summary ? summaryTasks(summary) : [],
      milestones: summary ? summaryMilestones(summary) : [],
      counts: summary ? summaryCounts(summary) : null,
      openCount: summary?.openCount,
      loaded: Boolean(current.failed || summary),
      failed: current.failed,
    };
  }), [projects, state]);
}
