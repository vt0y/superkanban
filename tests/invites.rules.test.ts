import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayUnion, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptInvite, createInvite, setInviteStatus, updateInviteSettings } from '@/services/invites';
import type { Project } from '@/types';

// Exercise the real client transaction against the rules, with a deterministic
// competing management write after the first invite read when requested.
const state = vi.hoisted(() => ({ db: null as Firestore | null, afterRead: null as (() => Promise<void>) | null }));
vi.mock('@/services/helpers', () => ({ database: () => state.db, withId: (snap: { id: string; data: () => unknown }) => ({ id: snap.id, ...snap.data() as object }) }));
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, runTransaction: (db: Firestore, callback: Parameters<typeof actual.runTransaction>[1]) => actual.runTransaction(db, (transaction) => callback(new Proxy(transaction, {
    get(target, key) {
      if (key === 'get') return async (ref: Parameters<typeof transaction.get>[0]) => {
        const snap = await target.get(ref);
        if (ref.path.startsWith('invites/') && state.afterRead) {
          const hook = state.afterRead; state.afterRead = null; await hook();
        }
        return snap;
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }))) };
});

let env: RulesTestEnvironment;
const projectId = 'invite-project';
const user = (uid: string) => ({ uid, email: `${uid}@example.com`, displayName: uid, photoURL: '' }) as User;
// RulesTestContext exposes the compat type; modular functions unwrap its delegate.
const dbFor = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore() as unknown as Firestore;
const useDb = (uid: string) => { state.db = dbFor(uid); return state.db; };
const accept = (uid: string) => { useDb(uid); return acceptInvite('link', user(uid)); };
const future = () => Timestamp.fromMillis(Date.now() + 86400000);
const settings = () => ({ name: 'Hiring', role: 'member' as const, expiresAt: future(), maxUses: null as number | null });
const seedInvite = async (extra: Record<string, unknown> = {}) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'invites', 'link'), {
  projectId, projectName: 'Alpha', role: 'member', status: 'active', createdBy: 'owner', expiresAt: future(), ...extra,
}));
const readInvite = () => getDoc(doc(dbFor('owner'), 'invites', 'link'));

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'dynamic-invites-test', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  state.afterRead = null;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', projectId), { ownerId: 'owner', memberIds: ['owner', 'admin', 'member'], name: 'Alpha', archived: false });
    for (const role of ['owner', 'admin', 'member']) await setDoc(doc(db, 'memberships', `${projectId}_${role}`), { projectId, userId: role, role, email: `${role}@example.com` });
  });
  await seedInvite();
});

function joinBatch(uid: string, count: number | undefined, extra: Record<string, unknown> = {}, project = true) {
  const db = dbFor(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, 'memberships', `${projectId}_${uid}`), { projectId, userId: uid, role: 'member', email: `${uid}@example.com`, inviteId: 'link', ...extra });
  if (count !== undefined) batch.update(doc(db, 'invites', 'link'), { usesCount: count, updatedAt: serverTimestamp() });
  if (project) batch.update(doc(db, 'projects', projectId), { memberIds: arrayUnion(uid) });
  return batch.commit();
}

