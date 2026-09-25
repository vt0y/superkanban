import { describe, expect, it } from 'vitest';
import { clampZoom, fitRects, screenToWorld, zoomAt } from './canvas-math';

describe('canvas-math', () => {
  it('clamps zoom inside min/max bounds', () => {
    expect(clampZoom(0.01)).toBe(0.1);
    expect(clampZoom(10)).toBe(4);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it('transforms screen points to world coordinates', () => {
    const view = { x: 100, y: 50, zoom: 2 };
    expect(screenToWorld(view, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(screenToWorld(view, 200, 150)).toEqual({ x: 50, y: 50 });
  });

  it('keeps cursor anchor fixed while zooming', () => {
    const view = { x: 0, y: 0, zoom: 1 };
    const zoomed = zoomAt(view, 2, 100, 100);
    // At zoom 1, (100, 100) on screen was (100, 100) in world.
    // At zoom 2, world (100, 100) must still project to screen (100, 100).
    expect(zoomed.zoom).toBe(2);
    expect(screenToWorld(zoomed, 100, 100)).toEqual({ x: 100, y: 100 });
  });
});
