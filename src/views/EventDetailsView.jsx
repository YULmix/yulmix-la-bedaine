import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarX2 } from 'lucide-react';
import fr from '../locales/fr.json';
import PosterHeader from '../components/brand/PosterHeader';
import PhaseTrack from '../components/brand/PhaseTrack';
import EventFacts from '../components/EventFacts';
import { Card, EmptyState } from '../components/ui';
import { VENUE_GALLERY_KINDS, fetchVenueGallery } from '../lib/galleries';

const EventDetailsView = ({ activeEvent }) => {
  const venueId = activeEvent?.venue?.id;
  const [venueGallery, setVenueGallery] = useState({ venueId: null, images: [] });

  // The venue's photos (#177), for signed-in members; none is just no photos.
  useEffect(() => {
    if (!venueId) return undefined;
    let current = true;
    fetchVenueGallery(venueId, VENUE_GALLERY_KINDS.general)
      .then(images => { if (current) setVenueGallery({ venueId, images }); })
      .catch(loadError => console.error('Error loading the venue gallery:', loadError));
    return () => { current = false; };
  }, [venueId]);

  if (!activeEvent) {
    return (
      <Card>
        <EmptyState icon={CalendarX2} title={fr.noActiveEventTitle}>{fr.noActiveEventMessage}</EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {fr.backToRegistration}
      </Link>
      <PosterHeader event={activeEvent} compact />
      <Card className="p-5 sm:p-6">
        <h2 className="mb-5 text-lg font-semibold text-ink">{fr.timelineTitle}</h2>
        <PhaseTrack event={activeEvent} />
      </Card>
      <Card className="p-5 sm:p-8">
        <h2 className="sr-only">{fr.eventDetailsTitle}</h2>
        {activeEvent.description && <p className="mb-8 max-w-prose text-lg text-ink">{activeEvent.description}</p>}
        <EventFacts event={activeEvent} venueGallery={venueGallery.venueId === venueId ? venueGallery.images : []} />
      </Card>
    </div>
  );
};

export default EventDetailsView;
