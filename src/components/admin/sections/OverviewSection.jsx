import { useState } from 'react';
import fr from '../../../locales/fr.json';
import { useEvents } from '../../../lib/events';
import { refreshAdminParties, useAdminParties } from '../../../lib/adminParties';
import { useEventPlaces } from '../../../lib/eventPlaces';
import { refreshBudget, useBudget } from '../../../lib/budget';
import { useToasts } from '../../../hooks/useToasts';
import AdminOverview from '../AdminOverview';
import PartyEditDialog from '../PartyEditDialog';
import NoActiveEvent from './NoActiveEvent';
import SectionStatus from './SectionStatus';

// Résumé (#195): the active event at a glance. Its parties, places and budget come from the
// shared stores; a party opens in the god-mode editor.
const OverviewSection = () => {
  const { activeEvent } = useEvents();
  const { parties, loading, error } = useAdminParties(activeEvent?.id);
  // The sleeping places as the event uses them (#113, #193), for the occupancy (#115).
  const { available: places } = useEventPlaces(activeEvent?.id);
  const budget = useBudget(activeEvent?.id);
  const [editingParty, setEditingParty] = useState(null);
  const { addToast } = useToasts(1699);

  if (!activeEvent) return <NoActiveEvent />;
  if (loading || error || budget.loading || budget.error) {
    return <SectionStatus loading={loading || budget.loading} error={error || budget.error} onRetry={() => { refreshAdminParties(activeEvent.id); refreshBudget(activeEvent.id); }} />;
  }

  const handleSaved = () => {
    addToast(fr.changesSavedToast, 'success');
    setEditingParty(null);
    refreshAdminParties(activeEvent.id);
  };

  return (
    <>
      <AdminOverview event={activeEvent} budget={budget.budget} parties={parties} places={places} onOpenParty={setEditingParty} />
      <PartyEditDialog party={editingParty} event={activeEvent} onClose={() => setEditingParty(null)} onSaved={handleSaved} />
    </>
  );
};

export default OverviewSection;
