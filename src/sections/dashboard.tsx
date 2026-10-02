import { useEffect, useState } from 'react';
import { limit } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';
import type { SectionProps } from '@/context/AppContext';
import { ActivityList, Avatar, Metric, PageTitle, PanelTitle } from '@/components/common';
import { useTaskModal } from '@/components/board/TaskModalHost';
import { TASK_COLUMNS } from '@/config/constants';
import { blockingMilestones } from '@/utils/milestone-deps';
import { compareDueDate, dueState } from '@/utils/calendar';
import type { Activity, Membership, Milestone, Project, ProjectDocument } from '@/types';
import { formatDue, pick } from '@/utils/formatters';
import { queryValue } from '@/utils/task-filter';
import { useActiveTasksState, useProjectItemsState, useTaskCounts } from '@/hooks';
import { subscribeProjectQuery, subscribeRecentActivities } from '@/services';
import { isGitHubEnabled } from '@/config/features';
import { Icon } from '@/components/common/Icon';
import type { AppContextValue } from '@/context/AppContext';

const STATUS_COLOR = new Map(TASK_COLUMNS.map((column) => [column.id, column.color]));
const assigneeQuery = (member: Membership, me: string) => (member.userId === me ? 'assignee:@me' : `assignee:${member.email ? member.email.split('@')[0] : queryValue(member.displayName)}`);

