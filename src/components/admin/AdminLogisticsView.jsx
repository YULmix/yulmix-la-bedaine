import { useEffect, useMemo, useState } from 'react';
import { BedDouble, CircleAlert, MessageSquareText, Pin, TriangleAlert } from 'lucide-react';
import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, BED_REASON_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { byBedPriority, placeOccupancy, placeOptions } from '../../lib/places';
import { computePlaceStats, placeDemandByType } from '../../lib/adminStats';
import { VENUE_GALLERY_KINDS, fetchVenueGallery } from '../../lib/galleries';
import GalleryButton, { GalleryStrip } from '../Gallery';
import { useRememberedToggle } from '../../hooks/useRememberedToggle';
import { Button, Card, EmptyState, Notice, Tag, Textarea, cx } from '../ui';
import { FilterPills } from './AdminUserManagement';
import PlacePicker from './PlacePicker';
import LogisticsSummary from './LogisticsSummary';
import SaveBar from './SaveBar';
import { CommentsView, FoodView, TransportView, VolunteeringView } from './LogisticsFormViews';
import { AdminHeaderActions } from './AdminNav';

const wantsBed = party => (party.attendees || []).some(a => a.sleeping_preference === 'bed');
const hasUnassigned = party => !party.is_waitlisted && (party.attendees || []).some(a => !a.place);

const FILTERS = [
  { id: 'all', labelKey: 'filterAll', test: () => true },
  { id: 'bed', labelKey: 'filterBedRequested', test: wantsBed },
  { id: 'unassigned', labelKey: 'filterUnassigned', test: hasUnassigned }
];

// Per-attendee sleeping places (#114), the organisers' private notes and their message to the
// party's participants (#216, shown to the member). Parties come in bed priority order (health,
// then young children, then the rest, #216), each with what it wrote to the organisers.
// Unsaved edits live in the logistics store (`logisticsChanges`, see lib/logisticsDraft.js) so
// they survive switching admin tabs and Logistique views, and are all saved at once from the bar
// at the bottom (#150);
// `logisticsErrors` holds why a party's save was refused. `places` are the event's, from
// the event places module (`available`, #193); with none, there is nothing to assign until they're defined (Événements tab).
// The venue's assignments gallery (#177) is in the page header's actions, with « Épingler le
// plan » (#293): pinned, the gallery shows as a strip stuck at the top while the parties scroll
// under it. Remembered per device (PIN_KEY), for every venue; with no image, nothing is pinned.
// `readOnly` (Comité, #217): the saved places and texts, without pickers, fields or Save.
const ReadOnlyText = ({ label, value }) => (
  <div className="mt-4">
    <p className="mb-1.5 text-sm font-semibold text-muted">{label}</p>
    <p className={cx('whitespace-pre-line text-sm [overflow-wrap:anywhere]', value?.trim() ? 'text-ink' : 'text-faint')}>
      {value?.trim() || fr.logisticsTextEmpty}
    </p>
  </div>
);

const PIN_KEY = 'bedaine:logistics-plan-pinned';

