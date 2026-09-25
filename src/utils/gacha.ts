import type { GachaTargetResult, GachaTargetType } from '@/types';

export type RandomIndex = (upperExclusive: number) => number;

export interface GachaTargetInput {
  targetType: GachaTargetType;
  targetId: string;
  targetTitle: string;
  winnerCount: number;
  previousAssigneeIds: string[];
}

export function cryptoRandomIndex(upperExclusive: number): number {
  if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0) throw new Error('INVALID_RANDOM_BOUND');
  const range = 0x1_0000_0000;
  const limit = range - (range % upperExclusive);
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= limit);
  return values[0] % upperExclusive;
}

export function oddsFor(eligibleIds: string[], counts: Record<string, number>): Record<string, number> {
  if (!eligibleIds.length) return {};
  const minimum = Math.min(...eligibleIds.map((id) => counts[id] || 0));
  const tier = eligibleIds.filter((id) => (counts[id] || 0) === minimum);
  return Object.fromEntries(eligibleIds.map((id) => [id, tier.includes(id) ? 1 / tier.length : 0]));
}

export function drawFromBag(
  candidateIds: string[],
  targets: GachaTargetInput[],
  initialCounts: Record<string, number>,
  randomIndex: RandomIndex = cryptoRandomIndex,
): { results: GachaTargetResult[]; winCounts: Record<string, number> } {
  const counts = Object.fromEntries(candidateIds.map((id) => [id, initialCounts[id] || 0]));
  const results = targets.map((target) => {
    const blocked = new Set(target.previousAssigneeIds);
    const eligibleIds = candidateIds.filter((id) => !blocked.has(id));
    if (target.winnerCount < 1 || target.winnerCount > eligibleIds.length) throw new Error('NOT_ENOUGH_ELIGIBLE_CANDIDATES');
    const odds = oddsFor(eligibleIds, counts);
    const available = [...eligibleIds];
    const winnerIds: string[] = [];
    for (let index = 0; index < target.winnerCount; index += 1) {
      const minimum = Math.min(...available.map((id) => counts[id] || 0));
      const tier = available.filter((id) => (counts[id] || 0) === minimum);
      const winner = tier[randomIndex(tier.length)];
      winnerIds.push(winner);
      counts[winner] = (counts[winner] || 0) + 1;
      available.splice(available.indexOf(winner), 1);
    }
    return { ...target, eligibleIds, odds, winnerIds };
  });
  return { results, winCounts: counts };
}

export async function candidatePoolKey(candidateIds: string[]): Promise<string> {
  const canonical = [...candidateIds].sort().join('\n');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}
