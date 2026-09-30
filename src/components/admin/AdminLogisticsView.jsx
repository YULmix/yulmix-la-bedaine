import { useMemo, useState } from 'react';
import { BedDouble, CircleAlert, TriangleAlert } from 'lucide-react';
import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, BED_REASON_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { placeOccupancy, placeOptions } from '../../lib/places';
import { computePlaceStats, placeDemandByType } from '../../lib/adminStats';
import { Card, EmptyState, Notice, Tag, Textarea } from '../ui';
import { FilterPills } from './AdminUserManagement';
import PlacePicker from './PlacePicker';
import LogisticsSummary from './LogisticsSummary';
import SaveBar from './SaveBar';

const wantsBed = party => (party.attendees || []).some(a => a.sleeping_preference === 'bed');
const hasUnassigned = party => !party.is_waitlisted && (party.attendees || []).some(a => !a.place);

const FILTERS = [
  { id: 'all', labelKey: 'filterAll', test: () => true },
  { id: 'bed', labelKey: 'filterBedRequested', test: wantsBed },
  { id: 'unassigned', labelKey: 'filterUnassigned', test: hasUnassigned }
];

// Per-attendee sleeping places (#114) and private admin notes. Unsaved edits live in the parent
// (`logisticsChanges`, see lib/logisticsDraft.js) so they survive switching admin tabs, and are
// all saved at once from the bar at the bottom (#150); `logisticsErrors` holds why a party's save
// was refused. `places` are the event's, from flattenPlaces(); with none, there is nothing to
// assign until they're defined (Événements tab).
const AdminLogisticsView = ({
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

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-ink">{fr.logisticsViewTitle}</h2>
        <p className="mt-2 max-w-prose text-muted">{fr.logisticsViewDescription}</p>
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

export default AdminLogisticsView;
