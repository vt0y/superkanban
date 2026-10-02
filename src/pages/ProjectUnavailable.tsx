import { Link } from 'react-router-dom';
import type { AppContextValue } from '@/context/AppContext';
import { AppHeader } from '@/components/layout/AppHeader';
import { Icon } from '@/components/common/Icon';
import { pick } from '@/utils/formatters';

/**
 * Shown for a project URL the user can't open. Rules deny reading a project to non-members, so
 * "doesn't exist" and "no access" look the same from here; the copy covers both.
 */
export function ProjectUnavailable({ context }: { context: AppContextValue }) {
  const { locale } = context;
  return (
    <>
      <AppHeader context={context} />
      <main className="center-content">
        <div className="invite-card project-unavailable">
          <div className="invite-icon"><Icon name="lock" /></div>
          <h1>{pick(locale, 'เปิดโปรเจกต์นี้ไม่ได้', 'You can’t open this project')}</h1>
          <p>{pick(locale, 'คุณอาจยังไม่ได้เป็นสมาชิก หรือโปรเจกต์ถูกลบไปแล้ว ขอลิงก์เชิญใหม่จากเจ้าของโปรเจกต์', 'You may not be a member yet, or the project no longer exists. Ask the project owner for an invite link.')}</p>
          <Link className="primary wide" to="/">
            <Icon name="home" /> {pick(locale, 'กลับหน้าแรก', 'Back to home')}
          </Link>
        </div>
      </main>
    </>
  );
}
