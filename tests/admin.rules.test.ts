import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, documentId, query, serverTimestamp, setDoc, startAfter, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { googleClaims } from './google-claims';

let environment: RulesTestEnvironment;
const db = (uid: string) => environment.authenticatedContext(uid, googleClaims(uid, `${uid}@example.com`)).firestore();
beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: 'admin-management-test', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
afterAll(async () => environment.cleanup());
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (ctx) => {
    const store = ctx.firestore();
    for (const uid of ['site-owner', 'site-admin', 'owner', 'project-admin', 'member']) {
      await setDoc(doc(store, 'users', uid), { displayName: uid, email: `${uid}@example.com`, locale: 'en', theme: 'system' });
    }
    await setDoc(doc(store, 'siteAdmins', 'site-owner'), { role: 'owner' });
    await setDoc(doc(store, 'siteAdmins', 'site-admin'), { role: 'admin' });
    await setDoc(doc(store, 'projects', 'p1'), { name: 'Project', archived: false, ownerId: 'owner', memberIds: ['owner', 'project-admin', 'member'] });
    for (const [uid, role] of [['owner', 'owner'], ['project-admin', 'admin'], ['member', 'member']]) {
      await setDoc(doc(store, 'memberships', `p1_${uid}`), { projectId: 'p1', userId: uid, role });
    }
    await setDoc(doc(store, 'projects', 'p1', 'tasks', 't1'), { title: 'Private task', createdBy: 'member', status: 'todo' });
    await setDoc(doc(store, 'siteFeedback', 'f1'), { userId: 'member', status: 'open' });
    await setDoc(doc(store, 'users', 'member', 'tarotReadings', 'r1'), { createdBy: 'member' });
  });
});
const archiveWrite = (actor: string, archived: boolean, reason = 'Abuse review') => updateDoc(doc(db(actor), 'projects', 'p1'), { archived, moderationArchived: archived, moderationReason: archived ? reason : '', moderationUpdatedBy: actor, moderationUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() });
const grantWrite = (actor: string, uid: string, role = 'admin') => {
  const store = db(actor); const batch = writeBatch(store);
  batch.set(doc(store, 'siteAdmins', uid), { role, grantedBy: actor, grantedAt: serverTimestamp() });
  batch.update(doc(store, 'users', uid), { staffUpdatedBy: actor, staffUpdatedAt: serverTimestamp() });
  return batch.commit();
};
const revokeWrite = (actor: string, uid: string) => {
  const store = db(actor); const batch = writeBatch(store);
  batch.delete(doc(store, 'siteAdmins', uid));
  batch.update(doc(store, 'users', uid), { staffUpdatedBy: actor, staffUpdatedAt: serverTimestamp() });
  return batch.commit();
};
const statusWrite = (actor: string, uid: string, accountStatus: string) => updateDoc(doc(db(actor), 'users', uid), { accountStatus, statusUpdatedAt: serverTimestamp(), statusUpdatedBy: actor });

