import { Marked, type Token } from 'marked';

function tokenText(tokens: Token[]): string {
  return tokens.map((token) => {
    if ('tokens' in token && Array.isArray(token.tokens)) return tokenText(token.tokens);
    return 'text' in token && typeof token.text === 'string' ? token.text : '';
  }).join('');
}

export function markdownAnchorSlug(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/[^\p{Letter}\p{Mark}\p{Number}\s_-]/gu, '')
    .replace(/[\s_]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '') || 'section';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

/** Render Markdown with stable Unicode heading IDs and [#heading-id] TOC links. */
export function renderMarkdown(content: string): string {
  const usedSlugs = new Map<string, number>();
  const parser = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const base = markdownAnchorSlug(tokenText(tokens));
        const occurrence = (usedSlugs.get(base) || 0) + 1;
        usedSlugs.set(base, occurrence);
        const id = occurrence === 1 ? base : `${base}-${occurrence}`;
        return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
    extensions: [{
      name: 'toc-anchor-link',
      level: 'inline',
      start(source) {
        return source.indexOf('[#');
      },
      tokenizer(source) {
        const match = /^\[#([^\]\r\n]+)\](?!\()/u.exec(source);
        if (!match) return undefined;
        return { type: 'toc-anchor-link', raw: match[0], anchor: match[1] };
      },
      renderer(token) {
        const id = markdownAnchorSlug(String(token.anchor));
        return `<a class="markdown-anchor-link" href="#${escapeHtml(id)}">#${escapeHtml(id)}</a>`;
      },
    }],
  });
  return parser.parse(content) as string;
}
