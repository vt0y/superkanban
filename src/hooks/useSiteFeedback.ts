import { useEffect, useRef, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { loadSiteFeedbackPage, subscribeSiteFeedback, type FeedbackCursor, type SubscribeSiteFeedbackOptions } from '@/services/feedback';
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

export function useSiteFeedbackPage(context: AppContextValue, options?: SubscribeSiteFeedbackOptions) {
  const [items, setItems] = useState<SiteFeedback[]>([]);
  const [cursor, setCursor] = useState<FeedbackCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const paged = useRef(false);
  const admin = context.siteRole !== null;
  const status = options?.status;
  useEffect(() => {
    paged.current = false;
    return subscribeSiteFeedback(context.user.uid, admin, (recent) => {
    setItems((current) => [...recent, ...current.filter((item) => !recent.some((next) => next.id === item.id))]);
    const last = recent.at(-1);
    if (!paged.current) {
      if (last?.createdAt) setCursor({ createdAt: last.createdAt, id: last.id });
      setHasMore(recent.length === (options?.limitCount ?? 50));
    }
  }, () => setItems([]), { ...options, limitCount: options?.limitCount ?? 50 });
  }, [context.user.uid, admin, status, options?.limitCount]);
  const loadMore = async () => {
    if (!cursor || !hasMore || loadingMore) return;
    setLoadingMore(true);
    paged.current = true;
    try {
      const page = await loadSiteFeedbackPage(context.user.uid, admin, cursor, options?.limitCount ?? 50, status);
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setCursor(page.nextCursor); setHasMore(page.hasMore);
    } finally { setLoadingMore(false); }
  };
  return { items, hasMore, loadingMore, loadMore };
}
