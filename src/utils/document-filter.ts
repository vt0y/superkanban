import type { Label, Milestone, ProjectDocument, Task } from '@/types';

export interface DocumentFilterTerm {
  key: 'label' | 'task' | 'milestone' | 'no';
  value: string;
  negated: boolean;
}

export interface ParsedDocumentQuery {
  terms: DocumentFilterTerm[];
  text: string[];
}

/** Splits search text while preserving quoted label names. */
export function tokenizeDocumentQuery(query: string): string[] {
  return [...query.matchAll(/-?[\w@]+:"[^"]*"?|"[^"]*"?|\S+/g)].map((match) => match[0]);
}

const unquote = (value: string) => value.replace(/^"|"$/g, '');

export function parseDocumentQuery(query: string): ParsedDocumentQuery {
  const parsed: ParsedDocumentQuery = { terms: [], text: [] };
  for (const token of tokenizeDocumentQuery(query.trim())) {
    const match = token.match(/^(-?)(label|task|milestone|no):(.*)$/i);
    if (match && match[3]) parsed.terms.push({ key: match[2].toLowerCase() as DocumentFilterTerm['key'], value: unquote(match[3]).toLowerCase(), negated: match[1] === '-' });
    else if (unquote(token)) parsed.text.push(unquote(token).toLowerCase());
  }
  return parsed;
}

export function matchDocument(document: ProjectDocument, parsed: ParsedDocumentQuery, labels: Label[], tasks: Task[] = [], milestones: Milestone[] = []): boolean {
  const names = (document.labelIds || []).map((id) => labels.find((label) => label.id === id)?.name.toLowerCase()).filter(Boolean) as string[];
  const taskNames = (document.taskIds || []).map((id) => tasks.find((task) => task.id === id)?.title.toLowerCase()).filter(Boolean) as string[];
  const milestoneNames = (document.milestoneIds || []).map((id) => milestones.find((milestone) => milestone.id === id)?.title.toLowerCase()).filter(Boolean) as string[];
  const matchesTerms = parsed.terms.every((term) => {
    const matches = term.key === 'label' ? names.includes(term.value)
      : term.key === 'task' ? taskNames.includes(term.value)
        : term.key === 'milestone' ? milestoneNames.includes(term.value)
          : term.value === 'label' ? names.length === 0 : term.value === 'task' ? (document.taskIds || []).length === 0 : term.value === 'milestone' && (document.milestoneIds || []).length === 0;
    return matches !== term.negated;
  });
  if (!matchesTerms) return false;
  const driveMetadata = document.kind === 'drive' ? [document.nickname || '', document.description || '', document.name]
    : document.kind === 'canva' ? [document.nickname || '', document.description || '', 'canva'] : [];
  const haystack = [document.title, 'excerpt' in document ? document.excerpt || '' : '', 'content' in document ? document.content || '' : '', ...driveMetadata, ...names, ...taskNames, ...milestoneNames].join(' ').toLowerCase();
  return parsed.text.every((word) => haystack.includes(word));
}
