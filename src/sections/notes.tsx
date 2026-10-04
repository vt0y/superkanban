import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { documentId, limit, orderBy, where, type QueryConstraint } from 'firebase/firestore';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AppContextValue, SectionProps } from '@/context/AppContext';
import { BulkBar, CanvaFileRow, CanvaLinkForm, CanvasControls, DriveAttachmentControl, DriveFileRow, driveRoleLabel, Empty, MarkdownRenderer, Modal, PageTitle } from '@/components/common';
import { useActiveTasks, useCanvasViewport, useItemDrag, useLinkedTasks, useProjectItems, useProjectItemsState, useSelection, type Selection } from '@/hooks';
import { NOTE_COLORS } from '@/config/constants';
import { parseContentWithLinks } from '@/utils/linkify';
import { canDeleteItem } from '@/utils/permissions';
import { allowedDriveRoles, attachCanvaProjectDocument, attachDriveProjectDocument, bulkRemoveProjectDocuments, bulkUpdateProjectDocumentLinks, bulkUpdateWorkItems, createProjectDocument, createWorkItem, deleteProjectDocument, deleteWorkItem, detachDriveProjectDocument, driveFolderUrl, driveOpenUrl, isCanvaProjectDocument, isDriveFolder, isDriveProjectDocument, loadProjectCollectionPage, migrateLegacyProjectDocument, pinProjectDocuments, subscribePinnedDocumentMetadata, subscribeProjectDocument, subscribeProjectQuery, unpinProjectDocument, updateCanvaProjectDocumentDetails, updateDocumentCanvasCard, updateDriveProjectDocumentDetails, updateDriveProjectDocumentRole, updateProjectDocument, updateProjectDocumentLabels, updateWorkItem, type CollectionCursor, type ProjectDocumentLinkField } from '@/services';
import type { CanvasItem, CanvaProjectDocument, DocumentCanvasCard, DriveProjectDocument, DriveRole, Label, LoadedProjectDocument, Membership, Milestone, ProjectDocument, Role, StickyNote, Task } from '@/types';
import { isDocumentCanvasCard, isStickyNote } from '@/types';
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
import { canvaEditUrl } from '@/utils/canva-link';
import { documentDisplayName, documentGroup, groupDocuments, latestDocumentGroup, sortDocuments, type DocumentGroup, type DocumentSort } from '@/utils/document-library';
import { findCanvasPositions } from '@/utils/canvas-items';

const NOTE_W = 210;
const NOTE_H = 160;

/** Where a library document lives: the Drive/Canva source, or the in-app Markdown page. */
const documentOpenUrl = (projectId: string, item: ProjectDocument): string => {
  if (isDriveProjectDocument(item)) return isDriveFolder(item) ? driveFolderUrl(item.driveFileId, item.resourceKey) : driveOpenUrl(item.driveFileId, item.resourceKey);
  if (isCanvaProjectDocument(item)) return canvaEditUrl(item);
  return `/p/${projectId}/docs/${item.id}`;
};

export function Notes({ context, project, members, role, readOnly }: SectionProps) {
  return <NotesOverview context={context} project={project} members={members} role={role} readOnly={readOnly} mode="sticky" />;
}

export function Documents({ context, project, members, role, readOnly, documentId: selectedDocumentId }: SectionProps & { documentId?: string }) {
  if (selectedDocumentId) return <DocumentReader documentId={selectedDocumentId} projectId={project.id} context={context} role={role} readOnly={readOnly} />;
  return <NotesOverview context={context} project={project} members={members} role={role} readOnly={readOnly} mode="documents" />;
}

