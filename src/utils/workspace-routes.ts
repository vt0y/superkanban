/** Top-level pages of a project workspace (`/p/:projectId/<section>`). */
export const WORKSPACE_SECTIONS = ['overview', 'tasks', 'plan', 'notes', 'docs', 'team', 'votes', 'gacha', 'settings'] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const TASK_VIEWS = ['board', 'table', 'calendar'] as const;
export const PLAN_VIEWS = ['milestones', 'usecases', 'diagrams'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
export type PlanView = (typeof PLAN_VIEWS)[number];

export const isWorkspaceSection = (value: string): value is WorkspaceSection => (WORKSPACE_SECTIONS as readonly string[]).includes(value);

/** Reads `?view=` against the allowed views, falling back to the first (default) one. */
export function viewParam<T extends string>(value: string | null, views: readonly T[]): T {
  return views.includes(value as T) ? (value as T) : views[0];
}

const withSearch = (path: string, params: URLSearchParams) => {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};

/**
 * Where an old or unknown workspace URL now lives, relative to `/p/:projectId/` (query string kept,
 * including `?task=`). Returns null when the URL is already canonical.
 */
export function legacySectionRedirect(section: string | undefined, search: string, documentId?: string): string | null {
  const params = new URLSearchParams(search);
  if (documentId) {
    if (section === 'docs') return null;
    if (section === 'documents' || section === 'notes') {
      params.delete('tab');
      return withSearch(`docs/${documentId}`, params);
    }
    return 'overview';
  }
  switch (section) {
    case undefined:
    case '':
    case 'dashboard':
      return withSearch('overview', params);
    case 'board':
      if (params.get('view') !== 'table') params.delete('view');
      return withSearch('tasks', params);
    case 'calendar':
      params.set('view', 'calendar');
      return withSearch('tasks', params);
    case 'milestones':
      params.delete('view');
      return withSearch('plan', params);
    case 'design':
      params.set('view', params.get('view') === 'list' ? 'usecases' : 'diagrams');
      return withSearch('plan', params);
    case 'use-cases':
      params.set('view', 'usecases');
      return withSearch('plan', params);
    case 'notes':
      if (params.get('tab') !== 'documents') return null;
      params.delete('tab');
      return withSearch('docs', params);
    case 'docs':
      // Notes briefly lived at /docs?view=notes.
      if (params.get('view') !== 'notes') return null;
      params.delete('view');
      return withSearch('notes', params);
    case 'documents':
      return withSearch('docs', params);
    default:
      return isWorkspaceSection(section) ? null : 'overview';
  }
}
