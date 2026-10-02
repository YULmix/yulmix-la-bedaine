import { useState } from 'react';
import fr from '../../../locales/fr.json';
import { useEvents } from '../../../lib/events';
import { refreshAdminParties, useAdminParties } from '../../../lib/adminParties';
import { useEventPlaces } from '../../../lib/eventPlaces';
import { useToasts } from '../../../hooks/useToasts';
import AdminOverview from '../AdminOverview';
import PartyEditDialog from '../PartyEditDialog';
import NoActiveEvent from './NoActiveEvent';
import SectionStatus from './SectionStatus';

// Résumé (#195): the active event at a glance. Its parties and places come from the shared
// stores; a party opens in the god-mode editor. `budget` comes from the admin view until the
// budget has its own store (#195, PR 3).
const OverviewSection = ({ budget }) => {
  const { activeEvent } = useEvents();
  const { parties, loading, error } = useAdminParties(activeEvent?.id);
  // The sleeping places as the event uses them (#113, #193), for the occupancy (#115).
  const { available: places } = useEventPlaces(activeEvent?.id);
  const [editingParty, setEditingParty] = useState(null);
  const { addToast } = useToasts(1699);

  if (!activeEvent) return <NoActiveEvent />;
  const status = <SectionStatus loading={loading} error={error} onRetry={() => refreshAdminParties(activeEvent.id)} />;
  if (loading || error) return status;

  const handleSaved = () => {
    addToast(fr.changesSavedToast, 'success');
    setEditingParty(null);
    refreshAdminParties(activeEvent.id);
  };

  return (
    <>
      <AdminOverview event={activeEvent} budget={budget} parties={parties} places={places} onOpenParty={setEditingParty} />
      <PartyEditDialog party={editingParty} event={activeEvent} onClose={() => setEditingParty(null)} onSaved={handleSaved} />
    </>
  );
};

export default OverviewSection;