function NotesOverview({ context, project, members, role, readOnly, mode }: SectionProps & { mode: 'sticky' | 'documents' }) {
  const canvasItems = useProjectItems<CanvasItem>(project.id, 'stickyNotes', mode === 'sticky');
  const notes = canvasItems.filter(isStickyNote);
  const documentCards = canvasItems.filter(isDocumentCanvasCard);
  const [searchParams, setSearchParams] = useSearchParams();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [documentCursor, setDocumentCursor] = useState<CollectionCursor | null>(null);
  const [documentsHaveMore, setDocumentsHaveMore] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const documentsPaged = useRef(false);
  const liveDocumentIds = useRef<Set<string>>(new Set());
  const tasks = useActiveTasks(project.id);
  const { items: labels, loaded: labelsLoaded } = useProjectItemsState<Label>(project.id, 'labels');
  const { items: milestones } = useProjectItemsState<Milestone>(project.id, 'milestones');
  const [noteModal, setNoteModal] = useState<StickyNote | { x: number; y: number } | null>(null);
  const [docModal, setDocModal] = useState<LoadedProjectDocument | 'new' | null>(null);
  const [driveModal, setDriveModal] = useState<DriveProjectDocument | CanvaProjectDocument | null>(null);
  const [addDocumentOpen, setAddDocumentOpen] = useState(false);
  const [pinPickerOpen, setPinPickerOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Active tasks are shared with the board; done tasks are fetched only when a loaded document links them.
  const linkedTaskIds = useMemo(() => [
    ...documents.flatMap((item) => item.taskIds || []),
    ...(driveModal?.taskIds || []),
    ...(docModal && docModal !== 'new' ? docModal.taskIds || [] : []),
  ], [documents, driveModal, docModal]);
  const documentTasks = useLinkedTasks(project.id, tasks, linkedTaskIds);
  const navigate = useNavigate();
  const { locale } = context;
  const query = searchParams.get('q') || '';
  const parsedQuery = useMemo(() => parseDocumentQuery(query), [query]);
  const queryLabelNames = parsedQuery.terms.filter((term) => term.key === 'label' && !term.negated).map((term) => term.value);
  const queryTaskNames = parsedQuery.terms.filter((term) => term.key === 'task' && !term.negated).map((term) => term.value);
  const queryMilestoneNames = parsedQuery.terms.filter((term) => term.key === 'milestone' && !term.negated).map((term) => term.value);
  const selectedLabelIds = [...new Set([
    ...(searchParams.get('labels') || '').split(',').filter(Boolean),
    ...labels.filter((label) => queryLabelNames.includes(label.name.toLowerCase())).map((label) => label.id),
  ])].filter((id) => labels.some((label) => label.id === id)).slice(0, 30);
  const selectedTaskIds = [...new Set(documentTasks.filter((task) => queryTaskNames.includes(task.title.toLowerCase())).map((task) => task.id))].slice(0, 30);
  const selectedMilestoneIds = [...new Set(milestones.filter((milestone) => queryMilestoneNames.includes(milestone.title.toLowerCase())).map((milestone) => milestone.id))].slice(0, 30);
  const labelFilterKey = [...selectedLabelIds].sort().join(',');
  const taskFilterKey = [...selectedTaskIds].sort().join(',');
  const milestoneFilterKey = [...selectedMilestoneIds].sort().join(',');
  const documentFilters: QueryConstraint[] = selectedTaskIds.length ? [where('taskIds', 'array-contains-any', selectedTaskIds)] : selectedMilestoneIds.length ? [where('milestoneIds', 'array-contains-any', selectedMilestoneIds)] : selectedLabelIds.length ? [where('labelIds', 'array-contains-any', selectedLabelIds)] : [];

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
  const toggleMilestoneFilter = (milestone: Milestone) => {
    const term = `milestone:${queryValue(milestone.title)}`;
    setSearchParams((current) => { const params = new URLSearchParams(current); const next = toggleQueryTerm(params.get('q') || '', term); if (next) params.set('q', next); else params.delete('q'); return params; }, { replace: true });
  };

  useEffect(() => {
    if (mode !== 'documents') return;
    // Document records contain only lightweight metadata; bodies remain
    // lazy-loaded by DocumentReader.
    setDocuments([]);
    documentsPaged.current = false;
    liveDocumentIds.current = new Set();
    return subscribeProjectQuery<ProjectDocument>(project.id, 'documents', `recent:50:labels:${labelFilterKey || '*'}:tasks:${taskFilterKey || '*'}:milestones:${milestoneFilterKey || '*'}`, [...documentFilters, orderBy('updatedAt', 'desc'), orderBy(documentId()), limit(50)], (items) => {
      const previousLiveIds = liveDocumentIds.current;
      liveDocumentIds.current = new Set(items.map((item) => item.id));
      setDocuments((current) => [...items, ...current.filter((item) => !previousLiveIds.has(item.id) && !liveDocumentIds.current.has(item.id))]);
      const last = items.at(-1);
      if (!documentsPaged.current) {
        setDocumentCursor(last?.updatedAt ? { value: last.updatedAt, id: last.id } : null);
        setDocumentsHaveMore(items.length === 50);
      }
    });
  }, [mode, project.id, labelFilterKey, taskFilterKey, milestoneFilterKey]);

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

  // Filter pills offer only labels/tasks that documents actually use. A server-side filter
  // narrows `documents`, so the last unfiltered set is remembered and kept in the union.
  const unfilteredUsage = useRef<{ labelIds: Set<string>; taskIds: Set<string>; milestoneIds: Set<string> }>({ labelIds: new Set(), taskIds: new Set(), milestoneIds: new Set() });
  const documentUsage = useMemo(() => {
    const usage = { labelIds: new Set(documents.flatMap((item) => item.labelIds || [])), taskIds: new Set(documents.flatMap((item) => item.taskIds || [])), milestoneIds: new Set(documents.flatMap((item) => item.milestoneIds || [])) };
    if (!labelFilterKey && !taskFilterKey && !milestoneFilterKey) { unfilteredUsage.current = usage; return usage; }
    return { labelIds: new Set([...unfilteredUsage.current.labelIds, ...usage.labelIds, ...selectedLabelIds]), taskIds: new Set([...unfilteredUsage.current.taskIds, ...usage.taskIds, ...selectedTaskIds]), milestoneIds: new Set([...unfilteredUsage.current.milestoneIds, ...usage.milestoneIds, ...selectedMilestoneIds]) };
  }, [documents, labelFilterKey, taskFilterKey, milestoneFilterKey]);
  const filterLabels = useMemo(() => labels.filter((label) => documentUsage.labelIds.has(label.id) || queryLabelNames.includes(label.name.toLowerCase())), [labels, documentUsage, query]);
  const filterTasks = useMemo(() => documentTasks.filter((task) => documentUsage.taskIds.has(task.id) || queryTaskNames.includes(task.title.toLowerCase())), [documentTasks, documentUsage, query]);
  const filterMilestones = useMemo(() => milestones.filter((milestone) => documentUsage.milestoneIds.has(milestone.id) || queryMilestoneNames.includes(milestone.title.toLowerCase())), [milestones, documentUsage, query]);

  const visibleDocuments = useMemo(() => documents.filter((document) => matchDocument(document, parsedQuery, labels, documentTasks, milestones)), [documents, parsedQuery, labels, documentTasks, milestones]);
  const selection = useSelection(visibleDocuments.map((document) => document.id));
  const selectedDocumentIds = [...selection.selected];
  const setDocumentQuery = (value: string) => setSearchParams((current) => { const params = new URLSearchParams(current); if (value.trim()) params.set('q', value); else params.delete('q'); return params; }, { replace: true });

  const bulkLink = async (field: ProjectDocumentLinkField, rawValue: string) => {
    const separator = rawValue.indexOf(':');
    if (separator < 0 || bulkBusy) return;
    const operation = rawValue.slice(0, separator) as 'add' | 'remove';
    const value = rawValue.slice(separator + 1);
    if (!value) return;
    setBulkBusy(true);
    const done = await attempt(() => bulkUpdateProjectDocumentLinks(project.id, selectedDocumentIds, field, value, operation).then(() => true), pick(locale, 'อัปเดตเอกสารไม่สำเร็จ', 'Could not update documents'));
    setBulkBusy(false);
    if (done) toast(pick(locale, `อัปเดต ${selectedDocumentIds.length} เอกสารแล้ว`, `Updated ${selectedDocumentIds.length} documents`), 'success');
  };

  const bulkRemove = async () => {
    if (bulkBusy) return;
    const selectedDocuments = documents.filter((document) => selection.has(document.id));
    const removable = selectedDocuments.filter((document) => canDeleteItem(role, document.createdBy, context.user.uid));
    const skipped = selectedDocuments.length - removable.length;
    if (!removable.length) { toast(pick(locale, 'ไม่มีสิทธิ์นำเอกสารที่เลือกออก', 'You cannot remove the selected documents'), 'error'); return; }
    const message = pick(locale, `นำ ${removable.length} เอกสารออกจากคลัง? ไฟล์ต้นทางจะไม่ถูกลบ`, `Remove ${removable.length} documents from the library? Source files will not be deleted`)
      + (skipped ? pick(locale, ` (ข้าม ${skipped} เอกสารที่ไม่มีสิทธิ์)`, ` (${skipped} skipped — no permission)`) : '');
    if (!confirm(message)) return;
    setBulkBusy(true);
    const done = await attempt(() => bulkRemoveProjectDocuments(project.id, removable).then(() => true), pick(locale, 'นำเอกสารออกไม่สำเร็จ', 'Could not remove documents'));
    setBulkBusy(false);
    if (done) {
      selection.clear();
      setSelectMode(false);
      toast(pick(locale, `นำ ${removable.length} เอกสารออกแล้ว`, `Removed ${removable.length} documents`), 'success');
    }
  };

  return <>
    <PageTitle eyebrow={mode === 'sticky' ? 'QUICK NOTES' : 'KNOWLEDGE SPACE'} title={mode === 'sticky' ? context.t('notes') : context.t('documents')}
      description={mode === 'sticky' ? pick(locale, 'แปะไอเดียและโน้ตสั้นบนพื้นที่อิสระ', 'Capture ideas and quick notes on a freeform canvas') : pick(locale, 'ค้นหา จัดหมวดหมู่ และแชร์เอกสารสำคัญของโปรเจกต์', 'Find, organize and share key project documents')}
      action={mode === 'sticky'
        ? (!readOnly && <div className="action-row"><button className="secondary" onClick={() => setPinPickerOpen(true)}><Icon name="pin" /> {pick(locale, 'ปักเอกสาร', 'Pin documents')}</button><button className="primary" onClick={() => setNoteModal({ x: NaN, y: NaN })}><Icon name="add" /> {context.t('sticky')}</button></div>)
        : <div className="action-row"><button className="secondary" onClick={() => setLabelsOpen(true)}><Icon name="label" /> {pick(locale, 'จัดการ Labels', 'Manage labels')}</button>{!readOnly && <><button className={`secondary ${selectMode ? 'on' : ''}`} onClick={() => { setSelectMode(!selectMode); if (selectMode) selection.clear(); }}><Icon name="checklist" /> {pick(locale, 'เลือกหลายรายการ', 'Select')}</button><button className="primary" onClick={() => setAddDocumentOpen(true)}><Icon name="add" /> {pick(locale, 'เพิ่มเอกสาร', 'Add document')}</button></>}</div>} />
    {mode === 'sticky'
      ? <StickyCanvas notes={notes} documentCards={documentCards} tasks={tasks} context={context} projectId={project.id} role={role} readOnly={readOnly} onEdit={setNoteModal} onDetails={setDriveModal} />
      : <><div className="board-toolbar document-toolbar"><DocumentFilterBar value={query} onChange={setDocumentQuery} labels={filterLabels} tasks={filterTasks} milestones={filterMilestones} locale={locale} /></div>
        {query && <p className="filter-summary">{pick(locale, `พบ ${visibleDocuments.length} จาก ${documents.length} เอกสารที่โหลดแล้ว`, `${visibleDocuments.length} of ${documents.length} loaded documents`)} · <button type="button" className="link-button" onClick={() => setDocumentQuery('')}>{pick(locale, 'ล้างตัวกรอง', 'Clear filter')}</button></p>}
        <DocumentLibrary documents={visibleDocuments} labels={labels} tasks={documentTasks} milestones={milestones} filtered={!!query} projectId={project.id} context={context} role={role} readOnly={readOnly} userId={context.user.uid} selection={selection} selectMode={selectMode} onEditDrive={setDriveModal} onFilter={toggleLabelFilter} onMilestoneFilter={toggleMilestoneFilter} activeLabelNames={queryLabelNames} />
        {documentsHaveMore && <div className="load-more-row"><button type="button" className="secondary" disabled={loadingDocuments} onClick={() => void loadMoreDocuments()}>{loadingDocuments ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดเอกสารเพิ่มเติม', 'Load more documents')}</button></div>}</>}
    {mode === 'documents' && !readOnly && <BulkBar count={selection.selected.size} locale={locale} onClear={selection.clear}>
      {labels.length > 0 && <select value="" disabled={bulkBusy} onChange={(event) => { if (event.target.value) void bulkLink('labelIds', event.target.value); }} aria-label="Label"><option value="">Label…</option><optgroup label={pick(locale, 'เพิ่ม', 'Add')}>{labels.map((label) => <option key={label.id} value={`add:${label.id}`}>+ {label.name}</option>)}</optgroup><optgroup label={pick(locale, 'เอาออก', 'Remove')}>{labels.map((label) => <option key={label.id} value={`remove:${label.id}`}>− {label.name}</option>)}</optgroup></select>}
      {documentTasks.length > 0 && <select value="" disabled={bulkBusy} onChange={(event) => { if (event.target.value) void bulkLink('taskIds', event.target.value); }} aria-label="Task"><option value="">Task…</option><optgroup label={pick(locale, 'เพิ่ม', 'Add')}>{documentTasks.map((task) => <option key={task.id} value={`add:${task.id}`}>+ {task.title}</option>)}</optgroup><optgroup label={pick(locale, 'เอาออก', 'Remove')}>{documentTasks.map((task) => <option key={task.id} value={`remove:${task.id}`}>− {task.title}</option>)}</optgroup></select>}
      {milestones.length > 0 && <select value="" disabled={bulkBusy} onChange={(event) => { if (event.target.value) void bulkLink('milestoneIds', event.target.value); }} aria-label="Milestone"><option value="">Milestone…</option><optgroup label={pick(locale, 'เพิ่ม', 'Add')}>{milestones.map((milestone) => <option key={milestone.id} value={`add:${milestone.id}`}>+ {milestone.title}</option>)}</optgroup><optgroup label={pick(locale, 'เอาออก', 'Remove')}>{milestones.map((milestone) => <option key={milestone.id} value={`remove:${milestone.id}`}>− {milestone.title}</option>)}</optgroup></select>}
      <button type="button" className="danger ghost" disabled={bulkBusy} onClick={() => void bulkRemove()}>{pick(locale, 'นำออก', 'Remove')}</button>
    </BulkBar>}
    {noteModal && <StickyModal item={'id' in noteModal ? noteModal : null} position={'id' in noteModal ? undefined : noteModal} projectId={project.id} tasks={tasks} context={context} role={role} readOnly={readOnly} onClose={() => setNoteModal(null)} />}
    {docModal && <DocumentModal item={docModal === 'new' ? null : docModal} labels={labels} tasks={documentTasks} milestones={milestones} projectId={project.id} context={context} role={role} readOnly={readOnly} onClose={() => setDocModal(null)} onSaved={(id) => { setDocModal(null); navigate(`/p/${project.id}/docs/${id}`); }} />}
    {driveModal && <DriveDocumentDetailsModal item={driveModal} labels={labels} tasks={documentTasks} milestones={milestones} projectId={project.id} context={context} readOnly={readOnly} onClose={() => setDriveModal(null)} />}
    {labelsOpen && <LabelManager labels={labels} tasks={tasks} projectId={project.id} context={context} role={role} readOnly={readOnly} onClose={() => setLabelsOpen(false)} onFilter={(label) => { toggleLabelFilter(label); setLabelsOpen(false); }} />}
    {addDocumentOpen && <AddDocumentModal project={project} members={members} documents={documents} labels={labels} tasks={documentTasks} context={context} onClose={() => setAddDocumentOpen(false)} onMarkdown={() => { setAddDocumentOpen(false); setDocModal('new'); }} />}
    {pinPickerOpen && <CanvasDocumentPicker projectId={project.id} pinnedIds={new Set(documentCards.map((card) => card.documentId))} canvasItems={canvasItems} context={context} labels={labels} tasks={documentTasks} milestones={milestones} onClose={() => setPinPickerOpen(false)} />}
  </>;
}

function StickyCanvas({ notes, documentCards, tasks, context, projectId, role, readOnly, onEdit, onDetails }: { notes: StickyNote[]; documentCards: DocumentCanvasCard[]; tasks: Task[]; context: AppContextValue; projectId: string; role: Role | null; readOnly: boolean; onEdit: (value: StickyNote | { x: number; y: number }) => void; onDetails: (item: DriveProjectDocument | CanvaProjectDocument) => void }) {
  const { locale, user } = context;
  const navigate = useNavigate();
  const canvas = useCanvasViewport(`ps.notes.view.${projectId}`);
  const { openTask } = useTaskModal();
  const [stack, setStack] = useState<string[]>([]);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const justDragged = useRef(false);
  useEffect(() => subscribePinnedDocumentMetadata(projectId, documentCards.map((card) => card.documentId), setDocuments), [projectId, documentCards.map((card) => card.documentId).sort().join('|')]);
  const documentById = useMemo(() => new Map(documents.map((item) => [item.id, item])), [documents]);
  const drag = useItemDrag(canvas.toWorld, (positions) => {
    const ids = [...positions.keys()];
    void attempt(() => bulkUpdateWorkItems(projectId, 'stickyNotes', ids, (id) => positions.get(id)!), pick(locale, 'ย้ายโน้ตไม่สำเร็จ', 'Could not move note'));
  });
  // Fit all notes the first time a board with notes is opened without a saved view.
  const [needsFit, setNeedsFit] = useState(() => { try { return !localStorage.getItem(`ps.notes.view.${projectId}`); } catch { return true; } });
  useEffect(() => {
    if (!needsFit || (!notes.length && !documentCards.length)) return;
    setNeedsFit(false);
    canvas.fit([...notes.map((note) => ({ x: note.x, y: note.y, w: NOTE_W, h: NOTE_H })), ...documentCards.map((card) => ({ x: card.x, y: card.y, w: NOTE_W, h: NOTE_H }))]);
  }, [notes, documentCards, needsFit, canvas]);

  const rects = () => [...notes.map((note) => ({ x: note.x, y: note.y, w: NOTE_W, h: NOTE_H })), ...documentCards.map((card) => ({ x: card.x, y: card.y, w: NOTE_W, h: NOTE_H }))];
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
  const updateCard = (card: DocumentCanvasCard, settings: { pinned?: boolean; color?: string }) => void attempt(() => updateDocumentCanvasCard(projectId, card.id, settings), pick(locale, 'อัปเดตการ์ดไม่สำเร็จ', 'Could not update card'));
  const removeNote = (note: StickyNote) => { if (confirm(pick(locale, 'ลบ Sticky Note นี้หรือไม่?', 'Delete this sticky note?'))) void attempt(() => deleteWorkItem(projectId, 'stickyNotes', note.id), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); };
  const removeCard = (item: ProjectDocument) => {
    if (confirm(pick(locale, 'ถอนเอกสารจาก Notes หรือไม่? เอกสารต้นฉบับจะไม่ถูกลบ', 'Remove from Notes? The original document will not be deleted.'))) void attempt(() => unpinProjectDocument(projectId, item.id), pick(locale, 'ถอนไม่สำเร็จ', 'Could not unpin document'));
  };

  const colorPicker = (id: string, current: string, onPick: (color: string) => void) => colorPickerId === id && !readOnly && <div className="sticky-color-picker" role="group" aria-label={pick(locale, 'สีโน้ต', 'Note color')}>{NOTE_COLORS.map((color) => <button type="button" key={color} className={current === color ? 'selected' : ''} style={{ background: color }} aria-label={color} onClick={() => { setColorPickerId(null); onPick(color); }} />)}</div>;
  const colorButton = (id: string) => <button type="button" className={`sticky-action-btn ${colorPickerId === id ? 'active' : ''}`} title={pick(locale, 'เลือกสี', 'Choose color')} aria-expanded={colorPickerId === id} onClick={() => setColorPickerId((current) => current === id ? null : id)}><Icon name="color" /></button>;

  return <><div ref={canvas.containerRef} className={`infinite-canvas sticky-canvas ${canvas.panning ? 'panning' : ''}`} style={canvas.gridStyle}
    onPointerDown={(event) => canvas.handlePointerDown(event, event.target === event.currentTarget)}
    onPointerMove={(event) => { if (!drag.move(event)) canvas.handlePointerMove(event); }}
    onPointerUp={(event) => { if (drag.end(event) === 'moved') { justDragged.current = true; window.setTimeout(() => { justDragged.current = false; }, 0); } canvas.handlePointerUp(event); }}
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
            <div className="sticky-header-actions">{!readOnly && colorButton(note.id)}<button type="button" className="sticky-action-btn" title={readOnly ? context.t('readOnly') : context.t('edit')} onClick={() => onEdit(note)}><Icon name={readOnly ? 'eye' : 'edit'} /></button>{!readOnly && canDeleteItem(role, note.createdBy, user.uid) && <button type="button" className="sticky-action-btn danger" title={context.t('delete')} onClick={() => removeNote(note)}><Icon name="close" /></button>}</div>
          </header>
          {colorPicker(note.id, note.color, (color) => void attempt(() => updateWorkItem(projectId, 'stickyNotes', note.id, { color }), pick(locale, 'เปลี่ยนสีไม่สำเร็จ', 'Could not change color')))}
          <p>{parseContentWithLinks(note.content)}</p>
          {note.taskId && <button type="button" className="sticky-task-link" onClick={() => openTask(note.taskId)}><Icon name="open" /> {tasks.find((task) => task.id === note.taskId)?.title || 'Task'}</button>}
        </article>;
      })}
      {documentCards.map((card) => {
        const item = documentById.get(card.documentId);
        if (!item) return null;
        const position = drag.overrides.get(card.id) || card;
        const dragging = drag.overrides.has(card.id);
        const group = documentGroup(item);
        const details = () => { if (isDriveProjectDocument(item) || isCanvaProjectDocument(item)) onDetails(item); else navigate(`/p/${projectId}/docs/${item.id}`); };
        return <article key={card.id} className={`sticky-note sticky-document ${card.pinned ? 'pinned' : ''} ${dragging ? 'dragging' : ''}`}
          style={{ background: card.color || NOTE_COLORS[0], transform: `translate3d(${position.x}px, ${position.y}px, 0)`, zIndex: dragging ? 9999 : order(card.id) }}
          onPointerDown={(event) => { if ((event.target as HTMLElement).closest('button,a')) return; if (canvas.handlePointerDown(event, false)) return; event.stopPropagation(); setStack((current) => [...current.filter((id) => id !== card.id), card.id]); if (!readOnly && !card.pinned && event.button === 0) drag.start(event, new Map([[card.id, { x: card.x, y: card.y }]])); }}
          onClick={(event) => {
            if (justDragged.current || (event.target as HTMLElement).closest('button,a,.sticky-color-picker')) return;
            if (isDriveProjectDocument(item) || isCanvaProjectDocument(item)) window.open(documentOpenUrl(projectId, item), '_blank', 'noopener,noreferrer');
            else navigate(`/p/${projectId}/docs/${item.id}`);
          }}
          onDoubleClick={(event) => event.stopPropagation()}>
          <header>
            {!readOnly ? <button type="button" className="sticky-action-btn" title={card.pinned ? pick(locale, 'ถอนหมุด', 'Unpin') : pick(locale, 'ปักหมุด (ล็อกตำแหน่ง)', 'Pin (lock position)')} onClick={() => updateCard(card, { pinned: !card.pinned })}><Icon name={card.pinned ? 'pin' : 'drag'} /></button> : <span />}
            <div className="sticky-header-actions">
              <a className="sticky-action-btn" href={documentOpenUrl(projectId, item)} target="_blank" rel="noreferrer" title={pick(locale, 'เปิดในแท็บใหม่', 'Open in new tab')}><Icon name="open" /></a>
              <button type="button" className="sticky-action-btn" title={pick(locale, 'ดูรายละเอียด', 'View details')} onClick={details}><Icon name={readOnly ? 'eye' : 'edit'} /></button>
              {!readOnly && colorButton(card.id)}
              {!readOnly && <button type="button" className="sticky-action-btn danger" title={pick(locale, 'ถอนจาก Notes', 'Remove from Notes')} onClick={() => removeCard(item)}><Icon name="close" /></button>}
            </div>
          </header>
          {colorPicker(card.id, card.color || NOTE_COLORS[0], (color) => updateCard(card, { color }))}
          <span className="sticky-document-type"><Icon name={group === 'folder' ? 'folder' : group === 'drive' ? 'cloud' : group === 'canva' ? 'canva' : 'document'} />{group === 'folder' ? 'Google Drive Folder' : group === 'drive' ? 'Google Drive' : group === 'canva' ? 'Canva' : 'Markdown'}</span>
          <h3>{documentDisplayName(item)}</h3>
          <p>{item.kind === 'drive' || item.kind === 'canva' ? item.description || item.title : item.excerpt || pick(locale, 'เอกสาร Markdown', 'Markdown document')}</p>
          <small><span>{(item.taskIds || []).length} Tasks</span><span>{relativeTime(item.updatedAt?.toDate(), locale)}</span></small>
        </article>;
      })}
    </div>
    {!notes.length && !documentCards.length && <div className="canvas-empty"><Empty icon="note" title={pick(locale, 'กระดานยังว่าง', 'The board is empty')} description={pick(locale, 'เพิ่ม Sticky Note หรือปักเอกสารจากคลัง', 'Add a sticky note or pin a library document')} /></div>}
    <div className="canvas-hint">{pick(locale, 'ลากที่ว่างเพื่อเลื่อน · Ctrl/⌘ + scroll เพื่อซูม · ดับเบิลคลิกเพื่อเพิ่มโน้ต', 'Drag empty space to pan · Ctrl/⌘ + scroll to zoom · double-click to add')}</div>
    <CanvasControls zoom={canvas.view.zoom} onZoomIn={() => canvas.zoomBy(1.2)} onZoomOut={() => canvas.zoomBy(1 / 1.2)} onReset={canvas.reset} onFit={() => canvas.fit(rects())} fitLabel={pick(locale, 'แสดงทั้งหมด', 'Fit all')} />
  </div></>;
}

function StickyModal({ item, position, projectId, tasks, context, role, readOnly, onClose }: { item: StickyNote | null; position?: { x: number; y: number }; projectId: string; tasks: Task[]; context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void }) {
  const { user, t, locale } = context;
  const [form, setForm] = useState({ content: item?.content || '', color: item?.color || NOTE_COLORS[0], taskId: item?.taskId || '', pinned: item?.pinned || false });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // NaN position = "add" button: drop the note near the origin with a little scatter.
    const x = position && Number.isFinite(position.x) ? position.x : 24 + Math.random() * 180;
    const y = position && Number.isFinite(position.y) ? position.y : 24 + Math.random() * 100;
    const ok = await attempt(() => (item ? updateWorkItem(projectId, 'stickyNotes', item.id, form) : createWorkItem(projectId, 'stickyNotes', { kind: 'note', ...form, x, y }, user, { type: 'note_created', th: 'เพิ่ม Sticky Note', en: 'added a sticky note' })).then(() => true), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
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

const GROUP_ORDER: DocumentGroup[] = ['folder', 'markdown', 'drive', 'canva'];

function DocumentLibrary({ documents, labels, milestones, filtered, projectId, context, role, readOnly, userId, selection, selectMode, onEditDrive, onFilter, onMilestoneFilter, activeLabelNames }: { documents: ProjectDocument[]; labels: Label[]; tasks: Task[]; milestones: Milestone[]; filtered: boolean; projectId: string; context: AppContextValue; role: Role | null; readOnly: boolean; userId: string; selection: Selection; selectMode: boolean; onEditDrive: (item: DriveProjectDocument | CanvaProjectDocument) => void; onFilter: (label: Label) => void; onMilestoneFilter: (milestone: Milestone) => void; activeLabelNames: string[] }) {
  const { locale } = context;
  const storageKey = `ps.documents.sort.${projectId}`;
  const [sort, setSort] = useState<DocumentSort>(() => { try { return localStorage.getItem(storageKey) === 'name' ? 'name' : 'updated'; } catch { return 'updated'; } });
  const groups = useMemo(() => groupDocuments(documents), [documents]);
  const latest = latestDocumentGroup(groups);
  const [open, setOpen] = useState<Set<DocumentGroup>>(() => new Set());
  const initialized = useRef(false);
  const wasFiltered = useRef(false);
  useEffect(() => {
    if (filtered) { wasFiltered.current = true; setOpen(new Set(GROUP_ORDER.filter((group) => groups[group].length))); return; }
    if (wasFiltered.current) { wasFiltered.current = false; setOpen(new Set(latest ? [latest] : [])); return; }
    if (!initialized.current && latest) { initialized.current = true; setOpen(new Set([latest])); }
  }, [filtered, latest, documents.length]);
  useEffect(() => { if (!filtered && !documents.length) initialized.current = false; }, [filtered, documents.length]);
  const changeSort = (next: DocumentSort) => { setSort(next); try { localStorage.setItem(storageKey, next); } catch { /* preference is optional */ } };
  const tagsKey = `ps.documents.tags.${projectId}`;
  const [showTags, setShowTags] = useState(() => { try { return localStorage.getItem(tagsKey) !== 'off'; } catch { return true; } });
  const toggleTags = () => { const next = !showTags; setShowTags(next); try { localStorage.setItem(tagsKey, next ? 'on' : 'off'); } catch { /* preference is optional */ } };
  const labelsFor = (item: ProjectDocument) => labels.filter((label) => (item.labelIds || []).includes(label.id));
  const names: Record<DocumentGroup, string> = { folder: pick(locale, 'โฟลเดอร์ Google Drive', 'Google Drive folders'), markdown: 'Markdown', drive: pick(locale, 'ไฟล์ Drive', 'Drive files'), canva: 'Canva' };
  const displayedIds = GROUP_ORDER.filter((group) => open.has(group)).flatMap((group) => sortDocuments(groups[group], sort).map((item) => item.id));
  const selectDocument = (event: MouseEvent<HTMLElement>, item: ProjectDocument): boolean => {
    if (readOnly) return false;
    if (event.shiftKey) { event.preventDefault(); selection.range(item.id, displayedIds); return true; }
    if (selectMode || event.ctrlKey || event.metaKey) { event.preventDefault(); selection.toggle(item.id); return true; }
    return false;
  };
  const detach = (item: ProjectDocument) => {
    if (!confirm(pick(locale, 'นำเอกสารออกจากคลังหรือไม่? ไฟล์ต้นทางจะไม่ถูกลบ', 'Remove this document from the library? The source file will not be deleted.'))) return;
    void attempt(() => (isDriveProjectDocument(item) || isCanvaProjectDocument(item) ? detachDriveProjectDocument(projectId, item.id) : deleteProjectDocument(projectId, item.id)), pick(locale, 'นำเอกสารออกไม่สำเร็จ', 'Could not remove document'));
  };
  return <section className="document-library">
    <div className="document-sort"><button type="button" className={`secondary small ${showTags ? 'active' : ''}`} aria-pressed={showTags} onClick={toggleTags}><Icon name="label" />{showTags ? pick(locale, 'ซ่อน Tags', 'Hide tags') : pick(locale, 'แสดง Tags', 'Show tags')}</button><span>{pick(locale, 'เรียง', 'Sort')}</span><select value={sort} onChange={(event) => changeSort(event.target.value as DocumentSort)}><option value="updated">{pick(locale, 'อัปเดตล่าสุด', 'Recently updated')}</option><option value="name">{pick(locale, 'ชื่อ', 'Name')}</option></select></div>
    {GROUP_ORDER.filter((group) => groups[group].length).map((group) => <section className="document-group" key={group}>
      <button type="button" className="document-group-heading" aria-expanded={open.has(group)} onClick={() => setOpen((current) => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; })}><span><Icon name={group === 'folder' ? 'folder' : group === 'drive' ? 'cloud' : group === 'canva' ? 'canva' : 'document'} />{names[group]} <b>{groups[group].length}</b></span><Icon name={open.has(group) ? 'chevronDown' : 'chevronRight'} /></button>
      {open.has(group) && <div className="compact-document-list">{sortDocuments(groups[group], sort).map((item) => {
        const name = documentDisplayName(item);
        const selectedLabels = labelsFor(item);
        const selectedMilestones = milestones.filter((milestone) => (item.milestoneIds || []).includes(milestone.id));
        const markdown = !isDriveProjectDocument(item) && !isCanvaProjectDocument(item);
        const type = group === 'folder' ? 'Folder' : isDriveProjectDocument(item) ? item.mimeType.split('/').pop()?.replace('vnd.google-apps.', '') || 'Drive' : group === 'canva' ? 'Canva' : 'Markdown';
        const openItem = () => { if (isDriveProjectDocument(item) || isCanvaProjectDocument(item)) onEditDrive(item); };
        return <div className={`compact-document-row ${selection.has(item.id) ? 'selected' : ''} ${selectMode || selection.selected.size ? 'select-mode' : ''}`} key={item.id}>
          {!readOnly && <input type="checkbox" className="document-select-check" checked={selection.has(item.id)} onChange={() => selection.toggle(item.id)} aria-label={pick(locale, `เลือก ${name}`, `Select ${name}`)} />}
          {markdown ? <Link className="compact-document-main" to={`/p/${projectId}/docs/${item.id}`} onClick={(event) => { if (selectDocument(event, item)) event.preventDefault(); }}><Icon name="document" /><span><strong>{name}</strong><small>{type} · {relativeTime(item.updatedAt?.toDate(), locale)}</small></span></Link> : <button type="button" className="compact-document-main" onClick={(event) => { if (!selectDocument(event, item)) openItem(); }}><Icon name={group === 'folder' ? 'folder' : group === 'canva' ? 'canva' : 'cloud'} /><span><strong>{name}</strong><small>{type} · {relativeTime(item.updatedAt?.toDate(), locale)}</small></span></button>}
          {showTags && selectedLabels.length > 0 && <span className="compact-document-labels">{selectedLabels.map((label) => <LabelChip key={label.id} label={label} active={activeLabelNames.includes(label.name.toLowerCase())} onClick={() => onFilter(label)} />)}</span>}
          {showTags && selectedMilestones.length > 0 && <span className="document-task-chips">{selectedMilestones.map((milestone) => <button type="button" key={milestone.id} onClick={() => onMilestoneFilter(milestone)}><Icon name="milestone" /> {milestone.title}</button>)}</span>}
          <span className="compact-document-counts"><small>{(item.taskIds || []).length} Tasks</small><small>{(item.milestoneIds || []).length} Milestones</small></span>
          <a className="compact-document-open" href={documentOpenUrl(projectId, item)} target="_blank" rel="noreferrer" title={pick(locale, 'เปิดในแท็บใหม่', 'Open in new tab')} aria-label={pick(locale, 'เปิดในแท็บใหม่', 'Open in new tab')}><Icon name="open" /></a>
          {!readOnly && canDeleteItem(role, item.createdBy, userId) && <button type="button" className="compact-document-remove" onClick={() => detach(item)} title={pick(locale, 'นำออกจากคลัง', 'Remove from library')}><Icon name="close" /></button>}
        </div>;
      })}</div>}
    </section>)}
    {!documents.length && <Empty icon="document" title={filtered ? pick(locale, 'ไม่พบเอกสาร', 'No matching documents') : pick(locale, 'ยังไม่มีเอกสาร', 'No documents yet')} description={filtered ? pick(locale, 'ลองเปลี่ยนคำค้นหา', 'Try another search') : pick(locale, 'เพิ่มเอกสารเพื่อเริ่มสร้างคลังของทีม', 'Add a document to start the team library')} />}
  </section>;
}

function AddDocumentModal({ project, members, documents, labels, context, onClose, onMarkdown }: { project: { id: string; name: string }; members: Membership[]; documents: ProjectDocument[]; labels: Label[]; tasks: Task[]; context: AppContextValue; onClose: () => void; onMarkdown: () => void }) {
  const [source, setSource] = useState<'choose' | 'drive' | 'canva'>('choose');
  const { locale, user } = context;
  return <Modal title={pick(locale, 'เพิ่มเอกสาร', 'Add document')} onClose={onClose} wide>
    {source === 'choose' && <div className="add-document-choices">
      <button type="button" onClick={onMarkdown}><Icon name="document" /><span><strong>Markdown</strong><small>{pick(locale, 'เขียนเอกสารในแอป', 'Write in the app')}</small></span></button>
      {isGoogleDriveEnabled && <button type="button" onClick={() => setSource('drive')}><Icon name="cloud" /><span><strong>Google Drive</strong><small>{pick(locale, 'อัปโหลด เลือกไฟล์หรือโฟลเดอร์ สร้างไฟล์ หรือวางลิงก์', 'Upload, choose a file or folder, create, or paste a link')}</small></span></button>}
      <button type="button" onClick={() => setSource('canva')}><Icon name="canva" /><span><strong>Canva</strong><small>{pick(locale, 'แนบด้วยลิงก์แก้ไข', 'Attach an edit link')}</small></span></button>
    </div>}
    {source !== 'choose' && <button type="button" className="secondary small add-document-back" onClick={() => setSource('choose')}><Icon name="arrowLeft" />{pick(locale, 'เลือกประเภทอื่น', 'Choose another type')}</button>}
    {source === 'drive' && <DriveAttachmentControl project={project} members={members} user={user} locale={locale} existingFileIds={new Set(documents.filter(isDriveProjectDocument).map((item) => item.driveFileId))} onAttach={(file, mode, sharing) => attachDriveProjectDocument(project.id, file, mode, sharing, user)} />}
    {source === 'canva' && <CanvaLinkForm user={user} locale={locale} autoFocus onCancel={onClose} onAttach={(link, title, labelIds) => attachCanvaProjectDocument(project.id, link, title, user, [], labelIds)} renderLabels={(value, onChange) => <div className="document-editor-labels"><span>Labels</span><LabelPicker labels={labels} value={value} onChange={onChange} projectId={project.id} context={context} readOnly={false} /></div>} />}
  </Modal>;
}

function CanvasDocumentPicker({ projectId, pinnedIds, canvasItems, context, labels, tasks, milestones, onClose }: { projectId: string; pinnedIds: Set<string>; canvasItems: CanvasItem[]; context: AppContextValue; labels: Label[]; tasks: Task[]; milestones: Milestone[]; onClose: () => void }) {
  const [items, setItems] = useState<ProjectDocument[]>([]);
  const [cursor, setCursor] = useState<CollectionCursor | null>(null);
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [queryText, setQueryText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeProjectQuery<ProjectDocument>(projectId, 'documents', 'canvas-picker:50', [orderBy('updatedAt', 'desc'), orderBy(documentId()), limit(50)], (next) => { setItems(next); const last = next.at(-1); setCursor(last?.updatedAt ? { value: last.updatedAt, id: last.id } : null); setMore(next.length === 50); }), [projectId]);
  const available = useMemo(() => items.filter((item) => !pinnedIds.has(item.id) && matchDocument(item, parseDocumentQuery(queryText), labels, tasks, milestones)), [items, pinnedIds, queryText, labels, tasks, milestones]);
  const loadMore = async () => { if (!cursor || busy) return; setBusy(true); try { const page = await loadProjectCollectionPage<ProjectDocument>(projectId, 'documents', cursor, 50); setItems((current) => [...current, ...page.items.filter((item) => !current.some((old) => old.id === item.id))]); setCursor(page.nextCursor); setMore(page.hasMore); } finally { setBusy(false); } };
  const pin = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    let centre = { x: 300, y: 200 };
    try { const view = JSON.parse(localStorage.getItem(`ps.notes.view.${projectId}`) || 'null'); if (view && Number.isFinite(view.x) && Number.isFinite(view.y) && Number.isFinite(view.zoom)) centre = { x: (400 - view.x) / view.zoom, y: (300 - view.y) / view.zoom }; } catch { /* use board origin */ }
    const occupied = canvasItems.map((item) => ({ x: item.x, y: item.y, w: NOTE_W, h: NOTE_H }));
    const positions = findCanvasPositions(selected.length, centre, occupied, { w: NOTE_W, h: NOTE_H });
    const ok = await attempt(() => pinProjectDocuments(projectId, selected, positions, context.user).then(() => true), pick(context.locale, 'ปักเอกสารไม่สำเร็จ', 'Could not pin documents'));
    setBusy(false); if (ok) onClose();
  };
  return <Modal title={pick(context.locale, 'ปักเอกสารบน Notes', 'Pin documents to Notes')} onClose={onClose} wide actions={<button type="button" className="primary" disabled={!selected.length || busy} onClick={() => void pin()}>{pick(context.locale, `ปัก ${selected.length || ''}`.trim(), `Pin ${selected.length || ''}`.trim())}</button>}>
    <div className="document-picker"><label className="search"><Icon name="search" /><input autoFocus value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder={pick(context.locale, 'ค้นหาชื่อ คำอธิบาย Labels หรือ Tasks', 'Search name, description, labels, or tasks')} /></label>
      <div className="document-picker-list">{available.map((item) => <label key={item.id} className={selected.includes(item.id) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span className="document-picker-icon"><Icon name={documentGroup(item) === 'folder' ? 'folder' : item.kind === 'drive' ? 'cloud' : item.kind === 'canva' ? 'canva' : 'document'} /></span><span><strong>{documentDisplayName(item)}</strong><small>{item.kind === 'drive' || item.kind === 'canva' ? item.description || item.title : item.excerpt || 'Markdown'}</small></span></label>)}</div>
      {!available.length && <p className="muted document-picker-empty">{pick(context.locale, 'ไม่มีเอกสารที่ปักได้', 'No documents available to pin')}</p>}
      {more && <div className="load-more-row"><button type="button" className="secondary" disabled={busy} onClick={() => void loadMore()}>{pick(context.locale, 'โหลดเพิ่มเติม', 'Load more')}</button></div>}
      <div className="form-actions"><span /><button type="button" className="secondary" onClick={onClose}>{pick(context.locale, 'ยกเลิก', 'Cancel')}</button><button type="button" className="primary" disabled={!selected.length || busy} onClick={() => void pin()}>{pick(context.locale, 'ปักเอกสาร', 'Pin documents')}</button></div>
    </div>
  </Modal>;
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

function DriveDocumentDetailsModal({ item, labels, tasks, milestones, projectId, context, readOnly, onClose }: { item: DriveProjectDocument | CanvaProjectDocument; labels: Label[]; tasks: Task[]; milestones: Milestone[]; projectId: string; context: AppContextValue; readOnly: boolean; onClose: () => void }) {
  const { locale } = context;
  const [nickname, setNickname] = useState(item.nickname || '');
  const [description, setDescription] = useState(item.description || '');
  const [labelIds, setLabelIds] = useState(item.labelIds || []);
  const [taskIds, setTaskIds] = useState(item.taskIds || []);
  const [milestoneIds, setMilestoneIds] = useState(item.milestoneIds || []);
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
    const details = { nickname, description, labelIds, taskIds, milestoneIds };
    const ok = await attempt(() => (drive ? updateDriveProjectDocumentDetails(projectId, item.id, details) : updateCanvaProjectDocumentDetails(projectId, item.id, details)).then(() => true), pick(locale, 'บันทึกรายละเอียดไม่สำเร็จ', 'Could not save document details'));
    setBusy(false);
    if (ok) onClose();
  };
  const saveLabel = pick(locale, 'บันทึกรายละเอียด', 'Save details');
  const sourceUrl = documentOpenUrl(projectId, item);
  return <Modal title={pick(locale, 'แก้ไขข้อมูลเอกสาร', 'Edit document details')} onClose={onClose} wide actions={!readOnly && <button form={formId} className="primary" disabled={busy}>{saveLabel}</button>}><form id={formId} className="stack-form drive-document-details" onSubmit={submit}>
    <a className="secondary drive-details-source" href={sourceUrl} target="_blank" rel="noreferrer"><Icon name="open" />{drive ? (isDriveFolder(drive) ? pick(locale, 'เปิดโฟลเดอร์ใน Google Drive', 'Open folder in Google Drive') : pick(locale, 'เปิดไฟล์ใน Google Drive', 'Open file in Google Drive')) : pick(locale, 'เปิดใน Canva', 'Open in Canva')}</a>
    <section className="drive-details-section"><header><span>1</span><div><h3>{pick(locale, 'ชื่อและคำอธิบาย', 'Name and description')}</h3><p>{pick(locale, 'ช่วยให้ทีมเข้าใจเอกสารโดยไม่ต้องเปิดไฟล์', 'Help the team understand the document before opening it')}</p></div></header>
      <label><span className="field-name">{pick(locale, 'ชื่อที่ใช้แสดง', 'Display name')} <i>{pick(locale, 'ไม่บังคับ', 'Optional')}</i></span><input autoFocus value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={200} placeholder={drive ? drive.name : item.title} disabled={readOnly} /><small className="field-help"><span>{drive ? pick(locale, 'เว้นว่างเพื่อใช้ชื่อไฟล์จริง', 'Leave blank to use the original filename') : pick(locale, 'เว้นว่างเพื่อใช้ชื่อที่ตั้งตอนแนบ', 'Leave blank to use the title set when attached')}</span><b>{nickname.length}/200</b></small></label>
      <label><span className="field-name">{pick(locale, 'คำอธิบายเอกสาร', 'Document description')} <i>{pick(locale, 'ไม่บังคับ', 'Optional')}</i></span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder={pick(locale, 'เช่น ใช้สำหรับรีวิว requirement รอบสุดท้าย…', 'For example: Final requirements review copy…')} disabled={readOnly} /><small className="field-help"><span>{pick(locale, 'แสดงใต้ชื่อเอกสารและค้นหาได้', 'Shown below the document name and included in search')}</span><b>{description.length}/1000</b></small></label>
    </section>
    <section className="drive-details-section"><header><span>2</span><div><h3>{pick(locale, 'จัดหมวดหมู่และเชื่อมงาน', 'Organize and link work')}</h3><p>{pick(locale, 'เพิ่ม Labels และเลือก Tasks ที่ใช้เอกสารนี้', 'Add labels and select tasks that use this document')}</p></div></header>
      <div className="document-editor-labels"><span>Labels</span><LabelPicker labels={labels} value={labelIds} onChange={setLabelIds} projectId={projectId} context={context} readOnly={readOnly} /></div>
      <fieldset disabled={readOnly}><legend>{pick(locale, `Tasks ที่เชื่อม (${taskIds.length})`, `Linked tasks (${taskIds.length})`)}</legend><div className="document-task-picker">{tasks.map((task) => <label key={task.id} className={taskIds.includes(task.id) ? 'selected' : ''}><input type="checkbox" checked={taskIds.includes(task.id)} onChange={(event) => setTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} /><span>{task.title}</span><small>{task.status.replace('_', ' ')}</small></label>)}</div>{!tasks.length && <p className="muted drive-details-no-tasks">{pick(locale, 'ยังไม่มี Task ในโปรเจกต์นี้', 'No tasks in this project yet')}</p>}</fieldset>
      <fieldset disabled={readOnly}><legend>{pick(locale, `Milestones ที่เชื่อม (${milestoneIds.length})`, `Linked milestones (${milestoneIds.length})`)}</legend><div className="document-task-picker">{milestones.map((milestone) => <label key={milestone.id} className={milestoneIds.includes(milestone.id) ? 'selected' : ''}><input type="checkbox" checked={milestoneIds.includes(milestone.id)} onChange={(event) => setMilestoneIds((current) => event.target.checked ? [...current, milestone.id] : current.filter((id) => id !== milestone.id))} /><span>{milestone.title}</span><small>{milestone.status}</small></label>)}</div>{!milestones.length && <p className="muted drive-details-no-tasks">{pick(locale, 'ยังไม่มี Milestone ในโปรเจกต์นี้', 'No milestones in this project yet')}</p>}</fieldset>
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
  const activeTasks = useActiveTasks(projectId);
  const tasks = useLinkedTasks(projectId, activeTasks, item?.taskIds || []);
  const milestones = useProjectItems<Milestone>(projectId, 'milestones');

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
    {editing && <DocumentModal item={item} labels={labels} tasks={tasks} milestones={milestones} projectId={projectId} context={context} role={role} readOnly={readOnly} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} onDeleted={() => navigate(`/p/${projectId}/docs`)} />}
  </>;
}

function DocumentModal({ item, labels, tasks, milestones, projectId, context, role, readOnly, onClose, onSaved, onDeleted }: { item: LoadedProjectDocument | null; labels: Label[]; tasks: Task[]; milestones: Milestone[]; projectId: string; context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void; onSaved: (id: string) => void; onDeleted?: () => void }) {
  const { user, t, locale } = context;
  const [title, setTitle] = useState(item?.title || 'Untitled'); const [content, setContent] = useState(item?.content || '# New document\n'); const [labelIds, setLabelIds] = useState(item?.labelIds || []); const [taskIds, setTaskIds] = useState(item?.taskIds || []); const [milestoneIds, setMilestoneIds] = useState(item?.milestoneIds || []); const [preview, setPreview] = useState(readOnly);
  const contentBytes = useMemo(() => documentContentBytes(content), [content]);
  const tooLarge = contentBytes > DOCUMENT_BODY_MAX_BYTES;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tooLarge) return;
    let savedId = item?.id || '';
    const ok = await attempt(async () => {
      if (item) await updateProjectDocument(projectId, item.id, title, content, labelIds, taskIds, milestoneIds);
      else savedId = await createProjectDocument(projectId, title, content, labelIds, user, taskIds, milestoneIds);
      return true;
    }, pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    if (ok) onSaved(savedId);
  };
  const formId = useId();
  const sizeLabel = `${(contentBytes / 1024).toFixed(contentBytes < 10240 ? 1 : 0)} / ${DOCUMENT_BODY_MAX_BYTES / 1024} KB`;
  return <Modal title={item ? (readOnly ? item.title : t('edit')) : t('documents')} onClose={onClose} wide actions={!readOnly && <button form={formId} className="primary" disabled={tooLarge}>{t('save')}</button>}><form id={formId} className="document-editor" onSubmit={submit}><div className="document-title-row"><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={DOCUMENT_TITLE_MAX_LENGTH} disabled={readOnly} /><div>{!readOnly && <button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>Edit</button>}<button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Preview</button></div></div><div className="document-editor-labels"><span>{pick(locale, 'Labels', 'Labels')}</span><LabelPicker labels={labels} value={labelIds} onChange={setLabelIds} projectId={projectId} context={context} readOnly={readOnly} /></div><fieldset className="document-task-field" disabled={readOnly}><legend>{pick(locale, 'เชื่อมกับ Tasks', 'Linked tasks')}</legend><div className="document-task-picker">{tasks.map((task) => <label key={task.id}><input type="checkbox" checked={taskIds.includes(task.id)} onChange={(event) => setTaskIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} /><span>{task.title}</span></label>)}</div></fieldset><fieldset className="document-task-field" disabled={readOnly}><legend>{pick(locale, 'เชื่อมกับ Milestones', 'Linked milestones')}</legend><div className="document-task-picker">{milestones.map((milestone) => <label key={milestone.id}><input type="checkbox" checked={milestoneIds.includes(milestone.id)} onChange={(event) => setMilestoneIds((current) => event.target.checked ? [...current, milestone.id] : current.filter((id) => id !== milestone.id))} /><span>{milestone.title}</span></label>)}</div></fieldset>{preview ? <MarkdownRenderer content={content} locale={locale} /> : <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck disabled={readOnly} />}<div className={`document-size ${tooLarge ? 'over' : ''}`}><span>{tooLarge ? pick(locale, 'เอกสารใหญ่เกินขีดจำกัด 900 KB', 'Document exceeds the 900 KB limit') : pick(locale, 'ขนาด UTF-8', 'UTF-8 size')}</span><b>{sizeLabel}</b></div><div className="form-actions">{!readOnly && item && canDeleteItem(role, item.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={async () => { if (confirm(`${t('delete')}?`)) { const ok = await attempt(() => deleteProjectDocument(projectId, item.id).then(() => true), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); if (ok) { onClose(); onDeleted?.(); } } }}>{t('delete')}</button>}<span /><button type="button" className="secondary" onClick={onClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : t('cancel')}</button>{!readOnly && <button className="primary" disabled={tooLarge}>{t('save')}</button>}</div></form></Modal>;
}
