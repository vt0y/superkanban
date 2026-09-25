import { useNavigate } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { AppHeader } from '@/components/layout/AppHeader';
import { Empty } from '@/components/common/Empty';
import { partitionProjects } from '@/utils/project-lists';

export function Home({ context }: { context: AppContextValue }) {
  const navigate = useNavigate();
  const { active, archived } = partitionProjects(context.projects);

  return (
    <>
      <AppHeader context={context} />
      <main className="page-shell home-page">
        <section className="welcome">
          <div>
            <p>
              {new Date().toLocaleDateString(context.locale === 'th' ? 'th-TH' : 'en-US', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
            <h1>
              {context.locale === 'th'
                ? `สวัสดี ${context.profile.displayName.split(' ')[0]} 👋`
                : `Hello, ${context.profile.displayName.split(' ')[0]} 👋`}
            </h1>
            <span>{context.t('greeting')}</span>
          </div>
          <button className="primary" onClick={() => navigate('/new')}>
            ＋ {context.t('newProject')}
          </button>
        </section>
        <section className="home-section">
          <div className="section-title">
            <div>
              <span className="eyebrow">WORKSPACES</span>
              <h2>{context.t('myProjects')}</h2>
            </div>
            <span className="count-badge">{active.length}</span>
          </div>
          {active.length ? (
            <div className="project-grid">
              {active.map((project) => (
                <button
                  key={project.id}
                  className="project-card"
                  onClick={() => navigate(`/p/${project.id}/dashboard`)}
                >
                  <div className="project-color" style={{ background: project.color }}>
                    {project.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="project-card-top">
                    <span className="active-dot">● Active</span>
                    <span>•••</span>
                  </div>
                  <h3>{project.name}</h3>
                  <p>
                    {project.description ||
                      (context.locale === 'th' ? 'ไม่มีคำอธิบาย' : 'No description')}
                  </p>
                  <div className="project-card-footer">
                    <span>
                      👥 {project.memberIds.length} {context.t('members')}
                    </span>
                    <b>เปิดโปรเจกต์ →</b>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon="◫"
              title={context.t('createFirst')}
              description={
                context.locale === 'th'
                  ? 'เริ่มจัดการงาน ทีม และความรู้ใน workspace เดียว'
                  : 'Bring tasks, team and knowledge into one workspace'
              }
              action={
                <button className="primary" onClick={() => navigate('/new')}>
                  ＋ {context.t('newProject')}
                </button>
              }
            />
          )}
        </section>
        {archived.length > 0 && (
          <details className="archived-projects">
            <summary>
              <span>
                <span className="eyebrow">ARCHIVE</span>
                <strong>{context.t('archivedProjects')}</strong>
              </span>
              <span className="count-badge">{archived.length}</span>
            </summary>
            <div className="project-grid">
              {archived.map((project) => (
                <button
                  key={project.id}
                  className="project-card archived"
                  onClick={() => navigate(`/p/${project.id}/dashboard`)}
                >
                  <div className="project-color" style={{ background: project.color }}>
                    {project.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="project-card-top">
                    <span className="archived-badge">📦 {context.t('archived')}</span>
                    <span>•••</span>
                  </div>
                  <h3>{project.name}</h3>
                  <p>
                    {project.description ||
                      (context.locale === 'th' ? 'ไม่มีคำอธิบาย' : 'No description')}
                  </p>
                  <div className="project-card-footer">
                    <span>
                      👥 {project.memberIds.length} {context.t('members')}
                    </span>
                    <b>{context.locale === 'th' ? 'เปิดดู' : 'View'} →</b>
                  </div>
                </button>
              ))}
            </div>
          </details>
        )}
      </main>
    </>
  );
}
