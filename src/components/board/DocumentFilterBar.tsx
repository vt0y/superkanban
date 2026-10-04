import { useMemo, useState } from 'react';
import type { Label, Milestone, Task } from '@/types';
import { parseDocumentQuery } from '@/utils/document-filter';
import { pick } from '@/utils/formatters';
import { queryValue, toggleQueryTerm } from '@/utils/task-filter';
import { Icon } from '@/components/common/Icon';

/** Board-style query bar for documents: text, label/task terms and missing metadata. */
export function DocumentFilterBar({ value, onChange, labels, tasks, milestones, locale }: { value: string; onChange: (value: string) => void; labels: Label[]; tasks: Task[]; milestones: Milestone[]; locale: string }) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const lastToken = value.match(/(?:^|\s)(-?)([a-z]*)(?::("?[^"\s]*))?$/i);
  const suggestions = useMemo(() => {
    const [, neg = '', key = '', typed] = lastToken || [];
    if (typed === undefined) {
      return [
        { insert: `${neg}label:`, label: 'label:', hint: pick(locale, 'กรองตาม label', 'by label') },
        { insert: `${neg}task:`, label: 'task:', hint: pick(locale, 'กรองตามงาน', 'by task') },
        { insert: `${neg}milestone:`, label: 'milestone:', hint: pick(locale, 'กรองตาม milestone', 'by milestone') },
        { insert: `${neg}no:`, label: 'no:', hint: pick(locale, 'รายการที่ไม่มี label', 'missing metadata') },
      ].filter((item) => item.label.startsWith(key.toLowerCase()));
    }
    const needle = typed.replace(/^"/, '').toLowerCase();
    const values = key.toLowerCase() === 'label' ? labels.map((label) => label.name) : key.toLowerCase() === 'task' ? tasks.map((task) => task.title) : key.toLowerCase() === 'milestone' ? milestones.map((milestone) => milestone.title) : key.toLowerCase() === 'no' ? ['label', 'task', 'milestone'] : [];
    return values.filter((item) => item.toLowerCase().includes(needle)).slice(0, 8).map((item) => ({ insert: `${neg}${key}:${queryValue(item)} `, label: item, hint: '' }));
  }, [lastToken?.[0], labels, tasks, milestones, locale]);
  const open = focused && suggestions.length > 0;
  const apply = (insert: string) => {
    const token = lastToken?.[0].trimStart() || '';
    onChange(value.slice(0, value.length - token.length) + insert);
    setActive(0);
  };
  const parsed = parseDocumentQuery(value);
  const hasNoLabel = parsed.terms.some((term) => term.key === 'no' && term.value === 'label' && !term.negated);
  const hasNoTask = parsed.terms.some((term) => term.key === 'no' && term.value === 'task' && !term.negated);
  const hasNoMilestone = parsed.terms.some((term) => term.key === 'no' && term.value === 'milestone' && !term.negated);

  return <div className="filter-bar document-filter-bar">
    <label className="search filter-input"><span><Icon name="search" /></span>
      <input value={value} onChange={(event) => { onChange(event.target.value); setActive(0); }} onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        placeholder={pick(locale, 'กรอง เช่น label:design หรือพิมพ์ชื่อเอกสาร', 'Filter, e.g. label:design or document title')} spellCheck={false}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { if (value) { event.stopPropagation(); onChange(''); } else event.currentTarget.blur(); return; }
          if (!open) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((active + 1) % suggestions.length); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((active - 1 + suggestions.length) % suggestions.length); }
          if (event.key === 'Tab' || (event.key === 'Enter' && suggestions[active])) { event.preventDefault(); apply(suggestions[active].insert); }
        }} />
      {value && <button type="button" className="filter-clear" onClick={() => onChange('')} aria-label={pick(locale, 'ล้างตัวกรอง', 'Clear filter')}><Icon name="close" /></button>}
      {open && <div className="filter-suggestions" role="listbox">{suggestions.map((item, index) => <button key={item.insert} type="button" role="option" aria-selected={index === active} className={index === active ? 'active' : ''}
        onMouseDown={(event) => { event.preventDefault(); apply(item.insert); }}><b>{item.label}</b>{item.hint && <small>{item.hint}</small>}</button>)}</div>}
    </label>
    <div className="filter-presets">
      {[...labels].sort((a, b) => a.name.localeCompare(b.name)).map((label) => {
        const term = `label:${queryValue(label.name)}`;
        const selected = parsed.terms.some((item) => item.key === 'label' && !item.negated && item.value === label.name.toLowerCase());
        return <button type="button" key={label.id} className={selected ? 'active' : ''} onClick={() => onChange(toggleQueryTerm(value, term))}><i style={{ background: label.color }} />{label.name}</button>;
      })}
      <button type="button" className={hasNoLabel ? 'active' : ''} onClick={() => onChange(toggleQueryTerm(value, 'no:label'))}>{pick(locale, 'ไม่มี label', 'No label')}</button>
      {[...tasks].sort((a, b) => a.title.localeCompare(b.title)).slice(0, 30).map((task) => {
        const term = `task:${queryValue(task.title)}`;
        const selected = parsed.terms.some((item) => item.key === 'task' && !item.negated && item.value === task.title.toLowerCase());
        return <button type="button" key={task.id} className={`document-task-filter ${selected ? 'active' : ''}`} onClick={() => onChange(toggleQueryTerm(value, term))}><Icon name="board" /> {task.title}</button>;
      })}
      <button type="button" className={hasNoTask ? 'active' : ''} onClick={() => onChange(toggleQueryTerm(value, 'no:task'))}>{pick(locale, 'ไม่มี Task', 'No task')}</button>
      {[...milestones].sort((a, b) => a.title.localeCompare(b.title)).slice(0, 30).map((milestone) => {
        const term = `milestone:${queryValue(milestone.title)}`;
        const selected = parsed.terms.some((item) => item.key === 'milestone' && !item.negated && item.value === milestone.title.toLowerCase());
        return <button type="button" key={milestone.id} className={`document-task-filter ${selected ? 'active' : ''}`} onClick={() => onChange(toggleQueryTerm(value, term))}><Icon name="milestone" /> {milestone.title}</button>;
      })}
      <button type="button" className={hasNoMilestone ? 'active' : ''} onClick={() => onChange(toggleQueryTerm(value, 'no:milestone'))}>{pick(locale, 'ไม่มี Milestone', 'No milestone')}</button>
    </div>
  </div>;
}
