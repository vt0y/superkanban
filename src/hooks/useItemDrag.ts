import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Drag helper for items on a canvas: tracks a local position override per item while the
 * pointer moves (one render per frame) and calls `onDrop` once with the final positions.
 */
export function useItemDrag(
  toWorld: (x: number, y: number) => { x: number; y: number },
  onDrop: (positions: Map<string, { x: number; y: number }>) => void,
) {
  const [overrides, setOverrides] = useState<Map<string, { x: number; y: number }>>(new Map());
  const drag = useRef<{
    startX: number;
    startY: number;
    origins: Map<string, { x: number; y: number }>;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const latest = useRef(overrides);
  const frame = useRef(0);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const start = useCallback(
    (event: ReactPointerEvent, origins: Map<string, { x: number; y: number }>) => {
      const world = toWorld(event.clientX, event.clientY);
      drag.current = { startX: world.x, startY: world.y, origins, moved: false, pointerId: event.pointerId };
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    },
    [toWorld],
  );

  const move = useCallback(
    (event: ReactPointerEvent, snap?: (value: number) => number): boolean => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return false;
      const world = toWorld(event.clientX, event.clientY);
      const dx = world.x - current.startX;
      const dy = world.y - current.startY;
      if (!current.moved && Math.hypot(dx, dy) < 3) return true;
      current.moved = true;
      const next = new Map<string, { x: number; y: number }>();
      current.origins.forEach((origin, id) =>
        next.set(id, {
          x: snap ? snap(origin.x + dx) : origin.x + dx,
          y: snap ? snap(origin.y + dy) : origin.y + dy,
        }),
      );
      latest.current = next;
      if (!frame.current)
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          setOverrides(latest.current);
        });
      return true;
    },
    [toWorld],
  );

  const end = useCallback((event: ReactPointerEvent): 'moved' | 'click' | null => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return null;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (!current.moved) {
      setOverrides(new Map());
      return 'click';
    }
    const final = latest.current;
    dropRef.current(final);
    // Keep the override until Firestore's snapshot catches up, so the item never jumps back.
    setTimeout(() => setOverrides((currentOverrides) => (currentOverrides === final ? new Map() : currentOverrides)), 700);
    setOverrides(final);
    return 'moved';
  }, []);

  return { overrides, start, move, end, dragging: () => !!drag.current?.moved };
}
