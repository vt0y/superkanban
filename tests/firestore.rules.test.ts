import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let environment: RulesTestEnvironment;
const projectId = 'project-a';

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'project-space-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
beforeEach(async () => environment.clearFirestore());
afterAll(async () => environment.cleanup());

const context = (uid: string, email = `${uid}@example.com`, customClaims: Record<string, unknown> = {}) =>
  environment.authenticatedContext(uid, { email, ...customClaims }).firestore();

async function seedProject() {
  await environment.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'projects', projectId), { name: 'Alpha', description: '', color: '#000', ownerId: 'owner', memberIds: ['owner', 'member', 'admin'], archived: false });
    for (const [uid, role] of [['owner', 'owner'], ['member', 'member'], ['admin', 'admin']] as const) {
      await setDoc(doc(db, 'memberships', `${projectId}_${uid}`), { projectId, userId: uid, email: `${uid}@example.com`, displayName: uid, photoURL: '', role });
      await setDoc(doc(db, 'users', uid), { displayName: uid, email: `${uid}@example.com`, photoURL: '', locale: 'en', theme: 'system' });
    }
  });
}

async function archiveProjectWithContent() {
  await seedProject();
  await environment.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await updateDoc(doc(db, 'projects', projectId), { archived: true });
    await setDoc(doc(db, 'projects', projectId, 'tasks', 'existing-task'), { title: 'Existing', status: 'todo', priority: 'medium', createdBy: 'member' });
    await setDoc(doc(db, 'projects', projectId, 'polls', 'existing-poll'), { question: 'Q', description: '', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], multiple: false, anonymous: false, closed: false, deadline: '', createdBy: 'owner' });
    await setDoc(doc(db, 'projects', projectId, 'chatMessages', 'existing-message'), { body: 'Existing chat', authorName: 'member', authorPhoto: '', createdBy: 'member', createdAt: Timestamp.now() });
    await setDoc(doc(db, 'invites', 'archived-token'), { projectId, projectName: 'Alpha', role: 'member', status: 'active', createdBy: 'owner', expiresAt: Timestamp.fromDate(new Date(Date.now() + 86400000)) });
  });
}

function validGachaDraw(initiatedBy = 'member') {
  return {
    candidateIds: ['admin', 'member'],
    winnerIds: ['member'],
    targetIds: ['task-1'],
    candidates: [
      { userId: 'admin', displayName: 'admin', photoURL: '' },
      { userId: 'member', displayName: 'member', photoURL: '' },
    ],
    results: [{ targetType: 'task', targetId: 'task-1', targetTitle: 'Task', winnerCount: 1, previousAssigneeIds: [], eligibleIds: ['admin', 'member'], odds: { admin: .5, member: .5 }, winnerIds: ['member'] }],
    initiatedBy,
    initiatedByName: initiatedBy,
    poolKey: 'a'.repeat(64),
    animationVersion: 1,
    animationStyle: 'pack',
    createdAt: serverTimestamp(),
  };
}

