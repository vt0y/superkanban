import { useCallback, useEffect, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import type { Milestone, Task, TaskStatus } from '@/types';
import { ADMIN_CACHE_TTL_MS, ADMIN_COUNT_CAP, loadAdminProjectCounts, loadAdminProjectMilestones, loadAdminProjectTasks, type AdminCount, type AdminPageResult, type AdminProject, type AdminProjectCounts } from '@/services/admin';
import { useAdminCollection } from '@/hooks/useAdminCollection';
import { Modal } from '@/components/common/Modal';
import { Metric } from '@/components/common/Metric';
import { Icon } from '@/components/common/Icon';
import { Segmented } from '@/components/common/Segmented';
import { adminLoadError, adminLoadErrorMessage } from '@/utils/admin-errors';
import { pick } from '@/utils/formatters';

type InspectTab = 'tasks' | 'milestones';
type WorkItem = (Task & { kind: 'task' }) | (Milestone & { kind: 'milestone' });

// Work items are member-written: render as plain text only, clipped, with unknown enum values shown as such.
const clip = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const tagged = <T, K extends WorkItem['kind']>(kind: K, load: Promise<AdminPageResult<T>>) =>
  load.then((page) => ({ ...page, items: page.items.map((item) => ({ ...item, kind })) as unknown as WorkItem[] }));

export function AdminProjectInspector({ context, project, onClose }: { context: AppContextValue; project: AdminProject; onClose: () => void }) {
  const { locale } = context;
  const [counts, setCounts] = useState<AdminProjectCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<InspectTab>('tasks');
  const [status, setStatus] = useState<TaskStatus | 'all'>('all');
  const [, setTick] = useState(0);
  useEffect(() => {
    let current = true;
    setCountsLoading(true); setCountsError(null);
    void loadAdminProjectCounts(project.id).then((value) => { if (current) setCounts(value); })
      .catch((cause: unknown) => { if (current) setCountsError(adminLoadErrorMessage(adminLoadError(cause), locale)); })
      .finally(() => { if (current) setCountsLoading(false); });
    return () => { current = false; };
  }, [project.id, context.user.uid, locale, revision]);
  // Re-enable refresh once the cached inspection expires.
  const wait = counts ? counts.loadedAt + ADMIN_CACHE_TTL_MS - Date.now() : 0;
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setTick((value) => value + 1), wait);
    return () => clearTimeout(timer);
  }, [wait > 0, counts?.loadedAt]);
  const load = useCallback((afterId?: string) => tab === 'tasks'
    ? tagged('task', loadAdminProjectTasks(project.id, afterId, status === 'all' ? undefined : status))
    : tagged('milestone', loadAdminProjectMilestones(project.id, afterId)), [project.id, tab, status]);
  const list = useAdminCollection<WorkItem>(load, `${context.user.uid}:${project.id}:${tab}:${status}`);

  const date = (value?: { toDate?(): Date }) => value?.toDate?.().toLocaleString(locale === 'th' ? 'th-TH' : 'en-US') ?? '—';
  const shown = (count?: AdminCount) => count ? (count.capped ? `${ADMIN_COUNT_CAP}+` : count.value) : null;
  const statuses: [TaskStatus, string][] = [
    ['backlog', pick(locale, 'รอดำเนินการ', 'Backlog')], ['todo', pick(locale, 'ต้องทำ', 'To do')],
    ['in_progress', pick(locale, 'กำลังทำ', 'In progress')], ['review', pick(locale, 'ตรวจสอบ', 'Review')], ['done', pick(locale, 'เสร็จแล้ว', 'Done')],
  ];
  const priorities: Record<string, string> = { low: pick(locale, 'ต่ำ', 'Low'), medium: pick(locale, 'กลาง', 'Medium'), high: pick(locale, 'สูง', 'High'), urgent: pick(locale, 'ด่วน', 'Urgent') };
  const unknown = pick(locale, 'ไม่ทราบ', 'unknown');
  const statusLabel = (value: unknown) => statuses.find(([key]) => key === value)?.[1] ?? unknown;
  const all = counts ? [...Object.values(counts.open), counts.done] : [];
  const total = counts ? (all.some((count) => count.capped) ? `${all.reduce((sum, count) => sum + count.value, 0)}+` : all.reduce((sum, count) => sum + count.value, 0)) : null;
  const cooling = wait > 0;
  const refresh = () => { setRevision((value) => value + 1); list.refresh(); };

  const taskRow = (task: Task) => {
    const checklist = Array.isArray(task.checklist) ? task.checklist : [];
    const description = clip(task.description, 2000);
    return <li key={task.id}>
      <strong>{clip(task.title, 200) || '—'}</strong>
      <small className="muted">{statusLabel(task.status)} · {priorities[task.priority as string] ?? unknown} · {clip(task.dueDate, 20) || '—'} {clip(task.dueTime, 5)} · {pick(locale, 'ผู้รับผิดชอบ', 'Assignees')}: {Array.isArray(task.assigneeIds) ? task.assigneeIds.length : 0}</small>
      <small className="muted">{pick(locale, 'สร้าง', 'Created')}: {date(task.createdAt)} · {pick(locale, 'อัปเดต', 'Updated')}: {date(task.updatedAt)}</small>
      {(description || checklist.length > 0) && <details>
        <summary>{pick(locale, 'รายละเอียด', 'Details')}</summary>
        {description && <p className="admin-inspector-text">{description}</p>}
        {checklist.length > 0 && <ul className="admin-inspector-checklist">{checklist.slice(0, 20).map((item, index) => <li key={index}>{item?.done ? '☑' : '☐'} {clip(item?.text, 200)}</li>)}</ul>}
        {checklist.length > 20 && <small className="muted">{pick(locale, `และอีก ${checklist.length - 20} รายการ`, `and ${checklist.length - 20} more`)}</small>}
      </details>}
    </li>;
  };
  const milestoneRow = (item: Milestone) => {
    const description = clip(item.description, 2000);
    return <li key={item.id}>
      <strong>{clip(item.title, 200) || '—'}</strong>
      <small className="muted">{item.status === 'completed' ? pick(locale, 'เสร็จแล้ว', 'Completed') : item.status === 'active' ? pick(locale, 'ใช้งาน', 'Active') : unknown} · {clip(item.dueDate, 20) || '—'} {clip(item.dueTime, 5)}</small>
      {description && <details><summary>{pick(locale, 'รายละเอียด', 'Details')}</summary><p className="admin-inspector-text">{description}</p></details>}
    </li>;
  };

  return <Modal title={pick(locale, `ตรวจสอบ: ${project.name}`, `Inspect: ${project.name}`)} onClose={onClose} wide>
    <div className="admin-inspector">
      <div className="admin-inspector-head">
        <span className={`chip ${project.archived ? 'admin-inactive' : 'admin-active'}`}>{project.moderationArchived ? pick(locale, 'เก็บโดยผู้ดูแลเว็บ', 'Archived by site staff') : project.archived ? pick(locale, 'เก็บถาวร', 'Archived') : pick(locale, 'ใช้งาน', 'Active')}</span>
        <button type="button" className="secondary small" disabled={countsLoading || list.loading || cooling} onClick={refresh}><Icon name="refresh" />{pick(locale, 'รีเฟรช', 'Refresh')}</button>
      </div>
      <dl className="admin-summary-facts">
        <div><dt>{pick(locale, 'เจ้าของ', 'Owner')}</dt><dd>{project.ownerName}{project.ownerEmail && <small className="muted"> · {project.ownerEmail}</small>}</dd></div>
        <div><dt>{pick(locale, 'สมาชิก', 'Members')}</dt><dd>{project.memberIds.length}</dd></div>
        <div><dt>{pick(locale, 'สร้างเมื่อ', 'Created')}</dt><dd>{date(project.createdAt)}</dd></div>
        <div><dt>{pick(locale, 'อัปเดตเมื่อ', 'Updated')}</dt><dd>{date(project.updatedAt)}</dd></div>
        {project.moderationArchived && <><div className="admin-summary-wide"><dt>{pick(locale, 'เหตุผล', 'Reason')}</dt><dd>{project.moderationReason}</dd></div><div className="admin-summary-wide"><dt>{pick(locale, 'ผู้ดำเนินการ', 'Actor')}</dt><dd>{project.moderationUpdatedBy} · {date(project.moderationUpdatedAt)}</dd></div></>}
      </dl>
      {countsError && <p className="admin-error" role="alert">{countsError}</p>}
      {!countsError && <div className="metric-grid admin-inspector-metrics">
        <Metric icon="tasks" color="blue" value={total} label={pick(locale, 'งานทั้งหมด', 'Total tasks')} />
        {statuses.slice(0, 4).map(([key, label]) => <Metric key={key} icon="circle" color="purple" value={shown(counts?.open[key as keyof AdminProjectCounts['open']])} label={label} />)}
        <Metric icon="circleCheck" color="green" value={shown(counts?.done)} label={statuses[4][1]} />
        <Metric icon="milestone" color="blue" value={shown(counts?.milestones)} label={pick(locale, 'ไมล์สโตน', 'Milestones')} />
      </div>}
      <div className="admin-toolbar">
        <Segmented value={tab} onChange={setTab} options={[{ id: 'tasks', label: pick(locale, 'งาน', 'Tasks') }, { id: 'milestones', label: pick(locale, 'ไมล์สโตน', 'Milestones') }]} />
        {tab === 'tasks' && <select aria-label={pick(locale, 'สถานะงาน', 'Task status')} value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | 'all')}>
          <option value="all">{pick(locale, 'ทุกสถานะ', 'All statuses')}</option>
          {statuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>}
      </div>
      {list.error && <div role="alert" className="admin-error"><span>{adminLoadErrorMessage(list.error, locale)}</span><button type="button" className="secondary small" onClick={list.retry}>{pick(locale, 'ลองใหม่', 'Retry')}</button></div>}
      {list.loading && <p role="status" className="muted">{pick(locale, 'กำลังโหลด…', 'Loading…')}</p>}
      {!list.loading && !list.error && !list.items.length && <p role="status" className="muted">{pick(locale, 'ไม่มีรายการ', 'Nothing here.')}</p>}
      <ul className="admin-compact-list">{list.items.map((item) => item.kind === 'task' ? taskRow(item) : milestoneRow(item))}</ul>
      {list.hasMore && <div className="load-more-row"><button type="button" className="secondary small" disabled={list.loadingMore || !!list.error} onClick={() => void list.loadMore()}>{list.loadingMore ? pick(locale, 'กำลังโหลด…', 'Loading…') : pick(locale, 'โหลดเพิ่มเติม', 'Load more')}</button></div>}
      <p className="muted admin-inspector-note">{pick(locale, 'ข้อมูลจริงจาก Firestore รีเฟรชได้นาทีละครั้ง', 'Live data from Firestore; refresh limited to once per minute.')}</p>
    </div>
  </Modal>;
}
