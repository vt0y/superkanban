import { describe, expect, it } from 'vitest';
import { isGitHubEnabled, isGoogleDriveEnabled, parseFeatureFlag, parseGitHubAppSlug } from './features';

describe('features config - parseFeatureFlag', () => {
  it('returns false for empty or non-truthy values', () => {
    expect(parseFeatureFlag(undefined)).toBe(false);
    expect(parseFeatureFlag(null)).toBe(false);
    expect(parseFeatureFlag('')).toBe(false);
    expect(parseFeatureFlag('   ')).toBe(false);
    expect(parseFeatureFlag('false')).toBe(false);
    expect(parseFeatureFlag('FALSE')).toBe(false);
    expect(parseFeatureFlag('0')).toBe(false);
    expect(parseFeatureFlag('no')).toBe(false);
    expect(parseFeatureFlag('disabled')).toBe(false);
  });

  it('returns true only for explicit true or 1', () => {
    expect(parseFeatureFlag('true')).toBe(true);
    expect(parseFeatureFlag('TRUE')).toBe(true);
    expect(parseFeatureFlag('True')).toBe(true);
    expect(parseFeatureFlag('  true  ')).toBe(true);
    expect(parseFeatureFlag('1')).toBe(true);
    expect(parseFeatureFlag(' 1 ')).toBe(true);
  });

  it('evaluates isGitHubEnabled as boolean', () => {
    expect(typeof isGitHubEnabled).toBe('boolean');
    expect(typeof isGoogleDriveEnabled).toBe('boolean');
  });
});

describe('features config - parseGitHubAppSlug', () => {
  it('accepts GitHub App slugs, normalised to lowercase', () => {
    expect(parseGitHubAppSlug('projectspace-github')).toBe('projectspace-github');
    expect(parseGitHubAppSlug('  ProjectSpace  ')).toBe('projectspace');
  });

  it('rejects empty or malformed slugs so GitHub stays disabled', () => {
    expect(parseGitHubAppSlug(undefined)).toBe('');
    expect(parseGitHubAppSlug('')).toBe('');
    expect(parseGitHubAppSlug('https://github.com/apps/x')).toBe('');
    expect(parseGitHubAppSlug('-leading-dash')).toBe('');
    expect(parseGitHubAppSlug('has space')).toBe('');
  });
});
