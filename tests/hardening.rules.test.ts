import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayRemove, arrayUnion, deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { googleClaims } from './google-claims';

// Regression tests for the site security audit (2026-10-13).
let environment: RulesTestEnvironment;
const db = (uid: string, claims: object = {}) => environment.authenticatedContext(uid, { ...googleClaims(uid, `${uid}@example.com`), ...claims }).firestore();
const withGitHub = (uid: string) => db(uid, { firebase: { sign_in_provider: 'google.com', identities: { 'google.com': [uid], 'github.com': [`gh-${uid}`] } } });

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: 'hardening-test', firestore: { rules: readFileSync('firestore.rules', 'utf8') } }); });
afterAll(async () => environment.cleanup());
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (ctx) => {
    const store = ctx.firestore();
    for (const uid of ['owner', 'admin', 'member', 'attacker', 'stranger']) {
      await setDoc(doc(store, 'users', uid), { displayName: uid, email: `${uid}@example.com`, photoURL: '', locale: 'en', theme: 'system' });
    }
    await setDoc(doc(store, 'projects', 'victim'), { name: 'Victim', ownerId: 'owner', memberIds: ['owner', 'admin', 'member'], archived: false });
    for (const [uid, role] of [['owner', 'owner'], ['admin', 'admin'], ['member', 'member']]) {
      await setDoc(doc(store, 'memberships', `victim_${uid}`), { projectId: 'victim', userId: uid, role });
    }
    await setDoc(doc(store, 'projects', 'victim', 'tasks', 't1'), { title: 'Secret', createdBy: 'member', status: 'todo' });
    await setDoc(doc(store, 'projects', 'own'), { name: 'Own', ownerId: 'attacker', memberIds: ['attacker'], archived: false });
    await setDoc(doc(store, 'memberships', 'own_attacker'), { projectId: 'own', userId: 'attacker', role: 'owner' });
  });
});

describe('security audit regressions', () => {
  it('rejects owner memberships whose ID points at another project', async () => {
    const attacker = db('attacker');
    await assertFails(setDoc(doc(attacker, 'memberships', 'victim_attacker'), { projectId: 'own', userId: 'attacker', role: 'owner' }));
    await assertFails(getDoc(doc(attacker, 'projects', 'victim', 'tasks', 't1')));
    // Normal project creation still works.
    const batch = writeBatch(attacker);
    batch.set(doc(attacker, 'projects', 'fresh'), { name: 'Fresh', ownerId: 'attacker', memberIds: ['attacker'], archived: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(attacker, 'memberships', 'fresh_attacker'), { projectId: 'fresh', userId: 'attacker', role: 'owner' });
    await assertSucceeds(batch.commit());
  });

  it('lets owners and admins remove members from memberIds but never add strangers', async () => {
    await assertFails(updateDoc(doc(db('owner'), 'projects', 'victim'), { memberIds: arrayUnion('stranger'), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(db('admin'), 'projects', 'victim'), { memberIds: arrayUnion('stranger'), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db('admin'), 'projects', 'victim'), { memberIds: arrayRemove('member'), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db('owner'), 'projects', 'victim'), { memberIds: arrayRemove('admin'), updatedAt: serverTimestamp() }));
  });

  it('limits owner role changes to admin and member', async () => {
    const owner = db('owner');
    await assertFails(updateDoc(doc(owner, 'memberships', 'victim_member'), { role: 'owner' }));
    await assertFails(updateDoc(doc(owner, 'memberships', 'victim_member'), { role: 'superuser' }));
    await assertSucceeds(updateDoc(doc(owner, 'memberships', 'victim_member'), { role: 'admin' }));
  });

  it('locks the GitHub handle while repo access is granted, but allows disconnecting', async () => {
    const member = withGitHub('member');
    await assertSucceeds(updateDoc(doc(member, 'memberships', 'victim_member'), { githubUsername: 'alice', githubId: '1' }));
    await assertSucceeds(updateDoc(doc(db('owner'), 'memberships', 'victim_member'), { githubPermission: 'push' }));
    await assertFails(updateDoc(doc(member, 'memberships', 'victim_member'), { githubUsername: 'bob', githubId: '2' }));
    await assertFails(updateDoc(doc(member, 'memberships', 'victim_member'), { githubUsername: 'bob' }));
    await assertSucceeds(updateDoc(doc(member, 'memberships', 'victim_member'), { githubUsername: deleteField(), githubId: deleteField() }));
  });

  it('rejects new anonymous polls and switching a poll to anonymous, but keeps legacy polls editable', async () => {
    const owner = db('owner');
    const poll = { question: 'Q', description: '', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], multiple: false, closed: false, deadline: '', createdBy: 'owner', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(doc(owner, 'projects', 'victim', 'polls', 'anon'), { ...poll, anonymous: true }));
    await assertSucceeds(setDoc(doc(owner, 'projects', 'victim', 'polls', 'named'), { ...poll, anonymous: false }));
    await assertFails(updateDoc(doc(owner, 'projects', 'victim', 'polls', 'named'), { anonymous: true }));
    await environment.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'projects', 'victim', 'polls', 'legacy'), { ...poll, anonymous: true, createdAt: null, updatedAt: null });
    });
    await assertSucceeds(updateDoc(doc(owner, 'projects', 'victim', 'polls', 'legacy'), { question: 'Renamed' }));
  });

  it('accepts only Google-hosted photos on profiles, memberships, and comments', async () => {
    const google = 'https://lh3.googleusercontent.com/a/photo';
    const evil = 'https://evil.example/p.gif';
    const member = db('member');
    await assertFails(updateDoc(doc(member, 'users', 'member'), { photoURL: evil }));
    await assertSucceeds(updateDoc(doc(member, 'users', 'member'), { photoURL: google }));
    await assertSucceeds(updateDoc(doc(member, 'users', 'member'), { photoURL: '' }));
    await environment.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'users', 'member'), { photoURL: evil }); });
    await assertSucceeds(updateDoc(doc(member, 'users', 'member'), { theme: 'dark' }));
    const comment = { targetType: 'task', targetId: 't1', body: 'Hi', authorName: 'member', createdBy: 'member', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(doc(member, 'projects', 'victim', 'comments', 'c1'), { ...comment, authorPhoto: evil }));
    await assertSucceeds(setDoc(doc(member, 'projects', 'victim', 'comments', 'c2'), { ...comment, authorPhoto: google }));
    const profile = { displayName: 'New', email: 'newbie@example.com', locale: 'en', theme: 'system' };
    await assertFails(setDoc(doc(db('newbie'), 'users', 'newbie'), { ...profile, photoURL: evil }));
    await assertSucceeds(setDoc(doc(db('newbie'), 'users', 'newbie'), { ...profile, photoURL: google }));
    const fresh = db('attacker');
    const batch = writeBatch(fresh);
    batch.set(doc(fresh, 'projects', 'pic'), { name: 'Pic', ownerId: 'attacker', memberIds: ['attacker'], archived: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(fresh, 'memberships', 'pic_attacker'), { projectId: 'pic', userId: 'attacker', role: 'owner', photoURL: evil });
    await assertFails(batch.commit());
  });
});