describe('dynamic invitation transactions and rules', () => {
  it('joins a legacy link, counts once for duplicate clicks, and preserves existing role', async () => {
    const results = await Promise.all([accept('guest'), accept('guest')]);
    expect(results.map((result) => result.alreadyMember).sort()).toEqual([false, true]);
    expect((await readInvite()).data()?.usesCount).toBe(1);
    await updateDoc(doc(dbFor('owner'), 'memberships', `${projectId}_guest`), { role: 'admin' });
    expect(await accept('guest')).toEqual({ projectId, alreadyMember: true });
    expect((await getDoc(doc(dbFor('guest'), 'memberships', `${projectId}_guest`))).data()?.role).toBe('admin');
    expect((await readInvite()).data()?.usesCount).toBe(1);
  });
  it('existing members can open unavailable links without consuming uses', async () => {
    await seedInvite({ status: 'revoked', usesCount: 4, maxUses: 1, expiresAt: Timestamp.fromMillis(1) });
    expect((await accept('member')).alreadyMember).toBe(true);
    expect((await readInvite()).data()?.usesCount).toBe(4);
  });
  it('a member who leaves consumes a new use when rejoining', async () => {
    await accept('guest');
    const db = dbFor('guest');
    const leave = writeBatch(db);
    leave.delete(doc(db, 'memberships', `${projectId}_guest`));
    const { arrayRemove } = await import('firebase/firestore');
    leave.update(doc(db, 'projects', projectId), { memberIds: arrayRemove('guest') });
    await assertSucceeds(leave.commit());
    expect((await accept('guest')).alreadyMember).toBe(false);
    expect((await readInvite()).data()?.usesCount).toBe(2);
  });
  it('only one concurrent join obtains the last slot', async () => {
    await seedInvite({ maxUses: 1, expiresAt: null });
    const results = await Promise.allSettled([accept('alice'), accept('bob')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await readInvite()).data()?.usesCount).toBe(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toBe('INVITE_EXHAUSTED');
  });
  it.each(['paused', 'revoked', 'expired', 'exhausted'])('rejects %s links', async (status) => {
    await seedInvite(status === 'expired' ? { expiresAt: Timestamp.fromMillis(1) } : status === 'exhausted' ? { maxUses: 1, usesCount: 1 } : { status });
    await expect(accept('guest')).rejects.toThrow(`INVITE_${status.toUpperCase()}`);
    await assertFails(joinBatch('guest', status === 'exhausted' ? 2 : 1));
  });
  it('reads the current role and revalidates a role changed during acceptance', async () => {
    state.afterRead = () => updateDoc(doc(dbFor('owner'), 'invites', 'link'), { role: 'admin', updatedAt: serverTimestamp() });
    await accept('guest');
    expect((await getDoc(doc(dbFor('guest'), 'memberships', `${projectId}_guest`))).data()?.role).toBe('admin');
  });
  it.each(['paused', 'revoked', 'limit'])('revalidates concurrent %s management', async (change) => {
    state.afterRead = () => updateDoc(doc(dbFor('owner'), 'invites', 'link'), {
      ...(change === 'limit' ? { maxUses: 1 } : { status: change }), updatedAt: serverTimestamp(),
    });
    if (change === 'limit') {
      await seedInvite({ usesCount: 1 });
      await expect(accept('guest')).rejects.toThrow('INVITE_EXHAUSTED');
    } else await expect(accept('guest')).rejects.toThrow(`INVITE_${change.toUpperCase()}`);
  });
  it('requires membership, counter, and project membership together and rejects counter tampering', async () => {
    await assertFails(joinBatch('guest', undefined));
    await assertFails(joinBatch('guest', 2));
    await assertFails(joinBatch('guest', 1, {}, false));
    await assertFails(joinBatch('guest', 1, { role: 'admin' }));
    await assertFails(joinBatch('guest', 1, { githubPermission: 'admin' }));
    await assertFails(updateDoc(doc(dbFor('guest'), 'invites', 'link'), { usesCount: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(dbFor('owner'), 'invites', 'link'), { usesCount: 1, updatedAt: serverTimestamp() }));
    await assertSucceeds(joinBatch('guest', 1));
    await assertFails(updateDoc(doc(dbFor('guest'), 'invites', 'link'), { usesCount: 2, updatedAt: serverTimestamp() }));
  });
  it('enforces management privileges, supports settings edits, Never/unlimited, pause/resume, and permanent revoke', async () => {
    useDb('admin');
    const id = await createInvite({ id: projectId, name: 'Alpha' } as Project, user('admin'), settings());
    await updateInviteSettings(id, { ...settings(), expiresAt: null, maxUses: 1 });
    await setInviteStatus(id, 'paused'); await setInviteStatus(id, 'active');
    await expect(updateInviteSettings(id, { ...settings(), role: 'admin' })).rejects.toMatchObject({ code: 'permission-denied' });
    useDb('owner'); await updateInviteSettings(id, { ...settings(), role: 'admin' });
    useDb('admin');
    await expect(updateInviteSettings(id, { ...settings(), role: 'member' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateInviteSettings(id, { ...settings(), role: 'admin' })).rejects.toMatchObject({ code: 'permission-denied' });
    await setInviteStatus(id, 'paused'); await setInviteStatus(id, 'active'); await setInviteStatus(id, 'revoked');
    useDb('owner'); await expect(setInviteStatus(id, 'active')).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateInviteSettings(id, settings())).rejects.toMatchObject({ code: 'permission-denied' });
    useDb('member'); await expect(createInvite({ id: projectId, name: 'Alpha' } as Project, user('member'), settings())).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('extends expired links and increases exhausted limits without changing their URL', async () => {
    await seedInvite({ expiresAt: Timestamp.fromMillis(1), usesCount: 2 });
    useDb('owner'); await updateInviteSettings('link', { ...settings(), maxUses: 1 });
    await expect(accept('guest')).rejects.toThrow('INVITE_EXHAUSTED');
    useDb('owner'); await updateInviteSettings('link', { ...settings(), maxUses: 3 });
    await accept('guest');
    expect((await readInvite()).data()?.usesCount).toBe(3);
    useDb('owner'); await updateInviteSettings('link', { ...settings(), maxUses: null, expiresAt: null });
    await accept('another');
  });
  it('allows missing membership transaction reads while restricting existing records and listing', async () => {
    const db = dbFor('outsider');
    await assertSucceeds(getDoc(doc(db, 'memberships', `${projectId}_outsider`)));
    await assertFails(getDoc(doc(db, 'memberships', `${projectId}_member`)));
    await assertFails(getDocs(query(collection(db, 'memberships'), where('projectId', '==', projectId))));
    await assertSucceeds(getDocs(query(collection(dbFor('member'), 'memberships'), where('projectId', '==', projectId))));
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'projects', projectId), { memberIds: ['owner', 'admin'] }));
    await assertSucceeds(getDoc(doc(dbFor('member'), 'memberships', `${projectId}_member`)));
  });
  it('rejects archived project joins and settings updates and keeps domain restrictions', async () => {
    await updateDoc(doc(dbFor('owner'), 'projects', projectId), { archived: true });
    await expect(accept('guest')).rejects.toMatchObject({ code: 'permission-denied' });
    useDb('owner'); await expect(updateInviteSettings('link', settings())).rejects.toMatchObject({ code: 'permission-denied' });
    await assertFails(getDoc(doc(env.authenticatedContext('outsider', { email: 'outsider@other.com' }).firestore(), 'invites', 'link')));
  });
});
