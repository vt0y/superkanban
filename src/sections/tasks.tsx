import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SectionProps } from '@/context/AppContext';
import { ViewTabs } from '@/components/common/ViewTabs';
import { pick } from '@/utils/formatters';
import { TASK_VIEWS, viewParam } from '@/utils/workspace-routes';
import { Board } from './board';

export const loadCalendar = () => import('./calendar');
const Calendar = lazy(() => loadCalendar().then((m) => ({ default: m.Calendar })));

/** Tasks page: one set of tasks seen as a board, a table or a calendar. */
export function Tasks(props: SectionProps) {
  const [params] = useSearchParams();
  const view = viewParam(params.get('view'), TASK_VIEWS);
  const { locale } = props.context;
  return <>
    <ViewTabs value={view} label={pick(locale, 'มุมมองงาน', 'Task views')} views={[
      { id: 'board', icon: 'board', label: pick(locale, 'บอร์ด', 'Board') },
      { id: 'table', icon: 'table', label: pick(locale, 'ตาราง', 'Table') },
      { id: 'calendar', icon: 'calendar', label: pick(locale, 'ปฏิทิน', 'Calendar') },
    ]} />
    {view === 'calendar'
      ? <Suspense fallback={<div className="section-loader"><span className="loader" /></div>}><Calendar {...props} /></Suspense>
      : <Board {...props} />}
  </>;
}
