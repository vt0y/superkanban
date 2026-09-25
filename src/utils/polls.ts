import type { Poll, PollVote } from '@/types';
import { dueDeadline } from './calendar';

/** Radio behaviour for single-choice polls, checkbox behaviour for multiple-choice polls. */
export function toggleOption(current: string[], optionId: string, multiple: boolean): string[] {
  if (current.includes(optionId)) return current.filter((id) => id !== optionId);
  return multiple ? [...current, optionId] : [optionId];
}

export interface OptionResult { id: string; label: string; count: number; percent: number; voterIds: string[] }

export function tally(poll: Pick<Poll, 'id' | 'options'>, votes: Pick<PollVote, 'pollId' | 'userId' | 'optionIds'>[]): { voters: number; results: OptionResult[] } {
  const relevant = votes.filter((vote) => vote.pollId === poll.id && vote.optionIds.length);
  const results = poll.options.map((option) => {
    const voterIds = relevant.filter((vote) => vote.optionIds.includes(option.id)).map((vote) => vote.userId);
    return { id: option.id, label: option.label, count: voterIds.length, percent: relevant.length ? Math.round(voterIds.length / relevant.length * 100) : 0, voterIds };
  });
  return { voters: relevant.length, results };
}

export function isPollOpen(poll: Pick<Poll, 'closed' | 'deadline' | 'deadlineTime'>, now = new Date()): boolean {
  if (poll.closed) return false;
  return !poll.deadline || dueDeadline(poll.deadline, poll.deadlineTime) >= now;
}
