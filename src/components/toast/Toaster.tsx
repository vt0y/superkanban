import { useEffect, useState } from 'react';
import { TOAST_EVENT, type ToastItem } from './toast';

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let seq = 0;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<Omit<ToastItem, 'id'>>).detail;
      const id = ++seq;
      setItems((current) => [...current.slice(-3), { ...detail, id }]);
      setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 3800);
    };
    addEventListener(TOAST_EVENT, onToast);
    return () => removeEventListener(TOAST_EVENT, onToast);
  }, []);
  return (
    <div className="toaster" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>
          {item.kind === 'error' ? '⚠' : item.kind === 'success' ? '✓' : 'ℹ'} {item.message}
        </div>
      ))}
    </div>
  );
}
