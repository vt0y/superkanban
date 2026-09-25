import type { Label } from '@/types';

/** Dark or light text, whichever reads better on `hex`. */
export function labelTextColor(hex: string): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16) || 0);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1f2328' : '#ffffff';
}

export function LabelChip({ label, onClick, active }: { label: Pick<Label, 'name' | 'color'>; onClick?: () => void; active?: boolean }) {
  const style = { background: label.color, color: labelTextColor(label.color) };
  return onClick
    ? <button type="button" className={`label-chip ${active ? 'active' : ''}`} style={style} onClick={(e) => { e.stopPropagation(); onClick(); }} title={label.name}>{label.name}</button>
    : <span className="label-chip" style={style} title={label.name}>{label.name}</span>;
}
