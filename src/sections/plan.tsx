import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SectionProps } from '@/context/AppContext';
import { ViewTabs } from '@/components/common/ViewTabs';
import { pick } from '@/utils/formatters';
import { PLAN_VIEWS, viewParam } from '@/utils/workspace-routes';

export const loadMilestones = () => import('./milestones');
export const loadDesign = () => import('./design');
const Milestones = lazy(() => loadMilestones().then((m) => ({ default: m.Milestones })));
const SoftwareDesign = lazy(() => loadDesign().then((m) => ({ default: m.SoftwareDesign })));

/** Plan page: milestones, then the software design work (use cases and their diagrams). */
export function Plan(props: SectionProps) {
  const [params] = useSearchParams();
  const view = viewParam(params.get('view'), PLAN_VIEWS);
  const { locale } = props.context;
  return <>
    <ViewTabs value={view} label={pick(locale, 'มุมมองแผนงาน', 'Plan views')} views={[
      { id: 'milestones', icon: 'milestone', label: pick(locale, 'เป้าหมาย', 'Milestones') },
      { id: 'usecases', icon: 'list', label: 'Use cases' },
      { id: 'diagrams', icon: 'design', label: pick(locale, 'ไดอะแกรม', 'Diagrams') },
    ]} />
    <Suspense fallback={<div className="section-loader"><span className="loader" /></div>}>
      {view === 'milestones' ? <Milestones {...props} /> : <SoftwareDesign {...props} view={view === 'usecases' ? 'list' : 'diagram'} />}
    </Suspense>
  </>;
}
