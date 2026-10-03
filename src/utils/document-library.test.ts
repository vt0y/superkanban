import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { ProjectDocument } from '@/types';
import { documentGroup, groupDocuments, latestDocumentGroup, sortDocuments } from './document-library';
import { DRIVE_FOLDER_MIME_TYPE } from '@/services/google-drive';

const item = (id: string, patch: Partial<ProjectDocument> = {}) => ({ id, title: id, createdBy: 'u', updatedAt: Timestamp.fromMillis(1), ...patch }) as ProjectDocument;

describe('document library helpers', () => {
  it('classifies all four visible groups and hides empties naturally', () => {
    const docs = [item('md'), item('folder', { kind: 'drive', driveFileId: 'f', name: 'Folder', mimeType: DRIVE_FOLDER_MIME_TYPE, shareMode: 'unmanaged', sharedMemberIds: [] }), item('file', { kind: 'drive', driveFileId: 'x', name: 'File', mimeType: 'application/pdf', shareMode: 'unmanaged', sharedMemberIds: [] }), item('canva', { kind: 'canva', canvaDesignId: 'DAGdesign1' })];
    expect(docs.map(documentGroup)).toEqual(['markdown', 'folder', 'drive', 'canva']);
    expect(Object.values(groupDocuments(docs)).map((group) => group.length)).toEqual([1, 1, 1, 1]);
  });

  it('finds the newest group and sorts loaded records by date or display name', () => {
    const older = item('z', { title: 'Zulu', updatedAt: Timestamp.fromMillis(1) });
    const newer = item('a', { title: 'Alpha', updatedAt: Timestamp.fromMillis(2) });
    expect(latestDocumentGroup(groupDocuments([older, newer]))).toBe('markdown');
    expect(sortDocuments([older, newer], 'updated').map((entry) => entry.id)).toEqual(['a', 'z']);
    expect(sortDocuments([older, newer], 'name').map((entry) => entry.id)).toEqual(['a', 'z']);
  });
});
