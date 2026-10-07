import { describe, expect, it } from 'vitest';
import { documentCanvasId, documentCardCounts, findCanvasPositions, isLegacyOrTypedNote, removableCanvasItems } from './canvas-items';

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

  it('counts legacy and generated cards and permits removing copies without source ownership', () => {
    const items = [
      { id: 'my-note', createdBy: 'me' },
      { id: 'their-note', kind: 'note', createdBy: 'other' },
      { id: 'document_spec', kind: 'document', documentId: 'spec', createdBy: 'other' },
      { id: 'generated-copy', kind: 'document', documentId: 'spec', createdBy: 'me' },
    ] as never;
    expect(documentCardCounts(items).get('spec')).toBe(2);
    expect(removableCanvasItems(items, 'member', 'me').map((item) => item.id)).toEqual(['my-note', 'document_spec', 'generated-copy']);
    expect(removableCanvasItems(items, 'admin', 'me')).toHaveLength(4);
  });
});
