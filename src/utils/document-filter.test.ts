import { describe, expect, it } from 'vitest';
import type { Label, Milestone, ProjectDocument, Task } from '@/types';
import { matchDocument, parseDocumentQuery, tokenizeDocumentQuery } from './document-filter';

const labels = [
  { id: 'design', name: 'UI Design', color: '#6366f1' },
  { id: 'draft', name: 'Draft', color: '#f59e0b' },
] as Label[];
const document = (values: Partial<ProjectDocument> = {}): ProjectDocument => ({
  id: 'doc-1', title: 'Mobile navigation', excerpt: 'Interaction notes', labelIds: [], createdBy: 'u1', ...values,
} as ProjectDocument);
const tasks = [{ id: 'task-1', title: 'Mobile polish', status: 'todo' }, { id: 'task-2', title: 'Release', status: 'done' }] as Task[];
const milestones = [{ id: 'milestone-1', title: 'Public launch', status: 'active' }] as Milestone[];

describe('document-filter', () => {
  it('parses text, quoted labels and negation', () => {
    expect(parseDocumentQuery('mobile label:"UI Design" -label:Draft')).toEqual({
      text: ['mobile'],
      terms: [
        { key: 'label', value: 'ui design', negated: false },
        { key: 'label', value: 'draft', negated: true },
      ],
    });
    expect(tokenizeDocumentQuery('label:"UI Design" no:label')).toEqual(['label:"UI Design"', 'no:label']);
  });

  it('matches document text and labels', () => {
    expect(matchDocument(document({ labelIds: ['design'] }), parseDocumentQuery('navigation label:"UI Design"'), labels)).toBe(true);
    expect(matchDocument(document({ labelIds: ['design', 'draft'] }), parseDocumentQuery('-label:draft'), labels)).toBe(false);
    expect(matchDocument(document(), parseDocumentQuery('no:label interaction'), labels)).toBe(true);
    expect(matchDocument(document({ labelIds: ['design'] }), parseDocumentQuery('no:label'), labels)).toBe(false);
  });

  it('matches task links and project-local Drive metadata', () => {
    const drive = document({ kind: 'drive', title: 'spec.pdf', name: 'spec.pdf', nickname: 'Launch brief', description: 'Final client handoff', driveFileId: 'file-1', mimeType: 'application/pdf', shareMode: 'link', sharedMemberIds: [], taskIds: ['task-1'] });
    expect(matchDocument(drive, parseDocumentQuery('launch task:"Mobile polish"'), labels, tasks)).toBe(true);
    expect(matchDocument(drive, parseDocumentQuery('handoff -task:Release'), labels, tasks)).toBe(true);
    expect(matchDocument(drive, parseDocumentQuery('no:task'), labels, tasks)).toBe(false);
    expect(matchDocument(document(), parseDocumentQuery('no:task'), labels, tasks)).toBe(true);
  });

  it('matches Canva nickname and description', () => {
    const canva = document({ kind: 'canva', title: 'Deck', canvaDesignId: 'DAGdeck0001', canvaEditToken: 'editTok1', nickname: 'Pitch v2', description: 'Investor round' });
    expect(matchDocument(canva, parseDocumentQuery('pitch'), labels)).toBe(true);
    expect(matchDocument(canva, parseDocumentQuery('investor deck'), labels)).toBe(true);
    expect(matchDocument(canva, parseDocumentQuery('canva'), labels)).toBe(true);
    expect(matchDocument(canva, parseDocumentQuery('spreadsheet'), labels)).toBe(false);
  });

  it('matches milestone links, missing links, negation, and milestone title text', () => {
    const linked = document({ milestoneIds: ['milestone-1'] });
    expect(matchDocument(linked, parseDocumentQuery('milestone:"Public launch"'), labels, tasks, milestones)).toBe(true);
    expect(matchDocument(linked, parseDocumentQuery('-milestone:"Public launch"'), labels, tasks, milestones)).toBe(false);
    expect(matchDocument(linked, parseDocumentQuery('public'), labels, tasks, milestones)).toBe(true);
    expect(matchDocument(document(), parseDocumentQuery('no:milestone'), labels, tasks, milestones)).toBe(true);
  });
});
