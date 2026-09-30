import { describe, expect, it } from 'vitest';
import { canonicalOriginalUrl, isPublicDomainMetadata, mapWikimediaTitle, validateWikimediaPages } from './tarot-images-download.js';
import { EXPECTED_SLUGS } from './tarot-images.js';

describe('Wikimedia tarot image downloader', () => {
  it.each([
    ['File:RWS Tarot 00 Fool.jpg', 'major-00-fool'],
    ['File:RWS Tarot 10 Wheel of Fortune.jpg', 'major-10-wheel-of-fortune'],
    ['File:Cups01.jpg', 'cups-ace'],
    ['File:Pents14.jpg', 'pentacles-king'],
    ['File:Swords11.jpg', 'swords-page'],
    ['File:Wands12.jpg', 'wands-knight'],
  ])('maps %s to %s', (title, slug) => expect(mapWikimediaTitle(title)).toBe(slug));

  it('requires an explicit Public Domain marker and non-copyrighted status', () => {
    expect(isPublicDomainMetadata({ LicenseShortName: { value: 'Public domain' }, Copyrighted: { value: 'False' } })).toBe(true);
    expect(isPublicDomainMetadata({ LicenseShortName: { value: 'CC BY-SA 4.0' }, Copyrighted: { value: 'True' } })).toBe(false);
    expect(isPublicDomainMetadata({ LicenseShortName: { value: 'Public domain' }, Copyrighted: { value: 'True' } })).toBe(false);
  });

  it('removes Wikimedia tracking parameters from original image URLs', () => {
    expect(canonicalOriginalUrl('https://upload.wikimedia.org/card.jpg?utm_source=commons#x'))
      .toBe('https://upload.wikimedia.org/card.jpg');
  });

  it('validates a complete unique 78-card response', () => {
    const pages = EXPECTED_SLUGS.map((slug) => ({
      title: `File:${slug}.jpg`,
      imageinfo: [{
        url: `https://upload.wikimedia.org/${slug}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${slug}.jpg`,
        mime: 'image/jpeg', width: 1100, height: 1920, sha1: slug,
        extmetadata: { LicenseShortName: { value: 'Public domain' }, Copyrighted: { value: 'False' } },
      }],
    }));
    expect(validateWikimediaPages(pages)).toHaveLength(78);
  });

  it('rejects an incomplete response', () => {
    expect(() => validateWikimediaPages([])).toThrow(/exactly 78/);
  });
});
