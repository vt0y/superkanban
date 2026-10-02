import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { Locale, Project } from '@/types';
import { templateById, type ProjectTemplateId } from '@/config/project-templates';
import { activityData, database, withId } from './helpers';

export function subscribeProjects(
  uid: string,
  callback: (items: Project[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(database(), 'projects'), where('memberIds', 'array-contains', uid)),
    (snapshot) => {
      callback(snapshot.docs.map((item) => withId<Project>(item)).sort((a, b) => a.name.localeCompare(b.name)));
    },
    onError,
  );
}

export async function createProject(
  user: User,
  input: { name: string; description: string; color: string; template?: ProjectTemplateId; locale?: Locale },
): Promise<string> {
  const store = database();
  const projectRef = doc(collection(store, 'projects'));
  const membershipRef = doc(store, 'memberships', `${projectRef.id}_${user.uid}`);
  const batch = writeBatch(store);
  batch.set(projectRef, {
    name: input.name.trim(),
    description: input.description.trim(),
    color: input.color,
    ownerId: user.uid,
    memberIds: [user.uid],
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(membershipRef, {
    projectId: projectRef.id,
    userId: user.uid,
    displayName: user.displayName || 'User',
    email: user.email || '',
    photoURL: user.photoURL || '',
    role: 'owner',
    joinedAt: serverTimestamp(),
  });
  await batch.commit();

  // Work-item rules require the membership to exist, so seed project content
  // only after the atomic project + owner-membership bootstrap succeeds.
  const seedBatch = writeBatch(store);
  const activityRef = doc(collection(store, 'projects', projectRef.id, 'activities'));
  seedBatch.set(
    activityRef,
    activityData(user, 'project_created', `สร้างโปรเจกต์ “${input.name}”`, `created project “${input.name}”`, projectRef.id),
  );
  const template = templateById(input.template ?? 'blank');
  template.labels.forEach((label) => {
    seedBatch.set(doc(collection(store, 'projects', projectRef.id, 'labels')), {
      name: label.name, color: label.color, description: '', createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
  template.milestones.forEach((milestone) => {
    seedBatch.set(doc(collection(store, 'projects', projectRef.id, 'milestones')), {
      title: input.locale === 'en' ? milestone.en : milestone.th, description: '', dueDate: '', dueTime: '', status: 'active', dependsOn: [],
      createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
  await seedBatch.commit();
  return projectRef.id;
}

export function subscribeProject(projectId: string, callback: (project: Project | null) => void): Unsubscribe {
  return onSnapshot(doc(database(), 'projects', projectId), (snap) =>
    callback(snap.exists() ? withId<Project>(snap) : null),
  );
}

export async function getProject(projectId: string): Promise<Project | null> {
  const snapshot = await getDoc(doc(database(), 'projects', projectId));
  return snapshot.exists() ? withId<Project>(snapshot) : null;
}

export async function updateProject(projectId: string, values: Partial<Project>): Promise<void> {
  await updateDoc(doc(database(), 'projects', projectId), { ...values, updatedAt: serverTimestamp() });
}
