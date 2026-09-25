export function Metric({
  icon,
  color,
  value,
  label,
}: {
  icon: string;
  color: string;
  value: number;
  label: string;
}) {
  return (
    <article className="metric">
      <span className={color}>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}
