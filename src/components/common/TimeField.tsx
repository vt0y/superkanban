import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { parseTime } from '@/utils/calendar';

type Part = 'hour' | 'minute';
const MAX: Record<Part, number> = { hour: 23, minute: 59 };

/**
 * Keeps only digits that can still form a valid part: a first digit above the tens limit ("7" for hours) is padded to "07",
 * and a second digit that would overflow ("25") is dropped. `done` means the part is complete and focus can move on.
 */
export function sanitizeTimePart(part: Part, input: string): { value: string; done: boolean } {
  const digits = input.replace(/\D/g, '').slice(0, 2);
  const tensLimit = Math.floor(MAX[part] / 10);
  if (digits.length === 1) return Number(digits) > tensLimit ? { value: `0${digits}`, done: true } : { value: digits, done: false };
  if (digits.length === 2) return Number(digits) > MAX[part] ? { value: digits[0], done: false } : { value: digits, done: true };
  return { value: '', done: false };
}

const split = (value: string) => { const [hour = '', minute = ''] = value ? value.split(':') : []; return { hour, minute }; };
const pad = (part: string) => part.padStart(2, '0');

/** 24-hour `HH : MM` field: one box, two inputs, auto-advance like a card expiry date. Emits `HH:mm` or '' on blur. */
export function TimeField({ value, onChange, disabled, label }: { value: string; onChange: (value: string) => void; disabled?: boolean; label: string }) {
  const [parts, setParts] = useState(() => split(value));
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const invalid = !!parts.minute && !parts.hour;

  useEffect(() => setParts(split(value)), [value]);

  const commit = () => {
    if (!parts.hour && !parts.minute) { if (value) onChange(''); return; }
    if (!parts.hour) { setParts(split(value)); return; }
    const next = `${pad(parts.hour)}:${pad(parts.minute || '0')}`;
    if (next !== value) onChange(next); else setParts(split(value));
  };
  const step = (part: Part, delta: number) => {
    const size = MAX[part] + 1;
    const next = ((Number(parts[part] || 0) + delta) % size + size) % size;
    setParts({ ...parts, [part]: pad(String(next)) });
  };
  const keyDown = (part: Part) => (e: KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(part, e.key === 'ArrowUp' ? 1 : -1); }
    else if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (part === 'hour' && (e.key === ':' || e.key === '.' || (e.key === 'ArrowRight' && atEnd))) {
      e.preventDefault();
      if (parts.hour.length === 1) setParts({ ...parts, hour: pad(parts.hour) });
      minuteRef.current?.focus();
      minuteRef.current?.select();
    } else if (part === 'minute' && ((e.key === 'Backspace' && !input.value) || (e.key === 'ArrowLeft' && atStart))) {
      e.preventDefault();
      hourRef.current?.focus();
    }
  };
  const change = (part: Part) => (raw: string) => {
    const { value: next, done } = sanitizeTimePart(part, raw);
    setParts((current) => ({ ...current, [part]: next }));
    if (part === 'hour' && done) { minuteRef.current?.focus(); minuteRef.current?.select(); }
  };
  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseTime(e.clipboardData.getData('text'));
    if (!parsed || !/[:.]/.test(e.clipboardData.getData('text'))) return;
    e.preventDefault();
    setParts(split(parsed));
    minuteRef.current?.focus();
  };
  const input = (part: Part) => <input ref={part === 'hour' ? hourRef : minuteRef} value={parts[part]} placeholder={part === 'hour' ? 'HH' : 'MM'}
    inputMode="numeric" autoComplete="off" maxLength={2} disabled={disabled} aria-label={`${label} (${part === 'hour' ? 'HH' : 'MM'})`} aria-invalid={invalid}
    onChange={(e) => change(part)(e.target.value)} onKeyDown={keyDown(part)} onPaste={paste} onFocus={(e) => e.currentTarget.select()} />;

  return <span role="group" aria-label={label} title={label} className={`time-field ${invalid ? 'invalid' : ''} ${disabled ? 'disabled' : ''}`}
    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commit(); }}
    // Clicking the box (or ':') would otherwise activate the surrounding <label>'s date input.
    onClick={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); if (!disabled) (parts.hour ? minuteRef : hourRef).current?.focus(); } }}>
    {input('hour')}<span aria-hidden>:</span>{input('minute')}
  </span>;
}
