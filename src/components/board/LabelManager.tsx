import { useState, type FormEvent } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import { Modal } from '@/components/common';
import { attempt, toast } from '@/components/toast';
import { createLabel, deleteLabel, importTagsAsLabels, nextLabelColor, updateWorkItem } from '@/services';
import type { Label, Role, Task } from '@/types';
import { canDeleteItem } from '@/utils/permissions';
import { pick } from '@/utils/formatters';
import { LabelChip } from './LabelChip';

/** The color input fires on every drag step; only save once it settles. */
let colorTimer = 0;

export function LabelManager({ labels, tasks, projectId, context, role, readOnly, onClose, onFilter }: {
  labels: Label[]; tasks: Task[]; projectId: string; context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void; onFilter: (label: Label) => void;
}) {
  const { locale, user } = context;
  const [name, setName] = useState('');
  const [color, setColor] = useState(nextLabelColor(labels));
  const [busy, setBusy] = useState(false);
  const legacyTags = new Set(tasks.flatMap((task) => task.tags || []).map((tag) => tag.toLowerCase())).size;
  const usage = (id: string) => tasks.filter((task) => task.labelIds?.includes(id)).length;
  const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (labels.some((label) => label.name.toLowerCase() === name.trim().toLowerCase())) { toast(pick(locale, 'มี label ชื่อนี้แล้ว', 'A label with this name exists'), 'error'); return; }
    const id = await attempt(() => createLabel(projectId, name, color, user), pick(locale, 'สร้าง label ไม่สำเร็จ', 'Could not create label'));
    if (id) { setName(''); setColor(nextLabelColor([...labels, { color }])); }
  };
  const save = (label: Label, values: Partial<Label>) => {
    if (values.name !== undefined && !values.name.trim()) return;
    void attempt(() => updateWorkItem(projectId, 'labels', label.id, values), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
  };
  const remove = async (label: Label) => {
    const count = usage(label.id);
    if (!confirm(pick(locale, `ลบ label “${label.name}”? (ใช้อยู่ ${count} งาน)`, `Delete label “${label.name}”? (used by ${count} tasks)`))) return;
    await attempt(() => deleteLabel(projectId, label.id, tasks), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed'));
  };
  const importTags = async () => {
    setBusy(true);
    const created = await attempt(() => importTagsAsLabels(projectId, tasks, labels, user), pick(locale, 'แปลงไม่สำเร็จ', 'Import failed'));
    setBusy(false);
    if (created !== undefined) toast(pick(locale, `แปลง tag เป็น label แล้ว (${created} ใหม่)`, `Tags converted (${created} new labels)`), 'success');
  };

  return <Modal title="Labels" onClose={onClose}>
    {!readOnly && legacyTags > 0 && <div className="label-import"><span>🏷 {pick(locale, `มี tag เดิม ${legacyTags} แบบในงาน`, `${legacyTags} old free-text tags found on tasks`)}</span><button type="button" className="secondary" disabled={busy} onClick={() => void importTags()}>{pick(locale, 'แปลงเป็น label', 'Import as labels')}</button></div>}
    {!readOnly && <form className="label-new" onSubmit={create}>
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={pick(locale, 'ชื่อ label ใหม่', 'New label name')} maxLength={50} />
      <button className="primary" disabled={!name.trim()}>{pick(locale, 'สร้าง', 'Create')}</button>
    </form>}
    <div className="label-list">{sorted.map((label) => <div key={label.id} className="label-row">
      <LabelChip label={label} onClick={() => { onFilter(label); onClose(); }} />
      {!readOnly ? <>
        <input type="color" defaultValue={label.color} onChange={(e) => { const value = e.target.value; clearTimeout(colorTimer); colorTimer = window.setTimeout(() => save(label, { color: value }), 400); }} aria-label="Color" />
        <input defaultValue={label.name} maxLength={50} onBlur={(e) => e.target.value.trim() !== label.name && save(label, { name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="Name" />
      </> : <span />}
      <small>{usage(label.id)} {pick(locale, 'งาน', 'tasks')}</small>
      {!readOnly && canDeleteItem(role, label.createdBy, user.uid) ? <button type="button" className="danger ghost" onClick={() => void remove(label)}>×</button> : <span />}
    </div>)}
    {!labels.length && <p className="muted">{pick(locale, 'ยังไม่มี label', 'No labels yet')}</p>}</div>
  </Modal>;
}
