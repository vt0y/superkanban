import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { SectionProps } from '@/context/AppContext';
import { toast } from '@/components/toast';
import { useProjectItemsState } from '@/hooks/useProjectItems';
import { subscribeTask } from '@/services/tasks';
import type { Label, Milestone, Task } from '@/types';
import { pick } from '@/utils/formatters';
import { TaskModal, type TaskDefaults } from './TaskModal';

interface OpenOptions { panel?: 'documents'; replace?: boolean }
interface TaskModalApi {
  /** Opens a task by pushing `?task=<id>`; passing the task itself avoids a loading flash. */
  openTask: (task: Task | string, options?: OpenOptions) => void;
  newTask: (defaults?: TaskDefaults) => void;
  isOpen: boolean;
}

const noop = () => undefined;
const TaskModalContext = createContext<TaskModalApi>({ openTask: noop, newTask: noop, isOpen: false });
export const useTaskModal = () => useContext(TaskModalContext);

/**
 * The workspace's single task editor. Any page opens a task with `openTask` (or a `?task=<id>` link) and
 * a new one with `newTask`. Back closes a task opened in-app; a deep-linked one just drops the param.
 */
export function TaskModalProvider({ children, ...section }: SectionProps & { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const taskId = params.get('task') || '';
  const [draft, setDraft] = useState<TaskDefaults | null>(null);
  const [panel, setPanel] = useState<{ id: string; panel: 'documents' } | null>(null);
  const seeds = useRef(new Map<string, Task>());
  const pushed = Boolean((location.state as { taskModal?: boolean } | null)?.taskModal);

  const openTask = useCallback((task: Task | string, options: OpenOptions = {}) => {
    const id = typeof task === 'string' ? task : task.id;
    if (typeof task !== 'string') seeds.current.set(id, task);
    setPanel(options.panel ? { id, panel: options.panel } : null);
    setDraft(null);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('task', id);
      return next;
    }, { state: { taskModal: true }, replace: options.replace });
  }, [setParams]);

  const newTask = useCallback((defaults: TaskDefaults = {}) => setDraft(defaults), []);

  const close = useCallback(() => {
    setDraft(null);
    setPanel(null);
    if (!taskId) return;
    if (pushed) navigate(-1);
    else setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('task');
      return next;
    }, { replace: true });
  }, [taskId, pushed, navigate, setParams]);

  const api = useMemo(() => ({ openTask, newTask, isOpen: Boolean(taskId || draft) }), [openTask, newTask, taskId, draft]);

  return <TaskModalContext.Provider value={api}>
    {children}
    {draft
      ? <HostedTaskModal key="new" {...section} task={null} defaults={draft} onClose={() => setDraft(null)} onCreated={(id) => openTask(id, { panel: 'documents' })} />
      : taskId && <LoadedTaskModal key={taskId} {...section} taskId={taskId} seed={seeds.current.get(taskId)} initialPanel={panel?.id === taskId ? panel.panel : undefined} onClose={close} />}
  </TaskModalContext.Provider>;
}

function LoadedTaskModal({ taskId, seed, initialPanel, onClose, ...section }: SectionProps & { taskId: string; seed?: Task; initialPanel?: 'documents'; onClose: () => void }) {
  const [task, setTask] = useState<Task | undefined>(seed);
  const seen = useRef(Boolean(seed));
  const { locale } = section.context;
  useEffect(() => subscribeTask(section.project.id, taskId, (next) => {
    if (next) { seen.current = true; setTask(next); return; }
    // Deleted from this modal (or elsewhere) after it loaded: just close. Never existed: say so.
    if (!seen.current) toast(pick(locale, 'ไม่พบงานนี้ อาจถูกลบไปแล้ว', 'That task no longer exists'), 'error');
    onClose();
  }, () => {
    toast(pick(locale, 'เปิดงานนี้ไม่ได้', 'Could not open that task'), 'error');
    onClose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [section.project.id, taskId]);
  if (!task) return null;
  return <HostedTaskModal {...section} task={task} initialPanel={initialPanel} onClose={onClose} />;
}

function HostedTaskModal({ context, project, members, role, readOnly, task, defaults, initialPanel, onClose, onCreated }: SectionProps & {
  task: Task | null; defaults?: TaskDefaults; initialPanel?: 'documents'; onClose: () => void; onCreated?: (id: string) => void;
}) {
  const milestones = useProjectItemsState<Milestone>(project.id, 'milestones');
  const labels = useProjectItemsState<Label>(project.id, 'labels');
  // TaskModal reads labels/milestones once to build its form, so wait until both have arrived.
  if (!milestones.loaded || !labels.loaded) return null;
  return <TaskModal task={task} defaults={defaults} projectId={project.id} projectName={project.name} members={members} milestones={milestones.items} labels={labels.items}
    context={context} role={role} readOnly={readOnly} onClose={onClose} onCreated={onCreated} initialPanel={initialPanel} />;
}
