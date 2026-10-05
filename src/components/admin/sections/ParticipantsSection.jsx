import { useEvents } from '../../../lib/events';
import { refreshAdminParties, useAdminParties } from '../../../lib/adminParties';
import { useAdminAccess } from '../../../hooks/useAdminAccess';
import ParticipantsView from '../ParticipantsView';
import NoActiveEvent from './NoActiveEvent';
import SectionStatus from './SectionStatus';

// « Participants » (#262): one row per attendee of the active event's non-cancelled parties,
// read-only. Inscrits' view for Organisateur and above, and Comité's own top-level section (#291),
// whose parties come without finances (#290).
const ParticipantsSection = () => {
  const { role } = useAdminAccess();
  const { activeEvent } = useEvents();
  const { activeParties, loading, error } = useAdminParties(activeEvent?.id, role);
  if (!activeEvent) return <NoActiveEvent />;
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={() => refreshAdminParties(activeEvent.id)} />;
  return <ParticipantsView parties={activeParties} />;
};

export default ParticipantsSection;
