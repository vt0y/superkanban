// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeMermaidSvg } from '@/components/common/MarkdownRenderer';
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

describe('sanitizeMermaidSvg', () => {
  it('strips script tags and onload event handlers', () => {
    const malicious = '<svg onload="alert(1)"><script>alert(2)</script><circle cx="50" cy="50" r="40" /></svg>';
    const sanitized = sanitizeMermaidSvg(malicious);
    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('onload');
    expect(sanitized).not.toContain('alert');
    expect(sanitized).toContain('<circle');
  });

  it('preserves foreignObject and nested text labels for Mermaid diagrams', () => {
    const flowchartSvg = '<svg><g class="node"><foreignObject width="100" height="50"><div><span class="nodeLabel">Start Process</span></div></foreignObject></g></svg>';
    const sanitized = sanitizeMermaidSvg(flowchartSvg);
    expect(sanitized).toContain('<foreignObject');
    expect(sanitized).toContain('Start Process');
  });
});
