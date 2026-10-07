import { measuredFirestore } from '@/services/firestore-diagnostics';
import {
  Timestamp,
  collection,
  doc,
  query,
  where,
  serverTimestamp,
  type Firestore,
  type Transaction,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth } from '@/config/firebase';
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
export const REBUILD_LEASE_MS = 90_000;
const RENEW_MS = 30_000;
const leaseRef = (store: Firestore, projectId: string) => doc(store, 'projects', projectId, 'summary', 'rebuildLease');

/** Wait for an occupied attempt to finish, or wake when its lease expires. */
function waitForLease(store: Firestore, projectId: string, expiresAt: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let stop: Unsubscribe = () => undefined;
    const timer = setTimeout(() => { stop(); resolve(); }, Math.max(0, expiresAt - Date.now()) + 50);
    stop = onSnapshot(leaseRef(store, projectId), (snapshot) => {
      if (!snapshot.exists() || snapshot.get('expiresAt').toMillis() <= Date.now()) {
        clearTimeout(timer); stop(); resolve();
      }
    }, (error) => { clearTimeout(timer); stop(); reject(error); });
  });
}

/** Across tabs/clients, only the lease owner scans; revision checks still prevent stale commits. */
export function rebuildProjectSummary(projectId: string): Promise<void> {
  const uid = auth?.currentUser?.uid;
  if (!uid) return Promise.reject(new Error('AUTH_REQUIRED'));
  const key = `${uid}:${projectId}`;
  const running = rebuilds.get(key);
  if (running) return running;
  const promise = (async () => {
    const store = database();
    const ref = projectSummaryRef(store, projectId);
    const lease = leaseRef(store, projectId);
    const token = crypto.randomUUID();
    const assertAccount = () => { if (auth?.currentUser?.uid !== uid) throw new Error('SUMMARY_REBUILD_ACCESS_LOST'); };
    for (;;) {
      assertAccount();
      const acquired = await runTransaction(store, async (transaction) => {
        const [current, held] = await Promise.all([transaction.get(ref), transaction.get(lease)]);
        if (current.exists() && !summaryNeedsRebuild(current.data() as ProjectSummary)) return { fresh: true, expiry: 0 };
        const expiry = held.exists() ? held.get('expiresAt').toMillis() : 0;
        if (expiry > Date.now()) return { fresh: false, expiry };
        transaction.set(lease, { ownerUid: uid, token, expiresAt: Timestamp.fromMillis(Date.now() + REBUILD_LEASE_MS) });
        return { fresh: false, expiry: 0 };
      });
      if (acquired.fresh) return;
      if (acquired.expiry) { await waitForLease(store, projectId, acquired.expiry); continue; }
      break;
    }
    let lost = false;
    let renewing = false;
    const owns = (snapshot: { exists(): boolean; get(field: string): any }) => snapshot.exists() && snapshot.get('ownerUid') === uid && snapshot.get('token') === token;
    const timer = setInterval(() => {
      if (renewing || lost) return;
      renewing = true;
      void runTransaction(store, async (transaction) => {
        assertAccount();
        const held = await transaction.get(lease);
        if (!owns(held) || held.get('expiresAt').toMillis() <= Date.now()) throw new Error('SUMMARY_REBUILD_LEASE_LOST');
        transaction.update(lease, { expiresAt: Timestamp.fromMillis(Date.now() + REBUILD_LEASE_MS) });
      }).catch(() => { lost = true; clearInterval(timer); }).finally(() => { renewing = false; });
    }, RENEW_MS);
    // Revocation stops renewals immediately; the rules also reject any in-flight commit.
    const stopAccess = onSnapshot(doc(store, 'memberships', `${projectId}_${uid}`), (snapshot) => { if (!snapshot.exists()) { lost = true; clearInterval(timer); } }, () => { lost = true; clearInterval(timer); });
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assertAccount();
        if (lost) throw new Error('SUMMARY_REBUILD_LEASE_LOST');
        const baseline = await getDoc(ref);
        const revision = baseline.exists() ? baseline.get('updatedAt')?.toMillis?.() ?? 0 : -1;
        const summary = await computeProjectSummary(projectId);
        try {
          await runTransaction(store, async (transaction) => {
            assertAccount();
            const [current, held] = await Promise.all([transaction.get(ref), transaction.get(lease)]);
            if (lost || !owns(held) || held.get('expiresAt').toMillis() <= Date.now()) throw new Error('SUMMARY_REBUILD_LEASE_LOST');
            const currentRevision = current.exists() ? current.get('updatedAt')?.toMillis?.() ?? 0 : -1;
            if (currentRevision !== revision) throw new Error('PROJECT_SUMMARY_REBUILD_RACE');
            transaction.set(ref, { ...summary, rebuiltAt: serverTimestamp(), updatedAt: serverTimestamp() });
            transaction.delete(lease);
          });
          return;
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'PROJECT_SUMMARY_REBUILD_RACE' || attempt === 2) throw error;
        }
      }
    } finally {
      clearInterval(timer);
      stopAccess();
      // Never delete another attempt's lease. Revoked/archived access leaves it to expire.
      if (auth?.currentUser?.uid === uid) await runTransaction(store, async (transaction) => {
        const held = await transaction.get(lease);
        if (owns(held)) transaction.delete(lease);
      }).catch(() => undefined);
    }
  })().finally(() => rebuilds.delete(key));
  rebuilds.set(key, promise);
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
  const key = `${auth?.currentUser?.uid || 'anonymous'}:${projectId}`;
  let shared = summarySubscriptions.get(key);
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
    summarySubscriptions.set(key, shared);
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
      if (shared && !shared.refs) { shared.stop(); summarySubscriptions.delete(key); }
    }, KEEP_ALIVE_MS);
  };
}

export function summaryNeedsRebuild(summary: ProjectSummary | null, now = Date.now()): boolean {
  if (!summary || summary.version !== PROJECT_SUMMARY_VERSION) return true;
  const rebuilt = summary.rebuiltAt?.toMillis?.();
  return !rebuilt || now - rebuilt > SUMMARY_STALE_MS;
}

const { getDoc, getDocs, getCountFromServer, onSnapshot, runTransaction } = measuredFirestore('project-summary');
