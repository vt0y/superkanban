import { describe, expect, it } from 'vitest';
import { sanitizeTimePart } from './TimeField';

describe('sanitizeTimePart', () => {
  it('pads a first digit that cannot start a two-digit value and moves on', () => {
    expect(sanitizeTimePart('hour', '7')).toEqual({ value: '07', done: true });
    expect(sanitizeTimePart('hour', '2')).toEqual({ value: '2', done: false });
    expect(sanitizeTimePart('minute', '6')).toEqual({ value: '06', done: true });
    expect(sanitizeTimePart('minute', '5')).toEqual({ value: '5', done: false });
  });

  it('drops a second digit that would overflow', () => {
    expect(sanitizeTimePart('hour', '23')).toEqual({ value: '23', done: true });
    expect(sanitizeTimePart('hour', '25')).toEqual({ value: '2', done: false });
    expect(sanitizeTimePart('minute', '59')).toEqual({ value: '59', done: true });
  });

  it('ignores non-digits and extra characters', () => {
    expect(sanitizeTimePart('hour', 'a1b')).toEqual({ value: '1', done: false });
    expect(sanitizeTimePart('minute', '305')).toEqual({ value: '30', done: true });
    expect(sanitizeTimePart('hour', '')).toEqual({ value: '', done: false });
  });
});
