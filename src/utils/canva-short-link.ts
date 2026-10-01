/**
 * Canva link expansion and title lookup, shared by the tarot Worker (which performs them) and the app (which validates input).
 * Only two URL shapes are ever fetched, both rebuilt from validated parts — never from user text or a Location header:
 *   https://canva.link/<slug>                          (redirect read, not followed)
 *   https://www.canva.com/design/<id>[/<token>]/edit   (HTML <title> read from the first 64 KB)
 */

export type ShortLinkResult = { ok: true; url: string; title: string } | { ok: false; error: 'not_found' | 'unresolved' };

const SLUG = /^\/([A-Za-z0-9_-]{1,64})\/?$/;
const DESIGN_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DESIGN_TOKEN = /^[A-Za-z0-9_-]{4,128}$/;
const DESIGN_PATH = /^\/design\/([A-Za-z0-9_-]{8,64})(?:\/([A-Za-z0-9_-]{4,128}))?\/(edit|view|watch)\/?$/;
const CANVA_HOSTS = new Set(['www.canva.com', 'canva.com']);
const FETCH_TIMEOUT_MS = 5_000;
/** Sent on every outbound request: Canva serves the anonymous editor page (with the design name in <title>) to regular browsers. */
export const CANVA_FETCH_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0';
const TITLE_SCAN_BYTES = 64 * 1024;
const TITLE_MAX = 200;
const GENERIC_TITLES = new Set(['canva', 'login', 'log in', 'sign up', 'signup', 'log in to canva', 'sign up for canva', 'just a moment...', 'attention required!', '404', 'page not found']);

/** Returns the slug of an exact `https://canva.link/<slug>` URL, or null for anything else (wrappers, look-alikes, query, hash, port, userinfo). */
export function canvaShortLinkSlug(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'canva.link' || url.port || url.username || url.password || url.search || url.hash) return null;
  return url.pathname.match(SLUG)?.[1] ?? null;
}

export const canvaShortLinkUrl = (slug: string) => `https://canva.link/${slug}`;

export interface CanvaEditTarget { designId: string; token?: string }

/** Parses an `https://(www.)canva.com/design/<id>[/<token>]/edit` link; query and hash are ignored. */
export function canvaEditTarget(raw: string): CanvaEditTarget | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || !CANVA_HOSTS.has(url.hostname) || url.port || url.username || url.password) return null;
  const match = url.pathname.match(DESIGN_PATH);
  if (!match || match[3] !== 'edit') return null;
  return match[2] ? { designId: match[1], token: match[2] } : { designId: match[1] };
}

export const canvaEditPageUrl = ({ designId, token }: CanvaEditTarget) => `https://www.canva.com/design/${designId}${token ? `/${token}` : ''}/edit`;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? entity;
  });
}

/** Extracts a design name from the start of a Canva page; returns '' when it is missing or generic. */
export function extractCanvaTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return raw ? cleanCanvaTitle(raw) : '';
}

/** Decodes, strips markup and control characters, drops a trailing " - Canva", and rejects generic page names. */
export function cleanCanvaTitle(raw: string): string {
  const title = decodeEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+[-–—|·]\s+Canva$/i, '')
    .trim();
  if (!title || GENERIC_TITLES.has(title.toLowerCase())) return '';
  return title.slice(0, TITLE_MAX);
}

async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (bytes < TITLE_SCAN_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(text) || /<\/head>/i.test(text)) break;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return text.slice(0, TITLE_SCAN_BYTES);
}

/** Diagnostics for the Worker log. Never carries design IDs, tokens or titles — only response shape. */
export interface CanvaTitleDiagnostic {
  step: 'title-fetch' | 'oembed-fetch' | 'link-fetch' | 'cache' | 'route';
  status?: number | 'error';
  kind?: string;
  source?: 'memory' | 'edge' | 'miss';
  route?: string;
  mode?: string;
  hasTarget?: boolean;
  contentType?: string;
  cfMitigated?: string | null;
  retryAfter?: string | null;
  parsed?: boolean;
  keys?: string[];
  rawTitleType?: string;
  rawTitleLength?: number;
  redirectTo?: string;
  bytes?: number;
  hasTitleTag?: boolean;
  titleFound?: boolean;
  error?: string;
}
let diagnosticLogger: ((event: CanvaTitleDiagnostic) => void) | null = null;
export function setCanvaTitleLogger(logger: ((event: CanvaTitleDiagnostic) => void) | null) { diagnosticLogger = logger; }

/** First path segment only (e.g. "/login/"), so logs reveal where Canva sent us without leaking the design. */
const redirectSummary = (location: string | null) => {
  if (!location) return undefined;
  try { const url = new URL(location, 'https://www.canva.com'); return `${url.hostname}/${url.pathname.split('/')[1] || ''}`; } catch { return 'unparseable'; }
};

/** Rate limits, server errors and network failures may clear up, so their empty result must not be cached. */
const isTransient = (status: number | 'error') => status === 'error' || status === 429 || status >= 500;

interface TitleLookup { title: string; transient: boolean }

