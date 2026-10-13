import type { User } from 'firebase/auth';
import {
  GithubAuthProvider,
  getAdditionalUserInfo,
  linkWithPopup,
  reauthenticateWithPopup,
  unlink,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import { auth } from '@/config/firebase';
import type { GitHubRevocation, Membership, Project, ProjectGitHubRepo, UserProfile } from '@/types';
import { activityData, database, withId } from './helpers';

// GitHub App: scopes are ignored, access comes from the App's permissions and the repos it is installed on.
export const githubProvider = new GithubAuthProvider();

export interface GitHubRepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  ownerType: 'User' | 'Organization';
  private: boolean;
  htmlUrl: string;
  description: string;
  defaultBranch: string;
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GitHubCollaborator {
  id: number;
  login: string;
  avatarUrl: string;
  roleName: string; // 'admin' | 'write' | 'read' | 'triage' | 'maintain'
  permissions: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
}

export type GitHubPermission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin';

/* ---------- Management session ("sudo mode") ---------- */

const SESSION_KEY = 'ps.github.session';
const LEGACY_TOKEN_KEY = 'ps.github.token';
/** GitHub App user access tokens expire 8 hours after issue; stop using them a little early. */
export const GITHUB_SESSION_TTL_MS = 8 * 60 * 60 * 1000 - 5 * 60 * 1000;

export interface GitHubSession {
  token: string;
  issuedAt: number;
  expiresAt: number;
}

/** Thrown on HTTP 401: the session token expired or was revoked, so the owner must enter sudo mode again. */
export class GitHubAuthError extends Error {
  constructor() {
    super('GitHub session expired');
    this.name = 'GitHubAuthError';
  }
}

function assertAuthorized(res: Response): void {
  if (res.status === 401) throw new GitHubAuthError();
}

export function getGitHubSession(now = Date.now()): GitHubSession | null {
  try {
    // Tokens from the old OAuth App never expire on their own; never reuse them.
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { token, issuedAt } = JSON.parse(raw) as { token?: unknown; issuedAt?: unknown };
    if (typeof token !== 'string' || !token || typeof issuedAt !== 'number') return null;
    const expiresAt = issuedAt + GITHUB_SESSION_TTL_MS;
    if (now >= expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { token, issuedAt, expiresAt };
  } catch {
    return null;
  }
}

export function getStoredGitHubToken(): string {
  return getGitHubSession()?.token ?? '';
}

export function startGitHubSession(token: string, now = Date.now()): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, issuedAt: now }));
  } catch {
    /* storage unavailable */
  }
  notifySessionChange();
}

/** Leaves sudo mode locally. The token itself dies on GitHub when its 8 hours are up. */
export function endGitHubSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
  notifySessionChange();
}

const SESSION_EVENT = 'ps:github-session';
function notifySessionChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EVENT));
}

/** Calls back whenever the session starts or ends (in this tab or another one). */
export function onGitHubSessionChange(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => event.key === SESSION_KEY && callback();
  window.addEventListener(SESSION_EVENT, callback);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SESSION_EVENT, callback);
    window.removeEventListener('storage', onStorage);
  };
}

/* ---------- Account Linking / Unlinking ---------- */

/**
 * Firebase refuses to link the same provider twice (auth/provider-already-linked), so once
 * GitHub is linked we re-run the popup through reauthentication instead. That is how an owner
 * who already connected their identity gets a fresh token to start a management session.
 */
export function githubPopupMode(user: Pick<User, 'providerData'>): 'link' | 'reauthenticate' {
  return user.providerData.some((p) => p.providerId === GithubAuthProvider.PROVIDER_ID) ? 'reauthenticate' : 'link';
}

export async function linkGitHubAccount(
  user: User,
  startSession = false,
): Promise<{ username: string; githubId: string; token: string }> {
  if (!auth) throw new Error('Firebase Auth not initialized');

  const result =
    githubPopupMode(user) === 'reauthenticate'
      ? await reauthenticateWithPopup(user, githubProvider)
      : await linkWithPopup(user, githubProvider);
  const credential = GithubAuthProvider.credentialFromResult(result);
  const info = getAdditionalUserInfo(result);

  const profile = info?.profile as Record<string, unknown> | undefined;
  const username = (info?.username as string) || (profile?.login as string) || '';
  const githubId = profile?.id != null ? String(profile.id) : '';
  const token = credential?.accessToken || '';

  // Identity-only connects (members) never keep the token; only an owner entering sudo mode does.
  if (token && startSession) {
    startGitHubSession(token);
  }

  // Force refresh ID token so Firebase Auth JWT includes github.com identity
  try {
    await user.getIdToken(true);
  } catch {
    /* token refresh non-blocking */
  }

  if (username) {
    const store = database();
    await updateDoc(doc(store, 'users', user.uid), {
      githubUsername: username,
      ...(githubId ? { githubId } : {}),
      githubConnectedAt: serverTimestamp(),
    });

    // One write per membership: a single batch would be rejected as a whole by the first archived project.
    // Anything that still fails is repaired by syncOwnMembershipGitHub when that project is opened.
    try {
      const memSnap = await getDocs(query(collection(store, 'memberships'), where('userId', '==', user.uid)));
      await Promise.allSettled(
        memSnap.docs.map((d) => updateDoc(d.ref, { githubUsername: username, ...(githubId ? { githubId } : {}) })),
      );
    } catch (err) {
      console.warn('Membership sync skipped', err);
    }
  }

  return { username, githubId, token };
}

