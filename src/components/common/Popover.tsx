import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Anchored menu panel. Desktop: drops below the trigger. Phones (<640px): CSS turns it into a bottom sheet
 * with a scrim. Closes on outside pointerdown and Escape, and hands focus back to the trigger.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  label,
  align = 'end',
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  label: string;
  align?: 'start' | 'end';
}) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const anchor = root.current;
    const onPointer = (event: PointerEvent) => {
      if (!anchor?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      anchor?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    };
    // Move focus into the panel (Tab then reaches the first item) without painting a ring on it.
    panel.current?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className="popover-anchor" ref={root}>
      {trigger}
      {open && (
        <>
          <button type="button" className="popover-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
          <div ref={panel} className={`popover ${align === 'start' ? 'align-start' : ''}`} role="menu" aria-label={label} tabIndex={-1}>
            {children}
          </div>
        </>
      )}
    </div>
  );
}
