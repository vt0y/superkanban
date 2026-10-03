import { useEffect, useState } from 'react';
import { subscribeProjectCollection } from '@/services/work-items';
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
export function useProjectItemsState<T>(projectId: string, collection: string, enabled = true): { items: T[]; loaded: boolean } {
  const [state, setState] = useState<{ items: T[]; loaded: boolean }>({ items: [], loaded: !enabled });
  useEffect(() => {
    if (!enabled) { setState({ items: [], loaded: true }); return; }
    setState({ items: [], loaded: false });
    return subscribeProjectCollection<T>(projectId, collection, (items) => setState({ items, loaded: true }));
  }, [projectId, collection, enabled]);
  return state;
}
