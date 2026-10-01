import { CalendarDays, Clock, ExternalLink, MapPin, Phone, ScrollText, Users } from 'lucide-react';
import fr from '../locales/fr.json';
import { eventAddress, getGoogleMapsUrl } from '../lib/venue';
import { formatEventDates } from '../lib/eventDisplay';
import GalleryButton from './Gallery';

const Fact = ({ icon: Icon, label, children }) => (
  <div className="flex gap-3">
    <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-neon" strokeWidth={1.75} />
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  </div>
);

// What a member needs to know about an edition: when, where, how long, who to call, what to
// bring, and links. Internal numbers (costs, tunables) are never shown here. `venueGallery`, the
// venue's general gallery (#177), shows under the address where the page has read it.
const EventFacts = ({ event, venueGallery }) => {
  const dates = formatEventDates(event);
  const links = event.external_links || [];
  const address = eventAddress(event);
  return (
    <div className="space-y-8">
      <dl className="grid gap-5 sm:grid-cols-2">
        {dates && <Fact icon={CalendarDays} label={fr.dates}>{dates}</Fact>}
        {(address || venueGallery?.length > 0) && (
          <Fact icon={MapPin} label={fr.venue}>
            {address && (
              <a href={getGoogleMapsUrl(address)} target="_blank" rel="noopener noreferrer" className="underline decoration-edge underline-offset-4 hover:decoration-neon">
                {address}
              </a>
            )}
            <GalleryButton images={venueGallery} name={event.venue?.name || fr.venue} className="mt-3" />
          </Fact>
        )}
        {event.duration_days > 0 && <Fact icon={Clock} label={fr.eventDurationTitle}>{event.duration_days} {fr.daysSuffix}</Fact>}
        {event.max_attendees > 0 && <Fact icon={Users} label={fr.eventDurationCapacityTitle}>{event.max_attendees} {fr.participantsSuffix}</Fact>}
      </dl>

      {event.points_of_contact && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-ink">
            <Phone aria-hidden="true" className="size-5 text-neon" strokeWidth={1.75} />{fr.eventPointsOfContactLabel}
          </h3>
          <p className="max-w-prose whitespace-pre-line text-muted">{event.points_of_contact}</p>
        </section>
      )}

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-ink">
          <ScrollText aria-hidden="true" className="size-5 text-neon" strokeWidth={1.75} />{fr.eventInstructionsLabel}
        </h3>
        <p className="max-w-prose whitespace-pre-line text-muted">{event.instructions || fr.noInstructionsMessage}</p>
      </section>

      {links.length > 0 && (
        <section>
          <h3 className="mb-2 text-lg font-semibold text-ink">{fr.eventExternalLinksLabel}</h3>
          <ul className="divide-y divide-line rounded-card border border-line">
            {links.map((link, index) => (
              <li key={index}>
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-between gap-3 px-4 text-ink hover:bg-raised">
                  <span className="truncate">{link.label || link.url}</span>
                  <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-faint" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default EventFacts;
