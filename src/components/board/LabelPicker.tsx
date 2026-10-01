import { useEffect, useRef, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { attempt } from '@/components/toast';
import { createLabel, nextLabelColor } from '@/services/labels';
import type { Label } from '@/types';
import { pick } from '@/utils/formatters';
import { LabelChip } from './LabelChip';

const POPOVER_WIDTH = 340;

export function LabelPicker({ labels, value, onChange, projectId, context, readOnly, showSelected = true }: {
  labels: Label[]; value: string[]; onChange: (ids: string[]) => void; projectId: string; context: AppContextValue; readOnly: boolean; showSelected?: boolean;
}) {
  const { locale, user } = context;
  const [open, setOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
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
  const close = () => { setOpen(false); setSearch(''); };
  // Open toward whichever side has room so the popover never slides under the sidebar or off-screen.
  const openPopover = () => {
    const rect = root.current?.getBoundingClientRect();
    setAlignEnd(Boolean(rect && rect.left + POPOVER_WIDTH > window.innerWidth - 16 && rect.right - POPOVER_WIDTH >= 16));
    setOpen(true);
  };

  return <div className={`label-picker ${showSelected ? '' : 'compact'}`} ref={root}>
    <div className="label-picker-value">
      {showSelected && selected.map((label) => <LabelChip key={label.id} label={label} />)}
      {showSelected && !selected.length && <span className="muted">{pick(locale, 'ไม่มี label', 'No labels')}</span>}
      {!readOnly && <button type="button" className="label-picker-trigger" aria-expanded={open} onClick={() => open ? close() : openPopover()}><span aria-hidden>🏷</span>{pick(locale, 'จัดการ Labels', 'Manage labels')}{selected.length > 0 && <b>{selected.length}</b>}<i aria-hidden>⌄</i></button>}
    </div>
    {open && <><button type="button" className="label-picker-scrim" onClick={close} aria-label={pick(locale, 'ปิดตัวเลือก Labels', 'Close label picker')} /><div className={`label-popover ${alignEnd ? 'align-end' : ''}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <header><div><strong>{pick(locale, 'เลือก Labels', 'Choose labels')}</strong><small>{pick(locale, `เลือกแล้ว ${selected.length} รายการ`, `${selected.length} selected`)}</small></div><button type="button" onClick={close} aria-label={pick(locale, 'ปิด', 'Close')}>×</button></header>
      <label className="label-picker-search"><span aria-hidden>⌕</span><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={pick(locale, 'ค้นหาหรือสร้าง label...', 'Filter or create labels...')}
        onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); if (matches.length && (exact || !term)) toggle(matches[0].id); else if (term) void create(); }} /></label>
      <div className="label-options">
        {matches.map((label) => <label key={label.id} className={value.includes(label.id) ? 'selected' : ''}><input type="checkbox" checked={value.includes(label.id)} onChange={() => toggle(label.id)} /><i style={{ background: label.color }} /><span>{label.name}</span><b aria-hidden>{value.includes(label.id) ? '✓' : ''}</b></label>)}
        {term && !exact && <button type="button" className="label-create" onClick={() => void create()}>＋ {pick(locale, 'สร้าง label', 'Create label')} “{search.trim()}”</button>}
        {!matches.length && !term && <p className="muted label-picker-empty">{pick(locale, 'พิมพ์ชื่อเพื่อสร้าง label แรก', 'Type a name to create the first label')}</p>}
        {!matches.length && term && exact && <p className="muted label-picker-empty">{pick(locale, 'ไม่พบ label', 'No matching labels')}</p>}
      </div>
      <footer><button type="button" className="primary" onClick={close}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button></footer>
    </div></>}
  </div>;
}
