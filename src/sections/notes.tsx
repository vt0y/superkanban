import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { documentId, limit, orderBy, where, type QueryConstraint } from 'firebase/firestore';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AppContextValue, SectionProps } from '@/context/AppContext';
import { CanvaFileRow, CanvaLinkForm, CanvasControls, DriveAttachmentControl, DriveFileRow, driveRoleLabel, Empty, MarkdownRenderer, Modal, PageTitle } from '@/components/common';
import { useActiveTasks, useCanvasViewport, useItemDrag, useProjectItems, useProjectItemsState } from '@/hooks';
import { NOTE_COLORS } from '@/config/constants';
import { parseContentWithLinks } from '@/utils/linkify';
import { canDeleteItem } from '@/utils/permissions';
import { allowedDriveRoles, attachCanvaProjectDocument, attachDriveProjectDocument, bulkUpdateWorkItems, createProjectDocument, createWorkItem, deleteProjectDocument, deleteWorkItem, detachDriveProjectDocument, isCanvaProjectDocument, isDriveProjectDocument, loadProjectCollectionPage, migrateLegacyProjectDocument, subscribeProjectDocument, subscribeProjectQuery, updateCanvaProjectDocumentDetails, updateDriveProjectDocumentDetails, updateDriveProjectDocumentRole, updateProjectDocument, updateProjectDocumentLabels, updateWorkItem, type CollectionCursor } from '@/services';
import type { CanvaProjectDocument, DriveProjectDocument, DriveRole, Label, LoadedProjectDocument, Membership, ProjectDocument, Role, StickyNote, Task } from '@/types';
import { attempt, toast } from '@/components/toast';
import { pick, relativeTime } from '@/utils/formatters';
import { DOCUMENT_BODY_MAX_BYTES, DOCUMENT_TITLE_MAX_LENGTH, documentContentBytes } from '@/utils/documents';
import { isGoogleDriveEnabled } from '@/config/features';
import { LabelChip } from '@/components/board/LabelChip';
import { useTaskModal } from '@/components/board/TaskModalHost';
import { LabelManager } from '@/components/board/LabelManager';
import { LabelPicker } from '@/components/board/LabelPicker';
import { DocumentFilterBar } from '@/components/board/DocumentFilterBar';
import { matchDocument, parseDocumentQuery, tokenizeDocumentQuery } from '@/utils/document-filter';
import { queryValue, toggleQueryTerm } from '@/utils/task-filter';
import { Icon } from '@/components/common/Icon';

const NOTE_W = 210;
const NOTE_H = 160;

export function Notes({ context, project, members, role, readOnly }: SectionProps) {
  return <NotesOverview context={context} project={project} members={members} role={role} readOnly={readOnly} mode="sticky" />;
}

export function Documents({ context, project, members, role, readOnly, documentId: selectedDocumentId }: SectionProps & { documentId?: string }) {
  if (selectedDocumentId) return <DocumentReader documentId={selectedDocumentId} projectId={project.id} context={context} role={role} readOnly={readOnly} />;
  return <NotesOverview context={context} project={project} members={members} role={role} readOnly={readOnly} mode="documents" />;
}

