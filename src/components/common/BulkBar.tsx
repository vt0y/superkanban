import type { ReactNode } from 'react';
import { pick } from '@/utils/formatters';
import { Icon } from './Icon';

export function BulkBar({
  count,
  locale,
  onClear,
  children,
}: {
  count: number;
  locale: string;
  onClear: () => void;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <div className="bulk-bar" role="toolbar">
      <span className="bulk-count">
        <b>{count}</b> {pick(locale, 'รายการที่เลือก', 'selected')}
      </span>
      <div className="bulk-actions">{children}</div>
      <button type="button" className="bulk-clear" onClick={onClear} title={pick(locale, 'ยกเลิกการเลือก', 'Clear selection')} aria-label={pick(locale, 'ยกเลิกการเลือก', 'Clear selection')}>
        <Icon name="close" />
      </button>
    </div>
  );
}
