import { useNavigate } from 'react-router-dom';
import { adminHref } from '../../../lib/adminRoutes';
import { refreshEvents, useEvents } from '../../../lib/events';
import { useToasts } from '../../../hooks/useToasts';
import { AdminVenues } from '../AdminVenues';
import SectionStatus from './SectionStatus';

// Sites (#195): the shared venues (ADR 0019), a venue at /admin/venues/:venueId and its location
// at /admin/venues/:venueId/:locationId. A venue change reloads the events, which carry their venue.
const VenuesSection = ({ venueId, locationId }) => {
  const navigate = useNavigate();
  const { events, loading, error } = useEvents();
  const { addToast } = useToasts(1699);

  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={refreshEvents} />;
  const go = (to) => navigate(adminHref(to));

  return (
    <AdminVenues
      venueId={venueId}
      events={events}
      locationId={locationId}
      onOpen={id => go({ section: 'venues', venueId: id, locationId: null })}
      onLocationChange={id => go({ section: 'venues', venueId, locationId: id })}
      onBack={() => go({ section: 'venues' })}
      onVenueChange={refreshEvents}
      notify={addToast}
    />
  );
};

export default VenuesSection;
