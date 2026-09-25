import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  actions,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Header buttons (e.g. a `form=` submit); shown on mobile, where the footer Cancel/Save are hidden. */
  actions?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    addEventListener('keydown', close);
    return () => {
      removeEventListener('keydown', close);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  // Portal to <body> so a modal opened from inside a transformed/blurred ancestor isn't clipped by it.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'wide' : ''} ${actions ? 'has-actions' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <h2>{title}</h2>
          {actions && <div className="modal-header-actions">{actions}</div>}
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
