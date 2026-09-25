import React from 'react';

export interface LinkSegment {
  type: 'text' | 'link';
  text: string;
  href?: string;
}

function addText(segments: LinkSegment[], text: string) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === 'text') {
    last.text += text;
  } else {
    segments.push({ type: 'text', text });
  }
}

export function parseLinkSegments(content: string): LinkSegment[] {
  if (!content) return [];

  // Match Markdown links [text](url) OR raw URLs (http://, https://, www.)
  const combinedRegex = /\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s]+)/gi;
  const segments: LinkSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = combinedRegex.exec(content)) !== null) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      addText(segments, content.slice(lastIndex, matchStart));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Markdown link: [text](url)
      const linkText = match[1];
      let href = match[2];
      if (href.startsWith('www.')) {
        href = `https://${href}`;
      }
      segments.push({
        type: 'link',
        text: linkText,
        href,
      });
      lastIndex = matchStart + match[0].length;
    } else if (match[3] !== undefined) {
      // Raw URL
      let rawUrl = match[3];
      let trailing = '';

      // Strip trailing punctuation character-by-character
      while (rawUrl.length > 0) {
        const lastChar = rawUrl[rawUrl.length - 1];
        if (/[.,;:!?]/.test(lastChar)) {
          trailing = lastChar + trailing;
          rawUrl = rawUrl.slice(0, -1);
          continue;
        }
        if (lastChar === ')') {
          const openCount = (rawUrl.match(/\(/g) || []).length;
          const closeCount = (rawUrl.match(/\)/g) || []).length;
          if (closeCount > openCount) {
            trailing = lastChar + trailing;
            rawUrl = rawUrl.slice(0, -1);
            continue;
          }
        }
        break;
      }

      if (rawUrl) {
        const href = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
          ? rawUrl
          : `https://${rawUrl}`;
        segments.push({
          type: 'link',
          text: rawUrl,
          href,
        });
      }

      if (trailing) {
        addText(segments, trailing);
      }
      lastIndex = matchStart + match[0].length;
    }
  }

  if (lastIndex < content.length) {
    addText(segments, content.slice(lastIndex));
  }

  return segments;
}

export function parseContentWithLinks(content: string): React.ReactNode[] {
  const segments = parseLinkSegments(content);
  return segments.map((segment, index) => {
    if (segment.type === 'link' && segment.href) {
      return React.createElement(
        'a',
        {
          key: index,
          href: segment.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          draggable: false,
          className: 'sticky-link',
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
          onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
        },
        segment.text,
      );
    }
    return React.createElement(React.Fragment, { key: index }, segment.text);
  });
}
