import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_SLUGS, inspectDirectory, parseTarotFilename } from './tarot-images.js';

describe('tarot image filename parser', () => {
  it('declares exactly 78 canonical output names', () => {
    expect(EXPECTED_SLUGS).toHaveLength(78);
    expect(new Set(EXPECTED_SLUGS).size).toBe(78);
  });

  it.each([
    ['major-00-fool.webp', 'major-00-fool'],
    ['RWS Tarot 02 High Priestess.jpg', 'major-02-high-priestess'],
    ['ar21.png', 'major-21-world'],
    ['Queen_of_Cups.jpeg', 'cups-queen'],
    ['Ace of Pentacles.tif', 'pentacles-ace'],
    ['Cups01.jpg', 'cups-ace'],
    ['Pents14.jpg', 'pentacles-king'],
    ['Swords12.jpg', 'swords-knight'],
    ['Wands03.jpg', 'wands-three'],
    ['w14.jpg', 'wands-king'],
    ['12-swords.png', 'swords-knight'],
  ])('maps %s to %s', (filename, expected) => expect(parseTarotFilename(filename)).toBe(expected));

  it('does not guess ambiguous filenames', () => {
    expect(parseTarotFilename('card-37.jpg')).toBeNull();
    expect(parseTarotFilename('back.png')).toBeNull();
  });

  it('accepts an exact canonical 78-image drop folder', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tarot-images-test-'));
    EXPECTED_SLUGS.forEach((slug) => writeFileSync(join(directory, `${slug}.png`), 'fixture'));
    const report = inspectDirectory(directory);
    expect(report.matches).toHaveLength(78);
    expect(report.missing).toEqual([]);
    expect(report.unmatched).toEqual([]);
    expect(report.duplicates).toEqual([]);
  });
});
