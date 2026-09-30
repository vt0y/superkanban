import { describe, expect, it } from 'vitest';
import { DOCUMENT_BODY_MAX_BYTES, documentContentBytes, documentExcerpt, documentMetadata } from './documents';

describe('document helpers', () => {
  it('measures UTF-8 bytes rather than JavaScript characters', () => {
    expect(documentContentBytes('abc')).toBe(3);
    expect(documentContentBytes('ไทย')).toBe(9);
    expect(documentContentBytes('😀')).toBe(4);
  });

  it('creates a compact plain-text excerpt without leaking fenced diagrams', () => {
    const markdown = '# Heading\n\nA **useful** [link](https://example.com).\n\n```mermaid\nflowchart TD\nA-->B\n```';
    expect(documentExcerpt(markdown)).toBe('Heading A useful link.');
  });

  it('returns v2 metadata and exposes the intended safety boundary', () => {
    expect(documentMetadata('hello')).toEqual({ schemaVersion: 2, excerpt: 'hello', contentBytes: 5 });
    expect(DOCUMENT_BODY_MAX_BYTES).toBe(921600);
  });
});
