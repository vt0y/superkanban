import { useId, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { where } from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import type { AppContextValue, SectionProps } from '@/context/AppContext';
import { Avatar, BulkBar, Empty, Modal, PageTitle, Segmented } from '@/components/common';
import { canDeleteItem } from '@/utils/permissions';
import { bulkDeleteWorkItems, bulkUpdateWorkItems, createWorkItem, deleteDiagramElements, deleteWorkItem, updateWorkItem } from '@/services';
import type { Diagram, DiagramEdge, DiagramNode, ProjectUseCase, Role } from '@/types';
import { attempt, toast } from '@/components/toast';
import { pick } from '@/utils/formatters';
import { useProjectItems, useProjectItemsState, useProjectQuery, useSelection } from '@/hooks';
import { classifyUseCase, nextUseCaseCode, type UseCaseKind } from '@/utils/usecase-model';
import { CommentThread } from '@/components/comments/CommentThread';
import { DiagramEditor } from './diagram';

export function SoftwareDesign({ context, project, members, role, readOnly }: SectionProps) {
  const { items: diagrams, loaded } = useProjectItemsState<Diagram>(project.id, 'diagrams');
  const useCases = useProjectItems<ProjectUseCase>(project.id, 'useCases');
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'list' ? 'list' : 'diagram';
  const { locale, user } = context;
  const sortedDiagrams = [...diagrams].sort((a, b) => (a.createdAt?.toMillis() ?? Date.now()) - (b.createdAt?.toMillis() ?? Date.now()));
  const current = sortedDiagrams.find((item) => item.id === params.get('d')) || sortedDiagrams[0];
  const elementScope = view === 'list' ? 'all' : `diagram:${current?.id || 'none'}`;
  const elementConstraints = useMemo(() => view === 'list' ? [] : [where('diagramId', '==', current?.id || '__none__')], [view, current?.id]);
  const nodes = useProjectQuery<DiagramNode>(project.id, 'diagramNodes', elementScope, elementConstraints);
  const edges = useProjectQuery<DiagramEdge>(project.id, 'diagramEdges', elementScope, elementConstraints);
  const update = (next: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...next });

  // Base/common/extension role of each use case across every diagram it appears on.
  const kinds = useMemo(() => {
    const map = new Map<string, UseCaseKind>();
    nodes.filter((node) => node.kind === 'usecase' && node.useCaseId).forEach((node) => {
      const kind = classifyUseCase(node.id, edges);
      if (kind !== 'base' || !map.has(node.useCaseId)) map.set(node.useCaseId, kind);
    });
    return map;
  }, [nodes, edges]);

  const createDiagram = async () => {
    const title = prompt(pick(locale, 'ชื่อไดอะแกรม', 'Diagram name'), diagrams.length ? `Diagram ${diagrams.length + 1}` : 'Main use case diagram');
    if (!title?.trim()) return;
    const id = await attempt(() => createWorkItem(project.id, 'diagrams', { title: title.trim() }, user, { type: 'diagram_created', th: `สร้างไดอะแกรม “${title}”`, en: `created diagram “${title}”` }), pick(locale, 'สร้างไม่สำเร็จ', 'Could not create diagram'));
    if (id) update({ view: 'diagram', d: id });
  };
  const renameDiagram = () => {
    if (!current) return;
    const title = prompt(pick(locale, 'เปลี่ยนชื่อไดอะแกรม', 'Rename diagram'), current.title);
    if (title?.trim()) void attempt(() => updateWorkItem(project.id, 'diagrams', current.id, { title: title.trim() }), pick(locale, 'เปลี่ยนชื่อไม่สำเร็จ', 'Rename failed'));
  };
  const deleteDiagram = async () => {
    if (!current || !confirm(pick(locale, `ลบไดอะแกรม “${current.title}”? (Use Case ในรายการจะยังอยู่)`, `Delete diagram “${current.title}”? (use cases stay in the list)`))) return;
    await attempt(async () => {
      await deleteDiagramElements(project.id, nodes.filter((n) => n.diagramId === current.id).map((n) => n.id), edges.filter((e) => e.diagramId === current.id).map((e) => e.id));
      await deleteWorkItem(project.id, 'diagrams', current.id);
    }, pick(locale, 'ลบไม่สำเร็จ', 'Delete failed'));
    update({ d: '' });
  };

  return <>
    <PageTitle eyebrow="SOFTWARE DESIGN" title={context.t('design')} description={pick(locale, 'ออกแบบ Use Case Diagram (Actor, Base/Common Use Case, include/extend) และมอบหมายผู้รับผิดชอบแต่ละ Use Case', 'Model use case diagrams (actors, base/common use cases, include/extend) and assign an owner to each use case')}
      action={<Segmented value={view} onChange={(next) => update({ view: next })} options={[{ id: 'diagram', label: <>◈ {pick(locale, 'ไดอะแกรม', 'Diagram')}</> }, { id: 'list', label: <>☰ {pick(locale, 'รายการ Use Case', 'Use case list')} <b>{useCases.length}</b></> }]} />} />
    {view === 'diagram' ? <>
      <div className="diagram-tabs">
        {sortedDiagrams.map((item) => <button key={item.id} className={current?.id === item.id ? 'active' : ''} onClick={() => update({ d: item.id })} onDoubleClick={readOnly ? undefined : renameDiagram}>◈ {item.title}</button>)}
        {!readOnly && <button className="add-tab" onClick={() => void createDiagram()}>＋ {pick(locale, 'ไดอะแกรมใหม่', 'New diagram')}</button>}
        {current && !readOnly && <span className="tab-actions"><button onClick={renameDiagram} title={pick(locale, 'เปลี่ยนชื่อ', 'Rename')}>✎</button>{canDeleteItem(role, current.createdBy, user.uid) && <button onClick={() => void deleteDiagram()} title={pick(locale, 'ลบไดอะแกรม', 'Delete diagram')}>🗑</button>}</span>}
      </div>
      {current ? <DiagramEditor key={current.id} diagram={current} nodes={nodes} edges={edges} useCases={useCases} members={members} context={context} role={role} projectId={project.id} readOnly={readOnly} />
        : loaded && <Empty icon="◈" title={pick(locale, 'ยังไม่มีไดอะแกรม', 'No diagrams yet')} description={pick(locale, 'สร้าง Use Case Diagram แรก: วาง Actor, Use Case และเชื่อมความสัมพันธ์แบบ draw.io', 'Create your first use case diagram — place actors and use cases and connect them, draw.io style')} action={!readOnly ? <button className="primary" onClick={() => void createDiagram()}>＋ {pick(locale, 'สร้างไดอะแกรม', 'Create diagram')}</button> : undefined} />}
    </> : <UseCaseList useCases={useCases} kinds={kinds} context={context} project={project} members={members} role={role} readOnly={readOnly} />}
  </>;
}

