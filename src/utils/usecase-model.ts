import type { DiagramEdge, DiagramEdgeKind, DiagramNodeKind } from '@/types';

export type UseCaseKind = 'base' | 'common' | 'extension';

type EdgeLike = Pick<DiagramEdge, 'from' | 'to' | 'kind'>;

/**
 * Derived UML role of a use case:
 * - common: target of an «include» (shared behaviour reused by other use cases)
 * - extension: source of an «extend» (optional behaviour added to a base use case)
 * - base: everything else
 */
export function classifyUseCase(nodeId: string, edges: EdgeLike[]): UseCaseKind {
  if (edges.some((edge) => edge.kind === 'include' && edge.to === nodeId)) return 'common';
  if (edges.some((edge) => edge.kind === 'extend' && edge.from === nodeId)) return 'extension';
  return 'base';
}

export function validEdge(from: DiagramNodeKind, to: DiagramNodeKind, kind: DiagramEdgeKind): boolean {
  if (from === 'boundary' || to === 'boundary' || from === 'note' || to === 'note') return false;
  if (kind === 'association') return (from === 'actor' && to === 'usecase') || (from === 'usecase' && to === 'actor');
  if (kind === 'include' || kind === 'extend') return from === 'usecase' && to === 'usecase';
  return from === to;
}

export function nextUseCaseCode(existing: string[]): string {
  const max = existing.reduce((highest, code) => {
    const match = /^UC-(\d+)$/i.exec(code.trim());
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `UC-${String(max + 1).padStart(2, '0')}`;
}

export const NODE_DEFAULTS: Record<DiagramNodeKind, { w: number; h: number; label: string }> = {
  actor: { w: 60, h: 110, label: 'Actor' },
  usecase: { w: 190, h: 76, label: 'New use case' },
  boundary: { w: 460, h: 380, label: 'System' },
  note: { w: 170, h: 90, label: 'Note' },
};

export interface Box { x: number; y: number; w: number; h: number }

/** Point where the segment from the box centre toward (tx, ty) leaves the shape. */
export function clipToShape(box: Box, kind: DiagramNodeKind, tx: number, ty: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  if (kind === 'usecase') {
    const a = box.w / 2;
    const b = box.h / 2;
    const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
    return { x: cx + dx * t, y: cy + dy * t };
  }
  const t = Math.min(Math.abs((box.w / 2) / (dx || 1e-9)), Math.abs((box.h / 2) / (dy || 1e-9)));
  return { x: cx + dx * t, y: cy + dy * t };
}
