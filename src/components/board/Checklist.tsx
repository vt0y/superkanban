import { useState } from 'react';
import type { ChecklistItem } from '@/types';
import { pick } from '@/utils/formatters';

const newId = () => Math.random().toString(36).slice(2, 10);

export function Checklist({ items, onChange, locale, readOnly }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void; locale: string; readOnly: boolean }) {
  const [draft, setDraft] = useState('');
  const done = items.filter((item) => item.done).length;
  const update = (id: string, values: Partial<ChecklistItem>) => onChange(items.map((item) => (item.id === id ? { ...item, ...values } : item)));
  const add = () => { const text = draft.trim(); if (!text) return; onChange([...items, { id: newId(), text: text.slice(0, 300), done: false }]); setDraft(''); };
  return <div className="checklist">
    <div className="checklist-head"><span>{pick(locale, 'เช็กลิสต์', 'Checklist')}</span>{items.length > 0 && <small>{done}/{items.length}</small>}</div>
    {items.length > 0 && <div className="checklist-bar"><i style={{ width: `${(done / items.length) * 100}%` }} /></div>}
    {items.map((item) => <div key={item.id} className={`checklist-item ${item.done ? 'done' : ''}`}>
      <input type="checkbox" checked={item.done} disabled={readOnly} onChange={(e) => update(item.id, { done: e.target.checked })} aria-label={item.text} />
      <input value={item.text} readOnly={readOnly} onChange={(e) => onChange(items.map((row) => (row.id === item.id ? { ...row, text: e.target.value } : row)))}
        onBlur={(e) => { if (!e.target.value.trim()) onChange(items.filter((row) => row.id !== item.id)); }} maxLength={300} />
      {!readOnly && <button type="button" onClick={() => onChange(items.filter((row) => row.id !== item.id))} aria-label={pick(locale, 'ลบ', 'Remove')}>×</button>}
    </div>)}
    {!readOnly && items.length < 100 && <input className="checklist-add" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={pick(locale, '＋ เพิ่มรายการ แล้วกด Enter', '＋ Add an item, press Enter')}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} />}
  </div>;
}
