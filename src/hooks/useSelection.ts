import { useCallback, useEffect, useMemo, useState } from 'react';

export interface Selection {
  selected: Set<string>;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Shift-click: select everything between the last toggled id and `id` in `orderedIds`. */
  range: (id: string, orderedIds: string[]) => void;
  set: (ids: string[]) => void;
  clear: () => void;
}

export function useSelection(validIds: string[]): Selection {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState('');
  const validKey = validIds.join('|');

  // Drop ids that disappeared (deleted by someone else) so bulk actions never target stale docs.
  useEffect(() => {
    const valid = new Set(validKey ? validKey.split('|') : []);
    setSelected((current) => {
      const next = new Set([...current].filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [validKey]);

  const toggle = useCallback((id: string) => {
    setAnchor(id);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const range = useCallback(
    (id: string, orderedIds: string[]) => {
      const from = orderedIds.indexOf(anchor);
      const to = orderedIds.indexOf(id);
      if (from < 0 || to < 0) {
        toggle(id);
        return;
      }
      const [start, end] = from < to ? [from, to] : [to, from];
      setSelected((current) => new Set([...current, ...orderedIds.slice(start, end + 1)]));
    },
    [anchor, toggle],
  );

  return useMemo(
    () => ({
      selected,
      has: (id: string) => selected.has(id),
      toggle,
      range,
      set: (ids: string[]) => setSelected(new Set(ids)),
      clear: () => setSelected(new Set()),
    }),
    [selected, toggle, range],
  );
}
