import type { CanvasItem } from '@/types';

export interface CanvasRect { x: number; y: number; w: number; h: number }

export const documentCanvasId = (documentId: string): string => `document_${documentId}`;

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
