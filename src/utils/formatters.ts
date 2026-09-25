import type { Locale } from '@/types';

export function pick(locale: Locale | string, th: string, en: string): string {
  return locale === 'th' ? th : en;
}

export function formatDate(date: string, locale: string): string {
  if (!date) return '—';
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short' });
}

/** `formatDate` plus the `HH:mm` time when one is set. */
export function formatDue(date: string, time: string | undefined, locale: string): string {
  return date && time ? `${formatDate(date, locale)} ${time}` : formatDate(date, locale);
}

export function formatDateTime(value: { toDate(): Date }, locale: string): string {
  return value.toDate().toLocaleString(locale === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(date: Date | undefined, locale: string): string {
  if (!date) return locale === 'th' ? 'เมื่อสักครู่' : 'just now';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale === 'th' ? 'th' : 'en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}
