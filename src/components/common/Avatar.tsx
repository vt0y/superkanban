import { safePhotoURL } from '@/utils/photo-url';

export function Avatar({ name, src, size = 'md' }: { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }) {
  const photo = safePhotoURL(src);
  return photo ? (
    <img className={`avatar ${size}`} src={photo} alt={name} referrerPolicy="no-referrer" />
  ) : (
    <span className={`avatar fallback ${size}`}>{name.slice(0, 1).toUpperCase()}</span>
  );
}