function NotesOverview({ context, project, members, role, readOnly, mode }: SectionProps & { mode: 'sticky' | 'documents' }) {
  const notes = useProjectItems<StickyNote>(project.id, 'stickyNotes');
  const [searchParams, setSearchParams] = useSearchParams();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [documentCursor, setDocumentCursor] = useState<CollectionCursor | null>(null);
  const [documentsHaveMore, setDocumentsHaveMore] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const documentsPaged = useRef(false);
  const liveDocumentIds = useRef<Set<string>>(new Set());
  const tasks = useActiveTasks(project.id);
  const documentTasks = useProjectItems<Task>(project.id, 'tasks');
  const { items: labels, loaded: labelsLoaded } = useProjectItemsState<Label>(project.id, 'labels');
  const [noteModal, setNoteModal] = useState<StickyNote | { x: number; y: number } | null>(null);
  const [docModal, setDocModal] = useState<LoadedProjectDocument | 'new' | null>(null);
  const [driveModal, setDriveModal] = useState<DriveProjectDocument | CanvaProjectDocument | null>(null);
  const [canvaOpen, setCanvaOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const navigate = useNavigate();
  const { locale } = context;
  const query = searchParams.get('q') || '';
  const parsedQuery = useMemo(() => parseDocumentQuery(query), [query]);
  const queryLabelNames = parsedQuery.terms.filter((term) => term.key === 'label' && !term.negated).map((term) => term.value);
  const queryTaskNames = parsedQuery.terms.filter((term) => term.key === 'task' && !term.negated).map((term) => term.value);
  const selectedLabelIds = [...new Set([
    ...(searchParams.get('labels') || '').split(',').filter(Boolean),
    ...labels.filter((label) => queryLabelNames.includes(label.name.toLowerCase())).map((label) => label.id),
  ])].filter((id) => labels.some((label) => label.id === id)).slice(0, 30);
  const selectedTaskIds = [...new Set(documentTasks.filter((task) => queryTaskNames.includes(task.title.toLowerCase())).map((task) => task.id))].slice(0, 30);
  const labelFilterKey = [...selectedLabelIds].sort().join(',');
  const taskFilterKey = [...selectedTaskIds].sort().join(',');
  const documentFilters: QueryConstraint[] = selectedTaskIds.length ? [where('taskIds', 'array-contains-any', selectedTaskIds)] : selectedLabelIds.length ? [where('labelIds', 'array-contains-any', selectedLabelIds)] : [];

  useEffect(() => {
    if (mode !== 'documents' || !labelsLoaded || !searchParams.has('labels')) return;
    const legacy = (searchParams.get('labels') || '').split(',').map((id) => labels.find((label) => label.id === id)).filter(Boolean) as Label[];
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      let nextQuery = params.get('q') || '';
      legacy.forEach((label) => { const term = `label:${queryValue(label.name)}`; if (!tokenizeDocumentQuery(nextQuery).includes(term)) nextQuery = `${nextQuery} ${term}`.trim(); });
      if (nextQuery) params.set('q', nextQuery);
      params.delete('labels');
      params.delete('tab');
      return params;
    }, { replace: true });
  }, [mode, labelsLoaded, labels, searchParams, setSearchParams]);

  const toggleLabelFilter = (label: Label) => {
    const term = `label:${queryValue(label.name)}`;
    const selected = queryLabelNames.includes(label.name.toLowerCase());
    if (!selected && queryLabelNames.length >= 30) {
      toast(pick(locale, 'กรองได้สูงสุด 30 labels พร้อมกัน', 'You can filter by up to 30 labels at once'), 'error');
      return;
    }
    setSearchParams((current) => { const params = new URLSearchParams(current); const next = toggleQueryTerm(params.get('q') || '', term); if (next) params.set('q', next); else params.delete('q'); return params; }, { replace: true });
  };

  useEffect(() => {
    if (mode !== 'documents') return;
    // Document records contain only lightweight metadata; bodies remain
    // lazy-loaded by DocumentReader.
    setDocuments([]);
    documentsPaged.current = false;
    liveDocumentIds.current = new Set();
    return subscribeProjectQuery<ProjectDocument>(project.id, 'documents', `recent:50:labels:${labelFilterKey || '*'}:tasks:${taskFilterKey || '*'}`, [...documentFilters, orderBy('updatedAt', 'desc'), orderBy(documentId()), limit(50)], (items) => {
      const previousLiveIds = liveDocumentIds.current;
      liveDocumentIds.current = new Set(items.map((item) => item.id));
      setDocuments((current) => [...items, ...current.filter((item) => !previousLiveIds.has(item.id) && !liveDocumentIds.current.has(item.id))]);
      const last = items.at(-1);
      if (!documentsPaged.current) {
        setDocumentCursor(last?.updatedAt ? { value: last.updatedAt, id: last.id } : null);
        setDocumentsHaveMore(items.length === 50);
      }
    });
  }, [mode, project.id, labelFilterKey, taskFilterKey]);

  const loadMoreDocuments = async () => {
    if (!documentCursor || loadingDocuments) return;
    setLoadingDocuments(true);
    documentsPaged.current = true;
    try {
      const page = await loadProjectCollectionPage<ProjectDocument>(project.id, 'documents', documentCursor, 50, 'updatedAt', documentFilters);
      setDocuments((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setDocumentCursor(page.nextCursor);
      setDocumentsHaveMore(page.hasMore);
    } finally { setLoadingDocuments(false); }
  };

  const visibleDocuments = useMemo(() => documents.filter((document) => matchDocument(document, parsedQuery, labels, documentTasks)), [documents, parsedQuery, labels, documentTasks]);
  const setDocumentQuery = (value: string) => setSearchParams((current) => { const params = new URLSearchParams(current); if (value.trim()) params.set('q', value); else params.delete('q'); return params; }, { replace: true });

  return <>
    <PageTitle eyebrow={mode === 'sticky' ? 'QUICK NOTES' : 'KNOWLEDGE SPACE'} title={mode === 'sticky' ? context.t('notes') : context.t('documents')}
      description={mode === 'sticky' ? pick(locale, 'แปะไอเดียและโน้ตสั้นบนพื้นที่อิสระ', 'Capture ideas and quick notes on a freeform canvas') : pick(locale, 'ค้นหา จัดหมวดหมู่ และแชร์เอกสารสำคัญของโปรเจกต์', 'Find, organize and share key project documents')}
      action={mode === 'sticky'
        ? (!readOnly && <button className="primary" onClick={() => setNoteModal({ x: NaN, y: NaN })}><Icon name="add" /> {context.t('sticky')}</button>)
        : <div className="action-row"><button className="secondary" onClick={() => setLabelsOpen(true)}><Icon name="label" /> {pick(locale, 'จัดการ Labels', 'Manage labels')}</button>{!readOnly && <button className="secondary" onClick={() => setCanvaOpen(true)}><Icon name="add" /> Canva</button>}{!readOnly && <button className="primary" onClick={() => setDocModal('new')}><Icon name="add" /> {context.t('documents')}</button>}</div>} />
    {mode === 'sticky'
      ? <StickyCanvas notes={notes} tasks={tasks} context={context} projectId={project.id} role={role} readOnly={readOnly} onEdit={setNoteModal} />
      : <><div className="board-toolbar document-toolbar"><DocumentFilterBar value={query} onChange={setDocumentQuery} labels={labels} tasks={documentTasks} locale={locale} /></div>
        {query && <p className="filter-summary">{pick(locale, `พบ ${visibleDocuments.length} จาก ${documents.length} เอกสารที่โหลดแล้ว`, `${visibleDocuments.length} of ${documents.length} loaded documents`)} · <button type="button" className="link-button" onClick={() => setDocumentQuery('')}>{pick(locale, 'ล้างตัวกรอง', 'Clear filter')}</button></p>}
        {!readOnly && isGoogleDriveEnabled && selectedLabelIds.length === 0 && <DriveAttachmentControl project={project} members={members} user={context.user} locale={locale} existingFileIds={new Set(documents.filter(isDriveProjectDocument).map((item) => item.driveFileId))}
          onAttach={(file, mode, sharing) => attachDriveProjectDocument(project.id, file, mode, sharing, context.user)} />}
        <DocumentList documents={visibleDocuments} labels={labels} tasks={documentTasks} filtered={!!query} projectId={project.id} context={context} members={members} role={role} readOnly={readOnly} userId={context.user.uid} onFilter={toggleLabelFilter} onTaskFilter={(task) => setDocumentQuery(toggleQueryTerm(query, `task:${queryValue(task.title)}`))} onEditDrive={setDriveModal} />
        {documentsHaveMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingDocuments} onClick={() => void loadMoreDocuments()}>{loadingDocuments ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดเอกสารเพิ่มเติม', 'Load more documents')}</button></div>}</>}
    {noteModal && <StickyModal item={'id' in noteModal ? noteModal : null} position={'id' in noteModal ? undefined : noteModal} projectId={project.id} tasks={tasks} context={context} role={role} readOnly={readOnly} onClose={() => setNoteModal(null)} />}
    {docModal && <DocumentModal item={docModal === 'new' ? null : docModal} labels={labels} tasks={documentTasks} projectId={project.id} context={context} role={role} readOnly={readOnly} onClose={() => setDocModal(null)} onSaved={(id) => { setDocModal(null); navigate(`/p/${project.id}/docs/${id}`); }} />}
    {driveModal && <DriveDocumentDetailsModal item={driveModal} labels={labels} tasks={documentTasks} projectId={project.id} context={context} readOnly={readOnly} onClose={() => setDriveModal(null)} />}
    {canvaOpen && <Modal title={pick(locale, 'แนบงานออกแบบ Canva', 'Attach a Canva design')} onClose={() => setCanvaOpen(false)}><CanvaLinkForm user={context.user} locale={locale} autoFocus onCancel={() => setCanvaOpen(false)} onAttach={(link, title, labelIds) => attachCanvaProjectDocument(project.id, link, title, context.user, [], labelIds)}
      renderLabels={(value, onChange) => <div className="document-editor-labels"><span>Labels</span><LabelPicker labels={labels} value={value} onChange={onChange} projectId={project.id} context={context} readOnly={readOnly} /></div>} /></Modal>}
    {labelsOpen && <LabelManager labels={labels} tasks={tasks} projectId={project.id} context={context} role={role} readOnly={readOnly} onClose={() => setLabelsOpen(false)} onFilter={(label) => { toggleLabelFilter(label); setLabelsOpen(false); }} />}
  </>;
}

function StickyCanvas({ notes, tasks, context, projectId, role, readOnly, onEdit }: { notes: StickyNote[]; tasks: Task[]; context: AppContextValue; projectId: string; role: Role | null; readOnly: boolean; onEdit: (value: StickyNote | { x: number; y: number }) => void }) {
  const { locale, user } = context;
  const canvas = useCanvasViewport(`ps.notes.view.${projectId}`);
  const { openTask } = useTaskModal();
  const [stack, setStack] = useState<string[]>([]);
  const drag = useItemDrag(canvas.toWorld, (positions) => {
    const ids = [...positions.keys()];
    void attempt(() => bulkUpdateWorkItems(projectId, 'stickyNotes', ids, (id) => positions.get(id)!), pick(locale, 'ย้ายโน้ตไม่สำเร็จ', 'Could not move note'));
  });
  // Fit all notes the first time a board with notes is opened without a saved view.
  const [needsFit, setNeedsFit] = useState(() => { try { return !localStorage.getItem(`ps.notes.view.${projectId}`); } catch { return true; } });
  useEffect(() => {
    if (!needsFit || !notes.length) return;
    setNeedsFit(false);
    canvas.fit(notes.map((note) => ({ x: note.x, y: note.y, w: NOTE_W, h: NOTE_H })));
  }, [notes, needsFit, canvas]);

  const rects = () => notes.map((note) => ({ x: note.x, y: note.y, w: NOTE_W, h: NOTE_H }));
  const order = (id: string) => { const index = stack.indexOf(id); return index < 0 ? 0 : index + 1; };

  const onNotePointerDown = (event: ReactPointerEvent, note: StickyNote) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    if (canvas.handlePointerDown(event, false)) return;
    event.stopPropagation();
    setStack((current) => [...current.filter((id) => id !== note.id), note.id]);
    if (readOnly || note.pinned || event.button !== 0) return;
    drag.start(event, new Map([[note.id, { x: note.x, y: note.y }]]));
  };

  const togglePin = (note: StickyNote) => void attempt(() => updateWorkItem(projectId, 'stickyNotes', note.id, { pinned: !note.pinned }), pick(locale, 'อัปเดตไม่สำเร็จ', 'Update failed'));
  const removeNote = (note: StickyNote) => { if (confirm(pick(locale, 'ลบ Sticky Note นี้หรือไม่?', 'Delete this sticky note?'))) void attempt(() => deleteWorkItem(projectId, 'stickyNotes', note.id), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); };

  return <div ref={canvas.containerRef} className={`infinite-canvas sticky-canvas ${canvas.panning ? 'panning' : ''}`} style={canvas.gridStyle}
    onPointerDown={(event) => canvas.handlePointerDown(event, event.target === event.currentTarget)}
    onPointerMove={(event) => { if (!drag.move(event)) canvas.handlePointerMove(event); }}
    onPointerUp={(event) => { drag.end(event); canvas.handlePointerUp(event); }}
    onPointerCancel={(event) => { drag.end(event); canvas.handlePointerUp(event); }}
    onDoubleClick={(event) => { if (!readOnly && event.target === event.currentTarget) { const world = canvas.toWorld(event.clientX, event.clientY); onEdit({ x: world.x - NOTE_W / 2, y: world.y - 30 }); } }}>
    <div className="canvas-world" style={{ transform: `translate3d(${canvas.view.x}px, ${canvas.view.y}px, 0) scale(${canvas.view.zoom})` }}>
      {notes.map((note) => {
        const position = drag.overrides.get(note.id) || note;
        const dragging = drag.overrides.has(note.id);
        return <article key={note.id} className={`sticky-note ${note.pinned ? 'pinned' : ''} ${dragging ? 'dragging' : ''}`}
          style={{ background: note.color, transform: `translate3d(${position.x}px, ${position.y}px, 0)`, zIndex: dragging ? 9999 : order(note.id) }}
          onPointerDown={(event) => onNotePointerDown(event, note)} onDoubleClick={(event) => { event.stopPropagation(); onEdit(note); }}>
          <header>
            {!readOnly && <button type="button" className="sticky-action-btn" title={note.pinned ? pick(locale, 'ถอนหมุด', 'Unpin') : pick(locale, 'ปักหมุด (ล็อกตำแหน่ง)', 'Pin (lock position)')} onClick={() => togglePin(note)}><Icon name={note.pinned ? 'pin' : 'drag'} /></button>}
            <div className="sticky-header-actions"><button type="button" className="sticky-action-btn" title={readOnly ? context.t('readOnly') : context.t('edit')} onClick={() => onEdit(note)}><Icon name={readOnly ? 'eye' : 'edit'} /></button>{!readOnly && canDeleteItem(role, note.createdBy, user.uid) && <button type="button" className="sticky-action-btn danger" title={context.t('delete')} onClick={() => removeNote(note)}><Icon name="close" /></button>}</div>
          </header>
          <p>{parseContentWithLinks(note.content)}</p>
          {note.taskId && <button type="button" className="sticky-task-link" onClick={() => openTask(note.taskId)}><Icon name="open" /> {tasks.find((task) => task.id === note.taskId)?.title || 'Task'}</button>}
        </article>;
      })}
    </div>
    {!notes.length && <div className="canvas-empty"><Empty icon="note" title={pick(locale, 'ยังไม่มี Sticky Note', 'No sticky notes yet')} description={pick(locale, 'ดับเบิลคลิกที่ว่างเพื่อแปะโน้ต', 'Double-click anywhere to add a note')} /></div>}
    <div className="canvas-hint">{pick(locale, 'ลากที่ว่างเพื่อเลื่อน · Ctrl/⌘ + scroll เพื่อซูม · ดับเบิลคลิกเพื่อเพิ่มโน้ต', 'Drag empty space to pan · Ctrl/⌘ + scroll to zoom · double-click to add')}</div>
    <CanvasControls zoom={canvas.view.zoom} onZoomIn={() => canvas.zoomBy(1.2)} onZoomOut={() => canvas.zoomBy(1 / 1.2)} onReset={canvas.reset} onFit={() => canvas.fit(rects())} fitLabel={pick(locale, 'แสดงทั้งหมด', 'Fit all')} />
  </div>;
}

function StickyModal({ item, position, projectId, tasks, context, role, readOnly, onClose }: { item: StickyNote | null; position?: { x: number; y: number }; projectId: string; tasks: Task[]; context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void }) {
  const { user, t, locale } = context;
  const [form, setForm] = useState({ content: item?.content || '', color: item?.color || NOTE_COLORS[0], taskId: item?.taskId || '', pinned: item?.pinned || false });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // NaN position = "add" button: drop the note near the origin with a little scatter.
    const x = position && Number.isFinite(position.x) ? position.x : 24 + Math.random() * 180;
    const y = position && Number.isFinite(position.y) ? position.y : 24 + Math.random() * 100;
    const ok = await attempt(() => (item ? updateWorkItem(projectId, 'stickyNotes', item.id, form) : createWorkItem(projectId, 'stickyNotes', { ...form, x, y }, user, { type: 'note_created', th: 'เพิ่ม Sticky Note', en: 'added a sticky note' })).then(() => true), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    if (ok) onClose();
  };
  const formId = useId();
  return <Modal title={item ? (readOnly ? t('sticky') : t('edit')) : t('sticky')} onClose={onClose} actions={!readOnly && <button form={formId} className="primary">{t('save')}</button>}><form id={formId} className="stack-form" onSubmit={submit}><fieldset className="read-only-fields" disabled={readOnly}><label>{pick(locale, 'ข้อความ', 'Text')}<textarea autoFocus rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required maxLength={800} /></label><fieldset><legend>{pick(locale, 'สี', 'Color')}</legend><div className="color-picker light">{NOTE_COLORS.map((color) => <button type="button" key={color} className={form.color === color ? 'selected' : ''} style={{ background: color }} onClick={() => setForm({ ...form, color })} aria-label={color} />)}</div></fieldset><label>{pick(locale, 'ผูกกับ Task', 'Linked task')}<select value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}><option value="">—</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="simple-check"><input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} /> {pick(locale, 'ปักหมุด (ล็อกตำแหน่ง)', 'Pinned (lock position)')}</label></fieldset><div className="form-actions">{!readOnly && item && canDeleteItem(role, item.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={async () => { if (confirm(t('delete') + '?')) { await attempt(() => deleteWorkItem(projectId, 'stickyNotes', item.id), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); onClose(); } }}>{t('delete')}</button>}<span /><button type="button" className="secondary" onClick={onClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : t('cancel')}</button>{!readOnly && <button className="primary">{t('save')}</button>}</div></form></Modal>;
}

function DocumentLabelRow({ document, labels, projectId, context, readOnly, onFilter }: { document: ProjectDocument; labels: Label[]; projectId: string; context: AppContextValue; readOnly: boolean; onFilter: (label: Label) => void }) {
  const [value, setValue] = useState(document.labelIds || []);
  useEffect(() => setValue(document.labelIds || []), [document.labelIds]);
  const selected = labels.filter((label) => value.includes(label.id));
  const save = async (labelIds: string[]) => {
    const previous = value;
    setValue(labelIds);
    const ok = await attempt(() => updateProjectDocumentLabels(projectId, document.id, labelIds).then(() => true), pick(context.locale, 'บันทึก label ไม่สำเร็จ', 'Could not save labels'));
    if (!ok) setValue(previous);
  };
  return <div className="document-label-row">{selected.map((label) => <LabelChip key={label.id} label={label} onClick={() => onFilter(label)} />)}{!readOnly && <LabelPicker labels={labels} value={value} onChange={(labelIds) => void save(labelIds)} projectId={projectId} context={context} readOnly={readOnly} showSelected={false} />}</div>;
}

function DocumentList({ documents, labels, tasks, filtered, projectId, context, members, role, readOnly, userId, onFilter, onTaskFilter, onEditDrive }: { documents: ProjectDocument[]; labels: Label[]; tasks: Task[]; filtered: boolean; projectId: string; context: AppContextValue; members: Membership[]; role: Role | null; readOnly: boolean; userId: string; onFilter: (label: Label) => void; onTaskFilter: (task: Task) => void; onEditDrive: (item: DriveProjectDocument | CanvaProjectDocument) => void }) {
  const { locale } = context;
  return <div className="document-list">{documents.map((document) => isDriveProjectDocument(document)
    ? <div className="document-entry" key={document.id}><DriveFileRow file={document} locale={locale} uploader={members.find((member) => member.userId === document.createdBy)?.displayName} canDetach={!readOnly && canDeleteItem(role, document.createdBy, userId)} onDetach={() => {
      if (!confirm(pick(locale, 'นำไฟล์แนบนี้ออกจาก SuperKanban หรือไม่? ไฟล์ต้นฉบับและสิทธิ์การแชร์ใน Google Drive จะไม่เปลี่ยนแปลง', 'Remove this attachment from SuperKanban? The original file and its Google Drive sharing permissions will stay unchanged.'))) return false;
      return attempt(() => detachDriveProjectDocument(projectId, document.id).then(() => true), pick(locale, 'นำไฟล์ออกไม่สำเร็จ', 'Could not detach file')).then((ok) => ok === true);
    }} /><DocumentMetadataRow document={document} labels={labels} tasks={tasks} projectId={projectId} context={context} readOnly={readOnly} onFilter={onFilter} onTaskFilter={onTaskFilter} onEdit={() => onEditDrive(document)} /></div>
    : isCanvaProjectDocument(document)
    ? <div className="document-entry" key={document.id}><CanvaFileRow file={document} locale={locale} uploader={members.find((member) => member.userId === document.createdBy)?.displayName} canDetach={!readOnly && canDeleteItem(role, document.createdBy, userId)} onDetach={() => {
      if (!confirm(pick(locale, 'นำงานออกแบบนี้ออกจาก SuperKanban หรือไม่? งานและการแชร์ใน Canva จะไม่เปลี่ยนแปลง', 'Remove this design from SuperKanban? The design and its sharing in Canva will stay unchanged.'))) return false;
      return attempt(() => detachDriveProjectDocument(projectId, document.id).then(() => true), pick(locale, 'นำงานออกแบบออกไม่สำเร็จ', 'Could not remove design')).then((ok) => ok === true);
    }} /><DocumentMetadataRow document={document} labels={labels} tasks={tasks} projectId={projectId} context={context} readOnly={readOnly} onFilter={onFilter} onTaskFilter={onTaskFilter} onEdit={() => onEditDrive(document)} /></div>
    : <div className="document-entry" key={document.id}><Link to={`/p/${projectId}/docs/${document.id}`}><span><Icon name="document" /></span><div><h3>{document.title}</h3><p>{document.excerpt || document.content?.replace(/[#*_`]/g, '').slice(0, 130) || 'Empty document'}</p><small>{relativeTime(document.updatedAt?.toDate(), locale)}</small></div><b><Icon name="arrowRight" /></b></Link><DocumentMetadataRow document={document} labels={labels} tasks={tasks} projectId={projectId} context={context} readOnly={readOnly} onFilter={onFilter} onTaskFilter={onTaskFilter} /></div>)}{!documents.length && <Empty icon="document" title={filtered ? pick(locale, 'ไม่พบเอกสารที่ตรงกับตัวกรอง', 'No documents match this filter') : pick(locale, 'ยังไม่มีเอกสาร', 'No documents yet')} description={filtered ? pick(locale, 'ลองแก้คำค้นหาหรือล้างตัวกรอง', 'Try changing or clearing the filter') : pick(locale, 'สร้างเอกสาร Markdown หรือแนบไฟล์จาก Google Drive', 'Create a Markdown document or attach a Google Drive file or Canva design')} />}</div>;
}

function DocumentMetadataRow({ document, labels, tasks, projectId, context, readOnly, onFilter, onTaskFilter, onEdit }: { document: ProjectDocument; labels: Label[]; tasks: Task[]; projectId: string; context: AppContextValue; readOnly: boolean; onFilter: (label: Label) => void; onTaskFilter: (task: Task) => void; onEdit?: () => void }) {
  const linkedTasks = tasks.filter((task) => (document.taskIds || []).includes(task.id));
  return <div className="document-metadata-row"><div className="document-metadata-tags"><DocumentLabelRow document={document} labels={labels} projectId={projectId} context={context} readOnly={readOnly} onFilter={onFilter} /><div className="document-task-chips">{linkedTasks.map((task) => <button type="button" key={task.id} onClick={() => onTaskFilter(task)}><Icon name="board" /> {task.title}</button>)}</div></div>{onEdit && !readOnly && <button type="button" className="secondary document-details-button" onClick={onEdit}><span aria-hidden="true"><Icon name="edit" /></span>{pick(context.locale, 'แก้ไข', 'Edit')}</button>}</div>;
}

function DriveDocumentDetailsModal({ item, labels, tasks, projectId, context, readOnly, onClose }: { item: DriveProjectDocument | CanvaProjectDocument; labels: Label[]; tasks: Task[]; projectId: string; context: AppContextValue; readOnly: boolean; onClose: () => void }) {
  const { locale } = context;
  const [nickname, setNickname] = useState(item.nickname || '');
  const [description, setDescription] = useState(item.description || '');
  const [labelIds, setLabelIds] = useState(item.labelIds || []);
  const [taskIds, setTaskIds] = useState(item.taskIds || []);
  const drive = isDriveProjectDocument(item) ? item : null;
  const currentRole = drive?.role || 'reader';
  const [role, setRole] = useState<DriveRole>(currentRole);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const roleOptions = !drive || drive.shareMode === 'unmanaged' ? [] : allowedDriveRoles(drive.shareMode, drive.mimeType);
  const roleManaged = drive?.shareMode === 'members' || Boolean(drive?.linkPermissionId);
  const canEditRole = !readOnly && roleOptions.length > 1 && roleManaged && item.createdBy === context.user.uid;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || readOnly) return;
    setBusy(true);
    if (drive && role !== currentRole) {
      const roleOk = await attempt(() => updateDriveProjectDocumentRole(projectId, drive, role, context.user).then(() => true), pick(locale, 'เปลี่ยนสิทธิ์ใน Google Drive ไม่สำเร็จ (ต้องเป็นเจ้าของไฟล์)', 'Could not change Google Drive access (you must own the file)'));
      if (!roleOk) { setBusy(false); return; }
    }
    const details = { nickname, description, labelIds, taskIds };
    const ok = await attempt(() => (drive ? updateDriveProjectDocumentDetails(projectId, item.id, details) : updateCanvaProjectDocumentDetails(projectId, item.id, details)).then(() => true), pick(locale, 'บันทึกรายละเอียดไม่สำเร็จ', 'Could not save document details'));
    setBusy(false);
    if (ok) onClose();
  };
  const saveLabel = pick(locale, 'บันทึกรายละเอียด', 'Save details');
  return <Modal title={pick(locale, 'แก้ไขข้อมูลเอกสาร', 'Edit document details')} onClose={onClose} wide actions={!readOnly && <button form={formId} className="primary" disabled={busy}>{saveLabel}</button>}><form id={formId} className="stack-form drive-document-details" onSubmit={submit}>
    <section className="drive-details-section"><header><span>1</span><div><h3>{pick(locale, 'ชื่อและคำอธิบาย', 'Name and description')}</h3><p>{pick(locale, 'ช่วยให้ทีมเข้าใจเอกสารโดยไม่ต้องเปิดไฟล์', 'Help the team understand the document before opening it')}</p></div></header>
      <label><span className="field-name">{pick(locale, 'ชื่อที่ใช้แสดง', 'Display name')} <i>{pick(locale, 'ไม่บังคับ', 'Optional')}</i></span><input autoFocus value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={200} placeholder={drive ? drive.name : item.title} disabled={readOnly} /><small className="field-help"><span>{drive ? pick(locale, 'เว้นว่างเพื่อใช้ชื่อไฟล์จริง', 'Leave blank to use the original filename') : pick(locale, 'เว้นว่างเพื่อใช้ชื่อที่ตั้งตอนแนบ', 'Leave blank to use the title set when attached')}</span><b>{nickname.length}/200</b></small></label>
      <label><span className="field-name">{pick(locale, 'คำอธิบายเอกสาร', 'Document description')} <i>{pick(locale, 'ไม่บังคับ', 'Optional')}</i></span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder={pick(locale, 'เช่น ใช้สำหรับรีวิว requirement รอบสุดท้าย…', 'For example: Final requirements review copy…')} disabled={readOnly} /><small className="field-help"><span>{pick(locale, 'แสดงใต้ชื่อเอกสารและค้นหาได้', 'Shown below the document name and included in search')}</span><b>{description.length}/1000</b></small></label>
    </section>
    <section className="drive-details-section"><header><span>2</span><div><h3>{pick(locale, 'จัดหมวดหมู่และเชื่อมงาน', 'Organize and link work')}</h3><p>{pick(locale, 'เพิ่ม Labels และเลือก Tasks ที่ใช้เอกสารนี้', 'Add labels and select tasks that use this document')}</p></div></header>
      <div className="document-editor-labels"><span>Labels</span><LabelPicker labels={labels} value={labelIds} onChange={setLabelIds} projectId={projectId} context={context} readOnly={readOnly} /></div>
      <fieldset disabled={readOnly}><legend>{pick(locale, `Tasks ที่เชื่อม (${taskIds.length})`, `Linked tasks (${taskIds.length})`)}</legend><div className="document-task-picker">{tasks.map((task) => <label key={task.id} className={taskIds.includes(task.id) ? 'selected' : ''}><input type="checkbox" checked={taskIds.includes(task.id)} onChange={(event) => setTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} /><span>{task.title}</span><small>{task.status.replace('_', ' ')}</small></label>)}</div>{!tasks.length && <p className="muted drive-details-no-tasks">{pick(locale, 'ยังไม่มี Task ในโปรเจกต์นี้', 'No tasks in this project yet')}</p>}</fieldset>
    </section>
    {!drive && <section className="drive-details-section"><header><span>3</span><div><h3>{pick(locale, 'สิทธิ์ใน Canva', 'Canva access')}</h3><p>{pick(locale, 'สิทธิ์แก้ไขจัดการใน Canva SuperKanban เก็บแค่ลิงก์แก้ไข', 'Edit access is managed in Canva; SuperKanban only stores the edit link.')}</p></div></header>
    </section>}
    {drive && <section className="drive-details-section"><header><span>3</span><div><h3>{pick(locale, 'สิทธิ์ใน Google Drive', 'Google Drive access')}</h3><p>{drive.shareMode === 'unmanaged'
      ? pick(locale, 'แนบด้วยลิงก์ SuperKanban ไม่ได้ให้สิทธิ์ใดๆ ผู้ที่เปิดไม่ได้ต้องขอสิทธิ์จากเจ้าของไฟล์ใน Google Drive', 'Attached by link. SuperKanban granted no access; anyone who cannot open it must request access from the owner in Google Drive.')
      : pick(locale, 'ใช้กับสิทธิ์ที่ SuperKanban สร้างเท่านั้น สิทธิ์ที่แชร์ไว้เองใน Drive จะไม่เปลี่ยน', 'Applies only to access SuperKanban granted. Permissions shared manually in Drive are never changed.')}</p></div></header>
      {roleOptions.length > 0 && <label><span className="field-name">{drive.shareMode === 'link' ? pick(locale, 'ทุกคนที่มีลิงก์', 'Anyone with the link') : pick(locale, 'สมาชิกโปรเจกต์', 'Project members')}</span><select value={role} onChange={(event) => setRole(event.target.value as DriveRole)} disabled={!canEditRole}>{roleOptions.map((option) => <option key={option} value={option}>{driveRoleLabel(option, locale)}</option>)}</select><small className="field-help"><span>{roleOptions.length === 1
        ? pick(locale, 'ไฟล์ที่ไม่ใช่ Google Docs, Sheets, Slides ให้สิทธิ์ดูเท่านั้น', 'Files other than Google Docs, Sheets and Slides are view-only')
        : !roleManaged ? pick(locale, 'สิทธิ์ลิงก์นี้ไม่ได้สร้างโดย SuperKanban จึงเปลี่ยนจากที่นี่ไม่ได้', 'This link access was not created by SuperKanban, so it cannot be changed here')
        : item.createdBy !== context.user.uid ? pick(locale, 'เฉพาะผู้แนบไฟล์ (เจ้าของใน Drive) เปลี่ยนสิทธิ์ได้', 'Only the person who attached the file (its Drive owner) can change access')
        : pick(locale, 'สมาชิกที่เพิ่มภายหลังจะได้สิทธิ์นี้เมื่อซิงก์', 'Members added later receive this role when you sync access')}</span></small></label>}
    </section>}
    <div className="form-actions drive-details-actions"><span /><button type="button" className="secondary" onClick={onClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : context.t('cancel')}</button>{!readOnly && <button className="primary" disabled={busy}>{busy ? pick(locale, 'กำลังบันทึก…', 'Saving…') : saveLabel}</button>}</div>
  </form></Modal>;
}

function DocumentReader({ documentId, projectId, context, role, readOnly }: { documentId: string; projectId: string; context: AppContextValue; role: Role | null; readOnly: boolean }) {
  const { locale } = context;
  const navigate = useNavigate();
  const [item, setItem] = useState<LoadedProjectDocument | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const labels = useProjectItems<Label>(projectId, 'labels');
  const tasks = useProjectItems<Task>(projectId, 'tasks');

  useEffect(() => {
    setItem(undefined);
    setFailed(false);
    return subscribeProjectDocument(projectId, documentId, setItem, () => setFailed(true));
  }, [projectId, documentId]);

  useEffect(() => {
    if (!item || item.schemaVersion === 2 || readOnly) return;
    void migrateLegacyProjectDocument(projectId, documentId).catch(() => undefined);
  }, [item?.id, item?.schemaVersion, projectId, documentId, readOnly]);

  if (item === undefined && !failed) return <div className="document-reader-state"><span className="loader" /></div>;
  if (!item || failed) return <div className="document-reader-state"><Empty icon="document" title={pick(locale, 'ไม่พบเอกสาร', 'Document not found')} description={pick(locale, 'เอกสารนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง', 'It may have been deleted or you may not have access.')} /><Link className="secondary" to={`/p/${projectId}/docs`}>{pick(locale, 'กลับไปเอกสาร', 'Back to documents')}</Link></div>;

  return <>
    <section className="document-reader-shell">
      <header className="document-reader-toolbar">
        <button type="button" className="secondary document-back" onClick={() => navigate(`/p/${projectId}/docs`)}><span aria-hidden="true"><Icon name="arrowLeft" /></span><span>{pick(locale, 'เอกสาร', 'Documents')}</span></button>
        <div><h1>{item.title}</h1><div className="document-reader-labels">{labels.filter((label) => (item.labelIds || []).includes(label.id)).map((label) => <LabelChip key={label.id} label={label} />)}</div><small>{pick(locale, 'แก้ไขล่าสุด', 'Updated')} {relativeTime(item.updatedAt?.toDate(), locale)}</small></div>
        {!readOnly && <button type="button" className="primary" onClick={() => setEditing(true)}>{pick(locale, 'แก้ไข', 'Edit')}</button>}
      </header>
      <MarkdownRenderer content={item.content} locale={locale} className="document-reader-content" />
    </section>
    {editing && <DocumentModal item={item} labels={labels} tasks={tasks} projectId={projectId} context={context} role={role} readOnly={readOnly} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} onDeleted={() => navigate(`/p/${projectId}/docs`)} />}
  </>;
}

function DocumentModal({ item, labels, tasks, projectId, context, role, readOnly, onClose, onSaved, onDeleted }: { item: LoadedProjectDocument | null; labels: Label[]; tasks: Task[]; projectId: string; context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void; onSaved: (id: string) => void; onDeleted?: () => void }) {
  const { user, t, locale } = context;
  const [title, setTitle] = useState(item?.title || 'Untitled'); const [content, setContent] = useState(item?.content || '# New document\n'); const [labelIds, setLabelIds] = useState(item?.labelIds || []); const [taskIds, setTaskIds] = useState(item?.taskIds || []); const [preview, setPreview] = useState(readOnly);
  const contentBytes = useMemo(() => documentContentBytes(content), [content]);
  const tooLarge = contentBytes > DOCUMENT_BODY_MAX_BYTES;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tooLarge) return;
    let savedId = item?.id || '';
    const ok = await attempt(async () => {
      if (item) await updateProjectDocument(projectId, item.id, title, content, labelIds, taskIds);
      else savedId = await createProjectDocument(projectId, title, content, labelIds, user, taskIds);
      return true;
    }, pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    if (ok) onSaved(savedId);
  };
  const formId = useId();
  const sizeLabel = `${(contentBytes / 1024).toFixed(contentBytes < 10240 ? 1 : 0)} / ${DOCUMENT_BODY_MAX_BYTES / 1024} KB`;
  return <Modal title={item ? (readOnly ? item.title : t('edit')) : t('documents')} onClose={onClose} wide actions={!readOnly && <button form={formId} className="primary" disabled={tooLarge}>{t('save')}</button>}><form id={formId} className="document-editor" onSubmit={submit}><div className="document-title-row"><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={DOCUMENT_TITLE_MAX_LENGTH} disabled={readOnly} /><div>{!readOnly && <button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>Edit</button>}<button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Preview</button></div></div><div className="document-editor-labels"><span>{pick(locale, 'Labels', 'Labels')}</span><LabelPicker labels={labels} value={labelIds} onChange={setLabelIds} projectId={projectId} context={context} readOnly={readOnly} /></div><fieldset className="document-task-field" disabled={readOnly}><legend>{pick(locale, 'เชื่อมกับ Tasks', 'Linked tasks')}</legend><div className="document-task-picker">{tasks.map((task) => <label key={task.id}><input type="checkbox" checked={taskIds.includes(task.id)} onChange={(event) => setTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} /><span>{task.title}</span></label>)}</div></fieldset>{preview ? <MarkdownRenderer content={content} locale={locale} /> : <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck disabled={readOnly} />}<div className={`document-size ${tooLarge ? 'over' : ''}`}><span>{tooLarge ? pick(locale, 'เอกสารใหญ่เกินขีดจำกัด 900 KB', 'Document exceeds the 900 KB limit') : pick(locale, 'ขนาด UTF-8', 'UTF-8 size')}</span><b>{sizeLabel}</b></div><div className="form-actions">{!readOnly && item && canDeleteItem(role, item.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={async () => { if (confirm(`${t('delete')}?`)) { const ok = await attempt(() => deleteProjectDocument(projectId, item.id).then(() => true), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); if (ok) { onClose(); onDeleted?.(); } } }}>{t('delete')}</button>}<span /><button type="button" className="secondary" onClick={onClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : t('cancel')}</button>{!readOnly && <button className="primary" disabled={tooLarge}>{t('save')}</button>}</div></form></Modal>;
}
