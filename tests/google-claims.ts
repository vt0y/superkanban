/** Token claims of a Google-created account, as the rules' authenticated() requires. */
export const googleClaims = (uid: string, email: string) => ({
  email,
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' as const, identities: { 'google.com': [uid], email: [email] } },
});
