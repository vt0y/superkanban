import { useEffect, useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import type { DriveAccessMode, DriveFileRef, DriveRole, DriveShareMode, Locale, Membership, Project } from '@/types';
import {
  createGoogleWorkspaceFile,
  DEFAULT_DRIVE_SHARE_MODE,
  DRIVE_ROOT_FOLDER_NAME,
  driveFolderUrl,
  driveOpenUrl,
  effectiveDriveRole,
  getCachedProjectDriveFolderId,
  getDriveFile,
  isGoogleWorkspaceMimeType,
  getOrCreateProjectDriveFolder,
  LOCAL_DRIVE_FILE_MAX_BYTES,
  parseGoogleFileLink,
  pickDriveFiles,
  shareDriveFile,
  uploadFileToDrive,
  validateLocalDriveFile,
  type DriveFileCandidate,
  type DriveShareResult,
  type GoogleWorkspaceFileType,
} from '@/services/google-drive';
import { syncProjectDrivePermissions, UNMANAGED_DRIVE_SHARING, type DrivePermissionSyncSummary } from '@/services/drive-attachments';
import { toast } from '@/components/toast';
import { pick } from '@/utils/formatters';
import { Icon } from '@/components/common/Icon';

type QueueState = 'queued' | 'uploading' | 'sharing' | 'attached' | 'duplicate' | 'error';
type QueueSource = 'local' | 'drive' | 'picker' | 'create' | 'link';

interface UploadQueueItem {
  key: string;
  name: string;
  source: QueueSource;
  state: QueueState;
  mode: DriveAccessMode;
  /** Requested role; clamped per file by effectiveDriveRole before sharing. */
  role: DriveRole;
  progress: number;
  localFile?: File;
  createType?: GoogleWorkspaceFileType;
  candidate?: DriveFileCandidate;
  sharing?: DriveShareResult;
  duplicateChecked?: boolean;
  retryable?: boolean;
  message?: string;
}

export type UploadRetryAction = 'restart-upload' | 'resume-attach' | 'reopen-picker' | null;

export function uploadRetryAction(item: Pick<UploadQueueItem, 'state' | 'source' | 'candidate' | 'localFile' | 'retryable'> & { createType?: GoogleWorkspaceFileType }): UploadRetryAction {
  if (item.state !== 'error' || !item.retryable) return null;
  if (item.source === 'picker') return 'reopen-picker';
  if (item.candidate) return 'resume-attach';
  return item.localFile || item.createType ? 'restart-upload' : null;
}

export function driveRoleLabel(role: DriveRole, locale: Locale): string {
  if (role === 'writer') return pick(locale, 'แก้ไขได้', 'Editor');
  if (role === 'commenter') return pick(locale, 'แสดงความคิดเห็นได้', 'Commenter');
  return pick(locale, 'ดูได้', 'Viewer');
}

const DRIVE_ROLES: DriveRole[] = ['reader', 'commenter', 'writer'];
const CREATE_TYPES: GoogleWorkspaceFileType[] = ['document', 'spreadsheet', 'presentation'];

function createTypeLabel(type: GoogleWorkspaceFileType): string {
  return type === 'document' ? 'Google Docs' : type === 'spreadsheet' ? 'Google Sheets' : 'Google Slides';
}

export function updateUploadQueueItem<T extends { key: string }>(items: T[], key: string, patch: Partial<T>): T[] {
  return items.map((item) => item.key === key ? { ...item, ...patch } : item);
}

export type DetachAction = () => false | Promise<boolean>;

export function beginOptimisticDetach(onDetach: DetachAction, setHidden: (hidden: boolean) => void): void {
  let result: false | Promise<boolean>;
  try { result = onDetach(); }
  catch { return; }
  if (result === false) return;
  setHidden(true);
  void result.then((ok) => { if (!ok) setHidden(false); }, () => setHidden(false));
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

function errorDetails(error: unknown, locale: Locale): { message: string; retryable: boolean } {
  const code = error instanceof Error ? error.message : '';
  if (code === 'DRIVE_FILE_TOO_LARGE') {
    return { message: pick(locale, 'ไฟล์ต้องไม่เกิน 25 MB', 'Files must be 25 MB or smaller'), retryable: false };
  }
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
    return { message: pick(locale, 'ยกเลิกการเชื่อมต่อ Google Drive', 'Google Drive connection was cancelled'), retryable: true };
  }
  if (code.startsWith('DRIVE_PICKER_CALLBACK_') || code === 'DRIVE_PICKER_RESULT_MISSING') {
    return { message: pick(locale, 'เบราว์เซอร์ไม่ได้ส่งไฟล์ที่เลือกกลับมา ลองเปิดตัวเลือกอีกครั้ง หรือใช้ “วางลิงก์” แทน', 'The browser did not return the selected file. Reopen the picker, or use “Paste link” instead.'), retryable: true };
  }
  if (code.startsWith('DRIVE_HTTP_403')) {
    return { message: pick(locale, 'Google Drive ไม่อนุญาตให้แชร์ไฟล์ตามรูปแบบที่เลือก', 'Google Drive could not apply the selected sharing mode'), retryable: true };
  }
  return {
    message: pick(locale, 'แนบไฟล์ไม่สำเร็จ ไฟล์ที่อัปโหลดแล้วยังอยู่ใน Google Drive', 'Could not attach the file. Any completed upload remains in Google Drive'),
    retryable: true,
  };
}

function queueStatus(item: UploadQueueItem, locale: Locale): string {
  if (item.state === 'queued') return pick(locale, 'รอดำเนินการ', 'Waiting');
  if (item.state === 'uploading' && item.source === 'create') return pick(locale, 'กำลังสร้างไฟล์ใน Google Drive', 'Creating in Google Drive');
  if (item.state === 'uploading') return pick(locale, `กำลังอัปโหลด ${Math.round(item.progress * 100)}%`, `Uploading ${Math.round(item.progress * 100)}%`);
  if (item.state === 'sharing') return pick(locale, 'กำลังตั้งค่าสิทธิ์และแนบไฟล์', 'Applying access and attaching');
  if (item.state === 'attached') return pick(locale, 'แนบแล้ว', 'Attached');
  if (item.state === 'duplicate') return pick(locale, 'แนบไฟล์นี้ไว้แล้ว', 'Already attached');
  return item.message || pick(locale, 'แนบไฟล์ไม่สำเร็จ', 'Could not attach file');
}

export function DriveAttachmentControl({ project, members, user, locale, existingFileIds, onAttach }: {
  project: Pick<Project, 'id' | 'name'>;
  members: Membership[];
  user: User;
  locale: Locale;
  existingFileIds: Set<string>;
  onAttach: (file: DriveFileCandidate, mode: DriveAccessMode, sharing: DriveShareResult) => Promise<void>;
}) {
  const [mode, setMode] = useState<DriveShareMode>(DEFAULT_DRIVE_SHARE_MODE);
  const [role, setRole] = useState<DriveRole>('reader');
  const [panel, setPanel] = useState<'create' | 'link' | null>(null);
  const [createType, setCreateType] = useState<GoogleWorkspaceFileType>('document');
  const [createName, setCreateName] = useState('');
  const [createRole, setCreateRole] = useState<DriveRole>('writer');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkError, setLinkError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderId, setFolderId] = useState(() => getCachedProjectDriveFolderId(user.uid, project.id));
  const [folderError, setFolderError] = useState('');
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const sharingName = useId();
  const roleName = useId();
  const detailsId = useId();

  useEffect(() => {
    setFolderId(getCachedProjectDriveFolderId(user.uid, project.id));
    setFolderError('');
    setItems([]);
  }, [user.uid, project.id]);

  const publish = (item: UploadQueueItem, patch: Partial<UploadQueueItem>) => {
    Object.assign(item, patch);
    setItems((current) => updateUploadQueueItem(current, item.key, patch));
  };

  const startBusy = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };

  const stopBusy = () => {
    busyRef.current = false;
    setBusy(false);
  };

  const processItem = async (item: UploadQueueItem, batchSeen: Set<string>) => {
    try {
      if (!item.candidate && item.createType) {
        publish(item, { state: 'uploading', progress: 0, message: undefined, retryable: undefined });
        const created = await createGoogleWorkspaceFile(user, project, item.createType, item.name);
        publish(item, { candidate: created, name: created.name, progress: 1 });
        setFolderId(getCachedProjectDriveFolderId(user.uid, project.id));
      }
      if (!item.candidate) {
        if (!item.localFile) throw new Error('DRIVE_UPLOAD_SOURCE_MISSING');
        validateLocalDriveFile(item.localFile);
        publish(item, { state: 'uploading', progress: 0, message: undefined, retryable: undefined });
        const uploaded = await uploadFileToDrive(user, project, item.localFile, (progress) => publish(item, { progress }));
        publish(item, { candidate: uploaded, name: uploaded.name, progress: 1 });
        setFolderId(getCachedProjectDriveFolderId(user.uid, project.id));
      }

      const candidate = item.candidate;
      if (!candidate) throw new Error('DRIVE_UPLOAD_RESULT_MISSING');
      if (!item.duplicateChecked) {
        publish(item, { duplicateChecked: true });
        if (existingFileIds.has(candidate.driveFileId) || batchSeen.has(candidate.driveFileId)) {
          publish(item, { state: 'duplicate', retryable: false });
          return;
        }
        batchSeen.add(candidate.driveFileId);
      }

      publish(item, { state: 'sharing', progress: 1, message: undefined, retryable: undefined });
      const sharing = item.sharing || (item.mode === 'unmanaged'
        ? UNMANAGED_DRIVE_SHARING
        : await shareDriveFile(user, candidate.driveFileId, item.mode, members, effectiveDriveRole(item.mode, candidate.mimeType, item.role)));
      if (!item.sharing) publish(item, { sharing });
      await onAttach(candidate, item.mode, sharing);
      publish(item, { state: 'attached', progress: 1, retryable: false });
    } catch (error) {
      const details = errorDetails(error, locale);
      publish(item, { state: 'error', ...details });
    }
  };

  const runItems = async (newItems: UploadQueueItem[]) => {
    if (!newItems.length || !startBusy()) return;
    setItems((current) => [...current, ...newItems.map((item) => ({ ...item }))]);
    const batchSeen = new Set<string>();
    try {
      for (const item of newItems) await processItem(item, batchSeen);
    } finally {
      stopBusy();
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const addLocal = (files: File[]) => void runItems(files.map((file) => ({
    key: `local:${crypto.randomUUID()}`,
    name: file.name,
    source: 'local' as const,
    state: 'queued' as const,
    mode,
    role,
    progress: 0,
    localFile: file,
  })));

  const createFile = (event: FormEvent) => {
    event.preventDefault();
    const name = createName.trim() || pick(locale, `${createTypeLabel(createType)} ใหม่`, `Untitled ${createTypeLabel(createType)}`);
    void runItems([{ key: `create:${crypto.randomUUID()}`, name, source: 'create', state: 'queued', mode, role: createRole, progress: 0, createType }]);
    setCreateName('');
    setPanel(null);
  };

  const attachLink = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseGoogleFileLink(linkUrl);
    if (!parsed) {
      setLinkError(pick(locale, 'ใช้ลิงก์ไฟล์จาก Google Docs, Sheets, Slides หรือ Drive (ไม่รองรับโฟลเดอร์)', 'Use a Google Docs, Sheets, Slides or Drive file link (folders are not supported)'));
      return;
    }
    if (!startBusy()) return;
    setLinkError('');
    let item: UploadQueueItem;
    try {
      const candidate = await getDriveFile(user, parsed.driveFileId);
      item = { key: `link:${crypto.randomUUID()}`, name: candidate.name, source: 'link', state: 'queued', mode, role, progress: 1, candidate };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code !== 'DRIVE_HTTP_403' && code !== 'DRIVE_HTTP_404') {
        stopBusy();
        setItems((current) => [...current, { key: `link:${crypto.randomUUID()}`, name: linkUrl, source: 'link', state: 'error', mode, role, progress: 0, ...errorDetails(error, locale) }]);
        return;
      }
      // drive.file cannot read files that were never picked or created here, so keep a link-only reference.
      const name = linkName.trim() || pick(locale, 'ไฟล์ Google Drive', 'Google Drive file');
      item = { key: `link:${crypto.randomUUID()}`, name, source: 'link', state: 'queued', mode: 'unmanaged', role: 'reader', progress: 1, candidate: { driveFileId: parsed.driveFileId, name, mimeType: parsed.mimeType || 'application/octet-stream' } };
    }
    stopBusy();
    setLinkUrl('');
    setLinkName('');
    setPanel(null);
    await runItems([item]);
  };

  const chooseDrive = async (replaceKey?: string) => {
    if (!startBusy()) return;
    if (replaceKey) setItems((current) => current.filter((item) => item.key !== replaceKey));
    try {
      const candidates = await pickDriveFiles(user);
      const newItems: UploadQueueItem[] = candidates.map((candidate) => ({
        key: `drive:${candidate.driveFileId}:${crypto.randomUUID()}`,
        name: candidate.name,
        source: 'drive',
        state: 'queued',
        mode,
        role,
        progress: 1,
        candidate,
      }));
      setItems((current) => [...current, ...newItems.map((item) => ({ ...item }))]);
      const batchSeen = new Set<string>();
      for (const item of newItems) await processItem(item, batchSeen);
    } catch (error) {
      const details = errorDetails(error, locale);
      setItems((current) => [...current, {
        key: `picker:${crypto.randomUUID()}`,
        name: 'Google Drive',
        source: 'picker',
        state: 'error',
        mode,
        role,
        progress: 0,
        ...details,
      }]);
    } finally {
      stopBusy();
    }
  };

  const retry = async (item: UploadQueueItem) => {
    const action = uploadRetryAction(item);
    if (!action || busyRef.current) return;
    if (action === 'reopen-picker') {
      await chooseDrive(item.key);
      return;
    }
    if (!startBusy()) return;
    const work = { ...item };
    publish(work, { state: 'queued', message: undefined, retryable: undefined });
    try { await processItem(work, new Set()); }
    finally { stopBusy(); }
  };

  const locateFolder = async () => {
    if (folderBusy) return;
    setFolderBusy(true);
    setFolderError('');
    try { setFolderId(await getOrCreateProjectDriveFolder(user, project)); }
    catch { setFolderError(pick(locale, 'ค้นหาโฟลเดอร์อัปโหลดไม่สำเร็จ', 'Could not locate the upload folder')); }
    finally { setFolderBusy(false); }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) addLocal([...event.dataTransfer.files]);
  };

  return <section className={`drive-attach-control ${dragging ? 'is-dragging' : ''}`} aria-busy={busy}>
    <div className="drive-attach-head">
      <div className="drive-attach-title"><span className="drive-cloud-mark" aria-hidden="true"><Icon name="attach" /></span><div><strong>{pick(locale, 'แนบไฟล์', 'Attach files')}</strong><small>{pick(locale, `ไฟล์ละไม่เกิน ${LOCAL_DRIVE_FILE_MAX_BYTES / 1024 / 1024} MB · จัดเก็บใน Google Drive`, `Up to ${LOCAL_DRIVE_FILE_MAX_BYTES / 1024 / 1024} MB each · stored in Google Drive`)}</small></div></div>
      <div className="drive-attach-head-actions">
        {folderId
          ? <a className="drive-folder-shortcut" href={driveFolderUrl(folderId)} target="_blank" rel="noreferrer" title={`${DRIVE_ROOT_FOLDER_NAME} / ${project.name}`}>{pick(locale, 'เปิดโฟลเดอร์', 'Open folder')} <Icon name="open" /></a>
          : <button type="button" className="drive-folder-shortcut" disabled={folderBusy || busy} onClick={() => void locateFolder()}>{folderBusy ? pick(locale, 'กำลังค้นหา…', 'Locating…') : pick(locale, 'ค้นหาโฟลเดอร์', 'Locate folder')}</button>}
        <button type="button" className={`drive-access-summary ${mode === 'link' ? 'external' : ''}`} aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen((open) => !open)}>
          <span>{pick(locale, 'สิทธิ์', 'Access')}: <b>{mode === 'members' ? pick(locale, 'สมาชิกโปรเจกต์', 'Project members') : pick(locale, 'ทุกคนที่มีลิงก์', 'Anyone with link')}</b>{role !== 'reader' && <> · {driveRoleLabel(effectiveDriveRole(mode, 'application/vnd.google-apps.document', role), locale)}</>}</span><i aria-hidden="true"><Icon name="chevronDown" /></i>
        </button>
      </div>
    </div>
    {folderError && <small className="drive-folder-error" role="status">{folderError}</small>}

    <div className="drive-drop-zone" onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={drop}>
      <div className="drive-drop-copy"><strong>{dragging ? pick(locale, 'วางไฟล์เพื่ออัปโหลด', 'Drop to upload') : pick(locale, 'ลากไฟล์มาวาง หรือเลือกแหล่งที่มา', 'Drop files here or choose a source')}</strong><small>{pick(locale, 'ไฟล์จากเครื่องจะอยู่ในโฟลเดอร์โปรเจกต์ของคุณ', 'Device files go to your project upload folder')}</small></div>
      <div className="drive-source-actions">
        <input ref={inputRef} type="file" multiple hidden onChange={(event) => addLocal([...event.target.files || []])} />
        <button type="button" className="primary" disabled={busy} onClick={() => inputRef.current?.click()}><Icon name="upload" />{pick(locale, 'อัปโหลดจากเครื่อง', 'Upload from device')}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void chooseDrive()}><Icon name="folder" className="google-drive-mark" />{pick(locale, 'เลือกจาก Drive', 'Choose from Drive')}</button>
        <button type="button" className={`secondary ${panel === 'create' ? 'active' : ''}`} disabled={busy} aria-expanded={panel === 'create'} onClick={() => setPanel((current) => current === 'create' ? null : 'create')}><span aria-hidden="true"><Icon name="add" /></span>{pick(locale, 'สร้างไฟล์ Google', 'New Google file')}</button>
        <button type="button" className={`secondary ${panel === 'link' ? 'active' : ''}`} disabled={busy} aria-expanded={panel === 'link'} onClick={() => setPanel((current) => current === 'link' ? null : 'link')}><span aria-hidden="true"><Icon name="link" /></span>{pick(locale, 'วางลิงก์', 'Paste link')}</button>
      </div>
      {dragging && <div className="drive-drop-overlay" aria-hidden="true"><Icon name="download" /><strong>{pick(locale, 'วางไฟล์ที่นี่', 'Drop files here')}</strong></div>}
    </div>
    <small className="drive-picker-hint">{pick(locale, 'ตัวเลือก Drive ค้างที่ “Sign in” หรือเลือกแล้วไม่กลับมา? (พบในเบราว์เซอร์ที่ปิดกั้นคุกกี้ข้ามไซต์)', 'Drive picker stuck on “Sign in” or not returning your selection? (common in privacy-hardened browsers)')} <button type="button" disabled={busy} onClick={() => setPanel('link')}>{pick(locale, 'วางลิงก์ไฟล์แทน', 'Paste the file link instead')}</button></small>

    {panel === 'create' && <form className="drive-attach-details drive-inline-form" onSubmit={createFile}>
      <div className="drive-sharing-panel">
        <div><strong>{pick(locale, 'สร้างไฟล์ Google ใหม่', 'Create a new Google file')}</strong><small>{pick(locale, 'สร้างในโฟลเดอร์โปรเจกต์ของคุณ และแชร์ตามสิทธิ์ที่เลือก', 'Created in your project folder and shared using the access below')}</small></div>
        <div className="drive-segmented" role="radiogroup" aria-label={pick(locale, 'ประเภทไฟล์', 'File type')}>{CREATE_TYPES.map((type) => <button type="button" key={type} role="radio" aria-checked={createType === type} className={createType === type ? 'selected' : ''} onClick={() => setCreateType(type)}>{createTypeLabel(type)}</button>)}</div>
        <label className="drive-inline-field"><span>{pick(locale, 'ชื่อไฟล์', 'File name')}</span><input value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={240} placeholder={pick(locale, `${createTypeLabel(createType)} ใหม่`, `Untitled ${createTypeLabel(createType)}`)} autoFocus /></label>
        <label className="drive-inline-field"><span>{mode === 'members' ? pick(locale, 'สมาชิกโปรเจกต์', 'Project members') : pick(locale, 'ทุกคนที่มีลิงก์', 'Anyone with the link')}</span><select value={effectiveDriveRole(mode, 'application/vnd.google-apps.document', createRole)} onChange={(event) => setCreateRole(event.target.value as DriveRole)}>{DRIVE_ROLES.filter((option) => effectiveDriveRole(mode, 'application/vnd.google-apps.document', option) === option).map((option) => <option key={option} value={option}>{driveRoleLabel(option, locale)}</option>)}</select></label>
        <div className="drive-inline-actions"><button type="button" className="secondary small" onClick={() => setPanel(null)}>{pick(locale, 'ยกเลิก', 'Cancel')}</button><button className="primary small" disabled={busy}>{pick(locale, 'สร้างและแนบ', 'Create and attach')}</button></div>
      </div>
    </form>}

    {panel === 'link' && <form className="drive-attach-details drive-inline-form" onSubmit={(event) => void attachLink(event)}>
      <div className="drive-sharing-panel">
        <div><strong>{pick(locale, 'แนบด้วยลิงก์ Google', 'Attach by Google link')}</strong><small>{pick(locale, 'ไม่ต้องใช้ตัวเลือก Drive ถ้า SuperKanban ยังไม่เคยเข้าถึงไฟล์นี้ ระบบจะเก็บเป็นลิงก์ และสิทธิ์จะจัดการใน Google Drive เท่านั้น', 'No picker needed. If SuperKanban has never accessed this file, it is saved as a link and access stays managed in Google Drive.')}</small></div>
        <label className="drive-inline-field"><span>{pick(locale, 'ลิงก์ไฟล์', 'File link')}</span><input type="url" required value={linkUrl} onChange={(event) => { setLinkUrl(event.target.value); setLinkError(''); }} placeholder="https://docs.google.com/document/d/…" autoFocus /></label>
        <label className="drive-inline-field"><span>{pick(locale, 'ชื่อที่ใช้แสดง', 'Display name')} <i>{pick(locale, 'ใช้เมื่ออ่านชื่อไฟล์จาก Drive ไม่ได้', 'Used when Drive cannot read the file name')}</i></span><input value={linkName} onChange={(event) => setLinkName(event.target.value)} maxLength={200} placeholder={pick(locale, 'เช่น Requirement v2', 'For example: Requirements v2')} /></label>
        {linkError && <small className="drive-folder-error" role="alert">{linkError}</small>}
        <div className="drive-inline-actions"><button type="button" className="secondary small" onClick={() => setPanel(null)}>{pick(locale, 'ยกเลิก', 'Cancel')}</button><button className="primary small" disabled={busy || !linkUrl.trim()}>{pick(locale, 'แนบลิงก์', 'Attach link')}</button></div>
      </div>
    </form>}

    {detailsOpen && <div className="drive-attach-details" id={detailsId}>
      <div className="drive-sharing-panel">
        <div><strong>{pick(locale, 'ใครเปิดไฟล์ได้', 'Who can open these files')}</strong><small>{pick(locale, 'ใช้กับไฟล์ใหม่ในคิวนี้', 'Applies to new files added to this queue')}</small></div>
        <div className="drive-sharing-options">
          <label className={mode === 'members' ? 'selected' : ''}>
            <input type="radio" name={sharingName} checked={mode === 'members'} onChange={() => setMode('members')} disabled={busy} />
            <span><b>{pick(locale, 'สมาชิกโปรเจกต์', 'Project members')}</b><small>{pick(locale, 'แนะนำ · ให้สิทธิ์แก่สมาชิกปัจจุบัน', 'Recommended · access for current members')}</small></span>
          </label>
          <label className={`external ${mode === 'link' ? 'selected' : ''}`}>
            <input type="radio" name={sharingName} checked={mode === 'link'} onChange={() => { setMode('link'); setRole((current) => effectiveDriveRole('link', 'application/vnd.google-apps.document', current)); }} disabled={busy} />
            <span><b>{pick(locale, 'ทุกคนที่มีลิงก์', 'Anyone with the link')}</b><small>{pick(locale, 'เข้าถึงจากภายนอกได้ · ใช้เมื่อจำเป็น', 'External access · use only when needed')}</small></span>
          </label>
        </div>
      </div>
      <div className="drive-sharing-panel">
        <div><strong>{pick(locale, 'สิทธิ์สำหรับ Google Docs, Sheets, Slides', 'Access for Google Docs, Sheets and Slides')}</strong><small>{pick(locale, 'ไฟล์ประเภทอื่นให้สิทธิ์ดูเท่านั้น · “ทุกคนที่มีลิงก์” แก้ไขไม่ได้', 'Other files are always view-only · “Anyone with the link” can never edit')}</small></div>
        <div className="drive-segmented" role="radiogroup" aria-label={pick(locale, 'บทบาท', 'Role')}>{DRIVE_ROLES.map((option) => {
          const allowed = effectiveDriveRole(mode, 'application/vnd.google-apps.document', option) === option;
          return <label key={option} className={role === option ? 'selected' : ''}><input type="radio" name={roleName} checked={role === option} disabled={busy || !allowed} onChange={() => setRole(option)} />{driveRoleLabel(option, locale)}</label>;
        })}</div>
      </div>
    </div>}

    <DrivePermissionSyncPanel variant="compact" projectId={project.id} members={members} user={user} locale={locale} />

    {items.length > 0 && <div className="drive-upload-queue" aria-label={pick(locale, 'คิวอัปโหลด', 'Upload queue')}>
      <div className="drive-queue-head"><strong>{pick(locale, 'กิจกรรมไฟล์', 'File activity')}</strong><button type="button" onClick={() => setItems((current) => current.filter((item) => !['attached', 'duplicate'].includes(item.state)))} disabled={!items.some((item) => ['attached', 'duplicate'].includes(item.state))}>{pick(locale, 'ล้างรายการที่เสร็จ', 'Clear completed')}</button></div>
      {items.map((item) => {
        const retryAction = uploadRetryAction(item);
        const working = ['queued', 'uploading', 'sharing'].includes(item.state);
        return <div key={item.key} className={`drive-queue-item ${item.state}`}>
          <span className="drive-queue-state" aria-hidden="true">{item.state === 'attached' ? <Icon name="check" /> : item.state === 'error' ? <Icon name="alert" /> : item.state === 'duplicate' ? <Icon name="copy" /> : working ? <Icon name="upload" /> : '·'}</span>
          <div><strong>{item.name}</strong><small>{queueStatus(item, locale)}</small>{item.state === 'uploading' && <progress value={item.progress} max={1} />}</div>
          <div className="drive-queue-actions">
            {item.candidate && ['attached', 'error'].includes(item.state) && <a href={driveOpenUrl(item.candidate.driveFileId)} target="_blank" rel="noreferrer">{pick(locale, 'เปิด', 'Open')} <Icon name="open" /></a>}
            {retryAction && <button type="button" disabled={busy} onClick={() => void retry(item)}>{pick(locale, 'ลองอีกครั้ง', 'Retry')}</button>}
            {!working && <button type="button" className="drive-queue-dismiss" aria-label={pick(locale, `นำ ${item.name} ออกจากคิว`, `Dismiss ${item.name}`)} onClick={() => setItems((current) => current.filter((currentItem) => currentItem.key !== item.key))}><Icon name="close" /></button>}
          </div>
        </div>;
      })}
    </div>}
  </section>;
}

