import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { AppHeader } from '@/components/layout/AppHeader';
import { Empty } from '@/components/common/Empty';
import { Icon, type IconName } from '@/components/common/Icon';
import { Segmented } from '@/components/common/Segmented';
import { TASK_COLUMNS } from '@/config/constants';
import { useHomeSummary } from '@/hooks/useHomeSummary';
import type { Locale, Project } from '@/types';
import { daysUntil, bucketMyTasks, MY_WORK_BUCKETS, projectStats, summarize, upcomingDeadlines, type Deadline, type MyWorkBucket, type ProjectWork } from '@/utils/home-summary';
import { parseISODate } from '@/utils/calendar';
import { formatDue, pick } from '@/utils/formatters';
import { partitionProjects } from '@/utils/project-lists';

const STATUS_COLOR = new Map(TASK_COLUMNS.map((column) => [column.id, column.color]));
const SCOPE_KEY = 'ps.home.deadlines';
type Scope = 'mine' | 'everyone';

function readScope(): Scope {
  try { return localStorage.getItem(SCOPE_KEY) === 'everyone' ? 'everyone' : 'mine'; } catch { return 'mine'; }
}

const initials = (project: Project) => project.name.slice(0, 2).toUpperCase();
const taskUrl = (projectId: string, taskId: string) => `/p/${projectId}/tasks?task=${taskId}`;
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function Home({ context }: { context: AppContextValue }) {
  const navigate = useNavigate();
  const { locale, user } = context;
  const { active, archived } = partitionProjects(context.projects);
  const work = useHomeSummary(active);
  const [scope, setScope] = useState<Scope>(readScope);
  const now = useMemo(() => new Date(), [work]);
  const loaded = work.every((item) => item.loaded);
  const totals = summarize(work, user.uid, now);
  const deadlines = upcomingDeadlines(work, now, { mineUid: scope === 'mine' ? user.uid : undefined });
  const myWork = bucketMyTasks(work, user.uid, now);
  const firstName = context.profile.displayName.split(' ')[0];
  const changeScope = (next: Scope) => {
    setScope(next);
    try { localStorage.setItem(SCOPE_KEY, next); } catch { /* storage blocked: the choice just won't stick */ }
  };

  const tiles: { id: string; icon: IconName; tone: string; value: number; label: string; onClick: () => void }[] = [
    { id: 'active', icon: 'board', tone: 'info', value: totals.active, label: pick(locale, 'งานที่ยังไม่เสร็จ', 'Active tasks'), onClick: () => scrollTo('home-projects') },
    { id: 'overdue', icon: 'alert', tone: 'danger', value: totals.overdue, label: pick(locale, 'เกินกำหนด', 'Overdue'), onClick: () => { changeScope('everyone'); scrollTo('home-deadlines'); } },
    { id: 'week', icon: 'dueSoon', tone: 'warning', value: totals.dueWeek, label: pick(locale, 'ครบกำหนดใน 7 วัน', 'Due in 7 days'), onClick: () => { changeScope('everyone'); scrollTo('home-deadlines'); } },
    { id: 'mine', icon: 'user', tone: 'violet', value: totals.mine, label: pick(locale, 'งานของฉัน', 'Assigned to me'), onClick: () => scrollTo('home-my-work') },
    { id: 'milestones', icon: 'milestone', tone: 'success', value: totals.milestonesSoon, label: pick(locale, 'Milestone ใน 14 วัน', 'Milestones in 14 days'), onClick: () => scrollTo('home-deadlines') },
  ];

  return (
    <>
      <AppHeader context={context} />
      <main className="page-shell home-page">
        <section className="welcome">
          <div>
            <p>{now.toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1>{pick(locale, `สวัสดี ${firstName}`, `Hello, ${firstName}`)}</h1>
            <span>{active.length ? pick(locale, `ภาพรวมจาก ${active.length} โปรเจกต์ที่กำลังทำ`, `Here’s what’s happening across ${active.length} active project${active.length > 1 ? 's' : ''}`) : context.t('greeting')}</span>
          </div>
          <button className="primary" onClick={() => navigate('/new')}>
            <Icon name="add" /> {context.t('newProject')}
          </button>
        </section>

        <button className="home-tarot-card" onClick={() => navigate('/tarot')}>
          <span className="home-tarot-moon">☾</span>
          <span>
            <small>ARCANA · AI TAROT</small>
            <strong>{pick(locale, 'จักรวาลมีสิ่งใดอยากบอกคุณ', 'What does the universe want you to know?')}</strong>
            <em>{pick(locale, 'สับสำรับ เลือกไพ่ 3 ใบ และรับคำทำนายจาก AI', 'Shuffle, choose three cards, and receive your AI reading')}</em>
          </span>
          <b>{pick(locale, 'เปิดไพ่', 'Enter')} <Icon name="arrowRight" /></b>
        </button>

        {active.length > 0 && <>
          <section className="home-summary" aria-label={pick(locale, 'สรุปทุกโปรเจกต์', 'Summary of all projects')}>
            {tiles.map((tile) => (
              <button key={tile.id} type="button" className={`summary-tile tone-${tile.tone} ${tile.id === 'overdue' && tile.value > 0 ? 'alerting' : ''}`} onClick={tile.onClick}>
                <span aria-hidden><Icon name={tile.icon} /></span>
                <strong>{loaded ? tile.value : '–'}</strong>
                <small>{tile.label}</small>
              </button>
            ))}
          </section>

          <div className="home-columns">
            <section className="panel home-panel" id="home-deadlines">
              <div className="panel-title">
                <h2>{context.t('upcomingDeadlines')}</h2>
                <Segmented<Scope> value={scope} onChange={changeScope} options={[{ id: 'mine', label: pick(locale, 'ของฉัน', 'Mine') }, { id: 'everyone', label: pick(locale, 'ทุกคน', 'Everyone') }]} />
              </div>
              {!loaded ? <ListSkeleton /> : deadlines.length ? (
                <div className="deadline-list">
                  {deadlines.map((day) => (
                    <div key={day.date} className="deadline-day">
                      <h3 className={daysUntil(day.date, now) < 0 ? 'overdue' : ''}>{dayLabel(day.date, now, locale)}</h3>
                      {day.items.map((item) => <DeadlineRow key={`${item.kind}:${item.kind === 'task' ? item.task.id : item.milestone.id}`} item={item} uid={user.uid} locale={locale} />)}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="home-empty"><Icon name="circleCheck" /> {pick(locale, 'ไม่มีกำหนดส่งใน 14 วันข้างหน้า', 'Nothing due in the next 14 days')}</p>
              )}
            </section>

            <section className="panel home-panel" id="home-my-work">
              <div className="panel-title">
                <h2>{context.t('myWork')}</h2>
                {loaded && <span>{totals.mine}</span>}
              </div>
              {!loaded ? <ListSkeleton /> : totals.mine ? (
                <div className="my-work">
                  {MY_WORK_BUCKETS.filter((bucket) => myWork[bucket].length).map((bucket) => (
                    <details key={bucket} className={`work-group ${bucket}`} open={bucket !== 'later' && bucket !== 'none'}>
                      <summary><Icon name="chevronRight" /> {bucketLabel(bucket, locale)} <b>{myWork[bucket].length}</b></summary>
                      {myWork[bucket].map(({ project, task }) => (
                        <Link key={task.id} className="work-row" to={taskUrl(project.id, task.id)}>
                          <i className="status-dot" style={{ background: STATUS_COLOR.get(task.status) }} />
                          <span className="work-title"><strong>{task.title}</strong><small><ProjectMark project={project} /> {project.name}</small></span>
                          {(task.priority === 'urgent' || task.priority === 'high') && <span className={`priority ${task.priority}`}>{task.priority}</span>}
                          {task.dueDate && <small className={`work-due ${bucket}`}>{formatDue(task.dueDate, task.dueTime, locale)}</small>}
                        </Link>
                      ))}
                    </details>
                  ))}
                </div>
              ) : (
                <p className="home-empty"><Icon name="circleCheck" /> {pick(locale, 'ยังไม่มีงานที่มอบหมายให้คุณ', 'Nothing is assigned to you right now')}</p>
              )}
            </section>
          </div>
        </>}

        <section className="home-section" id="home-projects">
          <div className="section-title">
            <h2>{context.t('myProjects')}</h2>
            <span className="count-badge">{active.length}</span>
          </div>
          {active.length ? (
            <div className="project-grid">
              {work.map((item) => (
                <ProjectCard key={item.project.id} work={item} now={now} context={context} onOpen={() => navigate(`/p/${item.project.id}/overview`)} />
              ))}
              <button className="project-card project-card-new" onClick={() => navigate('/new')}>
                <Icon name="add" />
                <span>{context.t('newProject')}</span>
              </button>
            </div>
          ) : (
            <Empty
              icon="layers"
              title={context.t('createFirst')}
              description={pick(locale, 'เริ่มจัดการงาน ทีม และความรู้ใน workspace เดียว', 'Bring tasks, team and knowledge into one workspace')}
              action={<button className="primary" onClick={() => navigate('/new')}><Icon name="add" /> {context.t('newProject')}</button>}
            />
          )}
        </section>

        {archived.length > 0 && (
          <details className="archived-projects">
            <summary>
              <span><Icon name="chevronRight" /><strong>{context.t('archivedProjects')}</strong></span>
              <span className="count-badge">{archived.length}</span>
            </summary>
            <div className="project-grid">
              {archived.map((project) => (
                <ProjectCard key={project.id} work={{ project, tasks: [], milestones: [], counts: null, loaded: true }} now={now} context={context} archived onOpen={() => navigate(`/p/${project.id}/overview`)} />
              ))}
            </div>
          </details>
        )}

      </main>
    </>
  );
}

function ProjectMark({ project }: { project: Project }) {
  return <span className="project-mark-sm" style={{ background: project.color }} aria-hidden>{initials(project)}</span>;
}

function DeadlineRow({ item, uid, locale }: { item: Deadline; uid: string; locale: Locale }) {
  const { project } = item;
  const content: ReactNode = item.kind === 'task'
    ? <>
        <i className="status-dot" style={{ background: STATUS_COLOR.get(item.task.status) }} />
        <span className="work-title"><strong>{item.task.title}</strong><small><ProjectMark project={project} /> {project.name}{item.task.assigneeIds.includes(uid) ? ` · ${pick(locale, 'ของฉัน', 'mine')}` : ''}</small></span>
      </>
    : <>
        <span className="deadline-flag" aria-hidden><Icon name="milestone" /></span>
        <span className="work-title"><strong>{item.milestone.title}</strong><small><ProjectMark project={project} /> {project.name} · Milestone</small></span>
      </>;
  const to = item.kind === 'task' ? taskUrl(project.id, item.task.id) : `/p/${project.id}/tasks?m=${item.milestone.id}`;
  return (
    <Link className={`work-row deadline-row ${item.overdue ? 'overdue' : ''}`} to={to}>
      {content}
      {item.time && <small className="work-due">{item.time}</small>}
    </Link>
  );
}

function ProjectCard({ work, now, context, archived = false, onOpen }: { work: ProjectWork; now: Date; context: AppContextValue; archived?: boolean; onOpen: () => void }) {
  const { project } = work;
  const { locale } = context;
  const stats = projectStats(work, now);
  return (
    <button className={`project-card ${archived ? 'archived' : ''}`} onClick={onOpen}>
      <div className="project-card-head">
        <div className="project-color" style={{ background: project.color }}>{initials(project)}</div>
        {archived ? (
          <span className="chip"><Icon name="archive" /> {context.t('archived')}</span>
        ) : !work.loaded || !work.counts ? null : stats.overdue > 0 ? (
          <span className="chip red"><Icon name="alert" /> {pick(locale, `เกินกำหนด ${stats.overdue}`, `${stats.overdue} overdue`)}</span>
        ) : work.loaded && !stats.active && !work.counts?.total ? (
          <span className="chip">{pick(locale, 'ยังไม่มีงาน', 'No tasks yet')}</span>
        ) : (
          <span className="chip green"><i className="dot" /> {pick(locale, 'ตามแผน', 'On track')}</span>
        )}
      </div>
      <h3>{project.name}</h3>
      <p>{project.description || pick(locale, 'ไม่มีคำอธิบาย', 'No description')}</p>
      {!archived && (
        <div className="project-card-stats">
          {work.failed ? <small className="muted">{pick(locale, 'โหลดข้อมูลไม่สำเร็จ', 'Couldn’t load stats')}</small> : !work.loaded || !work.counts ? <div className="list-skeleton" aria-hidden><i /></div> : <>
            <div className="progress-bar" aria-label={pick(locale, 'ความคืบหน้า', 'Progress')}><i style={{ width: `${stats.progress ?? 0}%` }} /></div>
            <div className="project-card-meta">
              <span>{pick(locale, `${stats.active} งานค้าง`, `${stats.active} active`)}{stats.progress !== null && ` · ${stats.progress}%`}</span>
              {stats.nextMilestone && <span className="next-milestone"><Icon name="milestone" /> {stats.nextMilestone.title} · {formatDue(stats.nextMilestone.dueDate, stats.nextMilestone.dueTime, locale)}</span>}
            </div>
          </>}
        </div>
      )}
      <div className="project-card-footer">
        <span><Icon name="team" /> {project.memberIds.length} {context.t('members')}</span>
        <b>{archived ? pick(locale, 'เปิดดู', 'View') : pick(locale, 'เปิดโปรเจกต์', 'Open')} <Icon name="arrowRight" /></b>
      </div>
    </button>
  );
}

function ListSkeleton() {
  return <div className="list-skeleton" aria-hidden>{[0, 1, 2].map((index) => <i key={index} />)}</div>;
}

function bucketLabel(bucket: MyWorkBucket, locale: Locale): string {
  const labels: Record<MyWorkBucket, [string, string]> = {
    overdue: ['เกินกำหนด', 'Overdue'],
    today: ['วันนี้', 'Today'],
    week: ['7 วันข้างหน้า', 'Next 7 days'],
    later: ['ภายหลัง', 'Later'],
    none: ['ไม่มีกำหนด', 'No due date'],
  };
  return pick(locale, ...labels[bucket]);
}

function dayLabel(date: string, now: Date, locale: Locale): string {
  const days = daysUntil(date, now);
  const formatted = parseISODate(date).toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  if (days < 0) return `${pick(locale, 'เกินกำหนด', 'Overdue')} · ${formatted}`;
  if (days === 0) return pick(locale, 'วันนี้', 'Today');
  if (days === 1) return pick(locale, 'พรุ่งนี้', 'Tomorrow');
  return formatted;
}
