import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { documentId, limit, orderBy } from 'firebase/firestore';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AppContextValue, SectionProps } from '@/context/AppContext';
import { CanvasControls, Empty, MarkdownRenderer, Modal, PageTitle } from '@/components/common';
import { useActiveTasks, useCanvasViewport, useItemDrag, useProjectItems } from '@/hooks';
import { NOTE_COLORS } from '@/config/constants';
import { parseContentWithLinks } from '@/utils/linkify';
import { canDeleteItem } from '@/utils/permissions';
import { bulkUpdateWorkItems, createProjectDocument, createWorkItem, deleteProjectDocument, deleteWorkItem, loadProjectCollectionPage, migrateLegacyProjectDocument, subscribeProjectDocument, subscribeProjectQuery, updateProjectDocument, updateWorkItem, type CollectionCursor } from '@/services';
import type { LoadedProjectDocument, ProjectDocument, Role, StickyNote, Task } from '@/types';
import { attempt } from '@/components/toast';
import { pick, relativeTime } from '@/utils/formatters';
import { DOCUMENT_BODY_MAX_BYTES, DOCUMENT_TITLE_MAX_LENGTH, documentContentBytes } from '@/utils/documents';

const NOTE_W = 210;
const NOTE_H = 160;

export function Notes({ context, project, role, readOnly, documentId: selectedDocumentId }: SectionProps & { documentId?: string }) {
  if (selectedDocumentId) return <DocumentReader documentId={selectedDocumentId} projectId={project.id} context={context} role={role} readOnly={readOnly} />;
  return <NotesOverview context={context} project={project} role={role} readOnly={readOnly} />;
}

