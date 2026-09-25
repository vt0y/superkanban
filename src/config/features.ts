/**
 * Global feature flags configured strictly via .env files.
 * All feature toggles are disabled by default.
 */

export function parseFeatureFlag(raw?: string | null): boolean {
  if (!raw) return false;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === 'true' || trimmed === '1';
}

/** A GitHub App slug as it appears in https://github.com/apps/<slug>; anything else is ignored. */
export function parseGitHubAppSlug(raw?: string | null): string {
  const slug = (raw ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) ? slug : '';
}

const env = import.meta.env;

export const githubAppSlug: string = parseGitHubAppSlug(
  (env.CONNECTS_GITHUB_APP_SLUG ?? env.VITE_CONNECTS_GITHUB_APP_SLUG ?? '') as string,
);

// GitHub features need both the flag and the GitHub App they run through.
export const isGitHubEnabled: boolean =
  parseFeatureFlag((env.CONNECTS_GITHUB ?? env.VITE_CONNECTS_GITHUB ?? '') as string) && githubAppSlug !== '';

export const githubAppInstallUrl = githubAppSlug ? `https://github.com/apps/${githubAppSlug}/installations/new` : '';