export function DrivePermissionSyncPanel({ projectId, members, user, locale, disabled = false, variant }: {
  projectId: string;
  members: Membership[];
  user: User;
  locale: Locale;
  disabled?: boolean;
  variant: 'compact' | 'settings';
}) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<DrivePermissionSyncSummary | null>(null);

  const sync = async () => {
    if (busy || disabled) return;
    const confirmed = confirm(pick(
      locale,
      'ซิงก์สิทธิ์ไฟล์ที่คุณเป็นเจ้าของในโปรเจกต์นี้หรือไม่? ระบบจะเพิ่มสมาชิกใหม่และนำสิทธิ์ที่ SuperKanban สร้างไว้ออกจากอดีตสมาชิก โดยไม่แตะสิทธิ์อื่นใน Drive',
      'Sync access for files you own in this project? This adds new members and removes SuperKanban-managed access from former members without changing other Drive permissions.',
    ));
    if (!confirmed) return;
    setBusy(true);
    setSummary(null);
    try { setSummary(await syncProjectDrivePermissions(projectId, user, members)); }
    catch (error) {
      console.error(error);
      toast(pick(locale, 'เริ่มซิงก์สิทธิ์ไม่สำเร็จ', 'Could not start permission sync'), 'error');
    } finally { setBusy(false); }
  };

  const result = summary && (summary.total === 0
    ? pick(locale, 'ไม่พบไฟล์ที่ต้องซิงก์', 'No files to sync')
    : pick(locale, `อัปเดต ${summary.updated} · ข้าม ${summary.skipped} · ล้มเหลว ${summary.failed}`, `Updated ${summary.updated} · skipped ${summary.skipped} · failed ${summary.failed}`));

  return <div className={`drive-sync-panel ${variant}`}>
    <div className="drive-sync-message"><span aria-hidden="true">!</span><div><strong>{pick(locale, 'สิทธิ์อาจไม่ตรงกับทีมปัจจุบัน', 'Access can become outdated')}</strong><small>{variant === 'compact'
      ? pick(locale, 'ซิงก์หลังเพิ่มหรือนำสมาชิกออกจากโปรเจกต์', 'Sync after adding or removing project members.')
      : pick(locale, 'สิทธิ์ใน Drive ไม่เปลี่ยนตามสมาชิกอัตโนมัติ ระบบจะไม่ลบสิทธิ์ที่ SuperKanban ไม่ได้สร้าง', 'Drive access does not follow membership automatically. Permissions not created by SuperKanban are never removed.')}</small></div></div>
    <div className="drive-sync-actions">
      <button type="button" className="secondary small" disabled={busy || disabled} onClick={() => void sync()}>{busy ? pick(locale, 'กำลังซิงก์…', 'Syncing…') : pick(locale, 'ซิงก์สิทธิ์ไฟล์ของฉัน', 'Sync access for my files')}</button>
      {result && <small role="status">{result}</small>}
    </div>
  </div>;
}

