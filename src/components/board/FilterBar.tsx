import { forwardRef, useMemo, useState } from 'react';
import type { Label, Membership, Milestone } from '@/types';
import { TASK_COLUMNS } from '@/config/constants';
import { pick } from '@/utils/formatters';
import { queryValue, toggleQueryTerm } from '@/utils/task-filter';
import { Icon } from '@/components/common/Icon';

/** GitHub-style filter input: `label:bug assignee:@me -is:done`, with value suggestions for the qualifier being typed. */
export const FilterBar = forwardRef<HTMLInputElement, {
  value: string; onChange: (value: string) => void; labels: Label[]; members: Membership[]; milestones: Milestone[]; locale: string; presets?: boolean;
}>(function FilterBar({ value, onChange, labels, members, milestones, locale, presets = true }, ref) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const lastToken = value.match(/(?:^|\s)(-?)([a-z]*)(?::("?[^"\s]*))?$/i);
  const suggestions = useMemo(() => {
    const [, neg = '', key = '', typed] = lastToken || [];
    const qualifiers: [string, string][] = [
      ['label:', pick(locale, 'ตาม label', 'by label')], ['assignee:', pick(locale, 'ผู้รับผิดชอบ', 'by assignee')], ['is:', 'open / done / overdue / blocked'],
      ['priority:', 'low / medium / high / urgent'], ['status:', pick(locale, 'สถานะ', 'by status')], ['milestone:', 'milestone'], ['due:', 'today / week / none'], ['no:', 'label / assignee / milestone / due'],
    ];
    if (typed === undefined) return key ? qualifiers.filter(([name]) => name.startsWith(key.toLowerCase())).map(([name, hint]) => ({ insert: `${neg}${name}`, label: name, hint, complete: false })) : [];
    const values: Record<string, string[]> = {
      label: labels.map((label) => label.name), assignee: ['@me', ...members.map((member) => member.email.split('@')[0])], is: ['open', 'done', 'overdue', 'blocked'],
      priority: ['low', 'medium', 'high', 'urgent'], status: TASK_COLUMNS.map((column) => column.id), milestone: milestones.map((milestone) => milestone.title), due: ['today', 'week', 'none'], no: ['label', 'assignee', 'milestone', 'due'],
    };
    const needle = typed.replace(/^"/, '').toLowerCase();
    return (values[key.toLowerCase()] || []).filter((item) => item.toLowerCase().includes(needle)).slice(0, 8)
      .map((item) => ({ insert: `${neg}${key}:${queryValue(item)} `, label: item, hint: '', complete: true }));
  }, [lastToken?.[0], labels, members, milestones, locale]);
  const open = focused && suggestions.length > 0;
  const apply = (insert: string) => { onChange(value.slice(0, value.length - (lastToken?.[0].trimStart().length || 0)) + insert); setActive(0); };

  const chip = (term: string, label: string) => <button type="button" className={value.split(/\s+/).includes(term) ? 'active' : ''} onClick={() => onChange(toggleQueryTerm(value, term))}>{label}</button>;
  return <div className="filter-bar">
    <label className="search filter-input"><span><Icon name="search" /></span>
      <input ref={ref} value={value} onChange={(e) => { onChange(e.target.value); setActive(0); }} onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 120)}
        placeholder={pick(locale, 'กรอง เช่น label:bug assignee:@me is:open  (กด / เพื่อค้นหา)', 'Filter, e.g. label:bug assignee:@me is:open  (press /)')} spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { if (value) { e.stopPropagation(); onChange(''); } else e.currentTarget.blur(); return; }
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % suggestions.length); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + suggestions.length) % suggestions.length); }
          if (e.key === 'Tab' || (e.key === 'Enter' && suggestions[active])) { e.preventDefault(); apply(suggestions[active].insert); }
        }} />
      {value && <button type="button" className="filter-clear" onClick={() => onChange('')} aria-label={pick(locale, 'ล้างตัวกรอง', 'Clear filter')}><Icon name="close" /></button>}
      {open && <div className="filter-suggestions" role="listbox">{suggestions.map((item, index) => <button key={item.insert} type="button" role="option" aria-selected={index === active} className={index === active ? 'active' : ''}
        onMouseDown={(e) => { e.preventDefault(); apply(item.insert); }}><b>{item.label}</b>{item.hint && <small>{item.hint}</small>}</button>)}</div>}
    </label>
    {presets && <div className="filter-presets">{chip('assignee:@me', pick(locale, 'งานของฉัน', 'My tasks'))}{chip('is:open', pick(locale, 'ยังไม่เสร็จ', 'Open'))}{chip('is:overdue', pick(locale, 'เกินกำหนด', 'Overdue'))}{chip('no:assignee', pick(locale, 'ไม่มีผู้รับผิดชอบ', 'Unassigned'))}</div>}
  </div>;
});
