import { useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

/**
 * Underlined tabs that switch a page's `?view=`. Only `view` changes; every other param (filters,
 * milestone scope, an open `?task=`) is kept. The first view is the default and leaves the URL clean.
 */
export function ViewTabs<T extends string>({ views, value, label }: { views: { id: T; label: string; icon: IconName }[]; value: T; label: string }) {
  const [, setParams] = useSearchParams();
  const select = (id: T) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (id === views[0].id) next.delete('view'); else next.set('view', id);
    return next;
  });
  return (
    <nav className="content-tabs view-tabs" role="tablist" aria-label={label}>
      {views.map((view) => (
        <button key={view.id} type="button" role="tab" aria-selected={value === view.id} className={value === view.id ? 'active' : ''} onClick={() => select(view.id)}>
          <Icon name={view.icon} />
          <span>{view.label}</span>
        </button>
      ))}
    </nav>
  );
}
