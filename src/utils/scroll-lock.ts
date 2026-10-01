/**
 * Shared page-scroll lock for modals, sheets and the mobile chat.
 * Reference-counted, so overlapping locks can be released in any order without leaving the page stuck at
 * `overflow: hidden` (each caller saving/restoring the previous value broke when releases were out of order).
 */
let holders = 0;
let restoreTo = '';

export function lockBodyScroll(): () => void {
  const { style } = document.body;
  if (holders === 0) restoreTo = style.overflow === 'hidden' ? '' : style.overflow;
  holders += 1;
  style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) style.overflow = restoreTo;
  };
}

/** Test hook. */
export function resetBodyScrollLock() { holders = 0; restoreTo = ''; }
