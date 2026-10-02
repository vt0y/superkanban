import { lazy, Suspense } from 'react';
import type { SectionProps } from '@/context/AppContext';

export const loadNotes = () => import('./notes');
export const NotesSection = lazy(() => loadNotes().then((m) => ({ default: m.Notes })));
const Documents = lazy(() => loadNotes().then((m) => ({ default: m.Documents })));

/** Documents page: the library, or the reader when a `documentId` is given. */
export function Docs({ documentId, ...props }: SectionProps & { documentId?: string }) {
  return <Suspense fallback={<div className="section-loader"><span className="loader" /></div>}><Documents {...props} documentId={documentId} /></Suspense>;
}