export async function unlinkGitHubAccount(user: User): Promise<void> {
  if (!auth) throw new Error('Firebase Auth not initialized');

  // 1. Unlink GitHub provider from Firebase Auth record
  try {
    await unlink(user, 'github.com');
    await user.getIdToken(true);
  } catch (err) {
    console.warn('Firebase Auth unlink skipped or already unlinked', err);
  }

  // 2. Clear fields from Firestore user document
  const store = database();
  await updateDoc(doc(store, 'users', user.uid), {
    githubUsername: deleteField(),
    githubId: deleteField(),
    githubConnectedAt: deleteField(),
  });

  // 3. Clear from each membership. Members may not touch githubPermission, so any repo access they
  //    still hold is queued for the project owner to revoke, in the same batch as the clear.
  try {
    const memSnap = await getDocs(query(collection(store, 'memberships'), where('userId', '==', user.uid)));
    await Promise.allSettled(
      memSnap.docs.map(async (d) => {
        const membership = withId<Membership>(d);
        const batch = writeBatch(store);
        batch.update(d.ref, { githubUsername: deleteField(), githubId: deleteField() });
        if (membership.githubPermission && membership.githubUsername) {
          const project = await getDoc(doc(store, 'projects', membership.projectId));
          const repo = (project.data() as Project | undefined)?.githubRepo;
          if (repo) {
            queueGitHubRevocation(batch, membership.projectId, {
              githubUsername: membership.githubUsername,
              userId: membership.userId,
              displayName: membership.displayName,
              permission: membership.githubPermission,
              repoOwner: repo.owner,
              repoName: repo.name,
              reason: 'disconnected',
              createdBy: user.uid,
            });
          }
        }
        await batch.commit();
      }),
    );
  } catch (err) {
    console.warn('Membership clear skipped', err);
  }

  // 4. Leave any management session
  endGitHubSession();
}

/**
 * Self-heal for a membership whose GitHub fields drifted from the user's profile (for example when
 * the sync at connect time failed). Writes only the caller's own membership, and only on mismatch.
 */
export function membershipGitHubDrift(membership: Membership, profile: UserProfile): boolean {
  const drifted = (membership.githubUsername || '') !== (profile.githubUsername || '') || (membership.githubId || '') !== (profile.githubId || '');
  // Rules lock the handle while repo access is granted (only removal is allowed); the owner re-grants for a new account.
  if (drifted && membership.githubPermission && profile.githubUsername) return false;
  return drifted;
}

export async function syncOwnMembershipGitHub(membership: Membership, profile: UserProfile): Promise<void> {
  await updateDoc(doc(database(), 'memberships', membership.id), {
    githubUsername: profile.githubUsername || deleteField(),
    githubId: profile.githubId || deleteField(),
  });
}

/* ---------- Pending revocations (access that must still be removed on GitHub) ---------- */

export type GitHubRevocationInput = Omit<GitHubRevocation, 'id' | 'createdAt'>;

export function queueGitHubRevocation(batch: WriteBatch, projectId: string, data: GitHubRevocationInput): void {
  const ref = doc(collection(database(), 'projects', projectId, 'githubRevocations'));
  batch.set(ref, { ...data, createdAt: serverTimestamp() });
}

export function subscribeGitHubRevocations(projectId: string, callback: (items: GitHubRevocation[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(database(), 'projects', projectId, 'githubRevocations'), orderBy('createdAt', 'asc')),
    (snapshot) => callback(snapshot.docs.map((item) => withId<GitHubRevocation>(item))),
  );
}

/** Removes the access on GitHub, then clears the queue entry and any leftover permission on the membership. */
export async function resolveGitHubRevocation(token: string, projectId: string, revocation: GitHubRevocation): Promise<void> {
  await revokeRepoAccess(token, revocation.repoOwner, revocation.repoName, revocation.githubUsername);
  const store = database();
  await deleteDoc(doc(store, 'projects', projectId, 'githubRevocations', revocation.id));
  const membership = await getDoc(doc(store, 'memberships', `${projectId}_${revocation.userId}`)).catch(() => null);
  if (membership?.exists() && membership.data().githubPermission) {
    await updateMemberGitHubPermission(projectId, revocation.userId, null);
  }
}

