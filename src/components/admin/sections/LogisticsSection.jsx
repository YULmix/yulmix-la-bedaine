import { useState } from 'react';
import fr from '../../../locales/fr.json';
import { useEvents } from '../../../lib/events';
import { refreshAdminParties, useAdminParties } from '../../../lib/adminParties';
import { useEventPlaces } from '../../../lib/eventPlaces';
import { discardLogistics, saveLogistics, setLogisticsMessage, setLogisticsNotes, setLogisticsPlace, useLogistics } from '../../../lib/logistics';
import { useToasts } from '../../../hooks/useToasts';
import AdminLogisticsView from '../AdminLogisticsView';
import UserProfileDialog from '../UserProfileDialog';
import NoActiveEvent from './NoActiveEvent';
import SectionStatus from './SectionStatus';

// Logistique (#195): what organisers plan with, for the active event. The places, notes and messages draft
// lives in the logistics store (one Save, #150), so it survives switching sections; the admin
// shell asks it before letting anyone leave the admin with unsaved edits.
const LogisticsSection = ({ view }) => {
  const { activeEvent } = useEvents();
  const eventId = activeEvent?.id;
  const { parties, activeParties, loading, error } = useAdminParties(eventId);
  // The sleeping places as the event uses them (#113, #193), shared with the event editor.
  const { available: places } = useEventPlaces(eventId);
  const { changes, errors, unsavedCount, saving } = useLogistics(eventId);
  const [profile, setProfile] = useState(null);
  const { addToast } = useToasts(1699);

  if (!activeEvent) return <NoActiveEvent />;
  if (loading || error) return <SectionStatus loading={loading} error={error} onRetry={() => refreshAdminParties(eventId)} />;

  const handleSave = async () => {
    try {
      const { failedPartyIds } = await saveLogistics(eventId);
      if (!failedPartyIds.length) {
        addToast(fr.logisticsAllSavedToast, 'success');
      } else {
        const names = failedPartyIds.map(id => parties.find(party => party.id === id)?.profiles?.full_name || fr.defaultUserFallback);
        addToast(fr.logisticsSomeFailedToast.replace('{n}', failedPartyIds.length).replace('{names}', names.join(', ')), 'error');
      }
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <>
      <AdminLogisticsView
        view={view}
        venue={activeEvent.venue}
        parties={activeParties}
        places={places}
        logisticsChanges={changes}
        logisticsErrors={errors}
        unsavedCount={unsavedCount}
        saving={saving}
        onPlaceChange={(party, attendeeId, placeId) => setLogisticsPlace(eventId, party, attendeeId, placeId)}
        onAdminNotesChange={(party, value) => setLogisticsNotes(eventId, party, value)}
        onParticipantMessageChange={(party, value) => setLogisticsMessage(eventId, party, value)}
        onSave={handleSave}
        onDiscard={() => discardLogistics(eventId)}
        onOpenUserProfile={setProfile}
      />
      <UserProfileDialog profile={profile} onClose={() => setProfile(null)} />
    </>
  );
};

export default LogisticsSection;
