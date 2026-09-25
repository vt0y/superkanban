import type { User } from 'firebase/auth';
import { collection, doc, serverTimestamp, writeBatch, type WriteBatch } from 'firebase/firestore';
import { LABEL_COLORS } from '@/config/constants';
import type { Label, Task } from '@/types';
import { activityData, BATCH_CHUNK, database } from './helpers';

/** Runs `writes` spread over as many batches as needed (Firestore caps a batch at 500 writes). */
async function chunked(writes: ((batch: WriteBatch) => void)[]): Promise<void> {
  const store = database();
  for (let start = 0; start < writes.length; start += BATCH_CHUNK) {
    const batch = writeBatch(store);
    writes.slice(start, start + BATCH_CHUNK).forEach((write) => write(batch));
    await batch.commit();
  }
}

export const nextLabelColor = (labels: Pick<Label, 'color'>[]) => LABEL_COLORS[labels.length % LABEL_COLORS.length];

export async function createLabel(projectId: string, name: string, color: string, user: User): Promise<string> {
  const ref = doc(collection(database(), 'projects', projectId, 'labels'));
  await chunked([(batch) => batch.set(ref, { name: name.trim().slice(0, 50), color, description: '', createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })]);
  return ref.id;
}

/** Deletes a label and removes it from every task that uses it. */
export async function deleteLabel(projectId: string, labelId: string, tasks: Task[]): Promise<void> {
  const store = database();
  await chunked([
    ...tasks.filter((task) => task.labelIds?.includes(labelId)).map((task) => (batch: WriteBatch) =>
      batch.update(doc(store, 'projects', projectId, 'tasks', task.id), { labelIds: task.labelIds!.filter((id) => id !== labelId), updatedAt: serverTimestamp() })),
    (batch: WriteBatch) => batch.delete(doc(store, 'projects', projectId, 'labels', labelId)),
  ]);
}

/**
 * Turns the old free-text tags into project labels: creates a label for each distinct tag
 * (case-insensitive, reusing labels with the same name) and moves every task's tags to labelIds.
 */
export async function importTagsAsLabels(projectId: string, tasks: Task[], labels: Label[], user: User): Promise<number> {
  const store = database();
  const byName = new Map(labels.map((label) => [label.name.toLowerCase(), label.id]));
  const writes: ((batch: WriteBatch) => void)[] = [];
  let created = 0;
  for (const tag of tasks.flatMap((task) => task.tags)) {
    const name = tag.trim().slice(0, 50);
    if (!name || byName.has(name.toLowerCase())) continue;
    const ref = doc(collection(store, 'projects', projectId, 'labels'));
    const color = LABEL_COLORS[(labels.length + created++) % LABEL_COLORS.length];
    byName.set(name.toLowerCase(), ref.id);
    writes.push((batch) => batch.set(ref, { name, color, description: '', createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  }
  for (const task of tasks.filter((item) => item.tags.length)) {
    const ids = task.tags.map((tag) => byName.get(tag.trim().slice(0, 50).toLowerCase())).filter((id): id is string => !!id);
    writes.push((batch) => batch.update(doc(store, 'projects', projectId, 'tasks', task.id), { labelIds: [...new Set([...(task.labelIds || []), ...ids])], tags: [], updatedAt: serverTimestamp() }));
  }
  writes.push((batch) => batch.set(doc(collection(store, 'projects', projectId, 'activities')),
    activityData(user, 'labels_imported', `แปลง tag เป็น label ${created} รายการ`, `converted tags into ${created} labels`, '')));
  await chunked(writes);
  return created;
}
