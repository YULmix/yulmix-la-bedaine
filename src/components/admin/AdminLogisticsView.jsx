import { useEffect, useMemo, useState } from 'react';
import { BedDouble, CircleAlert, TriangleAlert } from 'lucide-react';
import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, BED_REASON_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { placeOccupancy, placeOptions } from '../../lib/places';
import { computePlaceStats, placeDemandByType } from '../../lib/adminStats';
import { VENUE_GALLERY_KINDS, fetchVenueGallery } from '../../lib/galleries';
import GalleryButton from '../Gallery';
import { Card, EmptyState, Notice, Tag, Textarea, ViewPanel, ViewTabs, cx } from '../ui';
import { FilterPills } from './AdminUserManagement';
import PlacePicker from './PlacePicker';
import LogisticsSummary from './LogisticsSummary';
import SaveBar from './SaveBar';
import { CommentsView, FORM_VIEW_ICONS, FoodView, TransportView, VolunteeringView } from './LogisticsFormViews';

const wantsBed = party => (party.attendees || []).some(a => a.sleeping_preference === 'bed');
const hasUnassigned = party => !party.is_waitlisted && (party.attendees || []).some(a => !a.place);

const FILTERS = [
  { id: 'all', labelKey: 'filterAll', test: () => true },
  { id: 'bed', labelKey: 'filterBedRequested', test: wantsBed },
  { id: 'unassigned', labelKey: 'filterUnassigned', test: hasUnassigned }
];

// Per-attendee sleeping places (#114) and private admin notes. Unsaved edits live in the parent
// (`logisticsChanges`, see lib/logisticsDraft.js) so they survive switching admin tabs and
// Logistique views, and are all saved at once from the bar at the bottom (#150);
// `logisticsErrors` holds why a party's save was refused. `places` are the event's, from
// the event places module (`available`, #193); with none, there is nothing to assign until they're defined (Événements tab).
// The venue's assignments gallery (#177) sits by the title.
const PlacesView = ({
  venue,
  parties,
  places,
  logisticsChanges,
  logisticsErrors,
  unsavedCount,
  saving,
  onPlaceChange,
  onAdminNotesChange,
  onSave,
  onDiscard,
  onOpenUserProfile
}) => {
  const [filter, setFilter] = useState('all');
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.id, parties.filter(f.test).length])), [parties]);
  const activeFilter = FILTERS.find(f => f.id === filter) || FILTERS[0];
  const visible = parties.filter(activeFilter.test);
  const occupancy = useMemo(() => placeOccupancy(parties, logisticsChanges), [parties, logisticsChanges]);
  const placesById = useMemo(() => new Map(places.map(place => [place.id, place])), [places]);
  const placeStats = useMemo(() => computePlaceStats(parties, places, logisticsChanges), [parties, places, logisticsChanges]);
  const demand = useMemo(() => placeDemandByType(parties, places), [parties, places]);
  const venueId = venue?.id;
  const [gallery, setGallery] = useState({ venueId: null, images: [] });

  useEffect(() => {
    if (!venueId) return undefined;
    let current = true;
    fetchVenueGallery(venueId, VENUE_GALLERY_KINDS.assignments)
      .then(images => { if (current) setGallery({ venueId, images }); })
      .catch(loadError => console.error('Error loading the assignments gallery:', loadError));
    return () => { current = false; };
  }, [venueId]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-ink">{fr.logisticsViewTitle}</h2>
          <p className="mt-2 max-w-prose text-muted">{fr.logisticsViewDescription}</p>
        </div>
        <GalleryButton images={gallery.venueId === venueId ? gallery.images : []}
          name={venue?.name ? `${venue.name} · ${fr.galleryVenueAssignmentsTitle}` : fr.galleryVenueAssignmentsTitle} size="sm" />
      </div>

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
                        {places.length > 0 && (
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

              </Card>
            </li>
          );
        })}
      </ul>

      <SaveBar dirtyCount={unsavedCount} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </section>
  );
};

// The Logistique tab's views (#179): what organisers plan with. The id is the URL's ?view=, the
// first one being the default. Only places are edited here; the others read the form's answers.
export const LOGISTICS_VIEWS = [
  { id: 'places', labelKey: 'logisticsViewTitle', icon: BedDouble },
  { id: 'food', labelKey: 'logisticsViewFood', icon: FORM_VIEW_ICONS.food },
  { id: 'volunteering', labelKey: 'logisticsViewVolunteering', icon: FORM_VIEW_ICONS.volunteering },
  { id: 'transport', labelKey: 'logisticsViewTransport', icon: FORM_VIEW_ICONS.transport },
  { id: 'comments', labelKey: 'logisticsViewComments', icon: FORM_VIEW_ICONS.comments }
];

const FORM_VIEWS = { food: FoodView, volunteering: VolunteeringView, transport: TransportView, comments: CommentsView };

const AdminLogisticsView = ({ view, onViewChange, ...props }) => {
  const FormView = FORM_VIEWS[view];
  const views = LOGISTICS_VIEWS.map(({ id, labelKey, icon }) => ({
    id,
    label: fr[labelKey],
    icon,
    badge: id === 'places' && props.unsavedCount > 0 && <span className="size-2 rounded-full bg-warn" aria-label={fr.unsavedTag} />
  }));

  return (
    <div className="space-y-6">
      <ViewTabs views={views} value={view} onChange={onViewChange} label={fr.logisticsViewsLabel} idPrefix="logistics-view" />

      <ViewPanel idPrefix="logistics-view" value={view}>
        {FormView ? (
          <>
            <FormView parties={props.parties} />
            {/* Place changes stay pending on the other views; their bar stays in reach. */}
            {props.unsavedCount > 0 && (
              <div className="mt-6">
                <SaveBar dirtyCount={props.unsavedCount} saving={props.saving} onSave={props.onSave} onDiscard={props.onDiscard} />
              </div>
            )}
          </>
        ) : <PlacesView {...props} />}
      </ViewPanel>
    </div>
  );
};

export default AdminLogisticsView;
