const GAP = 1024;

interface Ordered { id: string; order: number }

/** An order value that sorts between `prev` and `next` (either may be missing). */
export function orderBetween(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return Date.now();
  if (next === undefined) return prev! + GAP;
  if (prev === undefined) return next - GAP;
  return (prev + next) / 2;
}

/**
 * New orders for `movedIds` inserted at `index` of `column` (index counts the column as it is
 * shown, moved cards included). Moved cards keep the order they are given in and are spread
 * evenly between their new neighbours.
 */
export function ordersForDrop(column: Ordered[], index: number, movedIds: string[]): Map<string, number> {
  const moved = new Set(movedIds);
  const before = column.slice(0, index).filter((item) => !moved.has(item.id));
  const after = column.slice(index).filter((item) => !moved.has(item.id));
  const prev = before[before.length - 1]?.order;
  const next = after[0]?.order;
  const result = new Map<string, number>();
  if (prev === undefined || next === undefined) {
    const base = prev ?? (next === undefined ? Date.now() : next - GAP * (movedIds.length + 1));
    movedIds.forEach((id, offset) => result.set(id, base + GAP * (offset + 1)));
    return result;
  }
  const step = (next - prev) / (movedIds.length + 1);
  movedIds.forEach((id, offset) => result.set(id, prev + step * (offset + 1)));
  return result;
}

/** True when dropping one card at `index` of its own column would leave it where it is. */
export function isNoopDrop(column: Ordered[], index: number, movedIds: string[]): boolean {
  if (movedIds.length !== 1) return false;
  const current = column.findIndex((item) => item.id === movedIds[0]);
  return current >= 0 && (index === current || index === current + 1);
}
