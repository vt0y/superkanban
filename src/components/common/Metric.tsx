import { Icon, type IconName } from './Icon';

export function Metric({
  icon,
  color,
  value,
  label,
}: {
  icon: IconName;
  color: string;
  value: number;
  label: string;
}) {
  return (
    <article className="metric">
      <span className={color}><Icon name={icon} /></span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}