describe('ProjectSpace Firestore rules', () => {
  it('ปฏิเสธผู้ที่ยังไม่เข้าสู่ระบบ', async () => {
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'projects', projectId)));
  });

  it('ประวัติ tarot เป็นข้อมูลส่วนตัว สร้างและลบได้แต่แก้ย้อนหลังไม่ได้', async () => {
    const alice = context('alice');
    const reading = doc(alice, 'users', 'alice', 'tarotReadings', 'reading-1');
    const cards = [
      { id: '00-fool', position: 'past', reversed: false, nameTh: 'เดอะฟูล', nameEn: 'The Fool' },
      { id: '17-star', position: 'present', reversed: false, nameTh: 'เดอะสตาร์', nameEn: 'The Star' },
      { id: '18-moon', position: 'future', reversed: true, nameTh: 'เดอะมูน', nameEn: 'The Moon' },
    ];
    await assertSucceeds(setDoc(reading, { schemaVersion: 1, category: 'general', question: '', locale: 'th', cards, readingMarkdown: '## คำทำนาย', requestId: 'req-1', createdBy: 'alice', createdAt: serverTimestamp() }));
    await assertSucceeds(getDoc(reading));
    await assertSucceeds(getDocs(query(collection(alice, 'users', 'alice', 'tarotReadings'), orderBy('createdAt', 'desc'), limit(20))));
    await assertFails(getDoc(doc(context('bob'), reading.path)));
    await assertFails(updateDoc(reading, { question: 'เปลี่ยนคำถาม' }));
    await assertSucceeds(deleteDoc(reading));
  });

  it('ปฏิเสธ tarot ที่สวมรอย ไพ่ซ้ำ ตำแหน่งผิด หรือ payload เกินขอบเขต', async () => {
    const db = context('alice');
    const target = (id: string) => doc(db, 'users', 'alice', 'tarotReadings', id);
    const cards = [
      { id: '00-fool', position: 'past', reversed: false, nameTh: 'เดอะฟูล', nameEn: 'The Fool' },
      { id: '17-star', position: 'present', reversed: false, nameTh: 'เดอะสตาร์', nameEn: 'The Star' },
      { id: '18-moon', position: 'future', reversed: true, nameTh: 'เดอะมูน', nameEn: 'The Moon' },
    ];
    const base = { schemaVersion: 1, category: 'love', question: 'Q', locale: 'th', cards, readingMarkdown: 'reading', requestId: 'req', createdBy: 'alice', createdAt: serverTimestamp() };
    await assertFails(setDoc(target('spoof'), { ...base, createdBy: 'bob' }));
    await assertFails(setDoc(target('duplicate'), { ...base, cards: [cards[0], cards[0], cards[2]] }));
    await assertFails(setDoc(target('position'), { ...base, cards: [cards[1], cards[0], cards[2]] }));
    await assertFails(setDoc(target('long'), { ...base, question: 'x'.repeat(501) }));
    await assertFails(setDoc(doc(db, 'users', 'bob', 'tarotReadings', 'foreign'), base));
  });

  it('สร้าง project และ owner membership ใน batch เดียวได้', async () => {
    const db = context('creator');
    const batch = writeBatch(db);
    batch.set(doc(db, 'projects', 'new-project'), { name: 'New', description: '', color: '#fff', ownerId: 'creator', memberIds: ['creator'], archived: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(db, 'memberships', 'new-project_creator'), { projectId: 'new-project', userId: 'creator', displayName: 'Creator', email: 'creator@example.com', photoURL: '', role: 'owner', joinedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  it('แยกข้อมูลแต่ละโปรเจกต์จากคนนอก', async () => {
    await seedProject();
    await assertSucceeds(getDoc(doc(context('member'), 'projects', projectId)));
    await assertSucceeds(getDocs(query(collection(context('member'), 'projects'), where('memberIds', 'array-contains', 'member'))));
    await assertFails(getDoc(doc(context('outsider'), 'projects', projectId)));
  });

  it('member แก้งานร่วมกันได้ แต่ลบงานคนอื่นไม่ได้', async () => {
    await seedProject();
    const memberDb = context('member');
    const task = doc(collection(memberDb, 'projects', projectId, 'tasks'));
    await assertSucceeds(setDoc(task, { title: 'Task', status: 'todo', priority: 'medium', createdBy: 'member' }));
    await assertSucceeds(updateDoc(task, { status: 'in_progress' }));
    await assertSucceeds(deleteDoc(task));
    const ownerTaskPath = `projects/${projectId}/tasks/owner-task`;
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), ownerTaskPath), { title: 'Owner task', status: 'todo', priority: 'medium', createdBy: 'owner' }));
    await assertFails(deleteDoc(doc(memberDb, ownerTaskPath)));
    await assertSucceeds(deleteDoc(doc(context('admin'), ownerTaskPath)));
  });

  it('document v2 แยก metadata/body จำกัด UTF-8 และใช้สิทธิ์ลบเดิม', async () => {
    await seedProject();
    const memberDb = context('member');
    const metadata = doc(memberDb, 'projects', projectId, 'documents', 'doc-v2');
    const body = doc(memberDb, 'projects', projectId, 'documentBodies', 'doc-v2');
    const create = writeBatch(memberDb);
    create.set(metadata, { schemaVersion: 2, title: 'Spec', excerpt: 'Hello', contentBytes: 5, createdBy: 'member', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    create.set(body, { content: 'Hello' });
    await assertSucceeds(create.commit());
    await assertSucceeds(getDoc(metadata));
    await assertSucceeds(getDoc(body));
    await assertFails(getDoc(doc(context('outsider'), body.path)));
    await assertSucceeds(updateDoc(metadata, { labelIds: ['planning'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(metadata, { labelIds: Array.from({ length: 51 }, (_, index) => `label-${index}`), updatedAt: serverTimestamp() }));

    const adminDb = context('admin');
    const update = writeBatch(adminDb);
    update.update(doc(adminDb, metadata.path), { excerpt: 'ภาษาไทย', contentBytes: 21, updatedAt: serverTimestamp() });
    update.update(doc(adminDb, body.path), { content: 'ภาษาไทย' });
    await assertSucceeds(update.commit());

    const oversized = 'ไ'.repeat(307201);
    const oversizedBatch = writeBatch(memberDb);
    oversizedBatch.set(doc(memberDb, 'projects', projectId, 'documents', 'too-large'), { schemaVersion: 2, title: 'Large', excerpt: '', contentBytes: 921603, createdBy: 'member' });
    oversizedBatch.set(doc(memberDb, 'projects', projectId, 'documentBodies', 'too-large'), { content: oversized });
    await assertFails(oversizedBatch.commit());

    await environment.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'projects', projectId, 'documents', 'owner-doc'), { schemaVersion: 2, title: 'Owner', excerpt: '', contentBytes: 1, createdBy: 'owner' });
      await setDoc(doc(db, 'projects', projectId, 'documentBodies', 'owner-doc'), { content: 'x' });
    });
    const memberDelete = writeBatch(memberDb);
    memberDelete.delete(doc(memberDb, 'projects', projectId, 'documentBodies', 'owner-doc'));
    memberDelete.delete(doc(memberDb, 'projects', projectId, 'documents', 'owner-doc'));
    await assertFails(memberDelete.commit());
    const adminDelete = writeBatch(adminDb);
    adminDelete.delete(doc(adminDb, 'projects', projectId, 'documentBodies', 'owner-doc'));
    adminDelete.delete(doc(adminDb, 'projects', projectId, 'documents', 'owner-doc'));
    await assertSucceeds(adminDelete.commit());
  });

  it('legacy document ยังอ่านได้และย้าย body แบบ atomic ได้เฉพาะ project ที่ active', async () => {
    await seedProject();
    await environment.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'projects', projectId, 'documents', 'legacy'), { title: 'Legacy', content: '# Old', createdBy: 'member', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
    const memberDb = context('member');
    await assertSucceeds(getDoc(doc(memberDb, 'projects', projectId, 'documents', 'legacy')));
    const migrate = writeBatch(memberDb);
    migrate.update(doc(memberDb, 'projects', projectId, 'documents', 'legacy'), { schemaVersion: 2, excerpt: 'Old', contentBytes: 5, content: deleteField() });
    migrate.set(doc(memberDb, 'projects', projectId, 'documentBodies', 'legacy'), { content: '# Old' });
    await assertSucceeds(migrate.commit());
    await assertSucceeds(updateDoc(doc(context('owner'), 'projects', projectId), { archived: true }));
    await assertSucceeds(getDoc(doc(memberDb, 'projects', projectId, 'documentBodies', 'legacy')));
    const archivedUpdate = writeBatch(memberDb);
    archivedUpdate.update(doc(memberDb, 'projects', projectId, 'documents', 'legacy'), { excerpt: 'No', contentBytes: 2 });
    archivedUpdate.update(doc(memberDb, 'projects', projectId, 'documentBodies', 'legacy'), { content: 'No' });
    await assertFails(archivedUpdate.commit());
  });

  it('Drive documents เก็บเฉพาะ metadata และถอดได้โดยผู้แนบหรือ admin', async () => {
    await seedProject();
    const memberDb = context('member');
    const driveDoc = doc(memberDb, 'projects', projectId, 'documents', 'drive_file-1');
    await assertSucceeds(setDoc(driveDoc, {
      kind: 'drive', title: 'Review.pdf', driveFileId: 'file-1', name: 'Review.pdf', mimeType: 'application/pdf', sizeBytes: 100,
      shareMode: 'link', sharedMemberIds: [], createdBy: 'member', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(context('owner'), driveDoc.path)));
    await assertFails(getDoc(doc(context('outsider'), driveDoc.path)));
    await assertSucceeds(updateDoc(doc(context('admin'), driveDoc.path), { labelIds: ['review'], updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(context('admin'), driveDoc.path), { nickname: 'Client review', description: 'Final approval copy', taskIds: ['task-1'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(context('admin'), driveDoc.path), { labelIds: Array.from({ length: 51 }, (_, index) => `label-${index}`), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(context('admin'), driveDoc.path), { nickname: 'x'.repeat(201), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(context('admin'), driveDoc.path), { description: 'x'.repeat(1001), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(context('admin'), driveDoc.path), { taskIds: Array.from({ length: 101 }, (_, index) => `task-${index}`), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(driveDoc, { name: 'Changed.pdf' }));
    await assertFails(setDoc(doc(memberDb, 'projects', projectId, 'documents', 'wrong-id'), {
      kind: 'drive', title: 'Wrong', driveFileId: 'file-2', name: 'Wrong', mimeType: 'text/plain',
      shareMode: 'members', sharedMemberIds: ['owner', 'member'], createdBy: 'member', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    const syncedDoc = doc(memberDb, 'projects', projectId, 'documents', 'drive_sync-file');
    await assertSucceeds(setDoc(syncedDoc, {
      kind: 'drive', title: 'Sync', driveFileId: 'sync-file', name: 'Sync', mimeType: 'text/plain', shareMode: 'members',
      sharedMemberIds: ['owner', 'member', 'admin'], managedPermissionIds: { owner: 'permission-owner' }, permissionsSyncedAt: serverTimestamp(),
      createdBy: 'member', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(syncedDoc, { managedPermissionIds: { admin: 'permission-admin' }, permissionsSyncedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(context('admin'), syncedDoc.path), { managedPermissionIds: {}, permissionsSyncedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(syncedDoc, { name: 'Mutated', permissionsSyncedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(driveDoc));

    const ownerDocPath = `projects/${projectId}/documents/drive_owner-file`;
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), ownerDocPath), {
      kind: 'drive', title: 'Owner', driveFileId: 'owner-file', name: 'Owner', mimeType: 'text/plain', shareMode: 'link', sharedMemberIds: [], createdBy: 'owner', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertFails(deleteDoc(doc(memberDb, ownerDocPath)));
    await assertSucceeds(deleteDoc(doc(context('admin'), ownerDocPath)));
  });

  it('Canva documents เก็บแค่ ID/edit token ที่แก้ภายหลังไม่ได้ และถอดได้โดยผู้แนบหรือ admin', async () => {
    await seedProject();
    const memberDb = context('member');
    const base = { kind: 'canva', title: 'Pitch deck', createdBy: 'member', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const canvaRef = (id: string, db = memberDb) => doc(db, 'projects', projectId, 'documents', `canva_${id}`);

    await assertSucceeds(setDoc(canvaRef('DAGdeck0001'), { ...base, canvaDesignId: 'DAGdeck0001', canvaEditToken: 'edit-Token_1', labelIds: [], taskIds: ['task-1'] }));
    await assertSucceeds(setDoc(canvaRef('DAGplain001'), { ...base, canvaDesignId: 'DAGplain001' }));
    await assertFails(getDoc(doc(context('outsider'), canvaRef('DAGdeck0001').path)));
    await assertFails(setDoc(doc(memberDb, 'projects', projectId, 'documents', 'canva_other'), { ...base, canvaDesignId: 'DAGwrong001' }));
    await assertFails(setDoc(canvaRef('DAG.bad.0001'), { ...base, canvaDesignId: 'DAG.bad.0001' }));
    await assertFails(setDoc(canvaRef('DAGtoken001'), { ...base, canvaDesignId: 'DAGtoken001', canvaEditToken: 'bad token/../x' }));
    await assertFails(setDoc(canvaRef('DAGextra001'), { ...base, canvaDesignId: 'DAGextra001', url: 'https://evil.example' }));
    await assertFails(setDoc(canvaRef('DAGnotitle1'), { ...base, title: '', canvaDesignId: 'DAGnotitle1' }));
    await assertFails(setDoc(canvaRef('DAGtime0001'), { ...base, canvaDesignId: 'DAGtime0001', createdAt: Timestamp.fromDate(new Date(2020, 0, 1)) }));

    await assertSucceeds(updateDoc(canvaRef('DAGdeck0001', context('owner')), { nickname: 'Final deck', description: 'Client copy', labelIds: ['label-1'], taskIds: [], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(canvaRef('DAGdeck0001'), { title: 'Renamed', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(canvaRef('DAGdeck0001'), { canvaEditToken: 'otherToken', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(canvaRef('DAGdeck0001', context('admin')), { canvaEditToken: deleteField(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(canvaRef('DAGplain001'), { canvaEditToken: 'addedLater', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(canvaRef('DAGview0001'), { ...base, canvaDesignId: 'DAGview0001', canvaViewToken: 'viewToken9' }));
    await assertFails(setDoc(canvaRef('DAGauth0001'), { ...base, canvaDesignId: 'DAGauth0001', canvaAuthor: 'Jamie' }));

    const ownerDocPath = `projects/${projectId}/documents/canva_DAGowner001`;
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), ownerDocPath), {
      kind: 'canva', title: 'Owner deck', canvaDesignId: 'DAGowner001', createdBy: 'owner', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));

    await assertFails(deleteDoc(doc(memberDb, ownerDocPath)));
    await assertSucceeds(deleteDoc(canvaRef('DAGdeck0001')));
    await assertSucceeds(deleteDoc(doc(context('admin'), ownerDocPath)));

    await environment.withSecurityRulesDisabled(async (ctx) => updateDoc(doc(ctx.firestore(), 'projects', projectId), { archived: true }));
    await assertFails(updateDoc(canvaRef('DAGplain001'), { nickname: 'Archived', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(canvaRef('DAGnew00001'), { ...base, canvaDesignId: 'DAGnew00001' }));
  });

  it('Drive roles: ยกระดับได้เฉพาะไฟล์ Google, ลิงก์สาธารณะแก้ไขไม่ได้, ลิงก์ unmanaged ไม่มีสิทธิ์', async () => {
    await seedProject();
    const memberDb = context('member');
    const base = { createdBy: 'member', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const gdoc = { kind: 'drive', title: 'Spec', name: 'Spec', mimeType: 'application/vnd.google-apps.document' };
    const docRef = (id: string) => doc(memberDb, 'projects', projectId, 'documents', `drive_${id}`);

    await assertSucceeds(setDoc(docRef('gdoc-1'), { ...gdoc, ...base, driveFileId: 'gdoc-1', shareMode: 'members', role: 'writer', sharedMemberIds: ['owner', 'member', 'admin'], managedPermissionIds: {}, permissionsSyncedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(docRef('gdoc-2'), { ...gdoc, ...base, driveFileId: 'gdoc-2', shareMode: 'link', role: 'commenter', linkPermissionId: 'anyone-1', sharedMemberIds: [] }));
    await assertFails(setDoc(docRef('gdoc-3'), { ...gdoc, ...base, driveFileId: 'gdoc-3', shareMode: 'link', role: 'writer', sharedMemberIds: [] }));
    await assertFails(setDoc(docRef('pdf-1'), { ...gdoc, ...base, mimeType: 'application/pdf', driveFileId: 'pdf-1', shareMode: 'link', role: 'commenter', sharedMemberIds: [] }));
    await assertFails(setDoc(docRef('gdoc-4'), { ...gdoc, ...base, driveFileId: 'gdoc-4', shareMode: 'link', role: 'owner', sharedMemberIds: [] }));
    await assertFails(setDoc(docRef('gdoc-5'), { ...gdoc, ...base, driveFileId: 'gdoc-5', shareMode: 'members', linkPermissionId: 'anyone-1', sharedMemberIds: ['owner', 'member', 'admin'] }));

    await assertSucceeds(setDoc(docRef('pasted-1'), { ...gdoc, ...base, driveFileId: 'pasted-1', shareMode: 'unmanaged', sharedMemberIds: [] }));
    await assertFails(setDoc(docRef('pasted-2'), { ...gdoc, ...base, driveFileId: 'pasted-2', shareMode: 'unmanaged', sharedMemberIds: ['owner'] }));
    await assertFails(setDoc(docRef('pasted-3'), { ...gdoc, ...base, driveFileId: 'pasted-3', shareMode: 'unmanaged', role: 'reader', sharedMemberIds: [] }));
    await assertFails(setDoc(docRef('pasted-4'), { ...gdoc, ...base, driveFileId: 'pasted-4', shareMode: 'unmanaged', managedPermissionIds: {}, sharedMemberIds: [] }));

    await assertSucceeds(updateDoc(docRef('gdoc-1'), { role: 'commenter', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(context('admin'), docRef('gdoc-1').path), { role: 'reader', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(context('admin'), docRef('gdoc-1').path), { nickname: 'Spec v2', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(docRef('gdoc-2'), { role: 'writer', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(docRef('pasted-1'), { role: 'reader', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(docRef('pasted-1'), { sharedMemberIds: ['owner', 'member', 'admin'], permissionsSyncedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });

  it('task attachments รุ่นเดิมอ่าน/ลบได้แต่สร้างหรือแก้เพิ่มไม่ได้', async () => {
    await seedProject();
    await environment.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'projects', projectId, 'tasks', 'task-1'), { title: 'Task', status: 'todo', priority: 'medium', createdBy: 'member' });
      await setDoc(doc(db, 'projects', projectId, 'taskAttachments', 'task-1_file-1'), {
        taskId: 'task-1', driveFileId: 'file-1', name: 'Design.png', mimeType: 'image/png', sizeBytes: 200,
        shareMode: 'members', sharedMemberIds: ['owner', 'member', 'admin'], createdBy: 'admin', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });
    });
    const adminDb = context('admin');
    const attachment = doc(adminDb, 'projects', projectId, 'taskAttachments', 'task-1_file-1');
    await assertSucceeds(getDoc(doc(context('member'), attachment.path)));
    await assertFails(getDoc(doc(context('outsider'), attachment.path)));
    await assertFails(updateDoc(attachment, { managedPermissionIds: { member: 'permission-member' }, permissionsSyncedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(attachment, { name: 'Changed.png' }));
    await assertFails(setDoc(doc(adminDb, 'projects', projectId, 'taskAttachments', 'task-1_file-2'), {
      taskId: 'task-1', driveFileId: 'file-2', name: 'New.txt', mimeType: 'text/plain', shareMode: 'link', sharedMemberIds: [], createdBy: 'admin', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    // The task creator can remove every reference while deleting their task.
    await assertSucceeds(deleteDoc(doc(context('member'), attachment.path)));
  });

  it('task queries แบบ active/history อ่านได้ทุกบทบาทสมาชิก และปฏิเสธคนนอก', async () => {
    await seedProject();
    await environment.withSecurityRulesDisabled(async (ctx) => {
      const tasks = collection(ctx.firestore(), 'projects', projectId, 'tasks');
      await setDoc(doc(tasks, 'active'), { status: 'todo', milestoneId: 'm1', updatedAt: Timestamp.now() });
      await setDoc(doc(tasks, 'done'), { status: 'done', milestoneId: 'm1', updatedAt: Timestamp.now() });
    });
    for (const uid of ['owner', 'admin', 'member']) {
      const tasks = collection(context(uid), 'projects', projectId, 'tasks');
      await assertSucceeds(getDocs(query(tasks, where('status', 'in', ['backlog', 'todo', 'in_progress', 'review']))));
      await assertSucceeds(getDocs(query(tasks, where('status', '==', 'done'), orderBy('updatedAt', 'desc'), limit(50))));
      await assertSucceeds(getDocs(query(tasks, where('milestoneId', '==', 'm1'), where('status', '==', 'done'))));
    }
    const outsiderTasks = collection(context('outsider'), 'projects', projectId, 'tasks');
    await assertFails(getDocs(query(outsiderTasks, where('status', 'in', ['backlog', 'todo', 'in_progress', 'review']))));
  });

  it('task รับ labelIds และ checklist เป็น list เท่านั้น', async () => {
    await seedProject();
    const task = doc(collection(context('member'), 'projects', projectId, 'tasks'));
    await assertSucceeds(setDoc(task, { title: 'Task', status: 'todo', priority: 'medium', labelIds: ['l1'], checklist: [{ id: 'c1', text: 'Step', done: false }], createdBy: 'member' }));
    await assertSucceeds(updateDoc(task, { checklist: [{ id: 'c1', text: 'Step', done: true }], labelIds: [] }));
    await assertFails(updateDoc(task, { checklist: 'nope' }));
    await assertFails(updateDoc(task, { labelIds: 'l1' }));
    await assertFails(updateDoc(task, { unknown: true }));
  });

  it('label: สมาชิกสร้างและแก้ได้ ลบได้เฉพาะเจ้าของหรือ admin', async () => {
    await seedProject();
    const label = doc(collection(context('member'), 'projects', projectId, 'labels'));
    await assertSucceeds(setDoc(label, { name: 'bug', color: '#d73a4a', description: '', createdBy: 'member' }));
    await assertFails(setDoc(doc(collection(context('member'), 'projects', projectId, 'labels')), { name: '', color: '#000', description: '', createdBy: 'member' }));
    await assertFails(setDoc(doc(collection(context('member'), 'projects', projectId, 'labels')), { name: 'x', color: '#000', description: '', createdBy: 'member', extra: 1 }));
    await assertFails(getDoc(doc(context('outsider'), label.path)));
    await assertSucceeds(updateDoc(doc(context('admin'), label.path), { color: '#0075ca' }));
    const ownerLabel = `projects/${projectId}/labels/owner-label`;
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), ownerLabel), { name: 'docs', color: '#000', description: '', createdBy: 'owner' }));
    await assertFails(deleteDoc(doc(context('member'), ownerLabel)));
    await assertSucceeds(deleteDoc(doc(context('admin'), ownerLabel)));
  });

  it('universal invite ใช้เข้าร่วมได้โดยไม่ผูกอีเมล', async () => {
    await seedProject();
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'invites', 'token'), {
      projectId, projectName: 'Alpha', role: 'member', status: 'active', createdBy: 'owner',
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 86400000)),
    }));
    const db = context('guest', 'guest@example.com');
    const batch = writeBatch(db);
    batch.set(doc(db, 'memberships', `${projectId}_guest`), { projectId, userId: 'guest', displayName: 'Guest', email: 'guest@example.com', photoURL: '', role: 'member', inviteId: 'token' });
    batch.update(doc(db, 'projects', projectId), { memberIds: ['owner', 'member', 'admin', 'guest'], updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
  });

  it('admin archive project ไม่ได้ แต่ owner ทำได้', async () => {
    await seedProject();
    await assertFails(updateDoc(doc(context('admin'), 'projects', projectId), { archived: true, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(context('owner'), 'projects', projectId), { archived: true, updatedAt: serverTimestamp() }));
  });

  it('สมาชิกทุกบทบาทอ่าน archived project ได้ แต่เขียน project และ nested content ไม่ได้', async () => {
    await archiveProjectWithContent();
    for (const uid of ['owner', 'admin', 'member']) {
      const db = context(uid);
      await assertSucceeds(getDoc(doc(db, 'projects', projectId)));
      await assertSucceeds(getDoc(doc(db, 'projects', projectId, 'tasks', 'existing-task')));
      await assertSucceeds(getDoc(doc(db, 'projects', projectId, 'chatMessages', 'existing-message')));
      await assertFails(updateDoc(doc(db, 'projects', projectId), { name: `Changed by ${uid}` }));
      await assertFails(setDoc(doc(db, 'projects', projectId, 'tasks', `new-${uid}`), { title: 'New', status: 'todo', priority: 'medium', createdBy: uid }));
      await assertFails(updateDoc(doc(db, 'projects', projectId, 'tasks', 'existing-task'), { status: 'done' }));
      await assertFails(deleteDoc(doc(db, 'projects', projectId, 'tasks', 'existing-task')));
      await assertFails(setDoc(doc(db, 'projects', projectId, 'pollVotes', `existing-poll_${uid}`), { pollId: 'existing-poll', userId: uid, optionIds: ['a'] }));
      await assertFails(setDoc(doc(db, 'projects', projectId, 'comments', `comment-${uid}`), { targetType: 'task', targetId: 'existing-task', body: 'No write', authorName: uid, authorPhoto: '', createdBy: uid }));
      await assertFails(setDoc(doc(db, 'projects', projectId, 'chatMessages', `message-${uid}`), { body: 'No write', authorName: uid, authorPhoto: '', createdBy: uid, createdAt: serverTimestamp() }));
      await assertFails(setDoc(doc(db, 'projects', projectId, 'activities', `activity-${uid}`), { type: 'test', messageTh: 'test', messageEn: 'test', actorUid: uid, actorName: uid, targetId: 'existing-task' }));
      await assertFails(setDoc(doc(db, 'invites', `invite-${uid}`), { projectId, projectName: 'Alpha', role: 'member', status: 'active', createdBy: uid, expiresAt: Timestamp.fromDate(new Date(Date.now() + 86400000)) }));
      await assertFails(updateDoc(doc(db, 'memberships', `${projectId}_member`), { role: 'admin' }));
    }
  });

  it('มีเพียง owner ที่ unarchive ได้ และห้ามเปลี่ยน metadata พร้อมกัน', async () => {
    await archiveProjectWithContent();
    await assertFails(updateDoc(doc(context('admin'), 'projects', projectId), { archived: false }));
    await assertFails(updateDoc(doc(context('member'), 'projects', projectId), { archived: false }));
    await assertFails(updateDoc(doc(context('owner'), 'projects', projectId), { archived: false, name: 'Sneaky change' }));
    await assertSucceeds(updateDoc(doc(context('owner'), 'projects', projectId), { archived: false, updatedAt: serverTimestamp() }));
  });

  it('ลิงก์เชิญเดิมเข้า archived project ไม่ได้ แต่ใช้ได้อีกครั้งหลัง unarchive', async () => {
    await archiveProjectWithContent();
    const guestDb = context('guest', 'guest@example.com');
    const join = () => {
      const batch = writeBatch(guestDb);
      batch.set(doc(guestDb, 'memberships', `${projectId}_guest`), { projectId, userId: 'guest', displayName: 'Guest', email: 'guest@example.com', photoURL: '', role: 'member', inviteId: 'archived-token' });
      batch.update(doc(guestDb, 'projects', projectId), { memberIds: ['owner', 'member', 'admin', 'guest'], updatedAt: serverTimestamp() });
      return batch.commit();
    };
    await assertFails(join());
    await assertSucceeds(updateDoc(doc(context('owner'), 'projects', projectId), { archived: false }));
    await assertSucceeds(join());
  });

  it('activity แก้ไขหรือลบย้อนหลังไม่ได้', async () => {
    await seedProject();
    const db = context('member');
    const activity = doc(collection(db, 'projects', projectId, 'activities'));
    await assertSucceeds(setDoc(activity, { type: 'task_created', messageTh: 'เพิ่มงาน', messageEn: 'created task', actorUid: 'member', actorName: 'Member', targetId: 'task-1', createdAt: serverTimestamp() }));
    await assertFails(updateDoc(activity, { messageEn: 'changed' }));
    await assertFails(deleteDoc(activity));
  });

  it('แชทโปรเจกต์เป็น realtime สำหรับสมาชิก และข้อความแก้ไขหรือลบไม่ได้', async () => {
    await seedProject();
    const memberDb = context('member');
    const message = doc(collection(memberDb, 'projects', projectId, 'chatMessages'));
    await assertSucceeds(setDoc(message, { body: 'Hello team https://example.com', authorName: 'member', authorPhoto: '', createdBy: 'member', createdAt: serverTimestamp() }));
    await assertSucceeds(getDoc(message));
    await assertSucceeds(getDocs(collection(memberDb, 'projects', projectId, 'chatMessages')));
    await assertFails(updateDoc(message, { body: 'Edited' }));
    await assertFails(deleteDoc(message));
    await assertFails(getDoc(doc(context('outsider'), 'projects', projectId, 'chatMessages', message.id)));
    await assertFails(getDocs(collection(context('outsider'), 'projects', projectId, 'chatMessages')));
  });

  it('ปฏิเสธข้อความแชทที่สวมรอยผู้ส่ง ว่าง ยาวเกิน หรือมี field เกิน', async () => {
    await seedProject();
    const db = context('member');
    const target = (id: string) => doc(db, 'projects', projectId, 'chatMessages', id);
    await assertFails(setDoc(target('spoof-uid'), { body: 'Hi', authorName: 'admin', authorPhoto: '', createdBy: 'admin', createdAt: serverTimestamp() }));
    await assertFails(setDoc(target('spoof-name'), { body: 'Hi', authorName: 'Someone else', authorPhoto: '', createdBy: 'member', createdAt: serverTimestamp() }));
    await assertFails(setDoc(target('empty'), { body: '', authorName: 'member', authorPhoto: '', createdBy: 'member', createdAt: serverTimestamp() }));
    await assertFails(setDoc(target('long'), { body: 'x'.repeat(2001), authorName: 'member', authorPhoto: '', createdBy: 'member', createdAt: serverTimestamp() }));
    await assertFails(setDoc(target('extra'), { body: 'Hi', authorName: 'member', authorPhoto: '', createdBy: 'member', createdAt: serverTimestamp(), edited: true }));
  });

  it('milestone รับ dependsOn เป็น list ได้', async () => {
    await seedProject();
    const db = context('member');
    const milestone = doc(collection(db, 'projects', projectId, 'milestones'));
    await assertSucceeds(setDoc(milestone, { title: 'M2', description: '', dueDate: '2026-12-01', status: 'active', dependsOn: ['m1'], createdBy: 'member' }));
    await assertSucceeds(updateDoc(milestone, { dependsOn: [] }));
    await assertSucceeds(updateDoc(milestone, { status: 'completed' }));
    await assertSucceeds(updateDoc(milestone, { status: 'active' }));
    await assertFails(updateDoc(milestone, { dependsOn: 'm1' }));
    await assertFails(updateDoc(milestone, { status: 'closed' }));
    await assertSucceeds(updateDoc(milestone, { dueTime: '17:30' }));
    await assertSucceeds(updateDoc(milestone, { dueTime: '' }));
    await assertFails(updateDoc(milestone, { dueTime: '25:00' }));
    await assertFails(updateDoc(milestone, { dueTime: 1730 }));
  });

  it('task และ poll รับเวลาครบกำหนดรูปแบบ HH:mm เท่านั้น', async () => {
    await seedProject();
    const db = context('member');
    const task = doc(collection(db, 'projects', projectId, 'tasks'));
    const base = { title: 'T', description: '', status: 'todo', priority: 'medium', assigneeIds: [], tags: [], dueDate: '2026-12-01', milestoneId: '', order: 1, createdBy: 'member' };
    await assertSucceeds(setDoc(task, { ...base, dueTime: '09:05' }));
    await assertSucceeds(updateDoc(task, { dueTime: '23:59' }));
    await assertFails(updateDoc(task, { dueTime: '9:5' }));
    await assertFails(setDoc(doc(collection(db, 'projects', projectId, 'tasks')), { ...base, dueTime: '24:00' }));
    const poll = { question: 'Q', description: '', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], multiple: false, anonymous: false, closed: false, deadline: '2026-12-01', createdBy: 'member' };
    await assertSucceeds(setDoc(doc(db, 'projects', projectId, 'polls', 'timed'), { ...poll, deadlineTime: '18:00' }));
    await assertFails(setDoc(doc(db, 'projects', projectId, 'polls', 'bad-time'), { ...poll, deadlineTime: 'noon' }));
  });

  it('โหวตได้เฉพาะในชื่อตัวเอง และเคารพ single/multiple choice', async () => {
    await seedProject();
    const ownerDb = context('owner');
    const options = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    await assertSucceeds(setDoc(doc(ownerDb, 'projects', projectId, 'polls', 'single'), { question: 'Q', description: '', options, multiple: false, anonymous: false, closed: false, deadline: '', createdBy: 'owner' }));
    await assertSucceeds(setDoc(doc(ownerDb, 'projects', projectId, 'polls', 'multi'), { question: 'Q', description: '', options, multiple: true, anonymous: false, closed: false, deadline: '', createdBy: 'owner' }));
    const memberDb = context('member');
    await assertSucceeds(setDoc(doc(memberDb, 'projects', projectId, 'pollVotes', 'single_member'), { pollId: 'single', userId: 'member', optionIds: ['a'] }));
    await assertFails(setDoc(doc(memberDb, 'projects', projectId, 'pollVotes', 'single_member'), { pollId: 'single', userId: 'member', optionIds: ['a', 'b'] }));
    await assertSucceeds(setDoc(doc(memberDb, 'projects', projectId, 'pollVotes', 'multi_member'), { pollId: 'multi', userId: 'member', optionIds: ['a', 'b'] }));
    await assertFails(setDoc(doc(memberDb, 'projects', projectId, 'pollVotes', 'single_admin'), { pollId: 'single', userId: 'admin', optionIds: ['a'] }));
    await assertFails(setDoc(doc(memberDb, 'projects', projectId, 'pollVotes', 'wrong-id'), { pollId: 'single', userId: 'member', optionIds: ['a'] }));
    await assertFails(updateDoc(doc(memberDb, 'projects', projectId, 'polls', 'single'), { closed: true }));
    await assertSucceeds(updateDoc(doc(context('admin'), 'projects', projectId, 'polls', 'single'), { closed: true }));
    await assertFails(setDoc(doc(memberDb, 'projects', projectId, 'pollVotes', 'single_member'), { pollId: 'single', userId: 'member', optionIds: ['b'] }));
    await assertFails(deleteDoc(doc(memberDb, 'projects', projectId, 'pollVotes', 'single_member')));
  });

  it('site feedback: ผู้ใช้เห็นเฉพาะของตัวเอง ผู้ดูแลเว็บเห็นและจัดการได้ทั้งหมด', async () => {
    await environment.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'siteAdmins', 'site-owner'), { role: 'owner', displayName: 'Platform Owner' });
      await setDoc(doc(db, 'siteAdmins', 'site-admin'), { role: 'admin', displayName: 'Site Admin' });
      await setDoc(doc(db, 'siteAdmins', 'invalid-role'), { role: 'member' });
    });
    const siteOwner = context('site-owner');
    const siteAdmin = context('site-admin');
    const fakeAdmin = context('fake', 'fake.admin@example.com');
    const invalidRole = context('invalid-role');
    const alice = context('alice');
    const entry = { title: 'Drag is laggy', body: 'On Firefox', category: 'bug', status: 'open', page: '/p/x/notes', adminReply: '', userId: 'alice', userName: 'Alice', userEmail: 'alice@example.com' };
    await assertSucceeds(setDoc(doc(alice, 'siteFeedback', 'f1'), entry));
    await assertFails(setDoc(doc(alice, 'siteFeedback', 'f2'), { ...entry, userId: 'bob' }));
    await assertFails(setDoc(doc(alice, 'siteFeedback', 'f3'), { ...entry, status: 'resolved' }));
    await assertFails(setDoc(doc(alice, 'siteFeedback', 'f4'), { ...entry, adminReply: 'self-reply' }));
    // Only the owner and the site admin can read it.
    await assertSucceeds(getDoc(doc(alice, 'siteFeedback', 'f1')));
    await assertSucceeds(getDocs(query(collection(alice, 'siteFeedback'), where('userId', '==', 'alice'))));
    await assertFails(getDocs(collection(alice, 'siteFeedback')));
    await assertFails(getDoc(doc(context('bob'), 'siteFeedback', 'f1')));
    await assertFails(getDocs(collection(fakeAdmin, 'siteFeedback')));
    await assertFails(getDocs(collection(invalidRole, 'siteFeedback')));
    await assertSucceeds(getDocs(collection(siteOwner, 'siteFeedback')));
    await assertSucceeds(getDocs(collection(siteAdmin, 'siteFeedback')));
    // Only the site admin triages; the admin can't rewrite the user's words.
    await assertFails(updateDoc(doc(alice, 'siteFeedback', 'f1'), { status: 'resolved' }));
    await assertSucceeds(updateDoc(doc(siteAdmin, 'siteFeedback', 'f1'), { status: 'in_review', adminReply: 'Looking into it' }));
    await assertSucceeds(updateDoc(doc(siteOwner, 'siteFeedback', 'f1'), { status: 'resolved' }));
    await assertFails(updateDoc(doc(siteAdmin, 'siteFeedback', 'f1'), { title: 'edited' }));
    // Owners can withdraw only while it is still open.
    await assertFails(deleteDoc(doc(alice, 'siteFeedback', 'f1')));
    await assertSucceeds(deleteDoc(doc(siteAdmin, 'siteFeedback', 'f1')));
  });

  it('site roles: ผู้ใช้อ่านได้เฉพาะสิทธิ์ของตนและแก้ไขเองไม่ได้', async () => {
    await environment.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'siteAdmins', 'site-admin'), { role: 'admin' });
    });
    const admin = context('site-admin');
    await assertSucceeds(getDoc(doc(admin, 'siteAdmins', 'site-admin')));
    await assertFails(getDoc(doc(admin, 'siteAdmins', 'someone-else')));
    await assertFails(getDocs(collection(admin, 'siteAdmins')));
    await assertFails(setDoc(doc(context('member'), 'siteAdmins', 'member'), { role: 'owner' }));
    await assertFails(updateDoc(doc(admin, 'siteAdmins', 'site-admin'), { role: 'owner' }));
    await assertFails(deleteDoc(doc(admin, 'siteAdmins', 'site-admin')));
  });

  it('comment แก้ได้เฉพาะเจ้าของ และคนนอกอ่านไม่ได้', async () => {
    await seedProject();
    const ref = doc(context('member'), 'projects', projectId, 'comments', 'c1');
    await assertSucceeds(setDoc(ref, { targetType: 'task', targetId: 't1', body: 'LGTM', authorName: 'Member', authorPhoto: '', createdBy: 'member' }));
    await assertSucceeds(updateDoc(ref, { body: 'LGTM!' }));
    await assertFails(updateDoc(doc(context('admin'), 'projects', projectId, 'comments', 'c1'), { body: 'edited' }));
    await assertSucceeds(deleteDoc(doc(context('admin'), 'projects', projectId, 'comments', 'c1')));
    await assertFails(getDoc(doc(context('outsider'), 'projects', projectId, 'comments', 'c1')));
    await assertFails(setDoc(doc(context('member'), 'projects', projectId, 'comments', 'c2'), { targetType: 'task', targetId: 't1', body: '', authorName: 'Member', authorPhoto: '', createdBy: 'member' }));
  });

  it('diagram node/edge: สมาชิกสร้างและลบได้ แต่ kind ต้องถูกต้อง', async () => {
    await seedProject();
    const ownerDb = context('owner');
    const node = doc(ownerDb, 'projects', projectId, 'diagramNodes', 'n1');
    await assertSucceeds(setDoc(node, { diagramId: 'd1', kind: 'actor', x: -120, y: 40, w: 60, h: 110, label: 'Customer', useCaseId: '', createdBy: 'owner' }));
    await assertFails(setDoc(doc(ownerDb, 'projects', projectId, 'diagramNodes', 'n2'), { diagramId: 'd1', kind: 'database', x: 0, y: 0, w: 1, h: 1, label: '', useCaseId: '', createdBy: 'owner' }));
    await assertFails(setDoc(doc(ownerDb, 'projects', projectId, 'diagramEdges', 'e0'), { diagramId: 'd1', from: 'n1', to: 'n3', kind: 'uses', createdBy: 'owner' }));
    await assertSucceeds(setDoc(doc(ownerDb, 'projects', projectId, 'diagramEdges', 'e1'), { diagramId: 'd1', from: 'n1', to: 'n3', kind: 'association', createdBy: 'owner' }));
    const memberDb = context('member');
    await assertSucceeds(updateDoc(doc(memberDb, 'projects', projectId, 'diagramNodes', 'n1'), { x: 300 }));
    await assertFails(updateDoc(doc(memberDb, 'projects', projectId, 'diagramNodes', 'n1'), { kind: 'usecase' }));
    await assertSucceeds(deleteDoc(doc(memberDb, 'projects', projectId, 'diagramEdges', 'e1')));
    await assertSucceeds(deleteDoc(doc(memberDb, 'projects', projectId, 'diagramNodes', 'n1')));
    await assertFails(setDoc(doc(context('outsider'), 'projects', projectId, 'diagramNodes', 'n9'), { diagramId: 'd1', kind: 'actor', x: 0, y: 0, w: 1, h: 1, label: '', useCaseId: '', createdBy: 'outsider' }));
  });

  it('gacha history และ bag อ่านเขียนได้เฉพาะสมาชิกใน active project และ history แก้ย้อนหลังไม่ได้', async () => {
    await seedProject();
    const memberDb = context('member');
    const drawRef = doc(memberDb, 'projects', projectId, 'gachaDraws', 'draw-1');
    const bagRef = doc(memberDb, 'projects', projectId, 'gachaBags', 'a'.repeat(64));
    await assertSucceeds(setDoc(bagRef, { candidateIds: ['admin', 'member'], winCounts: { admin: 0, member: 1 }, updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(drawRef, validGachaDraw()));
    await assertSucceeds(getDoc(drawRef));
    await assertFails(updateDoc(drawRef, { initiatedByName: 'changed' }));
    await assertFails(deleteDoc(drawRef));
    await assertFails(getDoc(doc(context('outsider'), 'projects', projectId, 'gachaDraws', 'draw-1')));
    await assertFails(setDoc(doc(context('outsider'), 'projects', projectId, 'gachaDraws', 'draw-2'), validGachaDraw('outsider')));
  });

  it('gacha ปฏิเสธข้อมูล spoofed, candidate นอกโปรเจกต์, payload เกินขนาด และการเขียนหลัง archive', async () => {
    await seedProject();
    const db = context('member');
    const target = (id: string) => doc(db, 'projects', projectId, 'gachaDraws', id);
    await assertFails(setDoc(target('spoof'), { ...validGachaDraw('admin') }));
    await assertFails(setDoc(target('outsider-candidate'), { ...validGachaDraw(), candidateIds: ['member', 'outsider'] }));
    await assertFails(setDoc(target('outsider-winner'), { ...validGachaDraw(), winnerIds: ['outsider'] }));
    await assertFails(setDoc(target('too-many-targets'), { ...validGachaDraw(), targetIds: Array.from({ length: 21 }, (_, index) => `t${index}`), results: Array.from({ length: 21 }, () => validGachaDraw().results[0]) }));
    await assertFails(setDoc(target('extra-field'), { ...validGachaDraw(), reroll: true }));
    await assertSucceeds(updateDoc(doc(context('owner'), 'projects', projectId), { archived: true }));
    await assertFails(setDoc(target('archived'), validGachaDraw()));
    await assertFails(setDoc(doc(db, 'projects', projectId, 'gachaBags', 'b'.repeat(64)), { candidateIds: ['member'], winCounts: { member: 0 }, updatedAt: serverTimestamp() }));
  });

  it('gacha batch ล้มเหลวทั้งรอบเมื่อ history ไม่ผ่าน validation', async () => {
    await seedProject();
    await environment.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'projects', projectId, 'tasks', 'atomic-task'), {
      title: 'Atomic', description: '', status: 'todo', priority: 'medium', assigneeIds: [], tags: [], dueDate: '', milestoneId: '', order: 1, createdBy: 'member',
    }));
    const db = context('member');
    const batch = writeBatch(db);
    batch.update(doc(db, 'projects', projectId, 'tasks', 'atomic-task'), { assigneeIds: ['member'] });
    batch.set(doc(db, 'projects', projectId, 'gachaDraws', 'invalid-atomic'), { ...validGachaDraw(), winnerIds: ['outsider'] });
    await assertFails(batch.commit());
    expect((await getDoc(doc(db, 'projects', projectId, 'tasks', 'atomic-task'))).data()?.assigneeIds).toEqual([]);
  });

  it('อนุญาตให้สร้าง user profile ได้เฉพาะอีเมลตามโดเมนที่กำหนดในกฎความปลอดภัย', async () => {
    // 1. Success with configured domain (lowercase)
    const allowedDb = context('student1', 'student1@example.com');
    await assertSucceeds(
      setDoc(doc(allowedDb, 'users', 'student1'), {
        displayName: 'Student One',
        email: 'student1@example.com',
        photoURL: '',
        locale: 'th',
        theme: 'system',
      }),
    );

    // 2. Success with uppercase EXAMPLE.COM
    const upperDb = context('student2', 'student2@EXAMPLE.COM');
    await assertSucceeds(
      setDoc(doc(upperDb, 'users', 'student2'), {
        displayName: 'Student Two',
        email: 'student2@EXAMPLE.COM',
        photoURL: '',
        locale: 'th',
        theme: 'system',
      }),
    );

    // 3. Fails with a domain outside the configured allowlist
    const gmailDb = context('outsider', 'outsider@hotmail.com');
    await assertFails(
      setDoc(doc(gmailDb, 'users', 'outsider'), {
        displayName: 'Outsider',
        email: 'outsider@hotmail.com',
        photoURL: '',
        locale: 'th',
        theme: 'system',
      }),
    );

    // 4. Fails if user tries to register someone else's uid
    await assertFails(
      setDoc(doc(allowedDb, 'users', 'other-uid'), {
        displayName: 'Impersonator',
        email: 'student1@example.com',
        photoURL: '',
        locale: 'th',
        theme: 'system',
      }),
    );

    // 5. Fails if email in doc does not match auth token email
    await assertFails(
      setDoc(doc(allowedDb, 'users', 'student1'), {
        displayName: 'Student One',
        email: 'another@example.com',
        photoURL: '',
        locale: 'th',
        theme: 'system',
      }),
    );
  });

  it('GitHub integration: account linking, repo binding, and collaborator permission rules', async () => {
    await seedProject();

    const memberDb = context('member');
    const memberWithGitHubDb = context('member', 'member@example.com', {
      firebase: { identities: { 'github.com': ['12345'] } },
    });

    // 1. Anti-tamper: User WITHOUT linked GitHub identity in token CANNOT set githubUsername
    await assertFails(
      updateDoc(doc(memberDb, 'users', 'member'), {
        githubUsername: 'octocat',
      }),
    );

    // User WITH linked GitHub identity can set githubUsername, githubId, githubConnectedAt
    await assertSucceeds(
      updateDoc(doc(memberWithGitHubDb, 'users', 'member'), {
        githubUsername: 'octocat',
        githubId: 12345,
        githubConnectedAt: serverTimestamp(),
      }),
    );

    // Another user cannot update member profile
    await assertFails(
      updateDoc(doc(context('admin'), 'users', 'member'), {
        githubUsername: 'hacker',
      }),
    );

    // 2. Project Owner can link and update githubRepo
    const ownerDb = context('owner');
    const repoData = {
      id: 999,
      owner: 'octocat',
      name: 'hello-world',
      fullName: 'octocat/hello-world',
      url: 'https://github.com/octocat/hello-world',
      private: true,
      defaultBranch: 'main',
      linkedAt: serverTimestamp(),
      linkedBy: 'owner',
    };
    await assertSucceeds(
      updateDoc(doc(ownerDb, 'projects', projectId), {
        githubRepo: repoData,
      }),
    );

    // Owner can unlink githubRepo
    await assertSucceeds(
      updateDoc(doc(ownerDb, 'projects', projectId), {
        githubRepo: deleteField(),
      }),
    );

    // Admin or Member cannot link or unlink githubRepo
    await assertFails(
      updateDoc(doc(context('admin'), 'projects', projectId), {
        githubRepo: repoData,
      }),
    );
    await assertFails(
      updateDoc(doc(memberDb, 'projects', projectId), {
        githubRepo: repoData,
      }),
    );

    // 3. Project Owner can manage collaborator githubPermission on memberships
    const memberMembershipDoc = doc(ownerDb, 'memberships', `${projectId}_member`);
    await assertSucceeds(
      updateDoc(memberMembershipDoc, {
        githubPermission: 'push',
      }),
    );
    await assertSucceeds(
      updateDoc(memberMembershipDoc, {
        githubPermission: deleteField(),
      }),
    );

    // Member cannot modify githubPermission
    await assertFails(
      updateDoc(doc(memberDb, 'memberships', `${projectId}_member`), {
        githubPermission: 'admin',
      }),
    );

    // 4. Anti-tamper: Member WITHOUT linked GitHub token cannot update githubUsername on membership
    await assertFails(
      updateDoc(doc(memberDb, 'memberships', `${projectId}_member`), {
        githubUsername: 'octocat',
      }),
    );

    // Member WITH linked GitHub token can update their own githubUsername on their membership
    await assertSucceeds(
      updateDoc(doc(memberWithGitHubDb, 'memberships', `${projectId}_member`), {
        githubUsername: 'octocat',
      }),
    );

    // Member WITH linked GitHub token can update both githubUsername and githubId
    await assertSucceeds(
      updateDoc(doc(memberWithGitHubDb, 'memberships', `${projectId}_member`), {
        githubUsername: 'octocat',
        githubId: '12345',
      }),
    );

    // Member WITH linked GitHub token can unlink both githubUsername and githubId
    await assertSucceeds(
      updateDoc(doc(memberWithGitHubDb, 'memberships', `${projectId}_member`), {
        githubUsername: deleteField(),
        githubId: deleteField(),
      }),
    );

    // Member cannot sneak role change with github fields
    await assertFails(
      updateDoc(doc(memberWithGitHubDb, 'memberships', `${projectId}_member`), {
        githubUsername: 'octocat',
        githubId: '12345',
        role: 'owner',
      }),
    );

    // Member cannot update someone else githubUsername on another membership
    await assertFails(
      updateDoc(doc(memberWithGitHubDb, 'memberships', `${projectId}_admin`), {
        githubUsername: 'octocat',
      }),
    );
  });

  it('GitHub revocation queue: admin/self create, owner-only resolve, no edits, proven handles only', async () => {
    await seedProject();
    const revocation = (overrides: Record<string, unknown> = {}) => ({
      githubUsername: 'octocat',
      userId: 'member',
      displayName: 'member',
      permission: 'push',
      repoOwner: 'owner-gh',
      repoName: 'alpha',
      reason: 'removed',
      createdBy: 'admin',
      createdAt: serverTimestamp(),
      ...overrides,
    });
    const queue = (db: ReturnType<typeof context>) => collection(db, 'projects', projectId, 'githubRevocations');
    const adminDb = context('admin');
    const memberDb = context('member');
    const ownerDb = context('owner');

    // Admin removes a member and queues the revocation atomically.
    const batch = writeBatch(adminDb);
    batch.delete(doc(adminDb, 'memberships', `${projectId}_member`));
    batch.set(doc(queue(adminDb), 'r1'), revocation());
    await assertSucceeds(batch.commit());

    // Spoofed author or unknown reason/permission is rejected.
    await assertFails(setDoc(doc(queue(adminDb), 'r2'), revocation({ createdBy: 'owner' })));
    await assertFails(setDoc(doc(queue(adminDb), 'r3'), revocation({ reason: 'whatever' })));
    await assertFails(setDoc(doc(queue(adminDb), 'r4'), revocation({ permission: 'root' })));
    await assertFails(setDoc(doc(queue(adminDb), 'r5'), { ...revocation(), extra: true }));

    // Only admins read the queue; nobody edits it; only the owner resolves it.
    await assertSucceeds(getDocs(queue(adminDb)));
    await assertFails(updateDoc(doc(queue(adminDb), 'r1'), { permission: 'pull' }));
    await assertFails(deleteDoc(doc(queue(adminDb), 'r1')));
    await assertSucceeds(getDoc(doc(queue(ownerDb), 'r1')));
    await assertSucceeds(deleteDoc(doc(queue(ownerDb), 'r1')));

    // A member may only queue their own access, and only when disconnecting.
    await seedProject();
    await assertFails(getDocs(queue(memberDb)));
    await assertSucceeds(setDoc(doc(queue(memberDb), 'self'), revocation({ createdBy: 'member', reason: 'disconnected' })));
    await assertFails(setDoc(doc(queue(memberDb), 'other'), revocation({ createdBy: 'member', userId: 'admin', reason: 'disconnected' })));
    await assertFails(setDoc(doc(queue(memberDb), 'removed'), revocation({ createdBy: 'member', reason: 'removed' })));
    await assertFails(setDoc(doc(queue(context('outsider')), 'x'), revocation({ createdBy: 'outsider', userId: 'outsider', reason: 'disconnected' })));

    // Disconnect batch: clear own handle (token no longer has github.com) + queue, in one commit.
    await environment.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'memberships', `${projectId}_member`), { githubUsername: 'octocat', githubId: '1', githubPermission: 'push' });
    });
    const disconnect = writeBatch(memberDb);
    disconnect.update(doc(memberDb, 'memberships', `${projectId}_member`), { githubUsername: deleteField(), githubId: deleteField() });
    disconnect.set(doc(queue(memberDb), 'disc'), revocation({ createdBy: 'member', reason: 'disconnected' }));
    await assertSucceeds(disconnect.commit());

    // Joining through an invite cannot carry a GitHub handle without a GitHub identity.
    await environment.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', 'join'), { projectId, projectName: 'Alpha', role: 'member', status: 'active', createdBy: 'owner', expiresAt: Timestamp.fromDate(new Date(Date.now() + 86400000)) });
    });
    const joiner = { projectId, userId: 'newbie', displayName: 'newbie', email: 'newbie@example.com', photoURL: '', role: 'member', inviteId: 'join' };
    await assertFails(setDoc(doc(context('newbie'), 'memberships', `${projectId}_newbie`), { ...joiner, githubUsername: 'torvalds' }));
    const provenDb = context('newbie', 'newbie@example.com', { firebase: { identities: { 'github.com': ['99'] } } });
    await assertSucceeds(setDoc(doc(provenDb, 'memberships', `${projectId}_newbie`), { ...joiner, githubUsername: 'newbie-gh' }));
  });
});
