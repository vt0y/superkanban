import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  endGitHubSession,
  fetchInstallationRepositories,
  fetchRepoCollaborators,
  fetchRepoInvitations,
  getGitHubSession,
  getStoredGitHubToken,
  GITHUB_SESSION_TTL_MS,
  githubAccessState,
  GitHubAuthError,
  githubPopupMode,
  githubProvider,
  membershipGitHubDrift,
  removeRepoCollaborator,
  revokeRepoAccess,
  setRepoCollaborator,
  startGitHubSession,
  verifyGitHubToken,
} from './github';

class LocalStorageMock implements Storage {
  private store: Record<string, string> = {};

  get length(): number {
    return Object.keys(this.store).length;
  }

  clear(): void {
    this.store = {};
  }

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }

  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
}

describe('github service - management session', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new LocalStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts, reads, and ends a session', () => {
    startGitHubSession('ghu_abc', 1_000);
    expect(getGitHubSession(2_000)).toEqual({ token: 'ghu_abc', issuedAt: 1_000, expiresAt: 1_000 + GITHUB_SESSION_TTL_MS });
    endGitHubSession();
    expect(getGitHubSession(2_000)).toBeNull();
  });

  it('expires just before the 8 hour GitHub App token lifetime', () => {
    startGitHubSession('ghu_abc', 0);
    expect(GITHUB_SESSION_TTL_MS).toBeLessThan(8 * 60 * 60 * 1000);
    expect(getGitHubSession(GITHUB_SESSION_TTL_MS - 1)?.token).toBe('ghu_abc');
    expect(getGitHubSession(GITHUB_SESSION_TTL_MS)).toBeNull();
    expect(localStorage.getItem('ps.github.session')).toBeNull();
  });

  it('drops never-expiring tokens left by the old OAuth App', () => {
    localStorage.setItem('ps.github.token', 'gho_legacy');
    expect(getStoredGitHubToken()).toBe('');
    expect(localStorage.getItem('ps.github.token')).toBeNull();
  });

  it('ignores corrupt session data and missing storage', () => {
    localStorage.setItem('ps.github.session', '{not json');
    expect(getGitHubSession()).toBeNull();
    localStorage.setItem('ps.github.session', JSON.stringify({ token: 42, issuedAt: 'x' }));
    expect(getGitHubSession()).toBeNull();
    vi.stubGlobal('localStorage', undefined);
    expect(getStoredGitHubToken()).toBe('');
    expect(() => startGitHubSession('t')).not.toThrow();
    expect(() => endGitHubSession()).not.toThrow();
  });
});

describe('github service - verifyGitHubToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns invalid when token is empty', async () => {
    const res = await verifyGitHubToken('');
    expect(res).toEqual({ valid: false, username: '' });
  });

  it('returns valid and username on successful response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'octocat' }),
    } as Response);

    const res = await verifyGitHubToken('valid_token');
    expect(res).toEqual({ valid: true, username: 'octocat' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer valid_token',
          Accept: 'application/vnd.github+json',
        },
      }),
    );
  });

  it('returns invalid when response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    } as Response);

    const res = await verifyGitHubToken('invalid_token');
    expect(res).toEqual({ valid: false, username: '' });
  });

  it('returns invalid when network fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    const res = await verifyGitHubToken('any_token');
    expect(res).toEqual({ valid: false, username: '' });
  });
});

describe('github service - fetchInstallationRepositories', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const repo = (id: number, fullName: string, isPrivate: boolean) => ({
    id,
    name: fullName.split('/')[1],
    full_name: fullName,
    owner: { login: fullName.split('/')[0] },
    private: isPrivate,
    html_url: `https://github.com/${fullName}`,
    description: null,
    default_branch: 'main',
  });

  it('merges repositories across installations, de-duplicated and sorted', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/user/installations?')) return { ok: true, json: async () => ({ installations: [{ id: 1 }, { id: 2 }] }) } as Response;
      if (url.includes('/installations/1/')) return { ok: true, json: async () => ({ repositories: [repo(11, 'zed/app', true), repo(12, 'acme/api', true)] }) } as Response;
      return { ok: true, json: async () => ({ repositories: [repo(12, 'acme/api', true), repo(13, 'acme/docs', false)] }) } as Response;
    }) as typeof fetch;

    const result = await fetchInstallationRepositories('ghu_t');
    expect(result.installations).toBe(2);
    expect(result.repos.map((r) => r.fullName)).toEqual(['acme/api', 'acme/docs', 'zed/app']);
    expect(result.repos[0]).toMatchObject({ owner: 'acme', private: true, description: '', htmlUrl: 'https://github.com/acme/api' });
  });

  it('reports zero installations so the UI can ask to install the App', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ installations: [] }) } as Response);
    expect(await fetchInstallationRepositories('ghu_t')).toEqual({ installations: 0, repos: [] });
  });

  it('throws GitHubAuthError when the session token is expired', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '' } as Response);
    await expect(fetchInstallationRepositories('ghu_old')).rejects.toBeInstanceOf(GitHubAuthError);
  });

  it('requires a token', async () => {
    await expect(fetchInstallationRepositories('')).rejects.toThrow('GitHub access token is required');
  });
});

