import { useEffect, useRef, useState } from 'react';
import type { AdminPageResult } from '@/services/admin';

import { adminLoadError, type AdminLoadError } from '@/utils/admin-errors';

type Loader<T> = (afterId?: string) => Promise<AdminPageResult<T>>;
// Share only pending requests, scoped to caller, loader and cursor. Never cache completed data.
const pending = new WeakMap<object, Map<string, Promise<AdminPageResult<{ id: string }>>>>();
function loadShared<T extends { id: string }>(load: Loader<T>, identity: string, cursor?: string, revision = 0): Promise<AdminPageResult<T>> {
  let requests = pending.get(load);
  if (!requests) { requests = new Map(); pending.set(load, requests); }
  const key = JSON.stringify([identity, cursor ?? null, revision]);
  const existing = requests.get(key);
  if (existing) return existing as Promise<AdminPageResult<T>>;
  const request = cursor === undefined ? load() : load(cursor);
  requests.set(key, request);
  const clear = () => { if (requests.get(key) === request) requests.delete(key); };
  void request.then(clear, clear);
  return request;
}

export function useAdminCollection<T extends { id: string }>(load: Loader<T>, identity: string) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<AdminLoadError | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const scope = useRef<{ load: Loader<T>; identity: string } | null>(null);
  const busy = useRef(false);
  const failedMore = useRef(false);
  useEffect(() => {
    const version = ++generation.current;
    busy.current = true;
    failedMore.current = false;
    if (scope.current?.load !== load || scope.current.identity !== identity) {
      setItems([]); setCursor(null); setHasMore(false);
    }
    scope.current = { load, identity };
    setLoading(true); setLoadingMore(false); setError(null);
    void loadShared(load, identity, undefined, revision).then((page) => {
      if (version !== generation.current) return;
      setItems(page.items); setCursor(page.nextCursor); setHasMore(page.hasMore);
    }).catch((cause: unknown) => {
      if (version === generation.current) setError(adminLoadError(cause));
    }).finally(() => {
      if (version === generation.current) { busy.current = false; setLoading(false); }
    });
    return () => { generation.current++; };
  }, [load, identity, revision]);
  const refresh = () => { generation.current++; busy.current = true; setRevision((value) => value + 1); };
  const loadMore = async () => {
    if (!cursor || !hasMore || busy.current) return;
    const version = generation.current;
    busy.current = true; failedMore.current = true;
    setLoadingMore(true); setError(null);
    try {
      const page = await loadShared(load, identity, cursor, revision);
      if (version !== generation.current) return;
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((old) => old.id === item.id))]);
      setCursor(page.nextCursor); setHasMore(page.hasMore); failedMore.current = false;
    } catch (cause) {
      if (version === generation.current) setError(adminLoadError(cause));
    } finally {
      if (version === generation.current) { busy.current = false; setLoadingMore(false); }
    }
  };
  const replace = (id: string, values: Partial<T>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
  return { items, hasMore, loading, loadingMore, error, refresh, loadMore, replace, retry: () => failedMore.current ? void loadMore() : refresh() };
}