async function titleFromEditor(target: CanvaEditTarget, fetcher: typeof fetch): Promise<TitleLookup> {
  try {
    const response = await fetcher(canvaEditPageUrl(target), {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'text/html', 'Accept-Language': 'en', 'User-Agent': CANVA_FETCH_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
    const shape = { step: 'title-fetch' as const, status: response.status, contentType: contentType.split(';')[0], cfMitigated: response.headers.get('cf-mitigated'), retryAfter: response.headers.get('Retry-After') };
    if (response.status !== 200 || !contentType.includes('text/html')) {
      void response.body?.cancel().catch(() => undefined);
      diagnosticLogger?.({ ...shape, redirectTo: redirectSummary(response.headers.get('Location')) });
      return { title: '', transient: isTransient(response.status) };
    }
    const head = await readHead(response);
    const title = extractCanvaTitle(head);
    diagnosticLogger?.({ ...shape, bytes: head.length, hasTitleTag: /<title[\s>]/i.test(head), titleFound: Boolean(title) });
    return { title, transient: false };
  } catch (error) {
    diagnosticLogger?.({ step: 'title-fetch', status: 'error', error: error instanceof Error ? error.name : 'unknown' });
    return { title: '', transient: true };
  }
}

/** Canva's oEmbed API on api.canva.com, queried with the rebuilt edit URL. */
async function titleFromOembed(target: CanvaEditTarget, fetcher: typeof fetch): Promise<TitleLookup> {
  try {
    const response = await fetcher(`https://api.canva.com/_spi/presentation/_oembed?format=json&url=${encodeURIComponent(canvaEditPageUrl(target))}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/json', 'User-Agent': CANVA_FETCH_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
    const shape = { step: 'oembed-fetch' as const, status: response.status, contentType: contentType.split(';')[0], cfMitigated: response.headers.get('cf-mitigated') };
    if (response.status !== 200 || !contentType.includes('json')) {
      void response.body?.cancel().catch(() => undefined);
      diagnosticLogger?.({ ...shape, redirectTo: redirectSummary(response.headers.get('Location')) });
      return { title: '', transient: isTransient(response.status) };
    }
    const text = (await readHead(response)).slice(0, TITLE_SCAN_BYTES);
    const payload = (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })();
    const title = typeof payload?.title === 'string' ? cleanCanvaTitle(payload.title) : '';
    diagnosticLogger?.({
      ...shape,
      bytes: text.length,
      parsed: Boolean(payload),
      // Structure only: key names and the raw title's type/length, never values.
      keys: payload ? Object.keys(payload).slice(0, 20) : undefined,
      rawTitleType: payload ? typeof payload.title : undefined,
      rawTitleLength: typeof payload?.title === 'string' ? payload.title.length : undefined,
      titleFound: Boolean(title),
    });
    return { title, transient: false };
  } catch (error) {
    diagnosticLogger?.({ step: 'oembed-fetch', status: 'error', error: error instanceof Error ? error.name : 'unknown' });
    return { title: '', transient: true };
  }
}

/**
 * oEmbed first: canva.com's editor page answers Worker traffic with 429, while api.canva.com's oEmbed returns the title.
 * The editor page stays as a fallback. `transient` is true when both failed in a way that may clear up.
 */
async function lookupCanvaDesignTitle(target: CanvaEditTarget, fetcher: typeof fetch): Promise<TitleLookup> {
  if (!DESIGN_ID.test(target.designId) || (target.token !== undefined && !DESIGN_TOKEN.test(target.token))) return { title: '', transient: false };
  const oembed = await titleFromOembed(target, fetcher);
  if (oembed.title) return oembed;
  const editor = await titleFromEditor(target, fetcher);
  return editor.title ? editor : { title: '', transient: oembed.transient || editor.transient };
}

/** Reads the design title (oEmbed, then the editor page). Any redirect, rate limit, or parse failure yields ''. */
export async function fetchCanvaDesignTitle(target: CanvaEditTarget, fetcher: typeof fetch = fetch): Promise<string> {
  return (await lookupCanvaDesignTitle(target, fetcher)).title;
}

/** One request to canva.link with redirects disabled; the Location is validated, never fetched as-is. */
export async function resolveCanvaShortLink(slug: string, fetcher: typeof fetch = fetch): Promise<{ ok: true; url: string; target: CanvaEditTarget | null } | { ok: false; error: 'not_found' | 'unresolved' }> {
  if (!SLUG.test(`/${slug}`)) return { ok: false, error: 'unresolved' };
  const requestUrl = canvaShortLinkUrl(slug);
  let response: Response;
  try {
    response = await fetcher(requestUrl, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': CANVA_FETCH_USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    diagnosticLogger?.({ step: 'link-fetch', status: 'error', error: error instanceof Error ? error.name : 'unknown' });
    return { ok: false, error: 'unresolved' };
  }
  void response.body?.cancel().catch(() => undefined);
  const location = response.status >= 300 && response.status < 400 ? response.headers.get('Location') : null;
  diagnosticLogger?.({ step: 'link-fetch', status: response.status, cfMitigated: response.headers.get('cf-mitigated'), redirectTo: redirectSummary(location), mode: location?.match(/\/(edit|view|watch)(?:[/?#]|$)/)?.[1] ?? 'other' });
  if (!location) return { ok: false, error: 'unresolved' };
  let target: URL;
  try { target = new URL(location, requestUrl); } catch { return { ok: false, error: 'unresolved' }; }
  if (target.protocol !== 'https:' || !CANVA_HOSTS.has(target.hostname) || target.port || target.username || target.password) return { ok: false, error: 'unresolved' };
  if (target.pathname === '/404' || target.pathname.startsWith('/404/')) return { ok: false, error: 'not_found' };
  const match = target.pathname.match(DESIGN_PATH);
  if (!match) return { ok: false, error: 'unresolved' };
  const url = `https://www.canva.com${target.pathname}`;
  return { ok: true, url, target: match[3] === 'edit' ? (match[2] ? { designId: match[1], token: match[2] } : { designId: match[1] }) : null };
}

/** Minimal slice of the Workers Cache API, so caching can be tested without the runtime. */
export interface ShortLinkCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export const SHORT_LINK_TTL_SECONDS = { ok: 7 * 24 * 60 * 60, not_found: 60 * 60, title: 24 * 60 * 60, no_title: 10 * 60 } as const;
/** Bump to invalidate every edge-cached entry (the edge cache outlives deploys). */
const CACHE_VERSION = 'v2';
const MEMORY_LIMIT = 1000;
const memory = new Map<string, { value: unknown; expiresAt: number }>();

function remember(key: string, value: unknown, ttlSeconds: number, now: number) {
  memory.delete(key);
  if (memory.size >= MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
  memory.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
}

/** Two-level cache: an in-isolate map and the edge cache (works on *.workers.dev and outlives deploys). Loads with `edge: false` stay in memory only. */
async function cached<T>(key: string, cache: ShortLinkCache | null, now: number, load: () => Promise<{ value: T; ttl: number; edge?: boolean } | null>): Promise<T | null> {
  const kind = key.split('/')[0];
  const local = memory.get(key);
  if (local && local.expiresAt > now) { diagnosticLogger?.({ step: 'cache', kind, source: 'memory' }); return local.value as T; }
  if (local) memory.delete(key);
  const request = new Request(`https://cache.internal/canva/${CACHE_VERSION}/${key}`);
  if (cache) {
    const hit = await cache.match(request).catch(() => undefined);
    const value = hit ? await hit.json().catch(() => undefined) as T | undefined : undefined;
    if (hit && value !== undefined) {
      remember(key, value, Number(hit.headers.get('X-Ttl')) || 60, now);
      diagnosticLogger?.({ step: 'cache', kind, source: 'edge' });
      return value;
    }
  }
  diagnosticLogger?.({ step: 'cache', kind, source: 'miss' });
  const loaded = await load();
  if (!loaded) return null;
  remember(key, loaded.value, loaded.ttl, now);
  if (cache && loaded.edge !== false) {
    await cache.put(request, new Response(JSON.stringify(loaded.value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${loaded.ttl}`, 'X-Ttl': String(loaded.ttl) },
    })).catch(() => undefined);
  }
  return loaded.value;
}

/** Cached title lookup: names live 1 day at the edge; definite misses (login page, parse failure) 10 minutes in memory; transient failures (429, 5xx, timeouts) are not cached. */
export async function cachedCanvaDesignTitle(target: CanvaEditTarget, cache: ShortLinkCache | null, fetcher: typeof fetch = fetch, now = Date.now()): Promise<string> {
  const key = `title/${target.designId}/${target.token ?? '-'}`;
  const title = await cached<string>(key, cache, now, async () => {
    const { title: value, transient } = await lookupCanvaDesignTitle(target, fetcher);
    if (value) return { value, ttl: SHORT_LINK_TTL_SECONDS.title };
    return transient ? null : { value, ttl: SHORT_LINK_TTL_SECONDS.no_title, edge: false };
  });
  return title ?? '';
}

/**
 * Cached short-link expansion plus title. Successes live 7 days, unknown slugs 1 hour; transient failures are never cached.
 */
export async function cachedResolveCanvaShortLink(slug: string, cache: ShortLinkCache | null, fetcher: typeof fetch = fetch, now = Date.now()): Promise<ShortLinkResult> {
  type Stored = { ok: true; url: string; target: CanvaEditTarget | null } | { ok: false; error: 'not_found' };
  const stored = await cached<Stored>(`link/${slug}`, cache, now, async () => {
    const result = await resolveCanvaShortLink(slug, fetcher);
    if (!result.ok && result.error === 'unresolved') return null;
    return { value: result as Stored, ttl: result.ok ? SHORT_LINK_TTL_SECONDS.ok : SHORT_LINK_TTL_SECONDS.not_found };
  });
  if (!stored) return { ok: false, error: 'unresolved' };
  if (!stored.ok) return stored;
  const title = stored.target ? await cachedCanvaDesignTitle(stored.target, cache, fetcher, now) : '';
  return { ok: true, url: stored.url, title };
}

/** Test hook: clears the in-isolate cache. */
export function clearShortLinkMemoryCache() { memory.clear(); }
