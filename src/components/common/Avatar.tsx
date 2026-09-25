export function Avatar({ name, src, size = 'md' }: { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }) {
  return src ? (
    <img className={`avatar ${size}`} src={src} alt={name} referrerPolicy="no-referrer" />
  ) : (
    <span className={`avatar fallback ${size}`}>{name.slice(0, 1).toUpperCase()}</span>
  );
}
