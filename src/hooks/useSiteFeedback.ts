import { useEffect, useRef, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { subscribeSiteFeedback, type SubscribeSiteFeedbackOptions } from '@/services/feedback';
import type { SiteFeedback } from '@/types';

export function useSiteFeedback(
  context: AppContextValue,
  enabled = true,
  options?: SubscribeSiteFeedbackOptions,
): SiteFeedback[] {
  const [items, setItems] = useState<SiteFeedback[]>([]);
  const admin = context.siteRole !== null;
  const status = options?.status;
  const limitCount = options?.limitCount;
  useEffect(
    () => (enabled ? subscribeSiteFeedback(context.user.uid, admin, setItems, () => setItems([]), { status, limitCount }) : undefined),
    [context.user.uid, admin, enabled, status, limitCount],
  );
  return items;
}

/** Keep the loaded window live so deleted or reclassified older rows disappear too. */
export function useSiteFeedbackPage(context: AppContextValue, options?: SubscribeSiteFeedbackOptions) {
  const pageSize = options?.limitCount ?? 50;
  const admin = context.siteRole === 'owner' || context.siteRole === 'admin';
  const status = options?.status;
  const key = `${context.user.uid}:${admin}:${status ?? 'all'}:${pageSize}`;
  const [window, setWindow] = useState({ key, limit: pageSize });
  const limitCount = window.key === key ? window.limit : pageSize;
  const [result, setResult] = useState<{ key: string; limit: number; items: SiteFeedback[]; hasMore: boolean; error: Error | null }>({
    key: '', limit: 0, items: [], hasMore: false, error: null,
  });
  const [retry, setRetry] = useState(0);
  const active = useRef(false);
  useEffect(() => {
    let current = true;
    active.current = true;
    setWindow({ key, limit: limitCount });
    const stop = subscribeSiteFeedback(context.user.uid, admin, (rows) => {
      if (!current) return;
      active.current = false;
      setResult({ key, limit: limitCount, items: rows.slice(0, limitCount), hasMore: rows.length > limitCount, error: null });
    }, (error) => {
      if (!current) return;
      active.current = false;
      setResult((previous) => ({
        key, limit: limitCount, items: previous.key === key ? previous.items : [],
        hasMore: previous.key === key && previous.hasMore, error,
      }));
    }, { status, limitCount: limitCount + 1 });
    return () => { current = false; stop(); };
  }, [context.user.uid, admin, key, status, limitCount, retry]);
  const matching = result.key === key;
  const loading = !matching || (result.limit !== limitCount && !result.error);
  const refresh = () => {
    active.current = true;
    setResult((previous) => ({ ...previous, limit: 0, error: null }));
    setRetry((value) => value + 1);
  };
  const loadMore = async () => {
    if (!matching || !result.hasMore || loading || active.current || result.error) return;
    active.current = true;
    setWindow({ key, limit: limitCount + pageSize });
  };
  return {
    items: matching ? result.items : [],
    hasMore: matching && result.hasMore,
    loading: loading && (!matching || result.items.length === 0),
    loadingMore: loading && matching && result.items.length > 0,
    error: matching ? result.error : null,
    loadMore, refresh,
  };
}
