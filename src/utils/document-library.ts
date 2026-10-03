import type { ProjectDocument } from '@/types';
import { DRIVE_FOLDER_MIME_TYPE } from '@/services/google-drive';

export type DocumentGroup = 'folder' | 'markdown' | 'drive' | 'canva';
export type DocumentSort = 'updated' | 'name';

export const documentDisplayName = (item: ProjectDocument): string =>
  item.kind === 'drive' ? item.nickname?.trim() || item.name : item.kind === 'canva' ? item.nickname?.trim() || item.title : item.title;

export const documentGroup = (item: ProjectDocument): DocumentGroup =>
  item.kind === 'drive' ? (item.mimeType === DRIVE_FOLDER_MIME_TYPE ? 'folder' : 'drive') : item.kind === 'canva' ? 'canva' : 'markdown';

export function groupDocuments(items: ProjectDocument[]): Record<DocumentGroup, ProjectDocument[]> {
  const groups: Record<DocumentGroup, ProjectDocument[]> = { folder: [], markdown: [], drive: [], canva: [] };
  items.forEach((item) => groups[documentGroup(item)].push(item));
  return groups;
}

export function sortDocuments(items: ProjectDocument[], sort: DocumentSort): ProjectDocument[] {
  return [...items].sort(sort === 'name'
    ? (a, b) => documentDisplayName(a).localeCompare(documentDisplayName(b), undefined, { sensitivity: 'base', numeric: true })
    : (a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0) || documentDisplayName(a).localeCompare(documentDisplayName(b)));
}

export function latestDocumentGroup(groups: Record<DocumentGroup, ProjectDocument[]>): DocumentGroup | null {
  let result: DocumentGroup | null = null;
  let latest = -Infinity;
  (Object.keys(groups) as DocumentGroup[]).forEach((group) => {
    const timestamp = Math.max(...groups[group].map((item) => item.updatedAt?.toMillis() ?? 0));
    if (groups[group].length && timestamp > latest) { latest = timestamp; result = group; }
  });
  return result;
}