function UseCaseList({ useCases, kinds, context, project, members, role, readOnly }: SectionProps & { useCases: ProjectUseCase[]; kinds: Map<string, UseCaseKind> }) {
  const { locale, user } = context;
  const [editing, setEditing] = useState<ProjectUseCase | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectMode, setSelectMode] = useState(false);
  const filtered = useCases.filter((item) => (filter === 'all' || item.status === filter || (filter === 'mine' && item.assigneeId === user.uid)) && `${item.code} ${item.title} ${item.actor}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const selection = useSelection(filtered.map((item) => item.id));
  const selectedIds = [...selection.selected];
  const assign = (item: ProjectUseCase, assigneeId: string) => void attempt(() => updateWorkItem(project.id, 'useCases', item.id, { assigneeId, status: assigneeId ? (item.status === 'completed' ? 'completed' : 'assigned') : 'open' }, user, { type: 'usecase_assigned', th: `เปลี่ยนผู้รับผิดชอบ ${item.code}`, en: `changed assignee for ${item.code}` }), pick(locale, 'มอบหมายไม่สำเร็จ', 'Assign failed'));
  const bulk = (values: Partial<ProjectUseCase>, th: string, en: string) => void attempt(() => bulkUpdateWorkItems(project.id, 'useCases', selectedIds, values, user, { type: 'usecase_bulk', th, en }), pick(locale, 'อัปเดตไม่สำเร็จ', 'Bulk update failed')).then((done) => done !== undefined && toast(pick(locale, `อัปเดต ${selectedIds.length} รายการแล้ว`, `Updated ${selectedIds.length} use cases`), 'success'));
  const bulkDelete = async () => {
    const deletable = useCases.filter((item) => selection.has(item.id) && canDeleteItem(role, item.createdBy, user.uid)).map((item) => item.id);
    const skipped = selectedIds.length - deletable.length;
    if (!deletable.length) { toast(pick(locale, 'ไม่มีสิทธิ์ลบรายการที่เลือก', 'You cannot delete the selected use cases'), 'error'); return; }
    if (!confirm(pick(locale, `ลบ ${deletable.length} Use Case?`, `Delete ${deletable.length} use cases?`) + (skipped ? pick(locale, ` (ข้าม ${skipped} รายการที่ไม่มีสิทธิ์)`, ` (${skipped} skipped — no permission)`) : ''))) return;
    if (await attempt(() => bulkDeleteWorkItems(project.id, 'useCases', deletable).then(() => true), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed'))) selection.clear();
  };
  const onCardClick = (event: MouseEvent, item: ProjectUseCase) => {
    if (readOnly) { setEditing(item); return; }
    if ((event.target as HTMLElement).closest('select, button, input')) return;
    if (event.shiftKey) { selection.range(item.id, filtered.map((uc) => uc.id)); return; }
    if (selectMode || event.ctrlKey || event.metaKey) selection.toggle(item.id);
  };

  return <>
    <div className="list-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={pick(locale, 'ค้นหารหัส ชื่อ หรือ actor...', 'Search code, title or actor...')} /></label>
      <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">{pick(locale, 'ทุกสถานะ', 'All status')}</option><option value="mine">{pick(locale, 'ของฉัน', 'Assigned to me')}</option><option value="open">Open</option><option value="assigned">Assigned</option><option value="completed">Completed</option></select>
      {!readOnly && <button className={`secondary ${selectMode ? 'on' : ''}`} onClick={() => { setSelectMode(!selectMode); if (selectMode) selection.clear(); }}>☑ {pick(locale, 'เลือกหลายรายการ', 'Select')}</button>}
      {!readOnly && <button className="primary" onClick={() => setEditing('new')}>＋ {context.t('addUseCase')}</button>}</div>
    <div className="usecase-grid">{filtered.map((item) => {
      const member = members.find((m) => m.userId === item.assigneeId);
      const kind = kinds.get(item.id);
      return <article key={item.id} className={`usecase-item ${item.status} ${selection.has(item.id) ? 'selected' : ''} ${selectMode || selection.selected.size ? 'select-mode' : ''}`} onClick={(event) => onCardClick(event, item)}>
        <header><span>{!readOnly && <input type="checkbox" className="card-check" checked={selection.has(item.id)} onChange={() => selection.toggle(item.id)} aria-label="Select" />}{item.code}{kind && <em className={`kind-badge ${kind}`}>{kind}</em>}</span><button onClick={() => setEditing(item)} title={readOnly ? context.t('readOnly') : context.t('edit')}>•••</button></header>
        <h3>{item.title}</h3><p className="uc-actor">♙ {item.actor || '—'}</p><p>{item.details || pick(locale, 'ยังไม่มีรายละเอียด', 'No description')}</p>
        <div className="rule-tags">{item.businessRules.map((rule) => <span key={rule}>{rule}</span>)}</div>
        <footer>{readOnly ? <span className="muted">{member?.displayName || pick(locale, 'ยังไม่มอบหมาย', 'Unassigned')}</span> : <select value={item.assigneeId} onChange={(e) => assign(item, e.target.value)}><option value="">{pick(locale, 'ยังไม่มอบหมาย', 'Unassigned')}</option>{members.map((m) => <option key={m.id} value={m.userId}>{m.displayName}</option>)}</select>}{member && <Avatar name={member.displayName} src={member.photoURL} size="sm" />}</footer>
      </article>;
    })}</div>
    {!filtered.length && <Empty icon="⌘" title={context.t('noData')} description={pick(locale, 'เพิ่ม Use Case ที่นี่ หรือวางบนไดอะแกรม', 'Add a use case here or place one on a diagram')} />}
    {!readOnly && <BulkBar count={selection.selected.size} locale={locale} onClear={selection.clear}>
      <select value="" onChange={(e) => { const value = e.target.value; if (value) bulk({ assigneeId: value === '-' ? '' : value, status: value === '-' ? 'open' : 'assigned' }, `มอบหมาย ${selectedIds.length} Use Case`, `assigned ${selectedIds.length} use cases`); }} aria-label="Assignee"><option value="">{pick(locale, 'มอบหมายให้…', 'Assign to…')}</option><option value="-">— {pick(locale, 'ยกเลิกการมอบหมาย', 'Unassign')}</option>{members.map((m) => <option key={m.id} value={m.userId}>{m.displayName}</option>)}</select>
      <select value="" onChange={(e) => e.target.value && bulk({ status: e.target.value as ProjectUseCase['status'] }, `เปลี่ยนสถานะ ${selectedIds.length} Use Case`, `changed status of ${selectedIds.length} use cases`)} aria-label="Status"><option value="">{pick(locale, 'สถานะ…', 'Status…')}</option><option value="open">Open</option><option value="assigned">Assigned</option><option value="completed">Completed</option></select>
      <button type="button" className="danger ghost" onClick={() => void bulkDelete()}>{context.t('delete')}</button>
    </BulkBar>}
    {editing && <UseCaseModal item={editing === 'new' ? null : editing} allCodes={useCases.map((u) => u.code)} projectId={project.id} context={context} role={role} readOnly={readOnly} onClose={() => setEditing(null)} />}
  </>;
}

function UseCaseModal({ item, allCodes, projectId, context, role, readOnly, onClose }: { item: ProjectUseCase | null; allCodes: string[]; projectId: string; context: AppContextValue; role: Role | null; readOnly: boolean; onClose: () => void }) {
  const { user, t, locale } = context;
  const [form, setForm] = useState({ code: item?.code || nextUseCaseCode(allCodes), title: item?.title || '', actor: item?.actor || '', details: item?.details || '', rules: item?.businessRules.join(', ') || '', status: item?.status || 'open' });
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const formId = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const values = { code: form.code, title: form.title, actor: form.actor, details: form.details, businessRules: form.rules.split(',').map((x) => x.trim()).filter(Boolean), status: form.status, assigneeId: item?.assigneeId || '' };
    const ok = await attempt(() => (item ? updateWorkItem(projectId, 'useCases', item.id, values) : createWorkItem(projectId, 'useCases', values, user, { type: 'usecase_created', th: `เพิ่ม Use Case ${form.code}`, en: `created use case ${form.code}` })).then(() => true), pick(locale, 'บันทึกไม่สำเร็จ', 'Save failed'));
    if (ok) onClose();
  };
  const actions = <>
    {item && <button type="button" className="comment-toggle" onClick={() => setCommentsOpen(true)} aria-label={pick(locale, 'ความคิดเห็น', 'Comments')}>💬 {commentCount}</button>}
    {!readOnly && <button form={formId} className="primary">{t('save')}</button>}
  </>;
  return <Modal title={item ? `${item.code} · ${item.title}` : t('addUseCase')} onClose={commentsOpen ? () => setCommentsOpen(false) : onClose} wide={!!item} actions={actions}>
    <div className={item ? `modal-split ${commentsOpen ? 'comments-open' : ''}` : ''}>
      <form id={formId} className="stack-form edit-form" onSubmit={submit}><fieldset className="read-only-fields" disabled={readOnly}><div className="field-row chip-row"><label><span className="field-name">Code</span><input className="code-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="UC-01" /></label><label><span className="field-name">Status</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectUseCase['status'] })}><option value="open">Open</option><option value="assigned">Assigned</option><option value="completed">Completed</option></select></label></div><label><span className="field-name">{pick(locale, 'ชื่อ Use Case', 'Use case name')}</span><input className="title-input" placeholder={pick(locale, 'ชื่อ Use Case', 'Use case name')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label><label>Actor<input value={form.actor} onChange={(e) => setForm({ ...form, actor: e.target.value })} /></label><label>{pick(locale, 'รายละเอียด', 'Details')}<textarea rows={4} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></label><label>Business Rules<input value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} placeholder="BR-01, BR-02" /></label></fieldset><div className="form-actions">{!readOnly && item && canDeleteItem(role, item.createdBy, user.uid) && <button type="button" className="danger ghost" onClick={async () => { if (confirm(`${t('delete')}?`)) { await attempt(() => deleteWorkItem(projectId, 'useCases', item.id), pick(locale, 'ลบไม่สำเร็จ', 'Delete failed')); onClose(); } }}>{t('delete')}</button>}<span /><button type="button" className="secondary" onClick={onClose}>{readOnly ? pick(locale, 'ปิด', 'Close') : t('cancel')}</button>{!readOnly && <button className="primary">{t('save')}</button>}</div></form>
      {item && <div className="comments-scrim" onClick={() => setCommentsOpen(false)} />}
      {item && <CommentThread projectId={projectId} targetType="useCase" targetId={item.id} context={context} role={role} readOnly={readOnly} onCount={setCommentCount} onClose={() => setCommentsOpen(false)} />}
    </div>
  </Modal>;
}
