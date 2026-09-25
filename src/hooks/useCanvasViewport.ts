import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { clampZoom, fitRects, screenToWorld, zoomAt, type Rect, type Viewport } from '@/utils/canvas-math';

const DEFAULT_VIEW: Viewport = { x: 40, y: 40, zoom: 1 };

function loadView(key: string): Viewport {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Viewport;
    return Number.isFinite(parsed.x) && Number.isFinite(parsed.y) && Number.isFinite(parsed.zoom)
      ? { ...parsed, zoom: clampZoom(parsed.zoom) }
      : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/**
 * Endless pan/zoom surface shared by the sticky board and the diagram editor.
 * - wheel pans, ctrl/⌘ + wheel (or trackpad pinch) zooms toward the cursor
 * - dragging empty space (or Space + drag, or middle button) pans
 * - two-finger touch pinch zooms
 * Viewport updates are coalesced into one render per animation frame.
 */
export function useCanvasViewport(storageKey: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<Viewport>(() => loadView(storageKey));
  const viewRef = useRef(view);
  const frame = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan'; lastX: number; lastY: number } | { kind: 'pinch'; dist: number; midX: number; midY: number } | null>(null);
  const spaceDown = useRef(false);
  const [panning, setPanning] = useState(false);

  const setView = useCallback((next: Viewport | ((current: Viewport) => Viewport)) => {
    viewRef.current = typeof next === 'function' ? next(viewRef.current) : next;
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        setViewState(viewRef.current);
      });
  }, []);

  useEffect(() => {
    const loaded = loadView(storageKey);
    viewRef.current = loaded;
    setViewState(loaded);
  }, [storageKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(view));
      } catch {
        /* storage unavailable */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [storageKey, view]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const local = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left || 0), y: clientY - (rect?.top || 0) };
  }, []);

  // Wheel must be a non-passive native listener so preventDefault stops page scroll / browser zoom.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : 1;
      if (event.ctrlKey || event.metaKey) {
        const point = local(event.clientX, event.clientY);
        setView((current) => zoomAt(current, current.zoom * Math.exp(-event.deltaY * scale * 0.0022), point.x, point.y));
      } else {
        setView((current) => ({ ...current, x: current.x - event.deltaX * scale, y: current.y - event.deltaY * scale }));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [local, setView]);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTyping(event.target)) {
        spaceDown.current = true;
        setPanning(true);
        if (containerRef.current?.matches(':hover')) event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceDown.current = false;
        setPanning(false);
      }
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
    };
  }, []);

  /**
   * Call from the surface's onPointerDown. Returns true when the event started a pan/pinch
   * (so callers skip their own handling). `onBackground` = the pointer hit empty canvas.
   */
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent, onBackground: boolean): boolean => {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
        gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), midX: mid.x, midY: mid.y };
        containerRef.current?.setPointerCapture(event.pointerId);
        return true;
      }
      if (spaceDown.current || event.button === 1 || (onBackground && event.button === 0 && !event.shiftKey)) {
        gesture.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY };
        containerRef.current?.setPointerCapture(event.pointerId);
        setPanning(true);
        return true;
      }
      return false;
    },
    [local],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent): boolean => {
      if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const current = gesture.current;
      if (!current) return false;
      if (current.kind === 'pan') {
        const dx = event.clientX - current.lastX;
        const dy = event.clientY - current.lastY;
        current.lastX = event.clientX;
        current.lastY = event.clientY;
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      } else if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
        setView((v) => {
          const zoomed = zoomAt(v, v.zoom * (dist / current.dist), current.midX, current.midY);
          return { ...zoomed, x: zoomed.x + mid.x - current.midX, y: zoomed.y + mid.y - current.midY };
        });
        current.dist = dist;
        current.midX = mid.x;
        current.midY = mid.y;
      }
      return true;
    },
    [local, setView],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent): boolean => {
    pointers.current.delete(event.pointerId);
    const active = !!gesture.current;
    if (!pointers.current.size || gesture.current?.kind === 'pinch') {
      gesture.current = null;
      if (!spaceDown.current) setPanning(false);
    }
    return active;
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const point = local(clientX, clientY);
      return screenToWorld(viewRef.current, point.x, point.y);
    },
    [local],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      setView((current) => zoomAt(current, current.zoom * factor, (rect?.width || 0) / 2, (rect?.height || 0) / 2));
    },
    [setView],
  );

  const fit = useCallback(
    (rects: Rect[]) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setView(fitRects(rects, rect.width, rect.height));
    },
    [setView],
  );

  const reset = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    setView((current) => zoomAt(current, 1, (rect?.width || 0) / 2, (rect?.height || 0) / 2));
  }, [setView]);

  /** Center a world point on screen (used to place new items where the user is looking). */
  const center = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return screenToWorld(viewRef.current, (rect?.width || 0) / 2, (rect?.height || 0) / 2);
  }, []);

  // Double the grid step when zoomed out so dots never get denser than ~12px on screen.
  let gridStep = 24 * view.zoom;
  while (gridStep < 12) gridStep *= 2;
  const gridStyle: CSSProperties = {
    backgroundSize: `${gridStep}px ${gridStep}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

  return {
    containerRef,
    view,
    setView,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    toWorld,
    zoomBy,
    fit,
    reset,
    center,
    gridStyle,
    panning,
  };
}
