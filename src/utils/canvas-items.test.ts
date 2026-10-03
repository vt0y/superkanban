import { describe, expect, it } from 'vitest';
import { documentCanvasId, findCanvasPositions, isLegacyOrTypedNote } from './canvas-items';

describe('canvas document helpers', () => {
  it('uses deterministic IDs and accepts legacy notes', () => {
    expect(documentCanvasId('drive_abc')).toBe('document_drive_abc');
    expect(isLegacyOrTypedNote({ id: 'old', content: '', color: '', x: 0, y: 0, taskId: '', pinned: false, createdBy: 'u' })).toBe(true);
    expect(isLegacyOrTypedNote({ id: 'card', kind: 'document', documentId: 'd', x: 0, y: 0, createdBy: 'u' })).toBe(false);
  });

  it('places multiple cards without colliding with existing items or each other', () => {
    const occupied = [{ x: -140, y: -90, w: 280, h: 180 }];
    const positions = findCanvasPositions(5, { x: 0, y: 0 }, occupied, { w: 280, h: 180 });
    expect(positions).toHaveLength(5);
    expect(new Set(positions.map((point) => `${point.x}:${point.y}`)).size).toBe(5);
    expect(positions).not.toContainEqual({ x: -140, y: -90 });
  });
});
