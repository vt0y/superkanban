import { useEffect, useState } from 'react';
import { Icon } from '@/components/common/Icon';
import { TOAST_EVENT, type ToastItem } from './toast';

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [retrying, setRetrying] = useState<Set<number>>(new Set());
  useEffect(() => {
    let seq = 0;
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<Omit<ToastItem, 'id'>>).detail;
      const id = ++seq;
      setItems((current) => [...current.filter((item) => item.retry), ...current.filter((item) => !item.retry).slice(-3), { ...detail, id }]);
      if (!detail.retry) setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 3800);
    };
    addEventListener(TOAST_EVENT, onToast);
    return () => removeEventListener(TOAST_EVENT, onToast);
  }, []);
  const retry = async (item: ToastItem) => {
    if (!item.retry || retrying.has(item.id)) return;
    setRetrying((current) => new Set([...current, item.id]));
    try {
      await item.retry();
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      console.error(error);
    } finally {
      setRetrying((current) => new Set([...current].filter((id) => id !== item.id)));
    }
  };
  return (
    <div className="toaster" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>
          <Icon name={item.kind === 'error' ? 'alert' : item.kind === 'success' ? 'check' : 'info'} />
          <span>{item.message}</span>
          {item.retry && <button type="button" className="secondary" disabled={retrying.has(item.id)} onClick={() => void retry(item)}>Retry / ลองอีกครั้ง</button>}
        </div>
      ))}
    </div>
  );
}
