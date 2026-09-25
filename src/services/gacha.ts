import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { GachaBag, GachaDraw, GachaMemberSnapshot, Membership, Project, ProjectUseCase, Task } from '@/types';
import { candidatePoolKey, drawFromBag, type GachaTargetInput } from '@/utils/gacha';
import { activityData, database, withId } from './helpers';

export const MAX_GACHA_TARGETS = 20;
export const MAX_GACHA_CARDS = 50;

export interface RunGachaInput {
  projectId: string;
  candidateIds: string[];
  targets: Array<Pick<GachaTargetInput, 'targetType' | 'targetId' | 'winnerCount'>>;
  user: User;
  animationStyle: 'golden' | 'pack';
}

export async function runGachaDraw(input: RunGachaInput): Promise<string> {
  const candidateIds = [...new Set(input.candidateIds)].sort();
  const cardCount = input.targets.reduce((sum, target) => sum + target.winnerCount, 0);
  if (!candidateIds.length || !input.targets.length) throw new Error('GACHA_SELECTION_REQUIRED');
  if (input.targets.length > MAX_GACHA_TARGETS || cardCount > MAX_GACHA_CARDS) throw new Error('GACHA_LIMIT_EXCEEDED');
  if (input.targets.some((target) => target.winnerCount < 1 || !Number.isInteger(target.winnerCount))) throw new Error('INVALID_WINNER_COUNT');

  const store = database();
  const poolKey = await candidatePoolKey(candidateIds);
  const projectRef = doc(store, 'projects', input.projectId);
  const bagRef = doc(store, 'projects', input.projectId, 'gachaBags', poolKey);
  const drawRef = doc(collection(store, 'projects', input.projectId, 'gachaDraws'));
  const activityRef = doc(collection(store, 'projects', input.projectId, 'activities'));

  await runTransaction(store, async (transaction) => {
    const targetRefs = input.targets.map((target) => doc(store, 'projects', input.projectId, target.targetType === 'task' ? 'tasks' : 'useCases', target.targetId));
    const memberRefs = candidateIds.map((uid) => doc(store, 'memberships', `${input.projectId}_${uid}`));
    const [projectSnapshot, bagSnapshot, targetSnapshots, memberSnapshots] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(bagRef),
      Promise.all(targetRefs.map((ref) => transaction.get(ref))),
      Promise.all(memberRefs.map((ref) => transaction.get(ref))),
    ]);
    if (!projectSnapshot.exists() || (projectSnapshot.data() as Project).archived) throw new Error('GACHA_PROJECT_ARCHIVED');
    const project = projectSnapshot.data() as Project;
    if (!project.memberIds.includes(input.user.uid) || candidateIds.some((uid) => !project.memberIds.includes(uid))) throw new Error('GACHA_MEMBERS_CHANGED');
    if (memberSnapshots.some((snapshot, index) => !snapshot.exists() || (snapshot.data() as Membership).userId !== candidateIds[index])) throw new Error('GACHA_MEMBERS_CHANGED');

    const targets: GachaTargetInput[] = targetSnapshots.map((snapshot, index) => {
      const requested = input.targets[index];
      if (!snapshot.exists()) throw new Error('GACHA_TARGET_CHANGED');
      if (requested.targetType === 'task') {
        const task = snapshot.data() as Task;
        return { ...requested, targetTitle: task.title, previousAssigneeIds: task.assigneeIds || [] };
      }
      const useCase = snapshot.data() as ProjectUseCase;
      if (useCase.assigneeId || useCase.status !== 'open' || requested.winnerCount !== 1) throw new Error('GACHA_TARGET_CHANGED');
      return { ...requested, targetTitle: `${useCase.code ? `${useCase.code} · ` : ''}${useCase.title}`, previousAssigneeIds: [] };
    });
    const previousBag = bagSnapshot.exists() ? (bagSnapshot.data() as GachaBag) : null;
    const { results, winCounts } = drawFromBag(candidateIds, targets, previousBag?.winCounts || {});
    const candidates: GachaMemberSnapshot[] = memberSnapshots.map((snapshot) => {
      const member = snapshot.data() as Membership;
      return { userId: member.userId, displayName: member.displayName, photoURL: member.photoURL || '' };
    });
    results.forEach((result, index) => {
      const ref = targetRefs[index];
      if (result.targetType === 'task') {
        transaction.update(ref, { assigneeIds: [...new Set([...result.previousAssigneeIds, ...result.winnerIds])], updatedAt: serverTimestamp() });
      } else {
        transaction.update(ref, { assigneeId: result.winnerIds[0], status: 'assigned', updatedAt: serverTimestamp() });
      }
    });
    transaction.set(bagRef, { candidateIds, winCounts, updatedAt: serverTimestamp() });
    transaction.set(drawRef, {
      candidateIds,
      winnerIds: results.flatMap((result) => result.winnerIds),
      targetIds: results.map((result) => result.targetId),
      candidates,
      results,
      initiatedBy: input.user.uid,
      initiatedByName: input.user.displayName || input.user.email || 'User',
      poolKey,
      animationVersion: 1,
      animationStyle: input.animationStyle,
      createdAt: serverTimestamp(),
    });
    transaction.set(activityRef, activityData(
      input.user,
      'gacha_draw',
      `สุ่มผู้รับผิดชอบ ${results.length} รายการ (${cardCount} คน)`,
      `drew assignees for ${results.length} item(s) (${cardCount} winner(s))`,
      drawRef.id,
    ));
  });
  return drawRef.id;
}

export function subscribeLatestGachaDraw(projectId: string, callback: (draw: GachaDraw | null) => void): Unsubscribe {
  const latest = query(collection(database(), 'projects', projectId, 'gachaDraws'), orderBy('createdAt', 'desc'), limit(1));
  return onSnapshot(latest, (snapshot) => callback(snapshot.empty ? null : withId<GachaDraw>(snapshot.docs[0])));
}

export function subscribeRecentGachaDraws(
  projectId: string,
  limitCount = 15,
  callback: (draws: GachaDraw[]) => void,
): Unsubscribe {
  const q = query(
    collection(database(), 'projects', projectId, 'gachaDraws'),
    orderBy('createdAt', 'desc'),
    limit(limitCount),
  );
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((item) => withId<GachaDraw>(item)));
  });
}