function NotesOverview({ context, project, role, readOnly }: Omit<SectionProps, 'members'>) {
  const notes = useProjectItems<StickyNote>(project.id, 'stickyNotes');
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<'sticky' | 'documents'>(() => searchParams.get('tab') === 'documents' ? 'documents' : 'sticky');
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [documentCursor, setDocumentCursor] = useState<CollectionCursor | null>(null);
  const [documentsHaveMore, setDocumentsHaveMore] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const documentsPaged = useRef(false);
  const tasks = useActiveTasks(project.id);
  const [noteModal, setNoteModal] = useState<StickyNote | { x: number; y: number } | null>(null);
  const [docModal, setDocModal] = useState<LoadedProjectDocument | 'new' | null>(null);
  const navigate = useNavigate();
  const { locale } = context;

  useEffect(() => {
    setTab(searchParams.get('tab') === 'documents' ? 'documents' : 'sticky');
  }, [searchParams]);

  const selectTab = (next: 'sticky' | 'documents') => {
    setTab(next);
    setSearchParams(next === 'documents' ? { tab: 'documents' } : {}, { replace: true });
  };

  useEffect(() => {
    // Document records contain only lightweight metadata; subscribe immediately so
    // the tab badge is truthful before the user opens the Documents tab. Bodies
    // remain lazy-loaded by DocumentReader.
    setDocuments([]);
    setDocumentsLoaded(false);
    documentsPaged.current = false;
    return subscribeProjectQuery<ProjectDocument>(project.id, 'documents', 'recent:50', [orderBy('updatedAt', 'desc'), orderBy(documentId()), limit(50)], (items) => {
      setDocuments((current) => [...items, ...current.filter((item) => !items.some((recent) => recent.id === item.id))]);
      setDocumentsLoaded(true);
      const last = items.at(-1);
      if (!documentsPaged.current) {
        setDocumentCursor(last?.updatedAt ? { value: last.updatedAt, id: last.id } : null);
        setDocumentsHaveMore(items.length === 50);
      }
    });
  }, [project.id]);

  const loadMoreDocuments = async () => {
    if (!documentCursor || loadingDocuments) return;
    setLoadingDocuments(true);
    documentsPaged.current = true;
    try {
      const page = await loadProjectCollectionPage<ProjectDocument>(project.id, 'documents', documentCursor, 50);
      setDocuments((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setDocumentCursor(page.nextCursor);
      setDocumentsHaveMore(page.hasMore);
    } finally { setLoadingDocuments(false); }
  };

  return <>
    <PageTitle eyebrow="KNOWLEDGE SPACE" title={context.t('notes')} description={pick(locale, 'เก็บไอเดีย โน้ตสั้น และเอกสารสำคัญของโปรเจกต์', 'Ideas, quick notes and key documents')} action={!readOnly && <button className="primary" onClick={() => tab === 'sticky' ? setNoteModal({ x: NaN, y: NaN }) : setDocModal('new')}>＋ {tab === 'sticky' ? context.t('sticky') : context.t('documents')}</button>} />
    <div className="content-tabs"><button className={tab === 'sticky' ? 'active' : ''} onClick={() => selectTab('sticky')}>{context.t('sticky')} <b>{notes.length}</b></button><button className={tab === 'documents' ? 'active' : ''} onClick={() => selectTab('documents')}>{context.t('documents')} <b>{documentsLoaded ? `${documents.length}${documentsHaveMore ? '+' : ''}` : '…'}</b></button></div>
    {tab === 'sticky'
      ? <StickyCanvas notes={notes} tasks={tasks} context={context} projectId={project.id} role={role} readOnly={readOnly} onEdit={setNoteModal} />
      : <><DocumentList documents={documents} projectId={project.id} locale={locale} />{documentsHaveMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingDocuments} onClick={() => void loadMoreDocuments()}>{loadingDocuments ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดเอกสารเพิ่มเติม', 'Load more documents')}</button></div>}</>}
    {noteModal && <StickyModal item={'id' in noteModal ? noteModal : null} position={'id' in noteModal ? undefined : noteModal} projectId={project.id} tasks={tasks} context={context} role={role} readOnly={readOnly} onClose={() => setNoteModal(null)} />}
    {docModal && <DocumentModal item={docModal === 'new' ? null : docModal} projectId={project.id} context={context} role={role} readOnly={readOnly} onClose={() => setDocModal(null)} onSaved={(id) => { setDocModal(null); navigate(`/p/${project.id}/notes/${id}`); }} />}
  </>;
}

function StickyCanvas({ notes, tasks, context, projectId, role, readOnly, onEdit }: { notes: StickyNote[]; tasks: Task[]; context: AppContextValue; projectId: string; role: Role | null; readOnly: boolean; onEdit: (value: StickyNote | { x: number; y: number }) => void }) {
  const { locale, user } = context;
  const canvas = useCanvasViewport(`ps.notes.view.${projectId}`);
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
            {!readOnly && <button type="button" className="sticky-action-btn" title={note.pinned ? pick(locale, 'ถอนหมุด', 'Unpin') : pick(locale, 'ปักหมุด (ล็อกตำแหน่ง)', 'Pin (lock position)')} onClick={() => togglePin(note)}>{note.pinned ? '📌' : '⋮⋮'}</button>}
            <div className="sticky-header-actions"><button type="button" className="sticky-action-btn" title={readOnly ? context.t('readOnly') : context.t('edit')} onClick={() => onEdit(note)}>{readOnly ? '⌕' : '✎'}</button>{!readOnly && canDeleteItem(role, note.createdBy, user.uid) && <button type="button" className="sticky-action-btn danger" title={context.t('delete')} onClick={() => removeNote(note)}>×</button>}</div>
          </header>
          <p>{parseContentWithLinks(note.content)}</p>
          {note.taskId && <small>↗ {tasks.find((task) => task.id === note.taskId)?.title || 'Task'}</small>}
        </article>;
      })}
    </div>
    {!notes.length && <div className="canvas-empty"><Empty icon="▤" title={pick(locale, 'ยังไม่มี Sticky Note', 'No sticky notes yet')} description={pick(locale, 'ดับเบิลคลิกที่ว่างเพื่อแปะโน้ต', 'Double-click anywhere to add a note')} /></div>}
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

function DocumentList({ documents, projectId, locale }: { documents: ProjectDocument[]; projectId: string; locale: string }) {
  return <div className="document-list">{documents.map((document) => <Link key={document.id} to={`/p/${projectId}/notes/${document.id}`}><span>▤</span><div><h3>{document.title}</h3><p>{document.excerpt || document.content?.replace(/[#*_`]/g, '').slice(0, 130) || 'Empty document'}</p><small>{relativeTime(document.updatedAt?.toDate(), locale)}</small></div><b>→</b></Link>)}{!documents.length && <Empty icon="▤" title={pick(locale, 'ยังไม่มีเอกสาร', 'No documents yet')} description={pick(locale, 'สร้างเอกสาร Markdown สำหรับสเปกหรือบันทึกการประชุม', 'Create Markdown docs for specs or meeting notes')} />}</div>;
}

function DocumentReader({ documentId, projectId, context, role, readOnly }: { documentId: string; projectId: string; context: AppContextValue; role: Role | null; readOnly: boolean }) {
  const { locale } = context;
  const navigate = useNavigate();
  const [item, setItem] = useState<LoadedProjectDocument | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

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
  if (!item || failed) return <div className="document-reader-state"><Empty icon="▤" title={pick(locale, 'ไม่พบเอกสาร', 'Document not found')} description={pick(locale, 'เอกสารนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง', 'It may have been deleted or you may not have access.')} /><Link className="secondary" to={`/p/${projectId}/notes?tab=documents`}>{pick(locale, 'กลับไปเอกสาร', 'Back to documents')}</Link></div>;

  return <>
    <section className="document-reader-shell">
      <header className="document-reader-toolbar">
        <button type="button" className="secondary document-back" onClick={() => navigate(`/p/${projectId}/notes?tab=documents`)}><span aria-hidden="true">←</span><span>{pick(locale, 'เอกสาร', 'Documents')}</span></button>
        <div><h1>{item.title}</h1><small>{pick(locale, 'แก้ไขล่าสุด', 'Updated')} {relativeTime(item.updatedAt?.toDate(), locale)}</small></div>
        {!readOnly && <button type="button" className="primary" onClick={() => setEditing(true)}>{pick(locale, 'แก้ไข', 'Edit')}</button>}
      </header>
      <MarkdownRenderer content={item.content} locale={locale} className="document-reader-content" />
    </section>
    {editing && <DocumentModal item={item} projectId={projectId} context={context} role={role} readOnly={readOnly} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} onDeleted={() => navigate(`/p/${projectId}/notes?tab=documents`)} />}
  </>;
}

function DocumentModal({ item, projectId, context, role, readOnly, onClose, onSaved, onDeleted }: { item: LoadedProjectDocument | null; projectId: string; context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void; onSaved: (id: string) => void; onDeleted?: () => void }) {
  const { user, t, locale } = context;
  const [title, setTitle] = useState(item?.title || 'Untitled'); const [content, setContent] = useState(item?.content || '# New document\n'); const [preview, setPreview] = useState(readOnly);
  const contentBytes = useMemo(() => documentContentBytes(content), [content]);
  const tooLarge = contentBytes > DOCUMENT_BODY_MAX_BYTES;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tooLarge) return;
    let savedId = item?.id || '';
    const ok = await attempt(async () => {
      if (item) await updateProjectDocument(projectId, item.id, title, content);
      else savedId = await createProjectDocument(projectId, title, content, user);
      return true;
    }, pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    if (ok) onSaved(savedId);
  };
  const formId = useId();
  const sizeLabel = `${(contentBytes / 1024).toFixed(contentBytes < 10240 ? 1 : 0)} / ${DOCUMENT_BODY_MAX_BYTES / 1024} KB`;
  return <Modal title={item ? (readOnly ? item.title : t('edit')) : t('documents')} onClose={onClose} wide actions={!readOnly && <button form={formId} className="primary" disabled={tooLarge}>{t('save')}</button>}><form id={formId} className="document-editor" onSubmit={submit}><div className="document-title-row"><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={DOCUMENT_TITLE_MAX_LENGTH} disabled={readOnly} /><div>{!readOnly && <button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>Edit</button>}<button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Preview</button></div></div>{preview ? <MarkdownRenderer content={content} locale={locale} /> : <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck disabled={readOnly} />}<div className={`document-size ${tooLarge ? 'over' : ''}`}><span>{tooLarge ? pick(locale, 'เอกสารใหญ่เกินขีดจำกัด 900 KB', 'Document exceeds the 900 KB limit') : pick(locale, 'ขนาด UTF-8', 'UTF-8 size')}</span><b>{sizeLabel}</b></div><div className="form-actions">{!readOnly && item && canDeleteItem(role, item.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={async () => { if (confirm(`${t('delete')}?`)) { const ok = await attempt(() => deleteProjectDocument(projectId, item.id).then(() => true), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); if (ok) { onClose(); onDeleted?.(); } } }}>{t('delete')}</button>}<span /><button type="button" className="secondary" onClick={onClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : t('cancel')}</button>{!readOnly && <button className="primary" disabled={tooLarge}>{t('save')}</button>}</div></form></Modal>;
}
