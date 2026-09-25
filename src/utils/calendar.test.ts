import { describe, expect, it } from 'vitest';
import { compareDueDate, dueDeadline, dueState, parseTime, monthGrid, monthKey, parseMonthKey, toISODate } from './calendar';

describe('calendar', () => {
  it('builds a Monday-first six week grid', () => {
    const grid = monthGrid(2026, 8); // September 2026 starts on a Tuesday
    expect(grid).toHaveLength(42);
    expect(toISODate(grid[0])).toBe('2026-08-31');
    expect(toISODate(grid[1])).toBe('2026-09-01');
    expect(grid.every((day, index) => index === 0 || day.getDay() === (grid[0].getDay() + index) % 7)).toBe(true);
  });

  it('parses and formats month keys', () => {
    expect(parseMonthKey('2026-02')).toEqual({ year: 2026, month: 1 });
    expect(parseMonthKey('2026-13', new Date(2025, 4, 3))).toEqual({ year: 2025, month: 4 });
    expect(monthKey(2026, 12)).toBe('2027-01');
    expect(monthKey(2026, -1)).toBe('2025-12');
  });

  it('classifies due dates', () => {
    const today = new Date(2026, 8, 25, 15);
    expect(dueState('', today)).toBe('none');
    expect(dueState('2026-09-24', today)).toBe('overdue');
    expect(dueState('2026-09-25', today)).toBe('soon');
    expect(dueState('2026-09-27', today)).toBe('soon');
    expect(dueState('2026-09-28', today)).toBe('normal');
  });

  it('parses typed times', () => {
    expect(['9', '930', '0930', '9:30', '9.30', '23:59'].map(parseTime)).toEqual(['09:00', '09:30', '09:30', '09:30', '09:30', '23:59']);
    expect(['24:00', '9:60', 'noon', '12345', ''].map(parseTime)).toEqual([null, null, null, null, null]);
  });

  it('uses the due time when set', () => {
    const today = new Date(2026, 8, 25, 15);
    expect(dueState('2026-09-25', today, 2, '14:30')).toBe('overdue');
    expect(dueState('2026-09-25', today, 2, '16:00')).toBe('soon');
    expect(dueState('2026-09-26', today, 2, '09:00')).toBe('soon');
    expect(dueDeadline('2026-09-25', '14:30')).toEqual(new Date(2026, 8, 25, 14, 30));
    expect(dueDeadline('2026-09-25')).toEqual(new Date(2026, 8, 25, 23, 59, 59));
  });

  it('sorts undated items last', () => {
    expect(['', '2026-03-01', '2026-01-01', ''].sort((a, b) => compareDueDate(a, b))).toEqual(['2026-01-01', '2026-03-01', '', '']);
  });

  it('sorts by time within a day, untimed last', () => {
    const items = [{ d: '2026-03-01', t: '' }, { d: '2026-03-01', t: '17:00' }, { d: '2026-03-01', t: '09:00' }, { d: '2026-02-01', t: '' }];
    expect(items.sort((a, b) => compareDueDate(a.d, b.d, a.t, b.t)).map((item) => item.t || item.d)).toEqual(['2026-02-01', '09:00', '17:00', '2026-03-01']);
  });
});
