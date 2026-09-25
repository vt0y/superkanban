/** Local `YYYY-MM-DD` for a date (never shifted by the UTC offset like `toISOString`). */
export function toISODate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return toISODate(a) === toISODate(b);
}

/** 42 days (6 weeks, Monday first) covering the given month; `month` is 0-based. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(year, month, 1 - offset + index));
}

/** `YYYY-MM` for a month key in the URL; falls back to the current month when invalid. */
export function parseMonthKey(value: string | null, today = new Date()): { year: number; month: number } {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return { year: Number(match[1]), month: Number(match[2]) - 1 };
  return { year: today.getFullYear(), month: today.getMonth() };
}

export function monthKey(year: number, month: number): string {
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export type DueState = 'overdue' | 'soon' | 'normal' | 'none';

/** Normalizes typed times ("9", "930", "9.30", "09:30") to `HH:mm`; `null` when it isn't a valid time. */
export function parseTime(input: string): string | null {
  const match = input.trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The moment a due date (plus optional `HH:mm`) passes; without a time it is the end of that day. */
export function dueDeadline(date: string, time = ''): Date {
  const deadline = parseISODate(date);
  const [hours, minutes] = time ? time.split(':').map(Number) : [23, 59];
  deadline.setHours(hours, minutes, time ? 0 : 59, 0);
  return deadline;
}

/** Overdue once the deadline has passed, "soon" when due within `soonDays` days (today included). */
export function dueState(dueDate: string, today = new Date(), soonDays = 2, dueTime = ''): DueState {
  if (!dueDate) return 'none';
  if (dueDeadline(dueDate, dueTime) < today) return 'overdue';
  const start = parseISODate(toISODate(today)).getTime();
  const days = Math.round((parseISODate(dueDate).getTime() - start) / 86_400_000);
  return days <= soonDays ? 'soon' : 'normal';
}

/** Sort by due date ascending (same day: by time, untimed after timed), with undated items last. */
export function compareDueDate(a: string, b: string, aTime = '', bTime = ''): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return a.localeCompare(b) || (aTime || '99:99').localeCompare(bTime || '99:99');
}
