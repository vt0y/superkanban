import { Link } from 'react-router-dom';
import { Icon } from '@/components/common/Icon';
import type { Locale } from '@/types';
import { pick } from '@/utils/formatters';

export function TarotNav({ locale, onHistory, onToggleLocale, onSignOut }: { locale: Locale; onHistory: () => void; onToggleLocale: () => void; onSignOut: () => void }) {
  return (
    <header className="arc-nav">
      <Link to="/" className="arc-nav-back" aria-label={pick(locale, 'กลับไป ProjectSpace', 'Back to ProjectSpace')}>
        <Icon name="arrowLeft" /><span>ProjectSpace</span>
      </Link>
      <div className="arc-wordmark">
        <Icon name="moonStar" />
        <span><strong>ARCANA</strong><small>AI TAROT</small></span>
      </div>
      <div className="arc-nav-actions">
        <button type="button" onClick={onHistory} aria-label={pick(locale, 'ประวัติคำทำนาย', 'Reading history')}>
          <Icon name="history" /><span>{pick(locale, 'ประวัติ', 'History')}</span>
        </button>
        <button type="button" onClick={onToggleLocale} aria-label={pick(locale, 'Switch to English', 'เปลี่ยนเป็นภาษาไทย')}>
          <Icon name="globe" /><span>{locale === 'th' ? 'EN' : 'ไทย'}</span>
        </button>
        <button type="button" onClick={onSignOut} aria-label={pick(locale, 'ออกจากระบบ', 'Sign out')} title={pick(locale, 'ออกจากระบบ', 'Sign out')}>
          <Icon name="logout" />
        </button>
      </div>
    </header>
  );
}
