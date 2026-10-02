import { useEffect, useState } from 'react';
import type { Project, ProjectSummary } from '@/types';
import { computeProjectSummary, rebuildProjectSummary, subscribeProjectSummary, summaryNeedsRebuild } from '@/services/project-summary';
import { PROJECT_SUMMARY_VERSION } from '@/utils/project-summary';

const valid = (summary: ProjectSummary | null): summary is ProjectSummary => Boolean(summary && summary.version === PROJECT_SUMMARY_VERSION);

/**
 * The project's live summary. A missing, outdated or week-old one is rebuilt. Archived projects can't
 * write it (rules), so when theirs is missing or outdated it is computed in memory instead.
 */
export function useProjectSummary(project: Project): { summary: ProjectSummary | null; loaded: boolean; failed: boolean } {
  const [state, setState] = useState<{ projectId: string; summary: ProjectSummary | null; loaded: boolean; failed: boolean }>({ projectId: project.id, summary: null, loaded: false, failed: false });
  useEffect(() => {
    let active = true;
    let computing = false;
    setState({ projectId: project.id, summary: null, loaded: false, failed: false });
    const fail = () => { if (active) setState((current) => ({ ...current, loaded: true, failed: true })); };
    const stop = subscribeProjectSummary(project.id, (summary) => {
      if (!active) return;
      if (valid(summary)) setState({ projectId: project.id, summary, loaded: true, failed: false });
      if (!summaryNeedsRebuild(summary)) return;
      if (!project.archived) { void rebuildProjectSummary(project.id).catch(fail); return; }
      if (valid(summary) || computing) return;
      computing = true;
      void computeProjectSummary(project.id)
        .then((computed) => { if (active) setState({ projectId: project.id, summary: computed, loaded: true, failed: false }); })
        .catch(fail);
    }, fail);
    return () => { active = false; stop(); };
  }, [project.id, project.archived]);
  return state.projectId === project.id ? state : { summary: null, loaded: false, failed: false };
}
