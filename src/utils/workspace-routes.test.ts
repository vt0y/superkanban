import { describe, expect, it } from 'vitest';
import { legacySectionRedirect, viewParam, TASK_VIEWS } from './workspace-routes';

describe('legacySectionRedirect', () => {
  it.each([
    [undefined, '', undefined, 'overview'],
    ['dashboard', '?task=t1', undefined, 'overview?task=t1'],
    ['board', '?q=label%3Abug&m=m1', undefined, 'tasks?q=label%3Abug&m=m1'],
    ['board', '?view=table&group=assignee', undefined, 'tasks?view=table&group=assignee'],
    ['board', '?view=board', undefined, 'tasks'],
    ['calendar', '?month=2026-10', undefined, 'tasks?month=2026-10&view=calendar'],
    ['milestones', '', undefined, 'plan'],
    ['design', '?d=abc', undefined, 'plan?d=abc&view=diagrams'],
    ['design', '?view=diagram&d=abc', undefined, 'plan?view=diagrams&d=abc'],
    ['design', '?view=list', undefined, 'plan?view=usecases'],
    ['use-cases', '', undefined, 'plan?view=usecases'],
    ['docs', '?view=notes', undefined, 'notes'],
    ['notes', '?tab=documents&q=x', undefined, 'docs?q=x'],
    ['documents', '?labels=a', undefined, 'docs?labels=a'],
    ['documents', '', 'doc1', 'docs/doc1'],
    ['notes', '?tab=documents', 'doc1', 'docs/doc1'],
    ['board', '', 'doc1', 'overview'],
    ['nope', '?q=1', undefined, 'overview'],
  ])('%s%s (doc %s) → %s', (section, search, documentId, expected) => {
    expect(legacySectionRedirect(section, search, documentId)).toBe(expected);
  });

  it.each(['overview', 'tasks', 'plan', 'notes', 'docs', 'team', 'votes', 'gacha', 'settings'])('keeps canonical %s', (section) => {
    expect(legacySectionRedirect(section, '?view=x&task=1')).toBeNull();
  });

  it('keeps a canonical document reader', () => {
    expect(legacySectionRedirect('docs', '', 'doc1')).toBeNull();
  });
});

describe('viewParam', () => {
  it('falls back to the first view', () => {
    expect(viewParam('calendar', TASK_VIEWS)).toBe('calendar');
    expect(viewParam('bogus', TASK_VIEWS)).toBe('board');
    expect(viewParam(null, TASK_VIEWS)).toBe('board');
  });
});