export function Dashboard({ context, project, members, readOnly }: SectionProps) {
  const { items: tasks, loaded: tasksLoaded } = useActiveTasksState(project.id);
  const counts = useTaskCounts(project.id);
  const { items: milestones, loaded: milestonesLoaded } = useProjectItemsState<Milestone>(project.id, 'milestones');
  const [recent, setRecent] = useState<Activity[] | null>(null);
  useEffect(() => { setRecent(null); return subscribeRecentActivities(project.id, 8, setRecent); }, [project.id]);
  // Render numbers and bars only once everything they depend on has arrived, so nothing counts up from 0.
  const ready = tasksLoaded && milestonesLoaded && counts !== null && members.length > 0;
  const navigate = useNavigate();
  const { openTask } = useTaskModal();
  const { locale, user } = context;
  const done = counts?.done ?? 0;
  const total = counts?.total ?? tasks.length;
  const overdue = tasks.filter((task) => task.status !== 'done' && dueState(task.dueDate, undefined, undefined, task.dueTime) === 'overdue').length;
  const progress = total ? Math.round((done / total) * 100) : 0;
  const activeMilestones = milestones.filter((item) => item.status === 'active').sort((a, b) => compareDueDate(a.dueDate, b.dueDate, a.dueTime, b.dueTime));
  const myTasks = tasks.filter((task) => task.assigneeIds.includes(user.uid)).sort((a, b) => compareDueDate(a.dueDate, b.dueDate, a.dueTime, b.dueTime));
  const tasksUrl = (query: string) => `/p/${project.id}/tasks?q=${encodeURIComponent(query)}`;

  return <><PageTitle eyebrow="PROJECT OVERVIEW" title={project.name} description={project.description || pick(locale, 'ติดตามภาพรวมของโปรเจกต์แบบเรียลไทม์', 'Follow your project in realtime')} />
    {!readOnly && ready && counts && <GettingStarted context={context} project={project} hasTasks={counts.total > 0} hasTeam={members.length > 1} hasMilestones={milestones.length > 0} />}
    {isGitHubEnabled && project.githubRepo && <a className="panel dashboard-repo" href={project.githubRepo.url} target="_blank" rel="noreferrer"><span aria-hidden="true"><Icon name="github" /></span><div><small>{context.t('ghRepoOfProject')}</small><strong>{project.githubRepo.fullName}{project.githubRepo.private && <em>{context.t('ghPrivate')}</em>}</strong>{project.githubRepo.defaultBranch && <small>{pick(locale, 'สาขาหลัก', 'Default branch')}: <code>{project.githubRepo.defaultBranch}</code></small>}</div><b>{context.t('ghOpen')} <Icon name="open" /></b></a>}
    <div className="metric-grid"><Metric icon="board" color="blue" value={ready ? total : null} label={context.t('tasks')} /><Metric icon="check" color="green" value={ready ? done : null} label={context.t('done')} /><Metric icon="alert" color="rose" value={ready ? overdue : null} label={context.t('overdue')} /><Metric icon="team" color="purple" value={ready ? members.length : null} label={context.t('members')} /></div>
    <div className="dashboard-grid">
      <section className="panel"><PanelTitle title={pick(locale, 'งานของฉัน', 'My tasks')} action={myTasks.length > 0 ? <Link className="panel-link" to={tasksUrl('assignee:@me')}>{pick(locale, 'ดูทั้งหมด', 'See all')} <Icon name="arrowRight" /></Link> : undefined} />
        {!ready ? <PanelSkeleton /> : <div className="task-mini-list">{myTasks.slice(0, 6).map((task) => {
          const state = dueState(task.dueDate, undefined, undefined, task.dueTime);
          return <button key={task.id} type="button" onClick={() => openTask(task)}><i style={{ background: STATUS_COLOR.get(task.status) }} /><strong>{task.title}</strong>{task.dueDate && <small className={`due ${state}`}>{formatDue(task.dueDate, task.dueTime, locale)}</small>}</button>;
        })}{!myTasks.length && <p className="muted">{pick(locale, 'ยังไม่มีงานที่มอบหมายให้คุณ', 'Nothing is assigned to you')}</p>}</div>}
      </section>
      <section className="panel progress-panel"><PanelTitle title={pick(locale, 'ความคืบหน้าโปรเจกต์', 'Project progress')} />{!ready ? <PanelSkeleton rows={5} /> : <><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}><div><strong>{progress}%</strong><small>{done}/{total} tasks</small></div></div><div className="status-bars">{TASK_COLUMNS.map((column) => { const count = column.id === 'done' ? done : tasks.filter((task) => task.status === column.id).length; return <div key={column.id}><span><i style={{ background: column.color }} />{locale === 'th' ? column.th : column.en}<b>{count}</b></span><div><i style={{ width: total ? `${count / total * 100}%` : '0%', background: column.color }} /></div></div>; })}</div></>}</section>
      <section className="panel"><PanelTitle title={context.t('workload')} />{!ready ? <PanelSkeleton /> : <div className="workload-list">{members.map((member) => { const assigned = tasks.filter((task) => task.assigneeIds.includes(member.userId) && task.status !== 'done').length; return <Link key={member.id} to={tasksUrl(assigneeQuery(member, user.uid))} title={pick(locale, `ดูงานของ ${member.displayName}`, `See ${member.displayName}’s tasks`)}><Avatar name={member.displayName} src={member.photoURL} size="sm" /><span><strong>{member.displayName}</strong><small>{pick(locale, `${assigned} งานที่ยังไม่เสร็จ`, `${assigned} active tasks`)}</small></span><div><i style={{ width: `${Math.min(100, assigned * 18)}%` }} /></div></Link>; })}</div>}</section>
      <section className="panel"><PanelTitle title={pick(locale, 'Milestone ที่กำลังมาถึง', 'Upcoming milestones')} action={<Link className="panel-link" to={`/p/${project.id}/plan`}>{pick(locale, 'ทั้งหมด', 'All')} <Icon name="arrowRight" /></Link>} />{!ready ? <PanelSkeleton rows={2} /> : <div className="milestone-mini-list">{activeMilestones.slice(0, 5).map((item) => { const blocked = blockingMilestones(item, milestones).length > 0; return <button key={item.id} onClick={() => navigate(`/p/${project.id}/tasks?m=${item.id}`)}><span className={blocked ? 'blocked' : ''}><Icon name={blocked ? 'lock' : 'milestone'} /></span><div><strong>{item.title}</strong><small>{item.dueDate ? formatDue(item.dueDate, item.dueTime, locale) : pick(locale, 'ไม่มีกำหนด', 'No due date')}{blocked ? ` · ${pick(locale, 'รอ milestone ก่อนหน้า', 'waiting on prerequisite')}` : ''}</small></div><b><Icon name="arrowRight" /></b></button>; })}{!activeMilestones.length && <p className="muted">{context.t('noData')}</p>}</div>}</section>
      <section className="panel activity-panel"><PanelTitle title={context.t('recentActivity')} />{recent ? <ActivityList items={recent} locale={locale} /> : <PanelSkeleton rows={4} />}</section>
    </div></>;
}

