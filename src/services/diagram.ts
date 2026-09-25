import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import type { DiagramNode } from '@/types';
import { activityData, database } from './helpers';

/** Creates a use case diagram node; `usecase` nodes also create the linked ProjectUseCase in the same batch. */
export async function createDiagramNode(
  projectId: string,
  node: Omit<DiagramNode, 'id' | 'useCaseId' | 'createdBy' | 'createdAt' | 'updatedAt'>,
  user: User,
  useCaseCode?: string,
): Promise<string> {
  const store = database();
  const batch = writeBatch(store);
  const nodeRef = doc(collection(store, 'projects', projectId, 'diagramNodes'));
  let useCaseId = '';
  if (node.kind === 'usecase' && useCaseCode) {
    const useCaseRef = doc(collection(store, 'projects', projectId, 'useCases'));
    useCaseId = useCaseRef.id;
    batch.set(useCaseRef, {
      code: useCaseCode,
      title: node.label,
      actor: '',
      details: '',
      businessRules: [],
      assigneeId: '',
      status: 'open',
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(
      doc(collection(store, 'projects', projectId, 'activities')),
      activityData(user, 'usecase_created', `เพิ่ม Use Case ${useCaseCode}`, `created use case ${useCaseCode}`, useCaseId),
    );
  }
  batch.set(nodeRef, { ...node, useCaseId, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await batch.commit();
  return nodeRef.id;
}

/** Deletes diagram nodes plus every edge touching them. Linked use cases are kept in the list. */
export async function deleteDiagramElements(projectId: string, nodeIds: string[], edgeIds: string[]): Promise<void> {
  const store = database();
  const batch = writeBatch(store);
  nodeIds.forEach((id) => batch.delete(doc(store, 'projects', projectId, 'diagramNodes', id)));
  edgeIds.forEach((id) => batch.delete(doc(store, 'projects', projectId, 'diagramEdges', id)));
  await batch.commit();
}
