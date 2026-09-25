import { useEffect, useRef, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { attempt } from '@/components/toast';
import { createLabel, nextLabelColor } from '@/services/labels';
import type { Label } from '@/types';
import { pick } from '@/utils/formatters';
import { LabelChip } from './LabelChip';

export function LabelPicker({ labels, value, onChange, projectId, context, readOnly }: {
  labels: Label[]; value: string[]; onChange: (ids: string[]) => void; projectId: string; context: AppContextValue; readOnly: boolean;
}) {
  const { locale, user } = context;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const selected = labels.filter((label) => value.includes(label.id));
  const term = search.trim().toLowerCase();
  const matches = [...labels].sort((a, b) => a.name.localeCompare(b.name)).filter((label) => label.name.toLowerCase().includes(term));
  const exact = labels.some((label) => label.name.toLowerCase() === term);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    addEventListener('mousedown', close);
    return () => removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  const create = async () => {
    const name = search.trim();
    if (!name) return;
    const id = await attempt(() => createLabel(projectId, name, nextLabelColor(labels), user), pick(locale, 'สร้าง label ไม่สำเร็จ', 'Could not create label'));
    if (id) { onChange([...value, id]); setSearch(''); }
  };

  return <div className="label-picker" ref={root}>
    <div className="label-picker-value">
      {selected.map((label) => <LabelChip key={label.id} label={label} />)}
      {!selected.length && <span className="muted">{pick(locale, 'ไม่มี label', 'No labels')}</span>}
      {!readOnly && <button type="button" className="link-button" onClick={() => setOpen(!open)}>{pick(locale, 'แก้ไข', 'Edit')} ▾</button>}
    </div>
    {open && <div className="label-popover" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
      <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={pick(locale, 'ค้นหาหรือสร้าง label...', 'Filter or create labels...')}
        onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); if (matches.length && (exact || !term)) toggle(matches[0].id); else if (term) void create(); }} />
      <div className="label-options">
        {matches.map((label) => <label key={label.id}><input type="checkbox" checked={value.includes(label.id)} onChange={() => toggle(label.id)} /><i style={{ background: label.color }} /><span>{label.name}</span></label>)}
        {term && !exact && <button type="button" className="label-create" onClick={() => void create()}>＋ {pick(locale, 'สร้าง label', 'Create label')} “{search.trim()}”</button>}
        {!labels.length && !term && <p className="muted">{pick(locale, 'พิมพ์ชื่อเพื่อสร้าง label แรก', 'Type a name to create the first label')}</p>}
      </div>
    </div>}
  </div>;
}
