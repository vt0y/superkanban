import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Locale, Membership, ProjectDocument } from '@/types';
import { attachCanvaProjectDocument, attachDriveProjectDocument, isDriveProjectDocument, linkProjectDocumentsToMilestone, linkProjectDocumentsToTask, subscribeProjectQuery } from '@/services';
import { attempt } from '@/components/toast';
import { pick } from '@/utils/formatters';
import { DriveAttachmentControl } from './DriveAttachmentControl';
import { CanvaLinkForm } from './CanvaLinkControl';
import { Modal } from './Modal';
import { isGoogleDriveEnabled } from '@/config/features';
import { Icon } from '@/components/common/Icon';

const displayName = (item: ProjectDocument) => item.kind === 'drive' ? item.nickname?.trim() || item.name : item.kind === 'canva' ? item.nickname?.trim() || item.title : item.title;
const summary = (item: ProjectDocument) => item.kind === 'drive' ? item.description || item.name : item.kind === 'canva' ? item.description || 'Canva' : item.excerpt || '';

export type DocumentPickerTarget = { type: 'task' | 'milestone'; id: string };

export function DocumentPickerModal({ project, target, members, user, locale, linkedIds, onClose }: {
  project: { id: string; name: string };
  target: DocumentPickerTarget;
  members: Membership[];
  user: User;
  locale: Locale;
  linkedIds: Set<string>;
  onClose: () => void;
}) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeProjectQuery<ProjectDocument>(project.id, 'documents', 'picker:recent:100', [orderBy('updatedAt', 'desc'), limit(100)], setDocuments), [project.id]);
  const available = useMemo(() => documents.filter((item) => !linkedIds.has(item.id) && [displayName(item), item.kind === 'drive' ? item.name : item.kind === 'canva' ? item.title : '', summary(item)].join(' ').toLowerCase().includes(query.trim().toLowerCase())), [documents, linkedIds, query]);
  const save = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    const ok = await attempt(() => (target.type === 'task'
      ? linkProjectDocumentsToTask(project.id, selected, target.id)
      : linkProjectDocumentsToMilestone(project.id, selected, target.id)).then(() => true), pick(locale, 'เชื่อมเอกสารไม่สำเร็จ', 'Could not link documents'));
    setBusy(false);
    if (ok) onClose();
  };

  const addButton = <button type="button" className="primary" disabled={!selected.length || busy} onClick={() => void save()}>{pick(locale, `เพิ่ม ${selected.length || ''}`.trim(), `Add ${selected.length || ''}`.trim())}</button>;
  const targetName = target.type === 'task' ? 'Task' : 'Milestone';
  return <Modal title={pick(locale, `เพิ่มเอกสารใน ${targetName}`, `Add documents to ${targetName.toLowerCase()}`)} onClose={onClose} wide actions={addButton}>
    <div className="document-picker">
      <label className="search"><span><Icon name="search" /></span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={pick(locale, 'ค้นหาเอกสาร ชื่อเล่น หรือรายละเอียด', 'Search documents, nickname or description')} /></label>
      <div className="document-picker-list">{available.map((item) => <label key={item.id} className={selected.includes(item.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span className="document-picker-icon"><Icon name={item.kind === 'drive' ? 'cloud' : item.kind === 'canva' ? 'canva' : 'document'} /></span><span><strong>{displayName(item)}</strong><small>{summary(item) || pick(locale, 'เอกสาร Markdown', 'Markdown document')}</small></span></label>)}</div>
      {!available.length && <p className="muted document-picker-empty">{pick(locale, 'ไม่พบเอกสารที่เลือกได้', 'No available documents found')}</p>}
      {isGoogleDriveEnabled && <div className="document-picker-upload"><h3>{pick(locale, 'หรืออัปโหลดเอกสารใหม่', 'Or upload a new document')}</h3><DriveAttachmentControl project={project} members={members} user={user} locale={locale} existingFileIds={new Set(documents.filter(isDriveProjectDocument).map((item) => item.driveFileId))} onAttach={(file, mode, sharing) => attachDriveProjectDocument(project.id, file, mode, sharing, user, target.type === 'task' ? [target.id] : [], target.type === 'milestone' ? [target.id] : [])} /></div>}
      <details className="document-picker-upload canva-picker"><summary>{pick(locale, 'หรือแนบงานออกแบบ Canva', 'Or attach a Canva design')}</summary><CanvaLinkForm user={user} locale={locale} onAttach={(link, title) => attachCanvaProjectDocument(project.id, link, title, user, target.type === 'task' ? [target.id] : [], [], target.type === 'milestone' ? [target.id] : []).then(onClose)} /></details>
      {/* Desktop footer; on mobile the header button is shown and these are hidden by .modal.has-actions. */}
      <div className="form-actions"><span /><button type="button" className="secondary" onClick={onClose}>{pick(locale, 'ยกเลิก', 'Cancel')}</button>{addButton}</div>
    </div>
  </Modal>;
}
