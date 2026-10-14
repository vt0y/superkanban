import { useEffect, useId, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import type { Locale } from '@/types';
import { fitRects, MAX_ZOOM, MIN_ZOOM, zoomAt, type Viewport } from '@/utils/canvas-math';
import { pick } from '@/utils/formatters';
import { renderMarkdown } from '@/utils/markdown';

/** Imperative twin of <Icon>: a lucide-styled stroke icon built from path data (these controls live outside React). */
function strokeIcon(paths: string[]) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ class: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
const MINUS = ['M5 12h14'];
const PLUS = ['M5 12h14', 'M12 5v14'];
const FIT = ['M15 3h6v6', 'M9 21H3v-6', 'm21 3-7 7', 'm3 21 7-7'];

function makeButton(label: string, content: string | string[], onClick: () => void, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  if (typeof content === 'string') button.textContent = content;
  else button.append(strokeIcon(content));
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

export function sanitizeMermaidSvg(svgMarkup: string): string {
  return DOMPurify.sanitize(svgMarkup, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true, 'annotation-xml': true },
  });
}

function makeDiagramZoomable(wrapper: HTMLElement, svgMarkup: string, locale: Locale): () => void {
  const cleanSvg = sanitizeMermaidSvg(svgMarkup);
  const viewport = document.createElement('div');
  const canvas = document.createElement('div');
  const controls = document.createElement('div');
  viewport.className = 'mermaid-viewport';
  viewport.tabIndex = 0;
  canvas.className = 'mermaid-canvas';
  controls.className = 'canvas-controls mermaid-controls';
  canvas.innerHTML = cleanSvg;
  const svg = canvas.querySelector('svg');
  if (!svg) {
    wrapper.innerHTML = cleanSvg;
    return () => undefined;
  }

  const viewBoxWidth = svg.viewBox.baseVal.width;
  const viewBoxHeight = svg.viewBox.baseVal.height;
  const declaredWidth = Number.parseFloat(svg.getAttribute('width') || '');
  const declaredHeight = Number.parseFloat(svg.getAttribute('height') || '');
  const baseWidth = viewBoxWidth || declaredWidth || 800;
  const baseHeight = viewBoxHeight || declaredHeight || 450;
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.style.maxWidth = 'none';
  canvas.style.width = `${baseWidth}px`;
  canvas.style.height = `${baseHeight}px`;

  // Keep this viewport interaction in sync with useCanvasViewport, which powers
  // Sticky Notes: transform-based rendering avoids layout/reflow while zooming.
  let view: Viewport = { x: 40, y: 40, zoom: 1 };
  let frame = 0;
  const zoomOutLabel = pick(locale, 'ซูมออก', 'Zoom out');
  const zoomInLabel = pick(locale, 'ซูมเข้า', 'Zoom in');
  const resetLabel = pick(locale, 'กลับไปที่ 100%', 'Reset to 100%');
  const fitLabel = pick(locale, 'แสดงแผนภาพทั้งหมด', 'Fit diagram');
  let zoomValue: HTMLButtonElement;
  let zoomOut: HTMLButtonElement;
  let zoomIn: HTMLButtonElement;

  const renderView = () => {
    canvas.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`;
    zoomValue.textContent = `${Math.round(view.zoom * 100)}%`;
    zoomOut.disabled = view.zoom <= MIN_ZOOM;
    zoomIn.disabled = view.zoom >= MAX_ZOOM;
  };
  const setView = (next: Viewport | ((current: Viewport) => Viewport)) => {
    view = typeof next === 'function' ? next(view) : next;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      renderView();
    });
  };
  const local = (clientX: number, clientY: number) => {
    const rect = viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const zoomBy = (factor: number) => {
    setView((current) => zoomAt(current, current.zoom * factor, viewport.clientWidth / 2, viewport.clientHeight / 2));
  };
  const fit = () => {
    setView(fitRects([{ x: 0, y: 0, w: baseWidth, h: baseHeight }], viewport.clientWidth, viewport.clientHeight, 24));
  };
  const reset = () => {
    setView((current) => zoomAt(current, 1, viewport.clientWidth / 2, viewport.clientHeight / 2));
  };

  zoomOut = makeButton(zoomOutLabel, MINUS, () => zoomBy(1 / 1.2));
  zoomValue = makeButton(resetLabel, '100%', reset, 'zoom-value');
  zoomIn = makeButton(zoomInLabel, PLUS, () => zoomBy(1.2));
  const divider = document.createElement('span');
  const fitButton = makeButton(fitLabel, FIT, fit);
  controls.append(zoomOut, zoomValue, zoomIn, divider, fitButton);
  viewport.append(canvas);
  wrapper.replaceChildren(viewport, controls);

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : 1;
    if (event.ctrlKey || event.metaKey) {
      const point = local(event.clientX, event.clientY);
      setView((current) => zoomAt(current, current.zoom * Math.exp(-event.deltaY * scale * .0022), point.x, point.y));
    } else {
      setView((current) => ({ ...current, x: current.x - event.deltaX * scale, y: current.y - event.deltaY * scale }));
    }
  };
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { kind: 'pan'; lastX: number; lastY: number } | { kind: 'pinch'; dist: number; midX: number; midY: number } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), midX: mid.x, midY: mid.y };
    } else if (event.button === 0 || event.button === 1) {
      gesture = { kind: 'pan', lastX: event.clientX, lastY: event.clientY };
    } else {
      pointers.delete(event.pointerId);
      return;
    }
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('panning');
  };
  const onPointerMove = (event: PointerEvent) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture?.kind === 'pan') {
      const dx = event.clientX - gesture.lastX;
      const dy = event.clientY - gesture.lastY;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    } else if (gesture?.kind === 'pinch' && pointers.size >= 2) {
      const pinch = gesture;
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      setView((current) => {
        const zoomed = zoomAt(current, current.zoom * (dist / pinch.dist), pinch.midX, pinch.midY);
        return { ...zoomed, x: zoomed.x + mid.x - pinch.midX, y: zoomed.y + mid.y - pinch.midY };
      });
      gesture.dist = dist;
      gesture.midX = mid.x;
      gesture.midY = mid.y;
    }
  };
  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (!pointers.size || gesture?.kind === 'pinch') {
      gesture = null;
      viewport.classList.remove('panning');
    }
  };
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  const initialFrame = requestAnimationFrame(fit);

  return () => {
    cancelAnimationFrame(initialFrame);
    cancelAnimationFrame(frame);
    viewport.removeEventListener('wheel', onWheel);
    viewport.removeEventListener('pointerdown', onPointerDown);
    viewport.removeEventListener('pointermove', onPointerMove);
    viewport.removeEventListener('pointerup', endPointer);
    viewport.removeEventListener('pointercancel', endPointer);
  };
}

export function MarkdownRenderer({ content, locale, className = '' }: { content: string; locale: Locale; className?: string }) {
  const containerRef = useRef<HTMLElement>(null);
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const safeHtml = useMemo(() => DOMPurify.sanitize(renderMarkdown(content)), [content]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(root.dataset.theme || 'light'));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // Mermaid replaces the original code nodes. Restore sanitized Markdown before each
    // content/theme pass so diagrams can be rendered again in the new theme.
    root.innerHTML = safeHtml;
    const codeBlocks = [...root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
    if (!codeBlocks.length) return;

    const diagrams = codeBlocks.map((code, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-diagram';
      wrapper.setAttribute('role', 'group');
      wrapper.setAttribute('aria-label', pick(locale, `แผนภาพ ${index + 1}`, `Diagram ${index + 1}`));
      const source = code.textContent || '';
      code.parentElement!.replaceWith(wrapper);
      return { wrapper, source, id: `mermaid-${renderId}-${index}` };
    });

    let cancelled = false;
    const cleanups: (() => void)[] = [];
    void (async () => {
      const { default: mermaid } = await import('mermaid');
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: theme === 'dark' ? 'dark' : 'default',
      });
      for (const diagram of diagrams) {
        if (cancelled) return;
        try {
          const { svg, bindFunctions } = await mermaid.render(diagram.id, diagram.source);
          if (cancelled) return;
          cleanups.push(makeDiagramZoomable(diagram.wrapper, svg, locale));
          bindFunctions?.(diagram.wrapper);
        } catch {
          if (cancelled) return;
          diagram.wrapper.classList.add('mermaid-error');
          const label = document.createElement('strong');
          label.textContent = pick(locale, 'ไม่สามารถแสดงแผนภาพนี้ได้', 'This diagram could not be rendered');
          const pre = document.createElement('pre');
          const code = document.createElement('code');
          code.textContent = diagram.source;
          pre.append(code);
          diagram.wrapper.replaceChildren(label, pre);
        }
      }
    })().catch(() => {
      if (cancelled) return;
      diagrams.forEach(({ wrapper, source }) => {
        const label = document.createElement('strong');
        label.textContent = pick(locale, 'ไม่สามารถโหลดตัวแสดงแผนภาพได้', 'The diagram renderer could not be loaded');
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = source;
        pre.append(code);
        wrapper.classList.add('mermaid-error');
        wrapper.replaceChildren(label, pre);
      });
    });
    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [safeHtml, locale, renderId, theme]);

  return <article ref={containerRef} className={`markdown ${className}`.trim()} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
