import { useEffect, useState } from 'react';
import type { AppContextValue } from '@/context/AppContext';
import type { ProjectSummary } from '@/types';
import { loadAdminProjectSummary, type AdminProject } from '@/services/admin';
import { summaryNeedsRebuild } from '@/services/project-summary';
import { Modal } from '@/components/common/Modal';
import { Metric } from '@/components/common/Metric';
import { Icon } from '@/components/common/Icon';
import { adminLoadError, adminLoadErrorMessage } from '@/utils/admin-errors';
import { pick } from '@/utils/formatters';

export function AdminProjectInspector({ context, project, onClose }: { context: AppContextValue; project: AdminProject; onClose: () => void }) {
  const { locale } = context;
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setSummary(null); setError(null);
    void loadAdminProjectSummary(project.id).then((value) => { if (current) setSummary(value); })
      .catch((cause: unknown) => { if (current) setError(adminLoadErrorMessage(adminLoadError(cause), locale)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [project.id, context.user.uid, locale, revision]);
  const date = (value?: { toDate(): Date }) => value?.toDate?.().toLocaleString(locale === 'th' ? 'th-TH' : 'en-US') ?? '—';
  const usable = summary?.version === 1;
  const statuses = [
    ['backlog', pick(locale, 'รอดำเนินการ', 'Backlog')], ['todo', pick(locale, 'ต้องทำ', 'To do')],
    ['in_progress', pick(locale, 'กำลังทำ', 'In progress')], ['review', pick(locale, 'ตรวจสอบ', 'Review')],
  ] as const;
  return <Modal title={pick(locale, `ตรวจสอบ: ${project.name}`, `Inspect: ${project.name}`)} onClose={onClose} wide>
    <div className="admin-inspector">
      <div className="admin-inspector-head">
        <span className={`chip ${project.archived ? 'admin-inactive' : 'admin-active'}`}>{project.moderationArchived ? pick(locale, 'เก็บโดยผู้ดูแลเว็บ', 'Archived by site staff') : project.archived ? pick(locale, 'เก็บถาวร', 'Archived') : pick(locale, 'ใช้งาน', 'Active')}</span>
        <button type="button" className="secondary small" disabled={loading} onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" />{pick(locale, 'รีเฟรชสรุป', 'Refresh summary')}</button>
      </div>
      <dl className="admin-summary-facts">
        <div><dt>{pick(locale, 'เจ้าของ', 'Owner')}</dt><dd>{project.ownerName}{project.ownerEmail && <small className="muted"> · {project.ownerEmail}</small>}</dd></div>
        <div><dt>{pick(locale, 'สมาชิก', 'Members')}</dt><dd>{project.memberIds.length}</dd></div>
        <div><dt>{pick(locale, 'สร้างเมื่อ', 'Created')}</dt><dd>{date(project.createdAt)}</dd></div>
        <div><dt>{pick(locale, 'อัปเดตเมื่อ', 'Updated')}</dt><dd>{date(project.updatedAt)}</dd></div>
        {project.moderationArchived && <><div className="admin-summary-wide"><dt>{pick(locale, 'เหตุผล', 'Reason')}</dt><dd>{project.moderationReason}</dd></div><div className="admin-summary-wide"><dt>{pick(locale, 'ผู้ดำเนินการ', 'Actor')}</dt><dd>{project.moderationUpdatedBy} · {date(project.moderationUpdatedAt)}</dd></div></>}
      </dl>
      {loading && <p role="status" className="muted">{pick(locale, 'กำลังโหลด…', 'Loading…')}</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      {!loading && !error && !usable && <p role="status" className="muted">{pick(locale, 'ไม่มีสรุปที่รองรับ สมาชิกต้องอัปเดตหรือสร้างสรุปใหม่', 'Summary unavailable. A member must update or rebuild it.')}</p>}
      {!loading && !error && usable && summary && <>
        <div className="metric-grid admin-inspector-metrics">
          <Metric icon="tasks" color="blue" value={summary.openCount + summary.doneTotal} label={pick(locale, 'งานทั้งหมด', 'Total tasks')} />
          {statuses.map(([key, label]) => <Metric key={key} icon="circle" color="purple" value={summary.openByStatus?.[key] ?? 0} label={label} />)}
          <Metric icon="circleCheck" color="green" value={summary.doneTotal} label={pick(locale, 'เสร็จแล้ว', 'Done')} />
          <Metric icon="milestone" color="blue" value={Object.keys(summary.milestones ?? {}).length} label={pick(locale, 'ไมล์สโตน', 'Milestones')} />
        </div>
        {summaryNeedsRebuild(summary) && <p className="admin-summary-warning" role="status"><Icon name="alert" />{pick(locale, 'สรุปอาจล้าสมัย', 'Summary may be stale.')}</p>}
        {summary.truncated && <p className="admin-summary-warning" role="status"><Icon name="alert" />{pick(locale, 'รายการงานถูกตัดทอน จำนวนรวมอาจมากกว่ารายการที่แสดง', 'Task details are truncated; totals may exceed the displayed entries.')}</p>}
        <h3>{pick(locale, 'งานที่ยังไม่เสร็จ', 'Open tasks')}</h3>
        <ul className="admin-compact-list">{Object.entries(summary.openTasks ?? {}).map(([id, task]) => <li key={id}><strong>{task.title}</strong><small className="muted">{statuses.find(([key]) => key === task.status)?.[1] ?? task.status} · {task.priority} · {task.dueDate || '—'} {task.dueTime} · {summary.milestones?.[task.milestoneId]?.title || task.milestoneId || '—'} · {pick(locale, 'ผู้รับผิดชอบ', 'Assignees')}: {task.assigneeIds?.join(', ') || '—'}</small></li>)}</ul>
        <h3>{pick(locale, 'ไมล์สโตน', 'Milestones')}</h3>
        <ul className="admin-compact-list">{Object.entries(summary.milestones ?? {}).map(([id, item]) => <li key={id}><strong>{item.title}</strong><small className="muted">{item.status === 'completed' ? pick(locale, 'เสร็จแล้ว', 'Completed') : pick(locale, 'ใช้งาน', 'Active')} · {item.dueDate || '—'} {item.dueTime}</small></li>)}</ul>
        <p className="muted admin-inspector-note">{pick(locale, 'อัปเดตสรุป', 'Summary updated')}: {date(summary.updatedAt)} · {pick(locale, 'สร้างสรุปใหม่', 'Rebuilt')}: {date(summary.rebuiltAt)}</p>
      </>}
      <p className="muted admin-inspector-note">{pick(locale, 'สรุปนี้ดูแลโดยสมาชิก อาจล้าสมัยหรือถูกแก้ไข ไม่ใช่หลักฐานยืนยันการใช้งานที่ผิดกฎ', 'This summary is maintained by members and may be stale or altered. It is not verified abuse evidence.')}</p>
    </div>
  </Modal>;
}
