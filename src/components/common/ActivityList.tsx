import type { Activity } from '@/types';
import { pick, relativeTime } from '@/utils/formatters';
import { Icon } from './Icon';

export function ActivityList({ items, locale }: { items: Activity[]; locale: string }) {
  return (
    <div className="activity-list">
      {items.map((item) => (
        <div key={item.id}>
          <span className="activity-icon"><Icon name="activity" /></span>
          <div>
            <p>
              <b>{item.actorName}</b> {locale === 'th' ? item.messageTh : item.messageEn}
            </p>
            <small>{relativeTime(item.createdAt?.toDate(), locale)}</small>
          </div>
        </div>
      ))}
      {!items.length && <p className="muted">{pick(locale, 'ยังไม่มีกิจกรรม', 'No activity yet')}</p>}
    </div>
  );
}
