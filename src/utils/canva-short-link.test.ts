import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVA_FETCH_USER_AGENT, cachedCanvaDesignTitle, cachedResolveCanvaShortLink, canvaEditTarget, canvaShortLinkSlug, clearShortLinkMemoryCache, extractCanvaTitle, fetchCanvaDesignTitle, resolveCanvaShortLink, SHORT_LINK_TTL_SECONDS, type ShortLinkCache } from './canva-short-link';

const redirect = (location: string | null, status = 302) => new Response(null, { status, headers: location ? { Location: location } : {} });
const fetcherReturning = (response: Response | Error) => vi.fn(async () => { if (response instanceof Error) throw response; return response; }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const EDIT = 'https://www.canva.com/design/DAHabc12345/AbC-dEf_123/edit';
const TARGET = { designId: 'DAHabc12345', token: 'AbC-dEf_123' };
const html = (title: string, status = 200) => new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><link rel="preconnect" href="https://media.canva.com">`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const oembed = (title: string) => new Response(JSON.stringify({ type: 'rich', version: '1.0', title }), { headers: { 'Content-Type': 'application/json' } });
/** canva.link answers with a redirect; every other URL (oEmbed, editor page) gets `page()`. */
const routed = (link: Response | Error, page: () => Response) => vi.fn(async (url: string) => {
  if (url.startsWith('https://canva.link/')) { if (link instanceof Error) throw link; return link.clone(); }
  return page();
}) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('canvaShortLinkSlug', () => {
  it('accepts only exact https://canva.link/<slug>', () => {
    expect(canvaShortLinkSlug('https://canva.link/AbC_12-x')).toBe('AbC_12-x');
    expect(canvaShortLinkSlug('  https://CANVA.link/AbC_12-x/  ')).toBe('AbC_12-x');
  });

  it.each([
    'https://google.com/url?q=https://canva.link/abc',
    'https://www.google.com/search?q=https%3A%2F%2Fcanva.link%2Fabc',
    'https://evil.com/canva.link/abc',
    'https://canva.link.evil.com/abc',
    'https://canva.link@evil.com/abc',
    'https://user:pass@canva.link/abc',
    'https://evil.com#https://canva.link/abc',
    'https://canva.link/abc#frag',
    'https://canva.link/abc?u=https://evil.com',
    'http://canva.link/abc',
    'https://canva.link:8443/abc',
    'https://canva.link/abc/../..',
    'https://canva.link/%2e%2e',
    'https://canva.link/a%2Fb',
    'https://canva.link/abc/def',
    'https://canva.link/',
    `https://canva.link/${'a'.repeat(65)}`,
    'javascript:alert(1)',
    'canva.link/abc',
  ])('rejects %s', (raw) => {
    expect(canvaShortLinkSlug(raw)).toBeNull();
  });
});