describe('github service - expired session on every API helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns HTTP 401 into GitHubAuthError', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Bad credentials' } as Response);
    await expect(fetchRepoCollaborators('t', 'o', 'r')).rejects.toBeInstanceOf(GitHubAuthError);
    await expect(fetchRepoInvitations('t', 'o', 'r')).rejects.toBeInstanceOf(GitHubAuthError);
    await expect(setRepoCollaborator('t', 'o', 'r', 'u', 'push')).rejects.toBeInstanceOf(GitHubAuthError);
    await expect(removeRepoCollaborator('t', 'o', 'r', 'u')).rejects.toBeInstanceOf(GitHubAuthError);
    await expect(revokeRepoAccess('t', 'o', 'r', 'u')).rejects.toBeInstanceOf(GitHubAuthError);
  });
});

describe('github service - fetchRepoCollaborators', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws error when token is empty', async () => {
    await expect(fetchRepoCollaborators('', 'owner', 'repo')).rejects.toThrow(
      'GitHub access token is required',
    );
  });

  it('parses and returns collaborator list accurately', async () => {
    const mockCollaborators = [
      {
        id: 1,
        login: 'octocat',
        avatar_url: 'https://github.com/images/octocat.png',
        role_name: 'admin',
        permissions: { admin: true, maintain: true, push: true, triage: true, pull: true },
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCollaborators,
    } as Response);

    const collabs = await fetchRepoCollaborators('token', 'octocat', 'hello-world');
    expect(collabs).toHaveLength(1);
    expect(collabs[0].login).toBe('octocat');
    expect(collabs[0].roleName).toBe('admin');
  });

  it('returns empty array when status is 403 or 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    } as Response);

    const res403 = await fetchRepoCollaborators('token', 'owner', 'repo');
    expect(res403).toEqual([]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    } as Response);

    const res404 = await fetchRepoCollaborators('token', 'owner', 'repo');
    expect(res404).toEqual([]);
  });

  it('throws on unexpected server error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    await expect(fetchRepoCollaborators('token', 'owner', 'repo')).rejects.toThrow(
      'Failed to fetch collaborators (500): Internal Server Error',
    );
  });
});

describe('github service - setRepoCollaborator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws error when token is empty', async () => {
    await expect(setRepoCollaborator('', 'owner', 'repo', 'user', 'push')).rejects.toThrow(
      'GitHub access token is required',
    );
  });

  it('handles 201 Created as invitation sent', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
    } as Response);

    const res = await setRepoCollaborator('token', 'org', 'repo', 'dev1', 'push');
    expect(res.invited).toBe(true);
    expect(res.message).toContain('Invitation sent to @dev1 (push)');
  });

  it('handles 204 No Content as direct update', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);

    const res = await setRepoCollaborator('token', 'org', 'repo', 'dev1', 'admin');
    expect(res.invited).toBe(false);
    expect(res.message).toContain('Updated permissions for @dev1 to admin');
  });

  it('throws on failure status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'Validation Failed',
    } as Response);

    await expect(setRepoCollaborator('token', 'org', 'repo', 'dev1', 'pull')).rejects.toThrow(
      'Failed to set collaborator (422): Validation Failed',
    );
  });
});

