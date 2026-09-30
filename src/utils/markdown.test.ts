import { describe, expect, it } from 'vitest';
import { markdownAnchorSlug, renderMarkdown } from './markdown';

describe('Markdown anchors', () => {
  it('keeps Thai characters in heading slugs', () => {
    expect(markdownAnchorSlug('สาราบ ปปป')).toBe('สาราบ-ปปป');
    expect(renderMarkdown('## สาราบ ปปป')).toContain('<h2 id="สาราบ-ปปป">');
  });

  it('renders the short table-of-contents link syntax', () => {
    expect(renderMarkdown('[#สาราบ-ปปป]')).toContain('href="#สาราบ-ปปป"');
  });

  it('gives duplicate headings stable unique IDs', () => {
    const html = renderMarkdown('# หัวข้อ\n\n# หัวข้อ');
    expect(html).toContain('id="หัวข้อ"');
    expect(html).toContain('id="หัวข้อ-2"');
  });

  it('does not rewrite the shorthand inside code', () => {
    expect(renderMarkdown('`[#หัวข้อ]`')).toContain('<code>[#หัวข้อ]</code>');
  });
});
