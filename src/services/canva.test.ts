import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  batchSet: vi.fn(),
  commit: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  arrayUnion: vi.fn((...values: unknown[]) => ({ arrayUnion: values })),
  collection: vi.fn((...parts: unknown[]) => parts.join('/')),
  doc: vi.fn((...parts: unknown[]) => parts.join('/')),
  getDoc: mocks.getDoc,
  serverTimestamp: vi.fn(() => 'server-time'),
  updateDoc: mocks.updateDoc,
  writeBatch: vi.fn(() => ({ set: mocks.batchSet, commit: mocks.commit })),
}));
vi.mock('./helpers', () => ({ database: vi.fn(() => 'database'), activityData: vi.fn(() => 'activity') }));

import { afterEach } from 'vitest';
import { attachCanvaProjectDocument, CanvaShortLinkError, clearExpandedCanvaLinks, expandCanvaShortLink, fetchCanvaDesignTitle, updateCanvaProjectDocumentDetails } from './canva';

const user = { uid: 'member' } as never;
const link = { designId: 'DAGdeck0001', editToken: 'editTok1' };

describe('Canva documents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a document keyed by design ID with the edit token', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    await attachCanvaProjectDocument('project-a', link, '  Pitch deck ', user, ['task-1', 'task-1']);
    expect(mocks.batchSet).toHaveBeenCalledWith('database/projects/project-a/documents/canva_DAGdeck0001', {
      kind: 'canva', title: 'Pitch deck', labelIds: [], taskIds: ['task-1'], milestoneIds: [], canvaDesignId: 'DAGdeck0001', canvaEditToken: 'editTok1',
      createdBy: 'member', createdAt: 'server-time', updatedAt: 'server-time',
    });
    expect(mocks.commit).toHaveBeenCalled();
  });


  it('only links tasks when the design is already attached', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true });
    await attachCanvaProjectDocument('project-a', link, 'Deck', user, ['task-2']);
    expect(mocks.batchSet).not.toHaveBeenCalled();
    expect(mocks.updateDoc).toHaveBeenCalledWith('database/projects/project-a/documents/canva_DAGdeck0001', { taskIds: { arrayUnion: ['task-2'] }, updatedAt: 'server-time' });
  });

  it('falls back to a design-ID title and omits a missing token', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    await attachCanvaProjectDocument('project-a', { designId: 'DAGdeck0001' }, '   ', user);
    expect(mocks.batchSet.mock.calls[0][1]).toMatchObject({ title: 'Canva · DAGdeck0001' });
    expect(mocks.batchSet.mock.calls[0][1]).not.toHaveProperty('canvaEditToken');
  });

  it('stores selected labels on new designs and merges them on re-attach', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false });
    await attachCanvaProjectDocument('project-a', link, 'Deck', user, [], ['ui', 'ui', 'review']);
    expect(mocks.batchSet.mock.calls[0][1]).toMatchObject({ labelIds: ['ui', 'review'], taskIds: [] });

    mocks.getDoc.mockResolvedValue({ exists: () => true });
    await attachCanvaProjectDocument('project-a', link, 'Deck', user, [], ['ui']);
    expect(mocks.updateDoc).toHaveBeenCalledWith('database/projects/project-a/documents/canva_DAGdeck0001', { labelIds: { arrayUnion: ['ui'] }, updatedAt: 'server-time' });
  });

  it('updates only project-local metadata', async () => {
    await updateCanvaProjectDocumentDetails('project-a', 'canva_DAGdeck0001', { nickname: ' Final ', description: '', labelIds: ['a', 'a'], taskIds: [] });
    expect(mocks.updateDoc).toHaveBeenCalledWith('database/projects/project-a/documents/canva_DAGdeck0001', {
      nickname: 'Final', description: '', labelIds: ['a'], taskIds: [], milestoneIds: [], updatedAt: 'server-time',
    });
  });
});

describe('expandCanvaShortLink', () => {
  const tokenUser = { uid: 'member', getIdToken: vi.fn(async () => 'id-token') } as never;
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearExpandedCanvaLinks();
    vi.stubEnv('VITE_TAROT_API_URL', 'https://worker.example/');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('posts the canonical short link with the ID token and dedupes concurrent calls', async () => {
    fetchMock.mockResolvedValue(respond(200, { url: 'https://www.canva.com/design/DAHabc12345/tok1/edit', title: 'Presentation Network' }));
    const [first, second] = await Promise.all([
      expandCanvaShortLink(tokenUser, 'https://canva.link/abc'),
      expandCanvaShortLink(tokenUser, ' https://canva.link/abc/ '),
    ]);
    expect(first).toEqual({ url: 'https://www.canva.com/design/DAHabc12345/tok1/edit', title: 'Presentation Network' });
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://worker.example/v1/links/canva/resolve');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer id-token' }, body: JSON.stringify({ url: 'https://canva.link/abc' }) });
    // The expanded link's title is already known, so no second Worker call.
    await expect(fetchCanvaDesignTitle(tokenUser, 'https://www.canva.com/design/DAHabc12345/tok1/edit?utm_source=x')).resolves.toBe('Presentation Network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('looks up titles for full edit links and treats any failure as empty', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { title: 'Deck' }));
    await expect(fetchCanvaDesignTitle(tokenUser, 'https://www.canva.com/design/DAHabc12345/tok1/edit')).resolves.toBe('Deck');
    expect(fetchMock.mock.calls[0][0]).toBe('https://worker.example/v1/links/canva/title');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ body: JSON.stringify({ url: 'https://www.canva.com/design/DAHabc12345/tok1/edit' }) });
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(fetchCanvaDesignTitle(tokenUser, 'https://www.canva.com/design/DAHother123/edit')).resolves.toBe('');
    fetchMock.mockResolvedValueOnce(respond(200, { title: 'Later' }));
    await expect(fetchCanvaDesignTitle(tokenUser, 'https://www.canva.com/design/DAHother123/edit')).resolves.toBe('Later');
    await expect(fetchCanvaDesignTitle(tokenUser, 'https://evil.com/design/DAHabc12345/edit')).resolves.toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps errors and evicts failures so a retry fetches again', async () => {
    fetchMock.mockResolvedValueOnce(respond(404, { error: { code: 'LINK_NOT_FOUND' } }));
    await expect(expandCanvaShortLink(tokenUser, 'https://canva.link/gone')).rejects.toMatchObject({ code: 'LINK_NOT_FOUND' });
    fetchMock.mockResolvedValueOnce(respond(500, {}));
    await expect(expandCanvaShortLink(tokenUser, 'https://canva.link/gone')).rejects.toMatchObject({ code: 'LINK_UNRESOLVED' });
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(expandCanvaShortLink(tokenUser, 'https://canva.link/gone')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects wrapped links and unconfigured setups without calling the Worker', async () => {
    await expect(expandCanvaShortLink(tokenUser, 'https://google.com/url?q=https://canva.link/abc')).rejects.toBeInstanceOf(CanvaShortLinkError);
    vi.stubEnv('VITE_TAROT_API_URL', '');
    await expect(expandCanvaShortLink(tokenUser, 'https://canva.link/abc')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
