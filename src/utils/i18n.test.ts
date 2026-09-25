import { describe, expect, it } from 'vitest';
import { fillMessage, translate } from './i18n';

describe('i18n', () => {
  it('translates messages for each supported locale', () => {
    expect(translate('th', 'dashboard')).toBe('ภาพรวม');
    expect(translate('en', 'dashboard')).toBe('Dashboard');
  });
});

describe('fillMessage', () => {
  it('fills named placeholders and leaves unknown ones intact', () => {
    expect(fillMessage(translate('en', 'ghPermUpdated'), { name: 'octocat', perm: 'Admin' })).toBe('Updated @octocat to Admin');
    expect(fillMessage('Hi {name} {missing}', { name: 'A' })).toBe('Hi A {missing}');
  });
});
