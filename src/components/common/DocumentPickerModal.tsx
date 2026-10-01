import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Locale, Membership, ProjectDocument } from '@/types';
import { attachDriveProjectDocument, isDriveProjectDocument, linkProjectDocumentsToTask, subscribeProjectQuery } from '@/services';
import { attempt } from '@/components/toast';
import { pick } from '@/utils/formatters';
import { DriveAttachmentControl } from './DriveAttachmentControl';
import { Modal } from './Modal';
import { isGoogleDriveEnabled } from '@/config/features';

const displayName = (item: ProjectDocument) => item.kind === 'drive' ? item.nickname?.trim() || item.name : item.title;

export function DocumentPickerModal({ project, taskId, members, user, locale, linkedIds, onClose }: {
  project: { id: string; name: string };
  taskId: string;
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
  const available = useMemo(() => documents.filter((item) => !linkedIds.has(item.id) && [displayName(item), item.kind === 'drive' ? item.name : '', item.kind === 'drive' ? item.description || '' : item.excerpt || ''].join(' ').toLowerCase().includes(query.trim().toLowerCase())), [documents, linkedIds, query]);
  const save = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    const ok = await attempt(() => linkProjectDocumentsToTask(project.id, selected, taskId).then(() => true), pick(locale, 'เชื่อมเอกสารไม่สำเร็จ', 'Could not link documents'));
    setBusy(false);
    if (ok) onClose();
  };

  return <Modal title={pick(locale, 'เพิ่มเอกสารใน Task', 'Add documents to task')} onClose={onClose} wide actions={<button type="button" className="primary" disabled={!selected.length || busy} onClick={() => void save()}>{pick(locale, `เพิ่ม ${selected.length || ''}`.trim(), `Add ${selected.length || ''}`.trim())}</button>}>
    <div className="document-picker">
      <label className="search"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={pick(locale, 'ค้นหาเอกสาร ชื่อเล่น หรือรายละเอียด', 'Search documents, nickname or description')} /></label>
      <div className="document-picker-list">{available.map((item) => <label key={item.id} className={selected.includes(item.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span className="document-picker-icon">{item.kind === 'drive' ? '☁' : '▤'}</span><span><strong>{displayName(item)}</strong><small>{item.kind === 'drive' ? item.description || item.name : item.excerpt || pick(locale, 'เอกสาร Markdown', 'Markdown document')}</small></span></label>)}</div>
      {!available.length && <p className="muted document-picker-empty">{pick(locale, 'ไม่พบเอกสารที่เลือกได้', 'No available documents found')}</p>}
      {isGoogleDriveEnabled && <div className="document-picker-upload"><h3>{pick(locale, 'หรืออัปโหลดเอกสารใหม่', 'Or upload a new document')}</h3><DriveAttachmentControl project={project} members={members} user={user} locale={locale} existingFileIds={new Set(documents.filter(isDriveProjectDocument).map((item) => item.driveFileId))} onAttach={(file, mode, sharing) => attachDriveProjectDocument(project.id, file, mode, sharing, user, [taskId])} /></div>}
    </div>
  </Modal>;
}
