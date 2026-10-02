import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { AppContextValue } from '@/context/AppContext';
import { attempt } from '@/components/toast';
import { createLabel, nextLabelColor } from '@/services/labels';
import type { Label } from '@/types';
import { pick } from '@/utils/formatters';
import { LabelChip } from './LabelChip';
import { Icon } from '@/components/common/Icon';

const POPOVER_WIDTH = 340;

export function LabelPicker({ labels, value, onChange, projectId, context, readOnly, showSelected = true }: {
  labels: Label[]; value: string[]; onChange: (ids: string[]) => void; projectId: string; context: AppContextValue; readOnly: boolean; showSelected?: boolean;
}) {
  const { locale, user } = context;
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selected = labels.filter((label) => value.includes(label.id));
  const term = search.trim().toLowerCase();
  const matches = [...labels].sort((a, b) => a.name.localeCompare(b.name)).filter((label) => label.name.toLowerCase().includes(term));
  const exact = labels.some((label) => label.name.toLowerCase() === term);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    addEventListener('mousedown', close);
    return () => removeEventListener('mousedown', close);
  }, [open]);

  // The popover is portaled to <body> (a modal body scrolls and would clip it), so pin it to the trigger by hand
  // and follow it when the modal scrolls or the window resizes. Phones get a bottom sheet from CSS instead.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = root.current?.querySelector('.label-picker-trigger')?.getBoundingClientRect();
      if (!rect || window.innerWidth < 640) { setPlace({}); return; }
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 32);
      const height = panel.current?.offsetHeight ?? 0;
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
      const below = window.innerHeight - rect.bottom - 6;
      const top = below >= height + 16 || rect.top < below ? rect.bottom + 6 : Math.max(16, rect.top - 6 - height);
      setPlace({ top, left, width, maxHeight: window.innerHeight - top - 16 });
    };
    update();
    addEventListener('resize', update);
    addEventListener('scroll', update, true);
    return () => { removeEventListener('resize', update); removeEventListener('scroll', update, true); };
  }, [open, search, labels.length]);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  const create = async () => {
    const name = search.trim();
    if (!name) return;
    const id = await attempt(() => createLabel(projectId, name, nextLabelColor(labels), user), pick(locale, 'สร้าง label ไม่สำเร็จ', 'Could not create label'));
    if (id) { onChange([...value, id]); setSearch(''); }
  };
  const close = () => { setOpen(false); setSearch(''); };

  return <div className={`label-picker ${showSelected ? '' : 'compact'}`} ref={root}>
    <div className="label-picker-value">
      {showSelected && selected.map((label) => <LabelChip key={label.id} label={label} />)}
      {showSelected && !selected.length && <span className="muted">{pick(locale, 'ไม่มี label', 'No labels')}</span>}
      {!readOnly && <button type="button" className="label-picker-trigger" aria-expanded={open} onClick={() => open ? close() : setOpen(true)}><span aria-hidden><Icon name="label" /></span>{pick(locale, 'จัดการ Labels', 'Manage labels')}{selected.length > 0 && <b>{selected.length}</b>}<i aria-hidden><Icon name="chevronDown" /></i></button>}
    </div>
    {open && createPortal(<><button type="button" className="label-picker-scrim" onClick={close} aria-label={pick(locale, 'ปิดตัวเลือก Labels', 'Close label picker')} /><div ref={panel} className="label-popover" style={place} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <header><div><strong>{pick(locale, 'เลือก Labels', 'Choose labels')}</strong><small>{pick(locale, `เลือกแล้ว ${selected.length} รายการ`, `${selected.length} selected`)}</small></div><button type="button" onClick={close} aria-label={pick(locale, 'ปิด', 'Close')}><Icon name="close" /></button></header>
      <label className="label-picker-search"><span aria-hidden><Icon name="search" /></span><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={pick(locale, 'ค้นหาหรือสร้าง label...', 'Filter or create labels...')}
        onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); if (matches.length && (exact || !term)) toggle(matches[0].id); else if (term) void create(); }} /></label>
      <div className="label-options">
        {matches.map((label) => <label key={label.id} className={value.includes(label.id) ? 'selected' : ''}><input type="checkbox" checked={value.includes(label.id)} onChange={() => toggle(label.id)} /><i style={{ background: label.color }} /><span>{label.name}</span><b aria-hidden>{value.includes(label.id) && <Icon name="check" />}</b></label>)}
        {term && !exact && <button type="button" className="label-create" onClick={() => void create()}><Icon name="add" /> {pick(locale, 'สร้าง label', 'Create label')} “{search.trim()}”</button>}
        {!matches.length && !term && <p className="muted label-picker-empty">{pick(locale, 'พิมพ์ชื่อเพื่อสร้าง label แรก', 'Type a name to create the first label')}</p>}
        {!matches.length && term && exact && <p className="muted label-picker-empty">{pick(locale, 'ไม่พบ label', 'No matching labels')}</p>}
      </div>
      <footer><button type="button" className="primary" onClick={close}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button></footer>
    </div></>, document.body)}
  </div>;
}