export async function updateMemberGitHubPermission(
  projectId: string,
  userId: string,
  permission: GitHubPermission | null,
): Promise<void> {
  const store = database();
  const ref = doc(store, 'memberships', `${projectId}_${userId}`);
  if (permission) {
    await updateDoc(ref, { githubPermission: permission });
  } else {
    await updateDoc(ref, { githubPermission: deleteField() });
  }
}

/* ---------- Repository Binding / Unlinking ---------- */

export async function linkProjectRepository(
  projectId: string,
  repo: ProjectGitHubRepo,
  user: User,
): Promise<void> {
  const store = database();
  await updateDoc(doc(store, 'projects', projectId), {
    githubRepo: {
      id: repo.id,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      url: repo.url,
      private: repo.private,
      ...(repo.ownerType ? { ownerType: repo.ownerType } : {}),
      defaultBranch: repo.defaultBranch || 'main',
      linkedAt: serverTimestamp(),
      linkedBy: user.uid,
    },
    updatedAt: serverTimestamp(),
  });

  // Record activity
  await updateDoc(
    doc(collection(store, 'projects', projectId, 'activities')),
    activityData(
      user,
      'github_repo_linked',
      `linked GitHub repository ${repo.fullName}`,
      `linked GitHub repository ${repo.fullName}`,
      projectId,
    ),
  ).catch(() => {
    /* activity logging non-blocking */
  });
}

export async function unlinkProjectRepository(
  projectId: string,
  repoFullName: string,
  user: User,
): Promise<void> {
  const store = database();
  await updateDoc(doc(store, 'projects', projectId), {
    githubRepo: deleteField(),
    updatedAt: serverTimestamp(),
  });

  // Record activity
  await updateDoc(
    doc(collection(store, 'projects', projectId, 'activities')),
    activityData(
      user,
      'github_repo_unlinked',
      `unlinked GitHub repository ${repoFullName}`,
      `unlinked GitHub repository ${repoFullName}`,
      projectId,
    ),
  ).catch(() => {
    /* activity logging non-blocking */
  });
}

/* ---------- GitHub REST API Calls ---------- */

export async function verifyGitHubToken(token: string): Promise<{ valid: boolean; username: string }> {
  if (!token) return { valid: false, username: '' };
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) return { valid: false, username: '' };
    const data = await res.json();
    return { valid: true, username: data.login || '' };
  } catch {
    return { valid: false, username: '' };
  }
}

export interface InstallationRepositories {
  installations: number;
  repos: GitHubRepoSummary[];
}

function mapRepo(r: Record<string, unknown>): GitHubRepoSummary {
  return {
    id: r.id as number,
    name: r.name as string,
    fullName: r.full_name as string,
    owner: ((r.owner as Record<string, unknown>)?.login as string) || '',
    ownerType: (r.owner as Record<string, unknown>)?.type === 'Organization' ? 'Organization' : 'User',
    private: Boolean(r.private),
    htmlUrl: r.html_url as string,
    description: (r.description as string) || '',
    defaultBranch: (r.default_branch as string) || 'main',
    permissions: r.permissions as GitHubRepoSummary['permissions'],
  };
}

/** Repositories the GitHub App is installed on that this user can reach, across all installations. */
export async function fetchInstallationRepositories(token: string): Promise<InstallationRepositories> {
  if (!token) throw new Error('GitHub access token is required');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };

  const res = await fetch('https://api.github.com/user/installations?per_page=100', { headers });
  assertAuthorized(res);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch installations (${res.status}): ${errText}`);
  }
  const { installations = [] } = (await res.json()) as { installations?: { id: number }[] };

  const lists = await Promise.all(
    installations.map(async (installation) => {
      const repoRes = await fetch(`https://api.github.com/user/installations/${installation.id}/repositories?per_page=100`, { headers });
      assertAuthorized(repoRes);
      if (!repoRes.ok) {
        const errText = await repoRes.text();
        throw new Error(`Failed to fetch repositories (${repoRes.status}): ${errText}`);
      }
      const { repositories = [] } = (await repoRes.json()) as { repositories?: Record<string, unknown>[] };
      return repositories.map(mapRepo);
    }),
  );

  const byId = new Map<number, GitHubRepoSummary>();
  lists.flat().forEach((repo) => byId.set(repo.id, repo));
  return { installations: installations.length, repos: [...byId.values()].sort((x, y) => x.fullName.localeCompare(y.fullName)) };
}