function fileKind(file: Pick<DriveFileRef, 'mimeType' | 'name'>): { label: string; className: string } {
  const mime = file.mimeType.toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return { label: 'PDF', className: 'pdf' };
  if (mime.startsWith('image/')) return { label: 'IMG', className: 'image' };
  if (mime.includes('spreadsheet') || /\.(xlsx?|csv)$/.test(name)) return { label: 'SHT', className: 'sheet' };
  if (mime.includes('presentation') || /\.(pptx?|key)$/.test(name)) return { label: 'SLD', className: 'slides' };
  if (mime.includes('document') || /\.(docx?|txt|md)$/.test(name)) return { label: 'DOC', className: 'document' };
  if (mime.includes('zip') || mime.includes('compressed') || /\.(zip|rar|7z)$/.test(name)) return { label: 'ZIP', className: 'archive' };
  return { label: 'FILE', className: 'generic' };
}

function driveAccessLabel(file: Pick<DriveFileRef, 'shareMode' | 'role' | 'mimeType'>, locale: Locale): string {
  if (file.shareMode === 'unmanaged') return pick(locale, 'จัดการสิทธิ์ใน Google Drive', 'Access managed in Google Drive');
  const audience = file.shareMode === 'link' ? pick(locale, 'ทุกคนที่มีลิงก์', 'Anyone with link') : pick(locale, 'สมาชิกโปรเจกต์', 'Project members');
  return isGoogleWorkspaceMimeType(file.mimeType) ? `${audience} · ${driveRoleLabel(file.role || 'reader', locale)}` : audience;
}

