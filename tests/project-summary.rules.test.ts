import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProjectSummary } from '@/utils/project-summary';
import { googleClaims } from './google-claims';

const state = vi.hoisted(() => ({ db: null as Firestore | null, auth: { currentUser: { uid: 'member' } }, scans: 0, gate: null as Promise<void> | null }));
vi.mock('@/config/firebase', () => ({ get db() { return state.db; }, auth: state.auth }));
vi.mock('firebase/firestore', async (original) => {
  const sdk = await original<typeof import('firebase/firestore')>();
  return { ...sdk, getDocs: async (...args: Parameters<typeof sdk.getDocs>) => {
    state.scans++;
    if (state.gate) await state.gate;
    return sdk.getDocs(...args);
  } };
});
let environment: RulesTestEnvironment;
const projectId = 'summary-project';
const summaryRef = () => doc(state.db!, 'projects', projectId, 'summary', 'main');
const leaseRef = () => doc(state.db!, 'projects', projectId, 'summary', 'rebuildLease');

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: 'summary-coordination-test', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
afterAll(async () => environment.cleanup());
beforeEach(async () => {
  vi.resetModules(); state.scans = 0; state.gate = null; state.auth.currentUser = { uid: 'member' };
  await environment.clearFirestore();
  state.db = environment.authenticatedContext('member', googleClaims('member', 'member@example.com')).firestore();
  await environment.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', projectId), { memberIds: ['member'], archived: false });
    await setDoc(doc(db, 'memberships', `${projectId}_member`), { projectId, userId: 'member', role: 'member' });
    await setDoc(doc(db, 'projects', projectId, 'tasks', 'task'), { title: 'Task', status: 'todo', priority: 'medium', assigneeIds: ['member'], dueDate: '', milestoneId: '', createdBy: 'member' });
  });
});

async function until(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error('Timed out waiting for rebuild');
}

describe('summary rebuild coordination in Firestore', () => {
  it('two independent clients scan once and wait for the same rebuilt summary', async () => {
    const first = await import('@/services/project-summary');
    vi.resetModules();
    const second = await import('@/services/project-summary');
    await Promise.all([first.rebuildProjectSummary(projectId), second.rebuildProjectSummary(projectId)]);
    expect(state.scans).toBe(2); // One open-task query and one milestone query.
    expect((await getDoc(summaryRef())).data()?.openCount).toBe(1);
    expect((await getDoc(leaseRef())).exists()).toBe(false);
  });

  it('renews the same attempt during a slow scan and releases it on completion', async () => {
    const service = await import('@/services/project-summary');
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => { release = resolve; });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const pending = service.rebuildProjectSummary(projectId);
      await until(() => state.scans === 2);
      const before = (await getDoc(leaseRef())).data()!;
      await vi.advanceTimersByTimeAsync(30_000);
      await until(async () => (await getDoc(leaseRef())).get('expiresAt').toMillis() > before.expiresAt.toMillis());
      expect((await getDoc(leaseRef())).get('token')).toBe(before.token);
      state.gate = null; release(); await pending;
      expect((await getDoc(leaseRef())).exists()).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('rescans rather than overwriting a concurrent summary revision', async () => {
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'projects', projectId, 'summary', 'main'), { ...emptyProjectSummary(), rebuiltAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) }));
    const service = await import('@/services/project-summary');
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = service.rebuildProjectSummary(projectId);
    await until(() => state.scans === 2);
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'projects', projectId, 'summary', 'main'), { ...emptyProjectSummary(), rebuiltAt: Timestamp.fromMillis(1), updatedAt: Timestamp.now() }));
    state.gate = null; release(); await pending;
    expect(state.scans).toBe(4);
    expect((await getDoc(summaryRef())).get('openCount')).toBe(1);
  });

  it('refuses to commit or release after another attempt takes ownership', async () => {
    const service = await import('@/services/project-summary');
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = service.rebuildProjectSummary(projectId);
    const rejection = expect(pending).rejects.toThrow('SUMMARY_REBUILD_LEASE_LOST');
    await until(() => state.scans === 2);
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'projects', projectId, 'summary', 'rebuildLease'), { ownerUid: 'member', token: 'replacement', expiresAt: Timestamp.fromMillis(Date.now() + 90_000) }));
    state.gate = null; release(); await rejection;
    expect((await getDoc(summaryRef())).exists()).toBe(false);
    expect((await getDoc(leaseRef())).get('token')).toBe('replacement');
  });

  it('maintains summaries atomically under concurrent task edits', async () => {
    const service = await import('@/services/project-summary');
    await service.rebuildProjectSummary(projectId);
    const items = await import('@/services/work-items');
    await Promise.all([
      items.updateWorkItem(projectId, 'tasks', 'task', { title: 'Renamed' }),
      items.updateWorkItem(projectId, 'tasks', 'task', { assigneeIds: [], dueDate: '2026-12-01' }),
    ]);
    const task = (await getDoc(doc(state.db!, 'projects', projectId, 'tasks', 'task'))).data()!;
    const summary = (await getDoc(summaryRef())).data()!;
    expect(summary.openTasks.task).toMatchObject({ title: task.title, assigneeIds: task.assigneeIds, dueDate: task.dueDate });
    expect(summary.openCount).toBe(1);
    await items.updateWorkItem(projectId, 'tasks', 'task', { status: 'done' });
    const done = (await getDoc(summaryRef())).data()!;
    expect(done.openCount).toBe(0); expect(done.doneTotal).toBe(1);
  });

  it('takes over an expired lease left by an abandoned client', async () => {
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'projects', projectId, 'summary', 'rebuildLease'), { ownerUid: 'abandoned', token: 'old', expiresAt: Timestamp.fromMillis(1) }));
    const service = await import('@/services/project-summary');
    await service.rebuildProjectSummary(projectId);
    expect(state.scans).toBe(2);
    expect((await getDoc(leaseRef())).exists()).toBe(false);
  });
});
