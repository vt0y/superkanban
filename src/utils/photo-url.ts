/** Profile photos are copied from Google sign-in; anything else could be a tracking image on another host. */
const GOOGLE_PHOTO = /^https:\/\/lh[3-6]\.googleusercontent\.com\//;

export function safePhotoURL(value: unknown): string {
  return typeof value === 'string' && value.length <= 2048 && GOOGLE_PHOTO.test(value) ? value : '';
}
