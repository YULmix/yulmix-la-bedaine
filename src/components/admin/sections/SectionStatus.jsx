import { RotateCw } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { Button, Notice, Skeleton } from '../../ui';

// What an admin section shows instead of itself while its data loads, or when it couldn't load:
// a skeleton, or the error with « Réessayer ». Null when there is something to show.
const SectionStatus = ({ loading, error, onRetry }) => {
  if (error) {
    return (
      <Notice
        tone="bad"
        title={fr.adminLoadError}
        action={<Button variant="secondary" size="sm" onClick={onRetry}><RotateCw aria-hidden="true" className="size-4" />{fr.retry}</Button>}
      >
        {error}
      </Notice>
    );
  }
  if (loading) {
    return (
      <div aria-busy="true" className="space-y-4">
        <span className="sr-only">{fr.adminDashboardLoading}</span>
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }
  return null;
};

export default SectionStatus;
