const rawEnv =
  (typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env.ALLOWED_EMAIL_DOMAINS as string | undefined) ??
      (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS as string | undefined)
    : undefined) ??
  (typeof process !== 'undefined' && process.env
    ? process.env.ALLOWED_EMAIL_DOMAINS || process.env.VITE_ALLOWED_EMAIL_DOMAINS
    : undefined) ??
  '';

export function parseAllowedDomains(raw: string): string[] {
  if (!raw) return [];
  const parts = raw
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase().replace(/^@/, ''))
    .filter((item) => item.length > 0);
  return Array.from(new Set(parts));
}

export const allowedDomains: string[] = parseAllowedDomains(rawEnv);

export function isAllowedEmail(
  email: string | null | undefined,
  domains: string[] = allowedDomains,
): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  const basicEmailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!basicEmailRegex.test(normalized)) return false;

  // If no domains are configured, allow any valid email
  if (domains.length === 0) return true;

  return domains.some((domain) => {
    const escapedDomain = domain.toLowerCase().replace(/^@/, '');
    return (
      normalized.endsWith(`@${escapedDomain}`) &&
      normalized.length > escapedDomain.length + 1
    );
  });
}

/** Mirrors the Firestore rules: a Google-created account with a verified, allowed email. */
export function isAllowedUser(
  user: { email: string | null; emailVerified: boolean; providerData: { providerId: string }[] },
  domains: string[] = allowedDomains,
): boolean {
  return user.emailVerified && user.providerData.some((provider) => provider.providerId === 'google.com') && isAllowedEmail(user.email, domains);
}

export function getAllowedDomainsLabel(domains: string[] = allowedDomains): string {
  if (domains.length === 0) return '';
  return domains.map((domain) => `@${domain}`).join(', ');
}

export function getDomainErrorMessage(domains: string[] = allowedDomains): string {
  if (domains.length === 0) return 'อีเมลไม่ถูกต้อง';
  return `อนุญาตเฉพาะบัญชีอีเมล ${getAllowedDomainsLabel(domains)} เท่านั้น`;
}
