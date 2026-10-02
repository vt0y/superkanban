/** Where a face-down card sits in the desktop fan: which arc (0 = front/lower) and its angle in degrees. */
export interface FanPosition { row: number; angle: number }

/**
 * Splits `total` cards into `rows` concentric arcs (front arc first) and spreads each arc evenly across
 * `span` degrees, centred on 0. Card order runs left to right within an arc.
 */
export function fanPosition(index: number, total: number, rows = 2, span = 112): FanPosition {
  const perRow = Math.ceil(total / rows);
  const row = Math.min(rows - 1, Math.floor(index / perRow));
  const inRow = row === rows - 1 ? total - perRow * (rows - 1) : perRow;
  const slot = index - row * perRow;
  const angle = inRow <= 1 ? 0 : -span / 2 + (span * slot) / (inRow - 1);
  return { row, angle: Math.round(angle * 100) / 100 };
}
