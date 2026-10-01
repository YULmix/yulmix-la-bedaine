import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, MapPin, Pencil, Plus, TriangleAlert } from 'lucide-react';
import fr from '../../locales/fr.json';
import { supabase } from '../../lib/supabase';
import { dbErrorMessage } from '../../lib/dbErrors';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { venueTotals } from '../../lib/places';
import { invalidateEventPlaces, useEventPlaces } from '../../lib/eventPlaces';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Notice, Select, Skeleton, Stat, Stepper, Toggle, cx } from '../ui';

// A capacity change is written this long after the last Stepper click, so tapping + five times is
// one write, not five racing ones.
const CAPACITY_WRITE_DELAY_MS = 400;

const SaveStatus = ({ status }) => (
  <p role="status" className="flex items-center gap-1.5 text-sm text-faint">
    {status === 'saved' && <Check aria-hidden="true" className="size-4 text-ok" strokeWidth={2} />}
    {status === 'saving' ? fr.sleepingSaving : status === 'saved' ? fr.sleepingSaved : fr.sleepingAutosave}
  </p>
);

const venueOption = venue => fr.eventVenueOption
  .replace('{name}', venue.name)
  .replace('{capacity}', venueTotals(venue.locations).capacity)
  + (venue.archived_at ? ` ${fr.eventVenueOptionArchived}` : '');

// The event's places (in display order) under their locations, which keep that order.
const byLocation = (places) => {
  const locations = new Map();
  places.forEach(place => {
    if (!locations.has(place.locationId)) locations.set(place.locationId, { id: place.locationId, name: place.locationName, places: [] });
    locations.get(place.locationId).places.push(place);
  });
  return [...locations.values()];
};

// One place, as this event sees it (an event places row, #193): available or not this edition,
// and its capacity for this event (the venue's by default). Who of this event sleeps there, if anyone.
const PlaceSetting = ({ place, frozen, onExclude, onCapacity }) => {
  const { isExcluded: excluded, capacity, occupants, locationName } = place;
  const overbooked = occupants.length > capacity;
  const details = [
    getOptionLabel(ACCOMMODATION_OPTIONS, place.type),
    capacity !== place.venueCapacity ? fr.placeVenueCapacity.replace('{capacity}', place.venueCapacity) : null,
    excluded ? fr.placeExcluded : occupants.length ? fr.placeOccupants.replace('{names}', occupants.join(', ')) : fr.placeFree
  ].filter(Boolean).join(' · ');
  if (frozen) {
    return (
      <li aria-label={place.label} className={cx('py-3', excluded && 'opacity-60')}>
        <span className="block text-base text-ink">{place.label}</span>
        <span className="block text-sm text-faint">
          {[fr.placeEventCapacity.replace('{capacity}', capacity), details].join(' · ')}
        </span>
      </li>
    );
  }
  return (
    <li aria-label={place.label} className={cx('py-2', excluded && 'opacity-60')}>
      <Toggle
        checked={!excluded}
        onChange={available => onExclude(!available)}
        label={place.label}
        description={(
          <span className={cx(overbooked && !excluded && 'text-warn')}>
            {overbooked && !excluded && <TriangleAlert aria-hidden="true" className="mr-1 inline size-4" strokeWidth={1.75} />}
            {details}
          </span>
        )}
        switchLabel={fr.placeAvailableLabel.replace('{place}', `${locationName} · ${place.label}`)}
        aside={!excluded && (
          <Stepper value={capacity} onChange={onCapacity} min={1} max={50}
            label={fr.placeEventCapacityLabel.replace('{place}', `${locationName} · ${place.label}`)} />
        )}
        className="flex-wrap gap-y-2 sm:flex-nowrap"
      />
    </li>
  );
};

