import type { User } from 'firebase/auth';
import { arrayUnion, collection, doc, getDoc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import type { CanvaProjectDocument, ProjectDocument } from '@/types';
import { canvaDefaultTitle, canvaDocumentId, type CanvaLink } from '@/utils/canva-link';
import { canvaEditPageUrl, canvaEditTarget, canvaShortLinkSlug, type CanvaEditTarget } from '@/utils/canva-short-link';
import { activityData, database } from './helpers';

export const isCanvaProjectDocument = (item: ProjectDocument): item is CanvaProjectDocument => item.kind === 'canva';

export type CanvaShortLinkErrorCode = 'NOT_CONFIGURED' | 'INVALID_LINK' | 'LINK_NOT_FOUND' | 'LINK_UNRESOLVED' | 'RATE_LIMITED' | 'NETWORK_ERROR';
export class CanvaShortLinkError extends Error {
  constructor(readonly code: CanvaShortLinkErrorCode) { super(code); }
}

// canva.link expansion runs on the tarot Worker (the browser cannot read cross-origin redirects).
const linkApiBase = () => ((import.meta.env.VITE_TAROT_API_URL as string | undefined) ?? '').trim().replace(/\/$/, '');
export const isLinkResolverConfigured = () => linkApiBase() !== '';

async function linkApiPost(user: User, path: string, url: string): Promise<{ response: Response; payload: { url?: unknown; title?: unknown; error?: { code?: string } } }> {
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${linkApiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new CanvaShortLinkError('NETWORK_ERROR');
  }
  return { response, payload: await response.json().catch(() => ({})) };
}

export interface ExpandedCanvaLink { url: string; title: string }

// One request per slug / edit link per page session; concurrent calls share it, failures are evicted for retry.
const expanded = new Map<string, Promise<ExpandedCanvaLink>>();
const titles = new Map<string, Promise<string>>();
const titleKey = (target: CanvaEditTarget) => `${target.designId}/${target.token ?? ''}`;

/** Expands https://canva.link/<slug> through the Worker; also returns the design title ('' when Canva does not expose one). */
export function expandCanvaShortLink(user: User, raw: string): Promise<ExpandedCanvaLink> {
  const slug = canvaShortLinkSlug(raw);
  if (!slug) return Promise.reject(new CanvaShortLinkError('INVALID_LINK'));
  if (!isLinkResolverConfigured()) return Promise.reject(new CanvaShortLinkError('NOT_CONFIGURED'));
  const cached = expanded.get(slug);
  if (cached) return cached;
  const pending = (async () => {
    const { response, payload } = await linkApiPost(user, '/v1/links/canva/resolve', `https://canva.link/${slug}`);
    if (response.ok && typeof payload.url === 'string') {
      const result = { url: payload.url, title: typeof payload.title === 'string' ? payload.title.slice(0, 200) : '' };
      const target = canvaEditTarget(result.url);
      if (target) titles.set(titleKey(target), Promise.resolve(result.title));
      return result;
    }
    const code = payload.error?.code;
    throw new CanvaShortLinkError(code === 'LINK_NOT_FOUND' || code === 'INVALID_LINK' || code === 'RATE_LIMITED' ? code : 'LINK_UNRESOLVED');
  })();
  expanded.set(slug, pending);
  pending.catch(() => expanded.delete(slug));
  return pending;
}

/** Looks up the title of a full Canva edit link. Never throws: any failure is ''. */
export function fetchCanvaDesignTitle(user: User, raw: string): Promise<string> {
  const target = canvaEditTarget(raw);
  if (!target || !isLinkResolverConfigured()) return Promise.resolve('');
  const key = titleKey(target);
  const cached = titles.get(key);
  if (cached) return cached;
  const pending = linkApiPost(user, '/v1/links/canva/title', canvaEditPageUrl(target))
    .then(({ response, payload }) => (response.ok && typeof payload.title === 'string' ? payload.title.slice(0, 200) : ''))
    .catch(() => '');
  titles.set(key, pending);
  void pending.then((title) => { if (!title) titles.delete(key); });
  return pending;
}

/** Test hook. */
export function clearExpandedCanvaLinks() { expanded.clear(); titles.clear(); }

/** Attaches a Canva design by its edit link. Re-attaching the same design only adds task links and labels. */
export async function attachCanvaProjectDocument(
  projectId: string,
  link: CanvaLink,
  title: string,
  user: User,
  taskIds: string[] = [],
  labelIds: string[] = [],
  milestoneIds: string[] = [],
): Promise<void> {
  const store = database();
  const id = canvaDocumentId(link.designId);
  const ref = doc(store, 'projects', projectId, 'documents', id);
  if ((await getDoc(ref)).exists()) {
    if (taskIds.length || labelIds.length || milestoneIds.length) {
      await updateDoc(ref, {
        ...(taskIds.length ? { taskIds: arrayUnion(...taskIds.slice(0, 100)) } : {}),
        ...(labelIds.length ? { labelIds: arrayUnion(...labelIds.slice(0, 50)) } : {}),
        ...(milestoneIds.length ? { milestoneIds: arrayUnion(...milestoneIds.slice(0, 100)) } : {}),
        updatedAt: serverTimestamp(),
      });
    }
    return;
  }
  const name = (title.trim() || canvaDefaultTitle(link.designId)).slice(0, 200);
  const batch = writeBatch(store);
  batch.set(ref, {
    kind: 'canva',
    title: name,
    labelIds: [...new Set(labelIds)].slice(0, 50),
    taskIds: [...new Set(taskIds)].slice(0, 100),
    milestoneIds: [...new Set(milestoneIds)].slice(0, 100),
    canvaDesignId: link.designId,
    ...(link.editToken ? { canvaEditToken: link.editToken } : {}),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(store, 'projects', projectId, 'activities')), activityData(user, 'canva_attached', `แนบงานออกแบบ Canva “${name}”`, `attached Canva design “${name}”`, id));
  await batch.commit();
}

export async function updateCanvaProjectDocumentDetails(
  projectId: string,
  documentId: string,
  input: { nickname: string; description: string; labelIds: string[]; taskIds: string[]; milestoneIds?: string[] },
): Promise<void> {
  await updateDoc(doc(database(), 'projects', projectId, 'documents', documentId), {
    nickname: input.nickname.trim().slice(0, 200),
    description: input.description.trim().slice(0, 1000),
    labelIds: [...new Set(input.labelIds)].slice(0, 50),
    taskIds: [...new Set(input.taskIds)].slice(0, 100),
    milestoneIds: [...new Set(input.milestoneIds || [])].slice(0, 100),
    updatedAt: serverTimestamp(),
  });
}
