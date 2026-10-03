import { CalendarRange } from 'lucide-react';
import fr from '../../../locales/fr.json';
import { refreshEvents, useEvents } from '../../../lib/events';
import { EmptyState } from '../../ui';
import SectionStatus from './SectionStatus';

// What a section about the active event shows when there is none. While the events load, or when
// they couldn't, that's what it says instead: a failed load isn't "no active event".
const NoActiveEvent = () => {
  const { loading, error } = useEvents();
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  return <EmptyState icon={CalendarRange} title={fr.noActiveEventTitle}>{fr.adminNoActiveEventHint}</EmptyState>;
};

export default NoActiveEvent;