// The Couchage section of the event editor (#147): which venue the event is at, and what of it
// this edition uses: a place can be excluded, or given another capacity for this event. Its places
// are the event places (#193), shared with Aperçu and Logistique, so a change shows there too.
// The venue itself (locations, places) is edited in the Sites tab. Changing the venue clears the
// event's assignments (in the database, with the change), so it names who is affected and asks first.
export const EventVenuePlan = ({ event, onVenueChange }) => {
  const navigate = useNavigate();
  const { places, loading, error: placesError, editPlace, savePlace } = useEventPlaces(event.id);
  const [venues, setVenues] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle');
  const [pendingVenue, setPendingVenue] = useState(null);
  const [changingVenue, setChangingVenue] = useState(false);
  const [blocked, setBlocked] = useState(null);
  const capacityTimers = useRef({});
  const placeQueues = useRef({});
  const inFlight = useRef(0);
  const venueId = event.venue_id;
  // An archived event keeps the layout it had (#148): shown, not changed.
  const frozen = event.status === 'ARCHIVED';

  // The venues to pick from, with their capacity; again once the event has another (a new one).
  const loadVenues = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('venues')
      .select('id, name, address, archived_at, locations(places(capacity))').order('name');
    if (loadError) {
      console.error('Error loading the venues:', loadError);
      setError(fr.eventVenueLoadError);
      setVenues(current => current || []);
      return;
    }
    setVenues(data);
  }, []);

  useEffect(() => { loadVenues(); }, [loadVenues, venueId]);

  // Who sleeps where changes in Logistique and with the parties, which don't tell the event
  // places: arriving here reads them afresh, as this section always has.
  useEffect(() => { invalidateEventPlaces(event.id); }, [event.id]);

  // A failed write has already put the event places back to what the database holds.
  const track = async (write) => {
    inFlight.current += 1;
    setStatus('saving');
    const result = await write;
    inFlight.current -= 1;
    if (result.error) {
      console.error('Error saving the event venue:', result.error);
      setError(dbErrorMessage(result.error, fr.eventVenueSaveError));
      setStatus('idle');
    } else {
      setError(null);
      if (!inFlight.current) setStatus('saved');
    }
    return result;
  };

  // Writes what the screen shows for one place. One place's writes go out one after the other,
  // each taking the setting shown when its turn comes, so a quick off/on can't land in the wrong
  // order: the last one written is what the screen shows.
  const syncOverride = (placeId) => {
    const turn = (placeQueues.current[placeId] || Promise.resolve()).then(() => track(savePlace(placeId)));
    placeQueues.current[placeId] = turn;
    return turn;
  };

  // Capacity writes still waiting are dropped: the venue change clears this event's overrides.
  const dropPendingCapacities = () => {
    Object.values(capacityTimers.current).forEach(clearTimeout);
    capacityTimers.current = {};
  };

  const exclude = (place, excluded) => {
    if (excluded && place.occupants.length) {
      return setBlocked({ name: `${place.locationName} · ${place.label}`, names: place.occupants });
    }
    editPlace(place.id, { isExcluded: excluded });
    syncOverride(place.id);
  };

  const setCapacity = (place, capacity) => {
    editPlace(place.id, { capacity });
    clearTimeout(capacityTimers.current[place.id]);
    setStatus('saving');
    capacityTimers.current[place.id] = setTimeout(() => {
      delete capacityTimers.current[place.id];
      syncOverride(place.id);
    }, CAPACITY_WRITE_DELAY_MS);
  };

  // Pending capacity writes go out when the admin leaves the section, not never.
  useEffect(() => () => {
    Object.entries(capacityTimers.current).forEach(([placeId, timer]) => {
      clearTimeout(timer);
      savePlace(placeId).then(({ error: writeError }) => { if (writeError) console.error('Error saving capacity:', writeError); });
    });
    capacityTimers.current = {};
  }, [savePlace]);

  const assigned = places.flatMap(place => place.occupants).sort((a, b) => a.localeCompare(b, 'fr'));

  const changeVenue = async (nextVenueId) => {
    dropPendingCapacities();
    setChangingVenue(true);
    try {
      const { error: updateError } = await supabase.from('events').update({ venue_id: nextVenueId }).eq('id', event.id);
      if (updateError) throw updateError;
      setError(null);
      invalidateEventPlaces(event.id);
      await onVenueChange();
    } catch (changeError) {
      console.error('Error changing the venue:', changeError);
      setError(dbErrorMessage(changeError, fr.eventVenueSaveError));
    } finally {
      setChangingVenue(false);
      setPendingVenue(null);
    }
  };

  const pickVenue = (nextVenueId) => {
    if (!nextVenueId || nextVenueId === venueId) return;
    if (assigned.length) return setPendingVenue(venues.find(venue => venue.id === nextVenueId));
    changeVenue(nextVenueId);
  };

  const createVenue = async () => {
    dropPendingCapacities();
    setChangingVenue(true);
    try {
      const { error: createError } = await supabase.rpc('create_event_venue', { p_event_id: event.id });
      if (createError) throw createError;
      setError(null);
      invalidateEventPlaces(event.id);
      await onVenueChange();
    } catch (createError) {
      console.error('Error creating the venue:', createError);
      setError(dbErrorMessage(createError, fr.venueCreateError));
    } finally {
      setChangingVenue(false);
    }
  };

  if (!venues || loading) {
    return (
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-32 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  const venue = venues.find(v => v.id === venueId);
  const offered = venues.filter(v => !v.archived_at || v.id === venueId);
  const locations = byLocation(places);
  const available = places.filter(place => !place.isExcluded);
  const venueCapacity = places.reduce((sum, place) => sum + place.venueCapacity, 0);
  const eventCapacity = available.reduce((sum, place) => sum + place.capacity, 0);
  const shownError = error || placesError;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-muted">{frozen ? fr.eventVenueFrozen : fr.eventVenueHint}</p>
        {venueId && !frozen && <SaveStatus status={status} />}
      </div>
      {shownError && <Notice tone="bad" role="alert">{shownError}</Notice>}

      <Card as="section" aria-labelledby="event-venue-title" className="space-y-4 p-4 sm:p-5">
        <h3 id="event-venue-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <MapPin aria-hidden="true" className="size-4.5 text-neon" strokeWidth={1.75} />{fr.venueTitle}
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={fr.eventVenuePickerLabel} className="min-w-60 flex-1">
            {({ id }) => (
              <Select id={id} value={venueId ?? ''} disabled={changingVenue || frozen} onChange={e => pickVenue(e.target.value)}>
                {!venueId && <option value="">{fr.eventVenuePickerPlaceholder}</option>}
                {offered.map(v => <option key={v.id} value={v.id}>{venueOption(v)}</option>)}
              </Select>
            )}
          </Field>
          {frozen ? null : venueId ? (
            <Button variant="secondary" onClick={() => navigate(`/admin?tab=venues&venue=${venueId}`)}>
              <Pencil aria-hidden="true" className="size-4" />{fr.eventVenueEdit}
            </Button>
          ) : (
            <Button variant="secondary" onClick={createVenue} loading={changingVenue}>
              <Plus aria-hidden="true" className="size-4" />{fr.eventVenueCreate}
            </Button>
          )}
        </div>
        {venue?.address && <p className="text-sm text-muted">{venue.address}</p>}
      </Card>

      {!venueId ? (
        <Card>
          <EmptyState icon={MapPin} title={fr.venueNone}>{!frozen && fr.eventVenueNoneHint}</EmptyState>
        </Card>
      ) : places.length === 0 ? (
        <Card>
          <EmptyState icon={MapPin} title={fr.locationsEmpty}
            action={!frozen && <Button onClick={() => navigate(`/admin?tab=venues&venue=${venueId}`)}><Pencil aria-hidden="true" className="size-4.5" />{fr.eventVenueEdit}</Button>}>
            {fr.eventVenueEmptyHint}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
            <Stat label={fr.eventVenueStatVenueCapacity} value={venueCapacity} />
            <Stat label={fr.eventVenueStatEventCapacity} value={eventCapacity} />
            <Stat label={fr.eventVenueStatAvailable} value={`${available.length}/${places.length}`} />
            <Stat label={fr.sleepingStatAssigned} value={assigned.length} tone={assigned.length > eventCapacity ? 'warn' : undefined} />
          </Card>

          {locations.map(location => (
            <Card as="section" key={location.id} aria-label={location.name} className="p-4 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                <h3 className="text-lg font-semibold text-ink">{location.name}</h3>
                <p className="font-data text-xs text-faint">
                  {fr.eventVenueLocationAvailable
                    .replace('{available}', location.places.filter(place => !place.isExcluded).length)
                    .replace('{places}', location.places.length)}
                </p>
              </div>
              <ul className="divide-y divide-line">
                {location.places.map(place => (
                  <PlaceSetting
                    key={place.id}
                    place={place}
                    frozen={frozen}
                    onExclude={excluded => exclude(place, excluded)}
                    onCapacity={capacity => setCapacity(place, capacity)}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </>
      )}

      <ConfirmDialog
        open={!!pendingVenue}
        title={fr.eventVenueChangeTitle}
        confirmLabel={fr.eventVenueChangeConfirm}
        loading={changingVenue}
        onCancel={() => setPendingVenue(null)}
        onConfirm={() => changeVenue(pendingVenue.id)}
      >
        {pendingVenue && (
          <div className="space-y-3">
            <p>{fr.eventVenueChangeBody.replace('{venue}', pendingVenue.name).replace('{count}', assigned.length)}</p>
            <ul className="list-disc pl-5 text-ink">
              {assigned.map((name, i) => <li key={i}>{name}</li>)}
            </ul>
          </div>
        )}
      </ConfirmDialog>

      <Dialog
        open={!!blocked}
        onClose={() => setBlocked(null)}
        title={fr.placeExcludeBlockedTitle}
        size="sm"
        footer={<Button variant="secondary" onClick={() => setBlocked(null)}>{fr.close}</Button>}
      >
        {blocked && (
          <div className="space-y-3 px-5 py-5 text-muted sm:px-6">
            <p>{fr.placeExcludeBlockedBody.replace('{name}', blocked.name)}</p>
            <ul className="list-disc pl-5 text-ink">
              {blocked.names.map((name, i) => <li key={i}>{name}</li>)}
            </ul>
          </div>
        )}
      </Dialog>
    </div>
  );
};
