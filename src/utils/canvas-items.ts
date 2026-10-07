import type { CanvasItem, Role } from '@/types';
import { canDeleteItem } from './permissions';

export interface CanvasRect { x: number; y: number; w: number; h: number }

/** Legacy identifier only; new copies must use generated Firestore IDs. */
export const documentCanvasId = (documentId: string): string => `document_${documentId}`;

export const removableCanvasItems = (items: CanvasItem[], role: Role | null, userId: string): CanvasItem[] =>
  items.filter((item) => item.kind === 'document' || canDeleteItem(role, item.createdBy, userId));

export function documentCardCounts(items: CanvasItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) if (item.kind === 'document') counts.set(item.documentId, (counts.get(item.documentId) || 0) + 1);
  return counts;
}

const overlaps = (a: CanvasRect, b: CanvasRect, gap = 16) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** Finds deterministic free cells, growing out from the viewport centre row by row. */
export function findCanvasPositions(count: number, centre: { x: number; y: number }, occupied: CanvasRect[], size: { w: number; h: number }): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  const stepX = size.w + 28;
  const stepY = size.h + 28;
  for (let index = 0, attempts = 0; result.length < count && attempts < 10000; attempts += 1) {
    const ring = Math.floor(index / 9);
    const cell = index % 9;
    const column = (cell % 3) - 1;
    const row = Math.floor(cell / 3) - 1 + ring * 3;
    index += 1;
    const candidate = { x: centre.x - size.w / 2 + column * stepX, y: centre.y - size.h / 2 + row * stepY, w: size.w, h: size.h };
    if (![...occupied, ...result.map((point) => ({ ...point, ...size }))].some((rect) => overlaps(candidate, rect))) result.push({ x: candidate.x, y: candidate.y });
  }
  return result;
}

export const isLegacyOrTypedNote = (item: CanvasItem): boolean => item.kind === undefined || item.kind === 'note';
