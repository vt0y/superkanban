import { describe, expect, it } from 'vitest';
import { safePhotoURL } from './photo-url';

describe('safePhotoURL', () => {
  it('keeps Google-hosted profile photos', () => {
    expect(safePhotoURL('https://lh3.googleusercontent.com/a/abc=s96-c')).toBe('https://lh3.googleusercontent.com/a/abc=s96-c');
    expect(safePhotoURL('https://lh6.googleusercontent.com/x')).toBe('https://lh6.googleusercontent.com/x');
  });
  it('drops other hosts, look-alikes, schemes, and bad values', () => {
    for (const value of ['http://lh3.googleusercontent.com/a/x', 'https://evil.com/lh3.googleusercontent.com/', 'https://lh3.googleusercontent.com.evil.com/x',
      'https://lh7.googleusercontent.com/x', 'javascript:alert(1)', '', undefined, null, 42, `https://lh3.googleusercontent.com/${'a'.repeat(2048)}`]) {
      expect(safePhotoURL(value)).toBe('');
    }
  });
});