describe('resolveCanvaShortLink', () => {
  it('fetches exactly canva.link/<slug> once with redirects disabled', async () => {
    const fetcher = fetcherReturning(redirect(`${EDIT}?utm_content=x&utm_source=sharebutton`));
    await expect(resolveCanvaShortLink('abc', fetcher)).resolves.toEqual({ ok: true, url: EDIT, target: TARGET });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://canva.link/abc');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual', headers: { 'User-Agent': CANVA_FETCH_USER_AGENT } });
  });

  it('normalises canva.com to www and strips query and hash', async () => {
    await expect(resolveCanvaShortLink('abc', fetcherReturning(redirect('https://canva.com/design/DAHabc12345/edit?x=1#y', 307))))
      .resolves.toEqual({ ok: true, url: 'https://www.canva.com/design/DAHabc12345/edit', target: { designId: 'DAHabc12345' } });
  });

  it('reports unknown slugs as not_found', async () => {
    await expect(resolveCanvaShortLink('nope', fetcherReturning(redirect('https://www.canva.com/404', 307)))).resolves.toEqual({ ok: false, error: 'not_found' });
  });

  it.each([
    '/design/DAHabc12345/edit',
    'https://evil.com/design/DAHabc12345/edit',
    'https://www.canva.com@evil.com/design/DAHabc12345/edit',
    'https://www.canva.com.evil.com/design/DAHabc12345/edit',
    'http://www.canva.com/design/DAHabc12345/edit',
    'https://www.canva.com:444/design/DAHabc12345/edit',
    'https://canva.link/other',
    'https://www.canva.com/login?redirect=/design/DAHabc12345/edit',
    'https://www.google.com/url?q=https://www.canva.com/design/DAHabc12345/edit',
  ])('never follows or accepts Location %s', async (location) => {
    const fetcher = fetcherReturning(redirect(location));
    await expect(resolveCanvaShortLink('abc', fetcher)).resolves.toEqual({ ok: false, error: 'unresolved' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats non-redirects, missing Location, failures and bad slugs as unresolved', async () => {
    await expect(resolveCanvaShortLink('abc', fetcherReturning(new Response('ok', { status: 200 })))).resolves.toEqual({ ok: false, error: 'unresolved' });
    await expect(resolveCanvaShortLink('abc', fetcherReturning(redirect(null)))).resolves.toEqual({ ok: false, error: 'unresolved' });
    await expect(resolveCanvaShortLink('abc', fetcherReturning(new Error('timeout')))).resolves.toEqual({ ok: false, error: 'unresolved' });
    const fetcher = fetcherReturning(redirect(EDIT));
    await expect(resolveCanvaShortLink('../evil', fetcher)).resolves.toEqual({ ok: false, error: 'unresolved' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Canva titles', () => {
  it('parses only canva.com edit links', () => {
    expect(canvaEditTarget(`${EDIT}?utm_content=x`)).toEqual(TARGET);
    expect(canvaEditTarget('https://canva.com/design/DAHabc12345/edit')).toEqual({ designId: 'DAHabc12345' });
    expect(canvaEditTarget('https://www.canva.com/design/DAHabc12345/AbC-dEf_123/view')).toBeNull();
    expect(canvaEditTarget('https://www.canva.com@evil.com/design/DAHabc12345/edit')).toBeNull();
    expect(canvaEditTarget('https://evil.com/design/DAHabc12345/edit')).toBeNull();
  });

  it('extracts, decodes and cleans the <title>', () => {
    expect(extractCanvaTitle('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Presentation Network</title><link rel="preconnect">')).toBe('Presentation Network');
    expect(extractCanvaTitle('<title>  Q3 &amp; Q4 &lt;Plan&gt; - Canva </title>')).toBe('Q3 & Q4 <Plan>');
    expect(extractCanvaTitle('<title>Deck | Canva</title>')).toBe('Deck');
    expect(extractCanvaTitle(`<title>${'x'.repeat(300)}</title>`)).toHaveLength(200);
  });

  it.each(['<title>Canva</title>', '<title>Log in to Canva</title>', '<title>Just a moment...</title>', '<title></title>', '<html><head>', ''])('returns empty for %s', (page) => {
    expect(extractCanvaTitle(page)).toBe('');
  });

  it('falls back to the rebuilt edit page without following redirects', async () => {
    const fetcher = vi.fn(async (url: string) => url.startsWith('https://api.canva.com/') ? new Response('', { status: 404 }) : html('Presentation Network')) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    await expect(fetchCanvaDesignTitle(TARGET, fetcher)).resolves.toBe('Presentation Network');
    expect(fetcher.mock.calls[1][0]).toBe(EDIT);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'GET', redirect: 'manual', headers: { 'User-Agent': CANVA_FETCH_USER_AGENT } });
  });

  it('returns empty for login redirects, non-HTML, errors and invalid parts', async () => {
    await expect(fetchCanvaDesignTitle(TARGET, fetcherReturning(redirect('/login/?redirect=x', 303)))).resolves.toBe('');
    await expect(fetchCanvaDesignTitle(TARGET, fetcherReturning(new Response('x', { headers: { 'Content-Type': 'text/plain' } })))).resolves.toBe('');
    await expect(fetchCanvaDesignTitle(TARGET, fetcherReturning(new Error('timeout')))).resolves.toBe('');
    const fetcher = fetcherReturning(html('x'));
    await expect(fetchCanvaDesignTitle({ designId: '../evil', token: 'x' }, fetcher)).resolves.toBe('');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads the title from oEmbed on api.canva.com first', async () => {
    const fetcher = vi.fn(async (url: string) => url.startsWith('https://api.canva.com/')
      ? new Response(JSON.stringify({ title: 'Presentation Network &amp; Co', type: 'rich' }), { headers: { 'Content-Type': 'application/json' } })
      : new Response('slow down', { status: 429, headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    await expect(fetchCanvaDesignTitle(TARGET, fetcher)).resolves.toBe('Presentation Network & Co');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(`https://api.canva.com/_spi/presentation/_oembed?format=json&url=${encodeURIComponent(EDIT)}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('stops reading after 64 KB when no title appears', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(16 * 1024).fill(97)); } });
    const fetcher = fetcherReturning(new Response(body, { headers: { 'Content-Type': 'text/html' } }));
    await expect(fetchCanvaDesignTitle(TARGET, fetcher)).resolves.toBe('');
    expect(pulled).toBeLessThanOrEqual(6);
  });
});

describe('caching', () => {
  const memoryCache = () => {
    const store = new Map<string, Response>();
    const cache: ShortLinkCache & { store: Map<string, Response> } = {
      store,
      match: async (request) => store.get(request.url)?.clone(),
      put: async (request, response) => { store.set(request.url, response); },
    };
    return cache;
  };
  beforeEach(() => clearShortLinkMemoryCache());

  it('expands with the title and serves repeats without any fetch', async () => {
    const cache = memoryCache();
    const fetcher = routed(redirect(EDIT), () => oembed('Presentation Network'));
    await expect(cachedResolveCanvaShortLink('abc', cache, fetcher, 0)).resolves.toEqual({ ok: true, url: EDIT, title: 'Presentation Network' });
    await expect(cachedResolveCanvaShortLink('abc', cache, fetcher, 1000)).resolves.toEqual({ ok: true, url: EDIT, title: 'Presentation Network' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cache.store.get('https://cache.internal/canva/v2/link/abc')?.headers.get('Cache-Control')).toBe(`public, max-age=${SHORT_LINK_TTL_SECONDS.ok}`);
    expect(cache.store.get('https://cache.internal/canva/v2/title/DAHabc12345/AbC-dEf_123')?.headers.get('Cache-Control')).toBe(`public, max-age=${SHORT_LINK_TTL_SECONDS.title}`);
  });

  it('returns an empty title when the editor needs a login, and keeps it out of the edge cache', async () => {
    const cache = memoryCache();
    const fetcher = routed(redirect(EDIT), () => redirect('/login/', 303));
    await expect(cachedResolveCanvaShortLink('abc', cache, fetcher, 0)).resolves.toEqual({ ok: true, url: EDIT, title: '' });
    expect(cache.store.has('https://cache.internal/canva/v2/title/DAHabc12345/AbC-dEf_123')).toBe(false);
  });

  it('never caches rate-limited or failed title lookups', async () => {
    const cache = memoryCache();
    const limited = vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    await expect(cachedCanvaDesignTitle(TARGET, cache, limited, 0)).resolves.toBe('');
    expect(cache.store.size).toBe(0);
    const recovered = vi.fn(async () => oembed('Deck')) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    await expect(cachedCanvaDesignTitle(TARGET, cache, recovered, 1000)).resolves.toBe('Deck');
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a title for view links', async () => {
    const fetcher = routed(redirect('https://www.canva.com/design/DAHabc12345/AbC-dEf_123/view'), () => html('Nope'));
    await expect(cachedResolveCanvaShortLink('view', null, fetcher, 0)).resolves.toEqual({ ok: true, url: 'https://www.canva.com/design/DAHabc12345/AbC-dEf_123/view', title: '' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves edge-cache hits after the isolate restarts', async () => {
    const cache = memoryCache();
    await cachedResolveCanvaShortLink('abc', cache, routed(redirect(EDIT), () => html('Deck')), 0);
    clearShortLinkMemoryCache();
    const fetcher = routed(redirect(EDIT), () => html('Deck'));
    await expect(cachedResolveCanvaShortLink('abc', cache, fetcher, 0)).resolves.toEqual({ ok: true, url: EDIT, title: 'Deck' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('caches not_found for an hour and never caches transient failures', async () => {
    const cache = memoryCache();
    await cachedResolveCanvaShortLink('gone', cache, fetcherReturning(redirect('https://www.canva.com/404')), 0);
    expect(cache.store.get('https://cache.internal/canva/v2/link/gone')?.headers.get('Cache-Control')).toBe(`public, max-age=${SHORT_LINK_TTL_SECONDS.not_found}`);

    await expect(cachedResolveCanvaShortLink('flaky', cache, routed(new Error('timeout'), () => html('x')), 0)).resolves.toEqual({ ok: false, error: 'unresolved' });
    expect(cache.store.has('https://cache.internal/canva/v2/link/flaky')).toBe(false);
    await expect(cachedResolveCanvaShortLink('flaky', cache, routed(redirect(EDIT), () => html('Deck')), 0)).resolves.toEqual({ ok: true, url: EDIT, title: 'Deck' });
  });

  it('expires in-isolate titles and works without an edge cache', async () => {
    const fetcher = vi.fn(async () => oembed('Deck')) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    await cachedCanvaDesignTitle(TARGET, null, fetcher, 0);
    await cachedCanvaDesignTitle(TARGET, null, fetcher, (SHORT_LINK_TTL_SECONDS.title - 1) * 1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await cachedCanvaDesignTitle(TARGET, null, fetcher, (SHORT_LINK_TTL_SECONDS.title + 1) * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