export function DriveFileRow({ file, locale, uploader, canDetach, onDetach, detachLabel, iconOnlyDetach = false }: {
  file: DriveFileRef & { id: string };
  locale: Locale;
  uploader?: string;
  canDetach: boolean;
  onDetach: DetachAction;
  detachLabel?: string;
  iconOnlyDetach?: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const kind = fileKind(file);

  return <div className="drive-file-row">
    <a className="drive-file-main" href={driveOpenUrl(file.driveFileId)} target="_blank" rel="noreferrer" title={pick(locale, 'เปิดใน Google Drive', 'Open in Google Drive')}>
      <span className={`drive-file-icon ${kind.className}`} aria-hidden="true">{kind.label}</span>
      <div className="drive-file-copy"><strong>{file.nickname?.trim() || file.name}</strong>{file.nickname?.trim() && <small className="drive-original-name">{file.name}</small>}{file.description?.trim() && <p className="drive-file-description">{file.description}</p>}<span className="drive-file-meta">{formatFileSize(file.sizeBytes) && <small>{formatFileSize(file.sizeBytes)}</small>}{uploader && <small>{uploader}</small>}<small className={`drive-access-badge ${file.shareMode === 'link' ? 'external' : file.shareMode === 'unmanaged' ? 'unmanaged' : ''}`} title={file.shareMode === 'unmanaged' ? pick(locale, 'แนบด้วยลิงก์ SuperKanban ไม่ได้ให้สิทธิ์ใดๆ ขอสิทธิ์จากเจ้าของไฟล์ใน Google Drive', 'Attached by link. SuperKanban granted no access; ask the file owner in Google Drive.') : undefined}>{driveAccessLabel(file, locale)}</small></span></div>
      <span className="drive-open-mark" aria-hidden="true"><Icon name="open" /></span>
    </a>
    {canDetach && <button type="button" className={`drive-detach${iconOnlyDetach ? ' icon-only' : ''}`} onClick={() => beginOptimisticDetach(onDetach, setHidden)} aria-label={detachLabel || pick(locale, `นำ ${file.name} ออกจาก SuperKanban`, `Remove ${file.name} from SuperKanban`)} title={detachLabel || pick(locale, 'นำออกจาก SuperKanban (ไฟล์และสิทธิ์ใน Drive จะไม่เปลี่ยน)', 'Remove from SuperKanban (Drive file and access stay unchanged)')}><span aria-hidden="true"><Icon name="close" /></span>{!iconOnlyDetach && <b>{detachLabel || pick(locale, 'นำออก', 'Remove')}</b>}</button>}
  </div>;
}
