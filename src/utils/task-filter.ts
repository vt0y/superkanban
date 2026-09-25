import type { Label, Membership, Milestone, Task } from '@/types';
import { dueState, parseISODate, toISODate } from './calendar';

export const FILTER_QUALIFIERS = ['label', 'assignee', 'priority', 'status', 'milestone', 'is', 'due', 'no'] as const;
export type FilterQualifier = (typeof FILTER_QUALIFIERS)[number];

export interface FilterTerm { key: FilterQualifier; value: string; negated: boolean }
export interface ParsedQuery { terms: FilterTerm[]; text: string[] }

export interface FilterContext {
  userId: string;
  labels: Label[];
  members: Membership[];
  milestones: Milestone[];
  /** Milestone ids whose prerequisites are still open. */
  blockedMilestoneIds?: Set<string>;
  today?: Date;
}

/** Splits on spaces while keeping `"quoted values"` (also after `key:`) together. */
function tokenize(query: string): string[] {
  return [...query.matchAll(/-?[\w@]+:"[^"]*"?|"[^"]*"?|\S+/g)].map((match) => match[0]);
}

const unquote = (value: string) => value.replace(/^"|"$/g, '');

export function parseTaskQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], text: [] };
  for (const token of tokenize(query.trim())) {
    const match = token.match(/^(-?)([a-z]+):(.*)$/i);
    const key = match?.[2].toLowerCase() as FilterQualifier | undefined;
    if (match && key && FILTER_QUALIFIERS.includes(key) && match[3]) parsed.terms.push({ key, value: unquote(match[3]).toLowerCase(), negated: match[1] === '-' });
    else if (unquote(token)) parsed.text.push(unquote(token).toLowerCase());
  }
  return parsed;
}

const STATUS_ALIASES: Record<string, string> = { progress: 'in_progress', 'in-progress': 'in_progress', inprogress: 'in_progress', doing: 'in_progress', 'to-do': 'todo' };

function matchTerm(task: Task, term: FilterTerm, ctx: FilterContext): boolean {
  const value = term.value;
  const labelNames = () => (task.labelIds || []).map((id) => ctx.labels.find((label) => label.id === id)?.name.toLowerCase()).filter(Boolean) as string[];
  switch (term.key) {
    case 'label': return labelNames().includes(value) || (task.tags || []).some((tag) => tag.toLowerCase() === value);
    case 'assignee': {
      if (value === '@me') return task.assigneeIds.includes(ctx.userId);
      return ctx.members.some((member) => task.assigneeIds.includes(member.userId)
        && (member.displayName.toLowerCase().includes(value) || member.email.toLowerCase().split('@')[0] === value));
    }
    case 'priority': return task.priority === value;
    case 'status': return task.status === (STATUS_ALIASES[value] || value);
    case 'milestone': return ctx.milestones.some((milestone) => milestone.id === task.milestoneId && milestone.title.toLowerCase().includes(value));
    case 'is':
      if (value === 'open') return task.status !== 'done';
      if (value === 'done' || value === 'closed') return task.status === 'done';
      if (value === 'overdue') return task.status !== 'done' && dueState(task.dueDate, ctx.today, undefined, task.dueTime) === 'overdue';
      if (value === 'blocked') return !!ctx.blockedMilestoneIds?.has(task.milestoneId);
      return false;
    case 'due': {
      if (value === 'none') return !task.dueDate;
      if (!task.dueDate) return false;
      const today = ctx.today || new Date();
      if (value === 'today') return task.dueDate === toISODate(today);
      if (value === 'week') {
        const days = (parseISODate(task.dueDate).getTime() - parseISODate(toISODate(today)).getTime()) / 86_400_000;
        return days >= 0 && days < 7;
      }
      return task.dueDate.startsWith(value);
    }
    case 'no':
      if (value === 'label') return !(task.labelIds || []).length && !(task.tags || []).length;
      if (value === 'assignee') return !task.assigneeIds.length;
      if (value === 'milestone') return !ctx.milestones.some((milestone) => milestone.id === task.milestoneId);
      if (value === 'due') return !task.dueDate;
      return false;
  }
}

export function matchTask(task: Task, parsed: ParsedQuery, ctx: FilterContext): boolean {
  if (!parsed.terms.every((term) => matchTerm(task, term, ctx) !== term.negated)) return false;
  if (!parsed.text.length) return true;
  const labelNames = (task.labelIds || []).map((id) => ctx.labels.find((label) => label.id === id)?.name || '');
  const haystack = [task.title, task.description, ...(task.tags || []), ...labelNames].join(' ').toLowerCase();
  return parsed.text.every((word) => haystack.includes(word));
}

/** Adds `term` to the query, or removes it when it is already there. */
export function toggleQueryTerm(query: string, term: string): string {
  const tokens = tokenize(query.trim());
  return tokens.includes(term) ? tokens.filter((token) => token !== term).join(' ') : [...tokens, term].join(' ');
}

/** Value for a qualifier, quoted when it has spaces. */
export const queryValue = (value: string) => (/\s/.test(value) ? `"${value}"` : value);
