import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import fr from '../../locales/fr.json';
import { cx } from '../ui';

// How every admin detail page opens (#210): a back link naming its parent (« ← Événements »,
// « ← Sites », « ← {venue name} »), then its title as the page's h1, with `tags` beside it, `actions`
// at the end of that line and `meta` under it. On a phone it replaces the section header, which the
// shell leaves out for a drill-down. The back link is a real link to the parent's URL, so the
// parent stays one click (or a long press) away and Back keeps its meaning.
const DrillDownHeader = ({ backTo, backLabel, title, titleId, tags, actions, meta, className }) => (
  <div className={cx('space-y-2', className)}>
    <Link to={backTo} aria-label={fr.adminBackTo.replace('{name}', backLabel)}
      className="-ml-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-control px-2 text-sm font-semibold text-muted transition duration-150 hover:bg-raised hover:text-ink">
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{backLabel}</span>
    </Link>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 id={titleId} className="min-w-0 font-display text-xl text-ink [overflow-wrap:anywhere] md:text-display-md">{title}</h1>
      {tags}
      {actions}
    </div>
    {meta}
  </div>
);

export default DrillDownHeader;
