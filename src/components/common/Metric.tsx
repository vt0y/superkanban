import { Icon, type IconName } from './Icon';

export function Metric({
  icon,
  color,
  value,
  label,
}: {
  icon: IconName;
  color: string;
  /** `null` while loading: shows a placeholder instead of a misleading 0. */
  value: number | null;
  label: string;
}) {
  return (
    <article className="metric">
      <span className={color}><Icon name={icon} /></span>
      <div>
        <strong>{value ?? <i className="skeleton-text" aria-label="…" />}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}
