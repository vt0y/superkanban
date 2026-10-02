import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SectionProps } from '@/context/AppContext';
import { ActivityList, Avatar, Metric, PageTitle, PanelTitle } from '@/components/common';
import { TASK_COLUMNS } from '@/config/constants';
import { blockingMilestones } from '@/utils/milestone-deps';
import { compareDueDate, dueState } from '@/utils/calendar';
import type { Activity, Milestone, Task } from '@/types';
import { formatDue, pick } from '@/utils/formatters';
import { useActiveTasks, useProjectItems, useTaskCounts } from '@/hooks';
import { subscribeRecentActivities } from '@/services';
import { isGitHubEnabled } from '@/config/features';
import { Icon } from '@/components/common/Icon';

export function Dashboard({ context, project, members }: SectionProps) {
  const tasks = useActiveTasks(project.id);
  const counts = useTaskCounts(project.id);
  const milestones = useProjectItems<Milestone>(project.id, 'milestones');
  const [recent, setRecent] = useState<Activity[]>([]);
  useEffect(() => subscribeRecentActivities(project.id, 8, setRecent), [project.id]);
  const navigate = useNavigate();
  const { locale } = context;
  const done = counts?.done ?? 0;
  const total = counts?.total ?? tasks.length;
  const overdue = tasks.filter((task) => task.status !== 'done' && dueState(task.dueDate, undefined, undefined, task.dueTime) === 'overdue').length;
  const progress = total ? Math.round((done / total) * 100) : 0;
  const activeMilestones = milestones.filter((item) => item.status === 'active').sort((a, b) => compareDueDate(a.dueDate, b.dueDate, a.dueTime, b.dueTime));
  return <><PageTitle eyebrow="PROJECT OVERVIEW" title={project.name} description={project.description || pick(locale, 'ติดตามภาพรวมของโปรเจกต์แบบเรียลไทม์', 'Follow your project in realtime')} />
    {isGitHubEnabled && project.githubRepo && <a className="panel dashboard-repo" href={project.githubRepo.url} target="_blank" rel="noreferrer"><span aria-hidden="true"><Icon name="github" /></span><div><small>{context.t('ghRepoOfProject')}</small><strong>{project.githubRepo.fullName}{project.githubRepo.private && <em>{context.t('ghPrivate')}</em>}</strong>{project.githubRepo.defaultBranch && <small>{pick(locale, 'สาขาหลัก', 'Default branch')}: <code>{project.githubRepo.defaultBranch}</code></small>}</div><b>{context.t('ghOpen')} <Icon name="open" /></b></a>}
    <div className="metric-grid"><Metric icon="board" color="blue" value={total} label={context.t('tasks')} /><Metric icon="check" color="green" value={done} label={context.t('done')} /><Metric icon="alert" color="rose" value={overdue} label={context.t('overdue')} /><Metric icon="team" color="purple" value={members.length} label={context.t('members')} /></div>
    <div className="dashboard-grid"><section className="panel progress-panel"><PanelTitle title={pick(locale, 'ความคืบหน้าโปรเจกต์', 'Project progress')} /><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as React.CSSProperties}><div><strong>{progress}%</strong><small>{done}/{total} tasks</small></div></div><div className="status-bars">{TASK_COLUMNS.map((column) => { const count = column.id === 'done' ? done : tasks.filter((task) => task.status === column.id).length; return <div key={column.id}><span><i style={{ background: column.color }} />{locale === 'th' ? column.th : column.en}<b>{count}</b></span><div><i style={{ width: total ? `${count / total * 100}%` : '0%', background: column.color }} /></div></div>; })}</div></section>
      <section className="panel"><PanelTitle title={context.t('workload')} /><div className="workload-list">{members.map((member) => { const assigned = tasks.filter((task) => task.assigneeIds.includes(member.userId) && task.status !== 'done').length; return <div key={member.id}><Avatar name={member.displayName} src={member.photoURL} size="sm" /><span><strong>{member.displayName}</strong><small>{assigned} active tasks</small></span><div><i style={{ width: `${Math.min(100, assigned * 18)}%` }} /></div></div>; })}{!members.length && <p className="muted">{context.t('noData')}</p>}</div></section>
      <section className="panel"><PanelTitle title={pick(locale, 'Milestone ที่กำลังมาถึง', 'Upcoming milestones')} /><div className="milestone-mini-list">{activeMilestones.slice(0, 5).map((item) => { const blocked = blockingMilestones(item, milestones).length > 0; return <button key={item.id} onClick={() => navigate(`/p/${project.id}/board?m=${item.id}`)}><span className={blocked ? 'blocked' : ''}><Icon name={blocked ? 'lock' : 'milestone'} /></span><div><strong>{item.title}</strong><small>{item.dueDate ? formatDue(item.dueDate, item.dueTime, locale) : pick(locale, 'ไม่มีกำหนด', 'No due date')}{blocked ? ` · ${pick(locale, 'รอ milestone ก่อนหน้า', 'waiting on prerequisite')}` : ''}</small></div><b><Icon name="arrowRight" /></b></button>; })}{!activeMilestones.length && <p className="muted">{context.t('noData')}</p>}</div></section>
      <section className="panel activity-panel"><PanelTitle title={context.t('recentActivity')} /><ActivityList items={recent} locale={locale} /></section>
    </div></>;
}
