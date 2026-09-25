import { describe, expect, it } from 'vitest';
import { parseLinkSegments } from './linkify';

describe('linkify', () => {
  it('returns empty array for empty string', () => {
    expect(parseLinkSegments('')).toEqual([]);
  });

  it('returns plain text when there are no links', () => {
    expect(parseLinkSegments('hello world')).toEqual([
      { type: 'text', text: 'hello world' },
    ]);
  });

  it('parses raw https and http URLs', () => {
    expect(parseLinkSegments('Visit https://example.com for info')).toEqual([
      { type: 'text', text: 'Visit ' },
      { type: 'link', text: 'https://example.com', href: 'https://example.com' },
      { type: 'text', text: ' for info' },
    ]);
  });

  it('parses raw www URLs and adds https scheme', () => {
    expect(parseLinkSegments('Check www.google.com please')).toEqual([
      { type: 'text', text: 'Check ' },
      { type: 'link', text: 'www.google.com', href: 'https://www.google.com' },
      { type: 'text', text: ' please' },
    ]);
  });

  it('parses markdown style links', () => {
    expect(parseLinkSegments('Read the [Docs](https://docs.example.com)')).toEqual([
      { type: 'text', text: 'Read the ' },
      { type: 'link', text: 'Docs', href: 'https://docs.example.com' },
    ]);
  });

  it('strips trailing punctuation from raw URLs', () => {
    expect(parseLinkSegments('Is it here: https://example.com? Yes.')).toEqual([
      { type: 'text', text: 'Is it here: ' },
      { type: 'link', text: 'https://example.com', href: 'https://example.com' },
      { type: 'text', text: '? Yes.' },
    ]);
  });

  it('handles unmatched parentheses in URLs', () => {
    expect(parseLinkSegments('(see https://example.com/path)')).toEqual([
      { type: 'text', text: '(see ' },
      { type: 'link', text: 'https://example.com/path', href: 'https://example.com/path' },
      { type: 'text', text: ')' },
    ]);
  });

  it('preserves balanced parentheses in URLs (e.g. Wikipedia)', () => {
    expect(parseLinkSegments('https://en.wikipedia.org/wiki/React_(software)')).toEqual([
      {
        type: 'link',
        text: 'https://en.wikipedia.org/wiki/React_(software)',
        href: 'https://en.wikipedia.org/wiki/React_(software)',
      },
    ]);
  });
});
