import { describe, expect, it } from 'vitest';
import type { Project } from '@/types';
import { partitionProjects } from './project-lists';

describe('project-lists', () => {
  it('splits active and archived projects', () => {
    const projects = [
      { id: '1', archived: false } as Project,
      { id: '2', archived: true } as Project,
      { id: '3', archived: false } as Project,
    ];
    const { active, archived } = partitionProjects(projects);
    expect(active.map((p) => p.id)).toEqual(['1', '3']);
    expect(archived.map((p) => p.id)).toEqual(['2']);
  });

  it('handles only active projects', () => {
    const projects = [{ id: '1', archived: false } as Project];
    const { active, archived } = partitionProjects(projects);
    expect(active.map((p) => p.id)).toEqual(['1']);
    expect(archived).toEqual([]);
  });

  it('handles only archived projects', () => {
    const projects = [{ id: '1', archived: true } as Project];
    const { active, archived } = partitionProjects(projects);
    expect(active).toEqual([]);
    expect(archived.map((p) => p.id)).toEqual(['1']);
  });

  it('handles empty lists', () => {
    expect(partitionProjects([])).toEqual({ active: [], archived: [] });
  });
});
