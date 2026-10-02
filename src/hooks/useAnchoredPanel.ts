import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Fixed-position style that pins a panel portaled to <body> under (or, without room, above) `anchor`,
 * clamped to the viewport and kept in place while anything scrolls or the window resizes. A modal body
 * scrolls and would clip an absolutely positioned panel, hence the portal. Below 640px it returns `{}`
 * so CSS can turn the panel into a bottom sheet. `deps` re-measure when the panel's height can change.
 */
export function useAnchoredPanel(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, width: number, deps: unknown[] = []): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect || window.innerWidth < 640) { setStyle({}); return; }
      const panelWidth = Math.min(width, window.innerWidth - 32);
      const height = panel.current?.offsetHeight ?? 0;
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - panelWidth - 16));
      const below = window.innerHeight - rect.bottom - 6;
      const top = below >= height + 16 || rect.top < below ? rect.bottom + 6 : Math.max(16, rect.top - 6 - height);
      setStyle({ top, left, width: panelWidth, maxHeight: window.innerHeight - top - 16 });
    };
    update();
    addEventListener('resize', update);
    addEventListener('scroll', update, true);
    return () => { removeEventListener('resize', update); removeEventListener('scroll', update, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, width, ...deps]);
  return style;
}
