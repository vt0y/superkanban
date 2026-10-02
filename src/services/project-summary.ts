import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Transaction,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Milestone, ProjectSummary, Task } from '@/types';
import { buildProjectSummary, OPEN_STATUSES, PROJECT_SUMMARY_VERSION } from '@/utils/project-summary';
import { database, withId } from './helpers';

export const SUMMARY_MISSING = 'PROJECT_SUMMARY_MISSING';
export const SUMMARY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export const projectSummaryRef = (store: Firestore, projectId: string) => doc(store, 'projects', projectId, 'summary', 'main');

/** Reads the current summary inside the same transaction as a work-item mutation. */
export async function readSummaryForTransaction(transaction: Transaction, store: Firestore, projectId: string): Promise<ProjectSummary> {
  const snapshot = await transaction.get(projectSummaryRef(store, projectId));
  if (!snapshot.exists() || snapshot.data().version !== PROJECT_SUMMARY_VERSION) throw new Error(SUMMARY_MISSING);
  return snapshot.data() as ProjectSummary;
}

export function writeSummaryInTransaction(transaction: Transaction, store: Firestore, projectId: string, summary: ProjectSummary) {
  transaction.set(projectSummaryRef(store, projectId), {
    ...summary,
    rebuiltAt: summary.rebuiltAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Computes a project's summary from Firestore without writing it: open tasks and milestones as
 * documents, completed tasks only as count aggregations (about 1 read per 1,000 counted). Used by the
 * rebuild, and directly for archived projects, whose summary can't be written.
 */
export async function computeProjectSummary(projectId: string): Promise<ProjectSummary> {
  const store = database();
  const tasks = collection(store, 'projects', projectId, 'tasks');
  const [openSnapshot, milestoneSnapshot, doneSnapshot] = await Promise.all([
    getDocs(query(tasks, where('status', 'in', [...OPEN_STATUSES]))),
    getDocs(collection(store, 'projects', projectId, 'milestones')),
    getCountFromServer(query(tasks, where('status', '==', 'done'))),
  ]);
  const milestones = milestoneSnapshot.docs.map((item) => withId<Milestone>(item));
  const byMilestone = Object.fromEntries(await Promise.all(milestones.map(async (milestone) => {
    const counted = await getCountFromServer(query(tasks, where('milestoneId', '==', milestone.id), where('status', '==', 'done')));
    return [milestone.id, counted.data().count] as const;
  })));
  return buildProjectSummary(openSnapshot.docs.map((item) => withId<Task>(item)), milestones, { total: doneSnapshot.data().count, byMilestone });
}

const rebuilds = new Map<string, Promise<void>>();

/** Full reconciliation for legacy, version-mismatched or periodically stale summaries. */
export function rebuildProjectSummary(projectId: string): Promise<void> {
  const running = rebuilds.get(projectId);
  if (running) return running;
  const promise = (async () => {
    const store = database();
    const ref = projectSummaryRef(store, projectId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const baseline = await getDoc(ref);
      const baselineRevision = baseline.exists() ? baseline.get('updatedAt')?.toMillis?.() ?? 0 : -1;
      const summary = await computeProjectSummary(projectId);
      try {
        await runTransaction(store, async (transaction) => {
          const current = await transaction.get(ref);
          const currentRevision = current.exists() ? current.get('updatedAt')?.toMillis?.() ?? 0 : -1;
          if (currentRevision !== baselineRevision) throw new Error('PROJECT_SUMMARY_REBUILD_RACE');
          transaction.set(ref, { ...summary, rebuiltAt: serverTimestamp(), updatedAt: serverTimestamp() });
        });
        return;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'PROJECT_SUMMARY_REBUILD_RACE' || attempt === 2) throw error;
      }
    }
  })().finally(() => rebuilds.delete(projectId));
  rebuilds.set(projectId, promise);
  return promise;
}

export async function withProjectSummaryRetry(projectId: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== SUMMARY_MISSING) throw error;
    await rebuildProjectSummary(projectId);
    await operation();
  }
}

interface SharedSummary {
  refs: number;
  latest: ProjectSummary | null | undefined;
  listeners: Set<(summary: ProjectSummary | null) => void>;
  errorListeners: Set<(error: Error) => void>;
  stop: Unsubscribe;
  timer: ReturnType<typeof setTimeout> | null;
}
const summarySubscriptions = new Map<string, SharedSummary>();
const KEEP_ALIVE_MS = 30_000;

/** One shared live document listener per project, kept warm briefly across routes. */
export function subscribeProjectSummary(projectId: string, callback: (summary: ProjectSummary | null) => void, onError?: (error: Error) => void): Unsubscribe {
  let shared = summarySubscriptions.get(projectId);
  if (!shared) {
    const listeners = new Set<(summary: ProjectSummary | null) => void>();
    const created: SharedSummary = {
      refs: 0,
      latest: undefined,
      listeners,
      errorListeners: new Set(),
      timer: null,
      stop: () => undefined,
    };
    created.stop = onSnapshot(projectSummaryRef(database(), projectId), (snapshot) => {
      created.latest = snapshot.exists() ? snapshot.data() as ProjectSummary : null;
      listeners.forEach((listener) => listener(created.latest!));
    }, (error) => created.errorListeners.forEach((listener) => listener(error)));
    shared = created;
    summarySubscriptions.set(projectId, shared);
  }
  if (shared.timer) { clearTimeout(shared.timer); shared.timer = null; }
  shared.refs += 1;
  shared.listeners.add(callback);
  if (onError) shared.errorListeners.add(onError);
  if (shared.latest !== undefined) callback(shared.latest);
  return () => {
    if (!shared) return;
    shared.listeners.delete(callback);
    if (onError) shared.errorListeners.delete(onError);
    shared.refs = Math.max(0, shared.refs - 1);
    if (!shared.refs) shared.timer = setTimeout(() => {
      if (shared && !shared.refs) { shared.stop(); summarySubscriptions.delete(projectId); }
    }, KEEP_ALIVE_MS);
  };
}

export function summaryNeedsRebuild(summary: ProjectSummary | null, now = Date.now()): boolean {
  if (!summary || summary.version !== PROJECT_SUMMARY_VERSION) return true;
  const rebuilt = summary.rebuiltAt?.toMillis?.();
  return !rebuilt || now - rebuilt > SUMMARY_STALE_MS;
}
