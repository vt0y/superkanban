import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '@/utils/scroll-lock';
import { Icon } from './Icon';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  actions,
  className = '',
  onBack,
  backLabel = 'Back',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** Header buttons (e.g. a `form=` submit); shown on mobile, where the footer Cancel/Save are hidden. */
  actions?: ReactNode;
  className?: string;
  /** Return to a parent view inside this dialog without remounting its shell. */
  onBack?: () => void;
  backLabel?: string;
}) {
  // Lock once per open modal (not per parent render, since onClose is often a fresh arrow).
  useEffect(() => lockBodyScroll(), []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', close);
    return () => removeEventListener('keydown', close);
  }, [onClose]);

  // Portal to <body> so a modal opened from inside a transformed/blurred ancestor isn't clipped by it.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'wide' : ''} ${actions ? 'has-actions' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <button type="button" className={`modal-close ${onBack ? 'modal-back' : ''}`} onClick={onBack ?? onClose} aria-label={onBack ? backLabel : 'Close'}>
            <Icon name={onBack ? 'arrowLeft' : 'close'} />
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
