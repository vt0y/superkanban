import { describe, expect, it } from 'vitest';
import {
  getAllowedDomainsLabel,
  getDomainErrorMessage,
  isAllowedEmail,
  parseAllowedDomains,
} from './auth-domains';

describe('auth-domains config and validation', () => {
  describe('parseAllowedDomains', () => {
    it('parses single domain', () => {
      expect(parseAllowedDomains('example.com')).toEqual(['example.com']);
      expect(parseAllowedDomains('@example.com')).toEqual(['example.com']);
    });

    it('parses space-separated domains', () => {
      expect(parseAllowedDomains('example.com xxx.xyx')).toEqual(['example.com', 'xxx.xyx']);
      expect(parseAllowedDomains('   example.com    xxx.xyx   ')).toEqual(['example.com', 'xxx.xyx']);
    });

    it('parses comma-separated domains and handles mixed delimiters', () => {
      expect(parseAllowedDomains('example.com, xxx.xyx')).toEqual(['example.com', 'xxx.xyx']);
      expect(parseAllowedDomains('example.com,xxx.xyx, yyy.zzz')).toEqual([
        'example.com',
        'xxx.xyx',
        'yyy.zzz',
      ]);
    });

    it('deduplicates and normalizes case', () => {
      expect(parseAllowedDomains('EXAMPLE.COM example.com @EXAMPLE.com')).toEqual(['example.com']);
    });

    it('handles empty or blank string', () => {
      expect(parseAllowedDomains('')).toEqual([]);
      expect(parseAllowedDomains('   ')).toEqual([]);
    });
  });

  describe('isAllowedEmail with custom domains list', () => {
    const domains = ['example.com', 'xxx.xyx'];

    it('accepts emails matching configured domains', () => {
      expect(isAllowedEmail('student@example.com', domains)).toBe(true);
      expect(isAllowedEmail('STUDENT@EXAMPLE.COM', domains)).toBe(true);
      expect(isAllowedEmail('123456789-0@example.com', domains)).toBe(true);
      expect(isAllowedEmail('user@xxx.xyx', domains)).toBe(true);
      expect(isAllowedEmail('User.Name+tag@XXX.XYX', domains)).toBe(true);
    });

    it('rejects emails from unlisted domains', () => {
      expect(isAllowedEmail('student@gmail.com', domains)).toBe(false);
      expect(isAllowedEmail('student@example.com.evil.com', domains)).toBe(false);
      expect(isAllowedEmail('student@notexample.com', domains)).toBe(false);
      expect(isAllowedEmail('user@xyx', domains)).toBe(false);
    });

    it('rejects invalid or empty inputs', () => {
      expect(isAllowedEmail('', domains)).toBe(false);
      expect(isAllowedEmail('not-an-email', domains)).toBe(false);
      expect(isAllowedEmail('@example.com', domains)).toBe(false);
      expect(isAllowedEmail(null, domains)).toBe(false);
      expect(isAllowedEmail(undefined, domains)).toBe(false);
    });

    it('allows any valid email if domains list is empty', () => {
      expect(isAllowedEmail('user@gmail.com', [])).toBe(true);
      expect(isAllowedEmail('student@example.com', [])).toBe(true);
      expect(isAllowedEmail('anyone@company.org', [])).toBe(true);
      expect(isAllowedEmail('invalid-email', [])).toBe(false);
    });
  });

  describe('labels and messages', () => {
    it('formats domain labels correctly', () => {
      expect(getAllowedDomainsLabel(['example.com'])).toBe('@example.com');
      expect(getAllowedDomainsLabel(['example.com', 'xxx.xyx'])).toBe('@example.com, @xxx.xyx');
      expect(getAllowedDomainsLabel([])).toBe('');
    });

    it('formats error message with domains', () => {
      expect(getDomainErrorMessage(['example.com'])).toBe(
        'อนุญาตเฉพาะบัญชีอีเมล @example.com เท่านั้น',
      );
      expect(getDomainErrorMessage(['example.com', 'xxx.xyx'])).toBe(
        'อนุญาตเฉพาะบัญชีอีเมล @example.com, @xxx.xyx เท่านั้น',
      );
      expect(getDomainErrorMessage([])).toBe('อีเมลไม่ถูกต้อง');
    });
  });
});
