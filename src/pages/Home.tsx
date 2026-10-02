import { useNavigate } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { AppHeader } from '@/components/layout/AppHeader';
import { Empty } from '@/components/common/Empty';
import { Icon } from '@/components/common/Icon';
import type { Project } from '@/types';
import { pick } from '@/utils/formatters';
import { partitionProjects } from '@/utils/project-lists';

export function Home({ context }: { context: AppContextValue }) {
  const navigate = useNavigate();
  const { locale } = context;
  const { active, archived } = partitionProjects(context.projects);
  const firstName = context.profile.displayName.split(' ')[0];

  return (
    <>
      <AppHeader context={context} />
      <main className="page-shell home-page">
        <section className="welcome">
          <div>
            <p>
              {new Date().toLocaleDateString(locale === 'th' ? 'th-TH' : 'en-US', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
            <h1>{pick(locale, `สวัสดี ${firstName}`, `Hello, ${firstName}`)}</h1>
            <span>{context.t('greeting')}</span>
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
        <section className="home-section">
          <div className="section-title">
            <h2>{context.t('myProjects')}</h2>
            <span className="count-badge">{active.length}</span>
          </div>
          {active.length ? (
            <div className="project-grid">
              {active.map((project) => (
                <ProjectCard key={project.id} project={project} context={context} onOpen={() => navigate(`/p/${project.id}/dashboard`)} />
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
              action={
                <button className="primary" onClick={() => navigate('/new')}>
                  <Icon name="add" /> {context.t('newProject')}
                </button>
              }
            />
          )}
        </section>
        {archived.length > 0 && (
          <details className="archived-projects">
            <summary>
              <span>
                <Icon name="chevronRight" />
                <strong>{context.t('archivedProjects')}</strong>
              </span>
              <span className="count-badge">{archived.length}</span>
            </summary>
            <div className="project-grid">
              {archived.map((project) => (
                <ProjectCard key={project.id} project={project} context={context} archived onOpen={() => navigate(`/p/${project.id}/dashboard`)} />
              ))}
            </div>
          </details>
        )}
      </main>
    </>
  );
}

function ProjectCard({ project, context, archived = false, onOpen }: { project: Project; context: AppContextValue; archived?: boolean; onOpen: () => void }) {
  const { locale } = context;
  return (
    <button className={`project-card ${archived ? 'archived' : ''}`} onClick={onOpen}>
      <div className="project-card-head">
        <div className="project-color" style={{ background: project.color }}>
          {project.name.slice(0, 2).toUpperCase()}
        </div>
        {archived ? (
          <span className="chip"><Icon name="archive" /> {context.t('archived')}</span>
        ) : (
          <span className="chip green"><i className="dot" /> Active</span>
        )}
      </div>
      <h3>{project.name}</h3>
      <p>{project.description || pick(locale, 'ไม่มีคำอธิบาย', 'No description')}</p>
      <div className="project-card-footer">
        <span>
          <Icon name="team" /> {project.memberIds.length} {context.t('members')}
        </span>
        <b>
          {archived ? pick(locale, 'เปิดดู', 'View') : pick(locale, 'เปิดโปรเจกต์', 'Open')} <Icon name="arrowRight" />
        </b>
      </div>
    </button>
  );
}
