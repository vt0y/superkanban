export interface Viewport { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(view: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom };
}

/** Zoom to `nextZoom` while keeping the world point under screen point (sx, sy) fixed. */
export function zoomAt(view: Viewport, nextZoom: number, sx: number, sy: number): Viewport {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(view, sx, sy);
  return { zoom, x: sx - world.x * zoom, y: sy - world.y * zoom };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Viewport that fits every rect inside a screen of width × height, with padding. */
export function fitRects(rects: Rect[], width: number, height: number, padding = 60): Viewport {
  if (!rects.length) return { x: width / 2, y: height / 2, zoom: 1 };
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const zoom = clampZoom(Math.min(1.5, (width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY)));
  return { zoom, x: width / 2 - ((minX + maxX) / 2) * zoom, y: height / 2 - ((minY + maxY) / 2) * zoom };
}
