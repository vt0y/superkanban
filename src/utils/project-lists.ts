import type { Project } from '@/types';

export function partitionProjects(projects: Project[]): { active: Project[]; archived: Project[] } {
  return projects.reduce<{ active: Project[]; archived: Project[] }>((groups, project) => {
    groups[project.archived ? 'archived' : 'active'].push(project);
    return groups;
  }, { active: [], archived: [] });
}