const PlacesView = ({
  readOnly = false,
  venue,
  parties,
  places,
  logisticsChanges,
  logisticsErrors,
  unsavedCount,
  saving,
  onPlaceChange,
  onAdminNotesChange,
  onParticipantMessageChange,
  onSave,
  onDiscard,
  onOpenUserProfile
}) => {
  const [filter, setFilter] = useState('all');
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.id, parties.filter(f.test).length])), [parties]);
  const activeFilter = FILTERS.find(f => f.id === filter) || FILTERS[0];
  const prioritized = useMemo(() => byBedPriority(parties), [parties]);
  const visible = prioritized.filter(activeFilter.test);
  const occupancy = useMemo(() => placeOccupancy(parties, logisticsChanges), [parties, logisticsChanges]);
  const placesById = useMemo(() => new Map(places.map(place => [place.id, place])), [places]);
  const placeStats = useMemo(() => computePlaceStats(parties, places, logisticsChanges), [parties, places, logisticsChanges]);
  const demand = useMemo(() => placeDemandByType(parties, places), [parties, places]);
  const venueId = venue?.id;
  const [gallery, setGallery] = useState({ venueId: null, images: [] });
  const [pinned, togglePinned] = useRememberedToggle(PIN_KEY, false);

  useEffect(() => {
    if (!venueId) return undefined;
    let current = true;
    fetchVenueGallery(venueId, VENUE_GALLERY_KINDS.assignments)
      .then(images => { if (current) setGallery({ venueId, images }); })
      .catch(loadError => console.error('Error loading the assignments gallery:', loadError));
    return () => { current = false; };
  }, [venueId]);

  const galleryImages = gallery.venueId === venueId ? gallery.images : [];
  const galleryName = venue?.name ? `${venue.name} · ${fr.galleryVenueAssignmentsTitle}` : fr.galleryVenueAssignmentsTitle;

  return (
    <section className="space-y-4">
      {pinned && <GalleryStrip images={galleryImages} name={galleryName} onUnpin={togglePinned} />}
      <p className="max-w-prose text-muted">{fr.logisticsViewDescription}</p>
      <AdminHeaderActions>
        {galleryImages.length > 0 && (
          <Button variant="secondary" size="sm" aria-pressed={pinned} onClick={togglePinned}
            className={cx('min-h-11', pinned && 'border-neon text-neon')}>
            <Pin aria-hidden="true" className={cx('size-4', pinned && 'fill-current')} strokeWidth={1.75} />
            {fr.galleryPin}
          </Button>
        )}
        <GalleryButton images={galleryImages} name={galleryName} size="sm" />
      </AdminHeaderActions>

      {places.length === 0
        ? <Notice tone="info" title={fr.logisticsNoPlacesTitle}>{fr.logisticsNoPlacesHint}</Notice>
        : <LogisticsSummary stats={placeStats} demand={demand} hasUnsaved={Object.values(logisticsChanges).some(party => Object.keys(party.places || {}).length > 0)} />}

      <FilterPills filters={FILTERS} value={filter} onChange={setFilter} counts={counts} label={fr.filterLabel} />

      {visible.length === 0 && <EmptyState icon={BedDouble} title={fr.noMatchingParties} />}

      <ul className="grid gap-4 xl:grid-cols-2">
        {visible.map(party => {
          const profile = party.profiles || {};
          const partyAttendees = party.attendees || [];
          const changes = logisticsChanges[party.id] || {};
          const hasChanges = !!logisticsChanges[party.id];
          const saveError = hasChanges && logisticsErrors[party.id];
          const notesId = `admin-notes-${party.id}`;
          const messageId = `participant-message-${party.id}`;
          const organizersMessage = party.message_to_organizers?.trim();

          return (
            <li key={party.id}>
              <Card className={`h-full p-4 sm:p-5 ${saveError ? 'border-bad/60' : hasChanges ? 'border-warn/50' : ''}`}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      onClick={() => onOpenUserProfile(profile)}
                      className="max-w-full truncate text-left text-lg font-semibold text-ink underline decoration-edge underline-offset-4 hover:decoration-neon"
                    >
                      {profile.full_name || fr.notSpecified}
                    </button>
                    <p className="truncate text-sm text-faint">{profile.email}</p>
                  </div>
                  {hasChanges && <Tag tone="warn">{fr.unsavedTag}</Tag>}
                </div>

                {saveError && (
                  <p className="mb-4 flex items-start gap-2 text-sm text-bad">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                    {saveError}
                  </p>
                )}

                <ul className="space-y-3">
                  {partyAttendees.map((attendee, index) => {
                    const savedPlaceId = attendee.place?.place_id ?? null;
                    const pending = changes.places?.[attendee.id];
                    const placeId = pending !== undefined ? pending : savedPlaceId;
                    const place = placesById.get(placeId);
                    const overbooked = place && occupancy.get(place.id) > place.capacity;
                    const attendeeName = attendee.name || `${fr.participantFallback} #${index + 1}`;
                    const pickerId = `place-${party.id}-${index}`;
                    const noteId = `${pickerId}-note`;
                    const reason = attendee.bed_reason === 'other' && attendee.bed_reason_other
                      ? attendee.bed_reason_other
                      : attendee.bed_reason ? getOptionLabel(BED_REASON_OPTIONS, attendee.bed_reason) : '';
                    const preference = attendee.sleeping_preference === 'outside_other' && attendee.sleeping_preference_other
                      ? attendee.sleeping_preference_other
                      : getOptionLabel(ACCOMMODATION_OPTIONS, attendee.sleeping_preference);

                    return (
                      <li key={attendee.id || index} className="grid gap-2 rounded-control bg-night/60 p-3 sm:grid-cols-[1fr_16rem] sm:items-start">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{attendeeName}</p>
                          <p className="text-sm text-muted">
                            {preference}
                            {reason && <span className="text-faint">{`, ${reason}`}</span>}
                          </p>
                        </div>
                        {places.length > 0 && readOnly && (
                          <p className={cx('text-sm sm:text-right', attendee.place ? 'text-ink' : 'text-faint')}>
                            {attendee.place?.bed_label || fr.logisticsNoPlaceAssigned}
                          </p>
                        )}
                        {places.length > 0 && !readOnly && (
                          <div>
                            <PlacePicker
                              id={pickerId}
                              label={`${fr.logisticsTableSleepingAssigned}, ${attendeeName}`}
                              options={placeOptions(places, occupancy, { preference: attendee.sleeping_preference, currentPlaceId: placeId })}
                              value={placeId}
                              onChange={newPlaceId => onPlaceChange(party, attendee.id, newPlaceId)}
                              disabled={party.is_waitlisted}
                              describedBy={party.is_waitlisted || overbooked ? noteId : undefined}
                            />
                            {party.is_waitlisted && <p id={noteId} className="mt-1.5 text-sm text-faint">{fr.placePickerWaitlisted}</p>}
                            {!party.is_waitlisted && overbooked && (
                              <p id={noteId} className="mt-1.5 flex items-center gap-1.5 text-sm text-warn">
                                <TriangleAlert aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                                {fr.placeOverbooked.replace('{taken}', occupancy.get(place.id)).replace('{capacity}', place.capacity)}
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {organizersMessage && (
                  <div className="mt-4 flex gap-2 rounded-control border border-line p-3">
                    <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-neon" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-muted">{fr.messageToOrganizers}</p>
                      <p className="whitespace-pre-line text-sm text-ink [overflow-wrap:anywhere]">{organizersMessage}</p>
                    </div>
                  </div>
                )}

                {readOnly ? (
                  <>
                    <ReadOnlyText label={fr.logisticsTableAdminNotes} value={party.admin_notes} />
                    <ReadOnlyText label={fr.logisticsTableParticipantMessage} value={party.message_to_participants} />
                  </>
                ) : (
                  <>
                  <div className="mt-4">
                    <label htmlFor={notesId} className="mb-1.5 block text-sm font-semibold text-muted">{fr.logisticsTableAdminNotes}</label>
                    <Textarea
                      id={notesId}
                      value={changes.adminNotes !== undefined ? changes.adminNotes : (party.admin_notes || '')}
                      onChange={(e) => onAdminNotesChange(party, e.target.value)}
                      rows={2}
                      placeholder={fr.adminNotesPlaceholder}
                    />
                  </div>

                  <div className="mt-4">
                    <label htmlFor={messageId} className="mb-1.5 block text-sm font-semibold text-muted">{fr.logisticsTableParticipantMessage}</label>
                    <Textarea
                      id={messageId}
                      value={changes.participantMessage !== undefined ? changes.participantMessage : (party.message_to_participants || '')}
                      onChange={(e) => onParticipantMessageChange(party, e.target.value)}
                      rows={2}
                      placeholder={fr.participantMessagePlaceholder}
                    />
                  </div>
                  </>
                )}

              </Card>
            </li>
          );
        })}
      </ul>

      {!readOnly && <SaveBar dirtyCount={unsavedCount} saving={saving} onSave={onSave} onDiscard={onDiscard} />}
    </section>
  );
};

// The Logistique tab's views (#179): what organisers plan with. Their ids and order come from the
// admin routes module (/admin/logistics/<view>, the first one the default). Only places are edited
// here; the others read the form's answers.
const FORM_VIEWS = { food: FoodView, volunteering: VolunteeringView, transport: TransportView, comments: CommentsView };

// The admin shell switches between the views (src/lib/adminSections.ts).
const AdminLogisticsView = ({ view, ...props }) => {
  const FormView = FORM_VIEWS[view];
  if (!FormView) return <PlacesView {...props} />;
  return (
    <>
      <FormView parties={props.parties} />
      {/* Place changes stay pending on the other views; their bar stays in reach. */}
      {props.unsavedCount > 0 && (
        <div className="mt-6">
          <SaveBar dirtyCount={props.unsavedCount} saving={props.saving} onSave={props.onSave} onDiscard={props.onDiscard} />
        </div>
      )}
    </>
  );
};

export default AdminLogisticsView;
