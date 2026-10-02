import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Locale, Membership } from '@/types';
import { Avatar } from '@/components/common';
import { Icon } from '@/components/common/Icon';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel';
import { pick } from '@/utils/formatters';

const PANEL_WIDTH = 320;

/** Assignee chips plus a searchable member picker (a bottom sheet on phones), in the style of LabelPicker. */
export function AssigneePicker({ members, value, onChange, currentUserId, locale, readOnly }: {
  members: Membership[]; value: string[]; onChange: (ids: string[]) => void; currentUserId: string; locale: Locale; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const place = useAnchoredPanel(open, trigger, panel, PANEL_WIDTH, [search]);
  const selected = members.filter((member) => value.includes(member.userId));
  const term = search.trim().toLowerCase();
  const matches = [...members]
    .sort((a, b) => Number(b.userId === currentUserId) - Number(a.userId === currentUserId) || a.displayName.localeCompare(b.displayName))
    .filter((member) => !term || member.displayName.toLowerCase().includes(term) || member.email.toLowerCase().includes(term));
  const amMember = members.some((member) => member.userId === currentUserId);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    addEventListener('mousedown', close);
    return () => removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  const close = () => { setOpen(false); setSearch(''); };

  return <div className="assignee-picker" ref={root}>
    <div className="label-picker-value">
      {selected.map((member) => <span key={member.id} className="assignee-chip">
        <Avatar name={member.displayName} src={member.photoURL} size="sm" />
        <span>{member.userId === currentUserId ? pick(locale, `${member.displayName} (ฉัน)`, `${member.displayName} (me)`) : member.displayName}</span>
        {!readOnly && <button type="button" onClick={() => toggle(member.userId)} aria-label={pick(locale, `เอา ${member.displayName} ออก`, `Unassign ${member.displayName}`)}><Icon name="close" /></button>}
      </span>)}
      {!selected.length && <span className="muted">{pick(locale, 'ยังไม่มีผู้รับผิดชอบ', 'Unassigned')}</span>}
      {!readOnly && amMember && !value.includes(currentUserId) && <button type="button" className="link-button assign-me" onClick={() => onChange([...value, currentUserId])}>{pick(locale, 'มอบหมายให้ฉัน', 'Assign to me')}</button>}
      {!readOnly && <button ref={trigger} type="button" className="label-picker-trigger" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <span aria-hidden><Icon name="userPlus" /></span>{pick(locale, 'เลือกผู้รับผิดชอบ', 'Assign')}<i aria-hidden><Icon name="chevronDown" /></i>
      </button>}
    </div>
    {open && createPortal(<>
      <button type="button" className="label-picker-scrim" onClick={close} aria-label={pick(locale, 'ปิด', 'Close')} />
      <div ref={panel} className="label-popover assignee-popover" style={place} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
        <header><div><strong>{pick(locale, 'ผู้รับผิดชอบ', 'Assignees')}</strong><small>{pick(locale, `เลือกแล้ว ${selected.length} คน`, `${selected.length} selected`)}</small></div><button type="button" onClick={close} aria-label={pick(locale, 'ปิด', 'Close')}><Icon name="close" /></button></header>
        {members.length > 6 && <label className="label-picker-search"><span aria-hidden><Icon name="search" /></span><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={pick(locale, 'ค้นหาสมาชิก…', 'Search members…')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) toggle(matches[0].userId); } }} /></label>}
        <div className="label-options">
          {matches.map((member) => <label key={member.id} className={value.includes(member.userId) ? 'selected' : ''}>
            <input type="checkbox" checked={value.includes(member.userId)} onChange={() => toggle(member.userId)} />
            <Avatar name={member.displayName} src={member.photoURL} size="sm" />
            <span>{member.displayName}{member.userId === currentUserId && <small> · {pick(locale, 'ฉัน', 'me')}</small>}</span>
            <b aria-hidden>{value.includes(member.userId) && <Icon name="check" />}</b>
          </label>)}
          {!matches.length && <p className="muted label-picker-empty">{pick(locale, 'ไม่พบสมาชิก', 'No matching members')}</p>}
        </div>
        <footer><button type="button" className="primary" onClick={close}>{pick(locale, 'เสร็จสิ้น', 'Done')}</button></footer>
      </div>
    </>, document.body)}
  </div>;
}
