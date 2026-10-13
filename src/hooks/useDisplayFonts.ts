import { useEffect } from 'react';

const DISPLAY_FONTS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Noto+Serif+Thai:wght@500;600&display=swap';

/** The serif display faces are only used by the tarot-themed pages, so load them there instead of for every visitor. */
export function useDisplayFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${DISPLAY_FONTS}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = DISPLAY_FONTS;
    document.head.append(link);
  }, []);
}