const dismissKey = (projectId: string) => `ps.gs.${projectId}`;
function readDismissed(projectId: string) {
  try { return localStorage.getItem(dismissKey(projectId)) === '1'; } catch { return false; }
}

/** First steps for a fresh project; hides itself once every step is done or when dismissed. */
function GettingStarted({ context, project, hasTasks, hasTeam, hasMilestones }: { context: AppContextValue; project: Project; hasTasks: boolean; hasTeam: boolean; hasMilestones: boolean }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(project.id));
  const [hasDocs, setHasDocs] = useState<boolean | null>(null);
  useEffect(() => subscribeProjectQuery<ProjectDocument>(project.id, 'documents', 'getting-started:1', [limit(1)], (items) => setHasDocs(items.length > 0), () => setHasDocs(false)), [project.id]);
  const { newTask } = useTaskModal();
  const navigate = useNavigate();
  const { locale } = context;
  const steps = [
    { done: hasTasks, icon: 'tasks' as const, title: pick(locale, 'สร้างงานแรก', 'Create your first task'), action: pick(locale, 'เพิ่มงาน', 'Add task'), run: () => newTask() },
    { done: hasTeam, icon: 'userPlus' as const, title: pick(locale, 'ชวนเพื่อนร่วมทีม', 'Invite a teammate'), action: pick(locale, 'เชิญ', 'Invite'), run: () => navigate(`/p/${project.id}/team`) },
    { done: hasMilestones, icon: 'milestone' as const, title: pick(locale, 'ตั้งเป้าหมาย (milestone)', 'Set a milestone'), action: pick(locale, 'วางแผน', 'Plan'), run: () => navigate(`/p/${project.id}/plan`) },
    { done: Boolean(hasDocs), icon: 'document' as const, title: pick(locale, 'เพิ่มเอกสารแรก', 'Add a document'), action: pick(locale, 'เปิดเอกสาร', 'Open docs'), run: () => navigate(`/p/${project.id}/docs`) },
  ];
  const completed = steps.filter((step) => step.done).length;
  // Wait for the documents check too, or the card could flash in and vanish again.
  if (dismissed || hasDocs === null || completed === steps.length) return null;
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(dismissKey(project.id), '1'); } catch { /* storage blocked: it just shows again next visit */ }
  };
  return <section className="panel getting-started">
    <header>
      <span aria-hidden><Icon name="rocket" /></span>
      <div><h2>{context.t('gettingStarted')}</h2><small>{pick(locale, `ทำแล้ว ${completed} จาก ${steps.length} ขั้น`, `${completed} of ${steps.length} done`)}</small></div>
      <button type="button" className="icon-button" onClick={dismiss} aria-label={pick(locale, 'ซ่อน', 'Dismiss')} title={pick(locale, 'ซ่อน', 'Dismiss')}><Icon name="close" /></button>
    </header>
    <div className="progress-bar"><i style={{ width: `${(completed / steps.length) * 100}%` }} /></div>
    <ol>{steps.map((step) => <li key={step.title} className={step.done ? 'done' : ''}>
      <span aria-hidden><Icon name={step.done ? 'circleCheck' : step.icon} /></span>
      <strong>{step.title}</strong>
      {step.done ? <small>{pick(locale, 'เรียบร้อย', 'Done')}</small> : <button type="button" className="secondary" onClick={step.run}>{step.action}</button>}
    </li>)}</ol>
  </section>;
}

/** Static placeholder rows shown inside a panel until its data arrives (no pulsing). */
function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="list-skeleton" aria-hidden>{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>;
}