export async function fetchRepoCollaborators(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubCollaborator[]> {
  if (!token) throw new Error('GitHub access token is required');

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/collaborators?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  assertAuthorized(res);

  if (!res.ok) {
    if (res.status === 403 || res.status === 404) return [];
    const errText = await res.text();
    throw new Error(`Failed to fetch collaborators (${res.status}): ${errText}`);
  }

  const items = await res.json();
  return items.map((c: Record<string, unknown>) => ({
    id: c.id as number,
    login: c.login as string,
    avatarUrl: (c.avatar_url as string) || '',
    roleName: (c.role_name as string) || 'read',
    permissions: c.permissions as GitHubCollaborator['permissions'],
  }));
}

/** Roles GitHub lets you grant on a repo: personal-account repos only have write collaborators. */
export function grantablePermissions(ownerType: 'User' | 'Organization'): GitHubPermission[] {
  return ownerType === 'User' ? ['push'] : ['pull', 'triage', 'push', 'maintain', 'admin'];
}

const ownerTypeCache = new Map<string, Promise<'User' | 'Organization'>>();

/** Account type of a repo owner (public endpoint, no token). Falls back to 'User', the stricter case. */
export function fetchOwnerType(owner: string): Promise<'User' | 'Organization'> {
  const key = owner.toLowerCase();
  let pending = ownerTypeCache.get(key);
  if (!pending) {
    pending = fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { type?: string } | null) => (body?.type === 'Organization' ? 'Organization' : 'User') as 'User' | 'Organization')
      .catch(() => 'User' as const);
    ownerTypeCache.set(key, pending);
  }
  return pending;
}

export async function setRepoCollaborator(
  token: string,
  owner: string,
  repo: string,
  username: string,
  permission: GitHubPermission,
  ownerType: 'User' | 'Organization' = 'Organization',
): Promise<{ invited: boolean; message: string }> {
  if (!token) throw new Error('GitHub access token is required');

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    // Personal-account repos reject any explicit role (422); their collaborators always get write.
    body: JSON.stringify(ownerType === 'User' ? {} : { permission }),
  });
  assertAuthorized(res);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to set collaborator (${res.status}): ${errText}`);
  }

  // 201 Created = Invitation created; 204 No Content = Collaborator updated
  const invited = res.status === 201;
  return {
    invited,
    message: invited
      ? `Invitation sent to @${username} (${permission})`
      : `Updated permissions for @${username} to ${permission}`,
  };
}

export async function removeRepoCollaborator(
  token: string,
  owner: string,
  repo: string,
  username: string,
): Promise<void> {
  if (!token) throw new Error('GitHub access token is required');

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/collaborators/${username}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  assertAuthorized(res);

  if (!res.ok && res.status !== 404) {
    const errText = await res.text();
    throw new Error(`Failed to remove collaborator (${res.status}): ${errText}`);
  }
}

export interface GitHubInvitation {
  id: number;
  login: string;
  permission: string;
}

export async function fetchRepoInvitations(token: string, owner: string, repo: string): Promise<GitHubInvitation[]> {
  if (!token) throw new Error('GitHub access token is required');

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/invitations?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  assertAuthorized(res);

  if (!res.ok) {
    if (res.status === 403 || res.status === 404) return [];
    const errText = await res.text();
    throw new Error(`Failed to fetch invitations (${res.status}): ${errText}`);
  }

  const items = await res.json();
  return items.map((i: Record<string, unknown>) => ({
    id: i.id as number,
    login: ((i.invitee as Record<string, unknown>)?.login as string) || '',
    permission: (i.permissions as string) || '',
  }));
}

export type GitHubAccessState = 'active' | 'pending' | 'none';

/** What GitHub itself says about a user's access: a collaborator, a pending invitation, or nothing. */
export function githubAccessState(
  login: string,
  collaborators: Pick<GitHubCollaborator, 'login'>[],
  invitations: Pick<GitHubInvitation, 'login'>[],
): GitHubAccessState {
  const target = login.toLowerCase();
  if (collaborators.some((c) => c.login.toLowerCase() === target)) return 'active';
  if (invitations.some((i) => i.login.toLowerCase() === target)) return 'pending';
  return 'none';
}

/**
 * Fully removes a user's access: cancels any pending invitation (removing a collaborator does not
 * cancel invitations sent to them) and removes the collaborator.
 */
export async function revokeRepoAccess(token: string, owner: string, repo: string, username: string): Promise<void> {
  const invitations = await fetchRepoInvitations(token, owner, repo);
  for (const invitation of invitations.filter((i) => i.login.toLowerCase() === username.toLowerCase())) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/invitations/${invitation.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    assertAuthorized(res);
    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      throw new Error(`Failed to cancel invitation (${res.status}): ${errText}`);
    }
  }
  await removeRepoCollaborator(token, owner, repo, username);
}