describe('site management authorization', () => {
  it('lets staff read and count real tasks and milestones but not the summary or work-item writes', async () => {
    await environment.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'projects', 'p1', 'summary', 'main'), { version: 1, openCount: 1, openTasks: { t1: { title: 'Private task' } } });
      await setDoc(doc(ctx.firestore(), 'projects', 'p1', 'milestones', 'm1'), { title: 'Milestone', status: 'active', createdBy: 'member' });
    });
    for (const actor of ['site-owner', 'site-admin']) {
      const store = db(actor);
      await assertSucceeds(getDoc(doc(store, 'projects', 'p1', 'tasks', 't1')));
      await assertSucceeds(getDocs(query(collection(store, 'projects', 'p1', 'tasks'), orderBy(documentId()), limit(51))));
      await assertSucceeds(getDocs(collection(store, 'projects', 'p1', 'milestones')));
      expect((await assertSucceeds(getCountFromServer(query(collection(store, 'projects', 'p1', 'tasks'), limit(5001))))).data().count).toBe(1);
      await assertFails(getDoc(doc(store, 'projects', 'p1', 'summary', 'main')));
      await assertFails(getDoc(doc(store, 'projects', 'p1', 'summary', 'rebuildLease')));
      await assertFails(updateDoc(doc(store, 'projects', 'p1', 'summary', 'main'), { openCount: 9 }));
      await assertFails(updateDoc(doc(store, 'projects', 'p1', 'tasks', 't1'), { title: 'Changed' }));
      await assertFails(setDoc(doc(store, 'projects', 'p1', 'milestones', 'm2'), { title: 'Injected', status: 'active', createdBy: actor }));
    }
    await assertSucceeds(getDoc(doc(db('member'), 'projects', 'p1', 'summary', 'main')));
    await assertFails(getDoc(doc(db('outsider'), 'projects', 'p1', 'summary', 'main')));
    await assertFails(getDoc(doc(db('outsider'), 'projects', 'p1', 'tasks', 't1')));
  });
  it('accepts only Google-created accounts with verified emails, even after a GitHub re-auth', async () => {
    const as = (uid: string, claims: object) => environment.authenticatedContext(uid, { ...googleClaims(uid, `${uid}@example.com`), ...claims }).firestore();
    const unverified = (uid: string) => as(uid, { email_verified: false });
    const githubOnly = (uid: string) => as(uid, { firebase: { sign_in_provider: 'github.com', identities: { 'github.com': ['gh-1'] } } });
    const reauthed = (uid: string) => as(uid, { firebase: { sign_in_provider: 'github.com', identities: { 'google.com': [uid], 'github.com': ['gh-1'] } } });
    for (const store of [unverified('member'), githubOnly('member')]) {
      await assertFails(getDoc(doc(store, 'users', 'member')));
      await assertFails(getDoc(doc(store, 'projects', 'p1')));
      await assertFails(getDoc(doc(store, 'projects', 'p1', 'tasks', 't1')));
    }
    await assertFails(setDoc(doc(githubOnly('newcomer'), 'users', 'newcomer'), { displayName: 'New', email: 'newcomer@example.com', locale: 'en', theme: 'system' }));
    await assertSucceeds(getDoc(doc(reauthed('member'), 'projects', 'p1', 'tasks', 't1')));
    for (const store of [unverified('site-owner'), githubOnly('site-owner')]) {
      const batch = writeBatch(store);
      batch.set(doc(store, 'siteAdmins', 'member'), { role: 'admin', grantedBy: 'site-owner', grantedAt: serverTimestamp() });
      batch.update(doc(store, 'users', 'member'), { staffUpdatedBy: 'site-owner', staffUpdatedAt: serverTimestamp() });
      await assertFails(batch.commit());
    }
    await assertSucceeds(grantWrite('site-owner', 'member'));
  });
  it('locks moderation archives until site staff restore them and preserves legacy owner restores', async () => {
    await assertSucceeds(archiveWrite('site-admin', true, 'Review\nspam'));
    await assertFails(updateDoc(doc(db('owner'), 'projects', 'p1'), { archived: false, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('owner'), 'projects', 'p1'), { archived: false, moderationArchived: false, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('member'), 'projects', 'p1', 'tasks', 't1'), { title: 'Changed' }));
    await assertSucceeds(archiveWrite('site-owner', false));
    await assertSucceeds(updateDoc(doc(db('owner'), 'projects', 'p1'), { archived: true, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db('owner'), 'projects', 'p1'), { archived: false, updatedAt: serverTimestamp() }));
  });
  it('rejects missing reasons, forged actors and times, and member-written moderation fields', async () => {
    await assertFails(archiveWrite('site-admin', true, ''));
    await assertFails(archiveWrite('site-admin', true, ' \n\t '));
    await assertFails(archiveWrite('site-admin', true, 'x'.repeat(1001)));
    await assertFails(updateDoc(doc(db('site-admin'), 'projects', 'p1'), { archived: true, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('owner'), 'projects', 'p1'), { moderationArchived: false }));
    await assertFails(updateDoc(doc(db('site-admin'), 'projects', 'p1'), { archived: true, moderationArchived: true, moderationReason: 'Abuse', moderationUpdatedBy: 'site-owner', moderationUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  it('allows only owners to grant/revoke admins, protecting owner roles, self, and suspended targets', async () => {
    for (const actor of ['site-admin', 'owner', 'member']) await assertFails(grantWrite(actor, 'project-admin'));
    await assertFails(grantWrite('site-owner', 'project-admin', 'owner'));
    await assertFails(grantWrite('site-owner', 'site-owner'));
    await assertFails(grantWrite('site-owner', 'missing'));
    await assertSucceeds(statusWrite('site-owner', 'member', 'suspended'));
    await assertFails(grantWrite('site-owner', 'member'));
    await assertSucceeds(grantWrite('site-owner', 'project-admin'));
    await assertFails(statusWrite('site-owner', 'project-admin', 'suspended'));
    await assertFails(deleteDoc(doc(db('site-admin'), 'siteAdmins', 'project-admin')));
    await assertFails(deleteDoc(doc(db('site-owner'), 'siteAdmins', 'site-owner')));
    await assertFails(deleteDoc(doc(db('site-owner'), 'siteAdmins', 'project-admin')));
    await assertSucceeds(revokeWrite('site-owner', 'project-admin'));
    expect((await getDoc(doc(db('site-owner'), 'users', 'project-admin'))).data()).toMatchObject({ staffUpdatedBy: 'site-owner' });
    await assertFails(getDocs(collection(db('project-admin'), 'users')));
  });
  it('rejects a batch that grants admin and suspends the same account', async () => {
    const store = db('site-owner');
    const batch = writeBatch(store);
    batch.set(doc(store, 'siteAdmins', 'member'), { role: 'admin', grantedBy: 'site-owner', grantedAt: serverTimestamp() });
    batch.update(doc(store, 'users', 'member'), { accountStatus: 'suspended', statusUpdatedBy: 'site-owner', statusUpdatedAt: serverTimestamp() });
    await assertFails(batch.commit());
  });
  it.each(['site-owner', 'site-admin'])('allows %s to manage ordinary accounts and project archive status', async (actor) => {
    await assertSucceeds(getDocs(collection(db(actor), 'users')));
    await assertSucceeds(getDocs(collection(db(actor), 'projects')));
    await assertSucceeds(getDocs(collection(db(actor), 'siteAdmins')));
    await assertSucceeds(statusWrite(actor, 'member', 'suspended'));
    await assertSucceeds(statusWrite(actor, 'member', 'active'));
    await assertSucceeds(archiveWrite(actor, true));
    await assertSucceeds(archiveWrite(actor, false));
    expect((await getDoc(doc(db(actor), 'projects', 'p1'))).data()).toMatchObject({ ownerId: 'owner', memberIds: ['owner', 'project-admin', 'member'] });
  });
  it.each(['owner', 'project-admin', 'member'])('denies site-wide lists and account management to project user %s', async (actor) => {
    await assertFails(getDocs(collection(db(actor), 'users')));
    await assertFails(getDocs(collection(db(actor), 'projects')));
    await assertFails(getDocs(collection(db(actor), 'siteAdmins')));
    await assertFails(statusWrite(actor, 'member', 'suspended'));
  });
  it('protects all staff, including self, and rejects forged audit fields or other profile changes', async () => {
    for (const target of ['site-owner', 'site-admin']) await assertFails(statusWrite('site-admin', target, 'suspended'));
    await assertFails(updateDoc(doc(db('site-admin'), 'users', 'member'), { accountStatus: 'suspended', statusUpdatedBy: 'site-owner', statusUpdatedAt: serverTimestamp() }));
    await assertFails(statusWrite('site-admin', 'member', 'deleted'));
    await assertFails(updateDoc(doc(db('site-admin'), 'users', 'member'), { accountStatus: 'suspended', statusUpdatedBy: 'site-admin', statusUpdatedAt: serverTimestamp(), displayName: 'Changed' }));
    await assertFails(updateDoc(doc(db('site-admin'), 'projects', 'p1'), { archived: true, updatedAt: serverTimestamp(), ownerId: 'site-admin' }));
  });
  it('does not grant staff access to other project content or personal tarot history', async () => {
    await environment.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'projects', 'p1', 'documents', 'd1'), { title: 'Doc', createdBy: 'member' });
      await setDoc(doc(ctx.firestore(), 'projects', 'p1', 'chatMessages', 'c1'), { text: 'Hi', createdBy: 'member' });
    });
    await assertFails(getDoc(doc(db('site-admin'), 'projects', 'p1', 'documents', 'd1')));
    await assertFails(getDoc(doc(db('site-admin'), 'projects', 'p1', 'chatMessages', 'c1')));
    await assertFails(getDoc(doc(db('site-admin'), 'users', 'member', 'tarotReadings', 'r1')));
  });
  it('blocks suspended users with existing auth tokens, while allowing own status and reactivation', async () => {
    const member = db('member');
    await assertSucceeds(getDoc(doc(member, 'projects', 'p1', 'tasks', 't1')));
    await assertSucceeds(statusWrite('site-admin', 'member', 'suspended'));
    expect((await assertSucceeds(getDoc(doc(member, 'users', 'member')))).data()?.accountStatus).toBe('suspended');
    await assertSucceeds(getDoc(doc(member, 'siteAdmins', 'member')));
    await assertFails(getDoc(doc(member, 'projects', 'p1')));
    await assertFails(getDoc(doc(member, 'projects', 'p1', 'tasks', 't1')));
    await assertFails(getDoc(doc(member, 'siteFeedback', 'f1')));
    await assertFails(getDoc(doc(member, 'users', 'member', 'tarotReadings', 'r1')));
    await assertFails(updateDoc(doc(member, 'users', 'member'), { accountStatus: 'active' }));
    await assertFails(updateDoc(doc(member, 'users', 'member'), { theme: 'dark' }));
    await assertSucceeds(statusWrite('site-owner', 'member', 'active'));
    await assertSucceeds(getDoc(doc(member, 'projects', 'p1', 'tasks', 't1')));
  });
  it('denies management after staff role revocation or out-of-band staff suspension', async () => {
    await environment.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'siteAdmins', 'site-admin'), { role: 'member' });
      await updateDoc(doc(ctx.firestore(), 'users', 'site-owner'), { accountStatus: 'suspended' });
    });
    for (const actor of ['site-admin', 'site-owner']) {
      await assertFails(getDocs(collection(db(actor), 'users')));
      await assertFails(statusWrite(actor, 'member', 'suspended'));
    }
  });
  it('allows legacy profiles and safe bootstrap, but prevents client provisioning of account state', async () => {
    await assertSucceeds(getDoc(doc(db('member'), 'projects', 'p1')));
    await assertSucceeds(setDoc(doc(db('new-user'), 'users', 'new-user'), { email: 'new-user@example.com', displayName: 'New' }));
    await assertFails(setDoc(doc(db('spoof'), 'users', 'spoof'), { email: 'spoof@example.com', accountStatus: 'active' }));
    await assertFails(setDoc(doc(db('spoof'), 'users', 'spoof'), { email: 'spoof@example.com', statusUpdatedBy: 'site-owner' }));
  });
  it('paginates metadata by ID, including legacy records without createdAt', async () => {
    await environment.withSecurityRulesDisabled(async (ctx) => {
      const batch = writeBatch(ctx.firestore());
      for (let i = 0; i < 55; i++) batch.set(doc(ctx.firestore(), 'projects', `z${i.toString().padStart(2, '0')}`), { name: `Old ${i}`, ownerId: 'owner', memberIds: ['owner'], archived: false });
      await batch.commit();
    });
    const first = await assertSucceeds(getDocs(query(collection(db('site-admin'), 'projects'), orderBy(documentId()), limit(51))));
    expect(first.size).toBe(51);
    const next = await assertSucceeds(getDocs(query(collection(db('site-admin'), 'projects'), orderBy(documentId()), startAfter(first.docs[49].id), limit(51))));
    expect(next.size).toBe(6);
    expect(new Set([...first.docs.slice(0, 50), ...next.docs].map((item) => item.id)).size).toBe(56);
  });
});
