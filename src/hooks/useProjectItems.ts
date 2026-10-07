import { useEffect, useState } from 'react';
import { subscribeProjectDocsByIds, subscribeProjectCollection } from '@/services/work-items';
import { subscribeProjectQuery } from '@/services/work-items';
import type { QueryConstraint } from 'firebase/firestore';

export function useProjectItems<T>(projectId: string, collection: string, enabled = true): T[] {
  return useProjectItemsState<T>(projectId, collection, enabled).items;
}

export function useProjectQuery<T>(projectId: string, collection: string, scopeKey: string, constraints: QueryConstraint[]): T[] {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    setItems([]);
    return subscribeProjectQuery<T>(projectId, collection, scopeKey, constraints, setItems);
    // Callers memoize constraints; scopeKey is the semantic dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, collection, scopeKey]);
  return items;
}

/** `enabled: false` skips the listener entirely (no reads) and reports an empty, loaded list. */
export function useProjectItemsState<T>(projectId: string, collection: string, enabled = true): { items: T[]; loaded: boolean; failed: boolean; retry: () => void } {
  const key = `${projectId}:${collection}:${enabled}`;
  const [state, setState] = useState<{ key: string; items: T[]; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setState(null);
    if (!enabled) return;
    return subscribeProjectCollection<T>(projectId, collection, (items) => setState({ key, items, failed: false }), () => setState({ key, items: [], failed: true }));
  }, [projectId, collection, enabled, key, attempt]);
  const current = enabled && state?.key === key ? state : null;
  return { items: current?.items || [], loaded: !enabled || Boolean(current && !current.failed), failed: current?.failed || false, retry: () => { setState(null); setAttempt((count) => count + 1); } };
}

/** Small referenced lists use the same canonical ID queries as other consumers. */
export function useProjectItemsByIds<T>(projectId: string, collection: string, ids: string[], enabled = true): T[] {
  const key = JSON.stringify([...new Set(ids)].sort());
  const stateKey = `${projectId}:${collection}:${key}`;
  const [state, setState] = useState<{ key: string; items: T[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return subscribeProjectDocsByIds<T>(projectId, collection, JSON.parse(key), (items) => setState({ key: stateKey, items }));
  }, [projectId, collection, key, stateKey, enabled]);
  return enabled && state?.key === stateKey ? state.items : [];
}