describe('github service - removeRepoCollaborator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws error when token is empty', async () => {
    await expect(removeRepoCollaborator('', 'owner', 'repo', 'user')).rejects.toThrow(
      'GitHub access token is required',
    );
  });

  it('succeeds silently when status is 204', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);

    await expect(removeRepoCollaborator('token', 'org', 'repo', 'dev1')).resolves.not.toThrow();
  });

  it('ignores 404 Not Found silently', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    } as Response);

    await expect(removeRepoCollaborator('token', 'org', 'repo', 'dev1')).resolves.not.toThrow();
  });

  it('throws on non-404 failure status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    } as Response);

    await expect(removeRepoCollaborator('token', 'org', 'repo', 'dev1')).rejects.toThrow(
      'Failed to remove collaborator (403): Forbidden',
    );
  });
});

describe('github service - auth provider', () => {
  it('uses a single GitHub provider without scopes (the GitHub App defines access)', () => {
    expect(githubProvider.providerId).toBe('github.com');
  });
});

describe('githubPopupMode', () => {
  it('links GitHub when the account has no GitHub provider yet', () => {
    expect(githubPopupMode({ providerData: [{ providerId: 'google.com' }] } as never)).toBe('link');
  });

  it('reauthenticates when GitHub is already linked, so owners can upgrade to repo scope', () => {
    expect(
      githubPopupMode({ providerData: [{ providerId: 'google.com' }, { providerId: 'github.com' }] } as never),
    ).toBe('reauthenticate');
  });
});

describe('github service - live access state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies collaborators, pending invitations, and no access (case-insensitive)', () => {
    const collaborators = [{ login: 'Alice' }];
    const invitations = [{ login: 'bob' }];
    expect(githubAccessState('alice', collaborators, invitations)).toBe('active');
    expect(githubAccessState('BOB', collaborators, invitations)).toBe('pending');
    expect(githubAccessState('carol', collaborators, invitations)).toBe('none');
  });

  it('parses pending invitations and treats 403/404 as none', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 7, invitee: { login: 'bob' }, permissions: 'write' }],
    } as Response);
    expect(await fetchRepoInvitations('t', 'o', 'r')).toEqual([{ id: 7, login: 'bob', permission: 'write' }]);

    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    expect(await fetchRepoInvitations('t', 'o', 'r')).toEqual([]);
  });

  it('revokeRepoAccess cancels the pending invitation and removes the collaborator', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/invitations?per_page=100')) {
        return { ok: true, json: async () => [{ id: 7, invitee: { login: 'Bob' } }, { id: 8, invitee: { login: 'eve' } }] } as Response;
      }
      return { ok: true, status: 204 } as Response;
    }) as typeof fetch;

    await revokeRepoAccess('t', 'o', 'r', 'bob');
    expect(calls).toEqual([
      'GET https://api.github.com/repos/o/r/invitations?per_page=100',
      'DELETE https://api.github.com/repos/o/r/invitations/7',
      'DELETE https://api.github.com/repos/o/r/collaborators/bob',
    ]);
  });
});

describe('github service - membership drift', () => {
  const membership = { id: 'p_u', projectId: 'p', userId: 'u', displayName: 'U', email: '', photoURL: '', role: 'member' as const };
  const profile = { id: 'u', displayName: 'U', email: '', photoURL: '', locale: 'th' as const, theme: 'system' as const };

  it('detects a missing, stale, or leftover GitHub handle', () => {
    expect(membershipGitHubDrift(membership, { ...profile, githubUsername: 'octo', githubId: '1' })).toBe(true);
    expect(membershipGitHubDrift({ ...membership, githubUsername: 'octo', githubId: '1' }, profile)).toBe(true);
    expect(membershipGitHubDrift({ ...membership, githubUsername: 'old', githubId: '1' }, { ...profile, githubUsername: 'octo', githubId: '1' })).toBe(true);
  });

  it('does nothing when already in sync', () => {
    expect(membershipGitHubDrift(membership, profile)).toBe(false);
    // A granted membership keeps its handle until the owner re-grants; removal still syncs.
    expect(membershipGitHubDrift({ ...membership, githubUsername: 'old', githubId: '1', githubPermission: 'push' }, { ...profile, githubUsername: 'octo', githubId: '2' })).toBe(false);
    expect(membershipGitHubDrift({ ...membership, githubUsername: 'old', githubId: '1', githubPermission: 'push' }, profile)).toBe(true);
    expect(membershipGitHubDrift({ ...membership, githubUsername: 'octo', githubId: '1' }, { ...profile, githubUsername: 'octo', githubId: '1' })).toBe(false);
  });
});
