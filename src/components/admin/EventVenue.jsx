import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, MapPin, Pencil, Plus, TriangleAlert } from 'lucide-react';
import fr from '../../locales/fr.json';
import { supabase } from '../../lib/supabase';
import { dbErrorMessage } from '../../lib/dbErrors';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { flattenPlaces, overrideWrite, venueTotals } from '../../lib/places';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Notice, Select, Skeleton, Stat, Stepper, Toggle, cx } from '../ui';

const bySortOrder = (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);

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

// One place, as this event sees it: available or not this edition, and its capacity for this
// event (the venue's by default). Who of this event sleeps there, if anyone.
const PlaceSetting = ({ place, locationName, override, occupants, onExclude, onCapacity }) => {
  const excluded = !!override?.is_excluded;
  const capacity = override?.capacity ?? place.capacity;
  const overbooked = occupants.length > capacity;
  const details = [
    getOptionLabel(ACCOMMODATION_OPTIONS, place.type),
    capacity !== place.capacity ? fr.placeVenueCapacity.replace('{capacity}', place.capacity) : null,
    excluded ? fr.placeExcluded : occupants.length ? fr.placeOccupants.replace('{names}', occupants.join(', ')) : fr.placeFree
  ].filter(Boolean).join(' · ');
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
// this edition uses: a place can be excluded, or given another capacity for this event
// (event_place_overrides). The venue itself (locations, places) is edited in the Sites tab.
// Changing the venue clears the event's assignments (in the database, with the change), so it
// names who is affected and asks first.
export const EventVenuePlan = ({ event, onVenueChange }) => {
  const navigate = useNavigate();
  const [venues, setVenues] = useState(null);
  const [locations, setLocations] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [occupants, setOccupants] = useState({});
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle');
  const [pendingVenue, setPendingVenue] = useState(null);
  const [changingVenue, setChangingVenue] = useState(false);
  const [blocked, setBlocked] = useState(null);
  const overridesRef = useRef({});
  const capacityTimers = useRef({});
  const placeQueues = useRef({});
  const inFlight = useRef(0);
  const venueId = event.venue_id;

  const setOverrideState = (next) => {
    overridesRef.current = next;
    setOverrides(next);
  };

  const load = useCallback(async () => {
    const [venuesResult, locationsResult, overridesResult, occupantsResult] = await Promise.all([
      supabase.from('venues').select('id, name, address, archived_at, locations(places(capacity))').order('name'),
      venueId
        ? supabase.from('locations')
          .select('id, name, sort_order, created_at, places(id, label, type, capacity, sort_order, created_at)')
          .eq('venue_id', venueId)
        : { data: [] },
      supabase.from('event_place_overrides').select('place_id, is_excluded, capacity').eq('event_id', event.id),
      supabase.from('attendee_places').select('place_id, attendee_name').eq('event_id', event.id).order('attendee_name')
    ]);
    const loadError = venuesResult.error || locationsResult.error || overridesResult.error || occupantsResult.error;
    if (loadError) {
      console.error('Error loading the event venue:', loadError);
      setError(fr.eventVenueLoadError);
      setVenues(current => current || []);
      setLocations(current => current || []);
      return;
    }
    setVenues(venuesResult.data);
    setLocations(locationsResult.data
      .map(location => ({ ...location, places: [...location.places].sort(bySortOrder) }))
      .sort(bySortOrder));
    setOverrideState(Object.fromEntries(overridesResult.data.map(row => [row.place_id, row])));
    const names = {};
    occupantsResult.data.forEach(({ place_id: placeId, attendee_name: name }) => {
      (names[placeId] ||= []).push(name);
    });
    setOccupants(names);
  }, [event.id, venueId]);

  useEffect(() => { load(); }, [load]);

  const track = async (write) => {
    inFlight.current += 1;
    setStatus('saving');
    const result = await write;
    inFlight.current -= 1;
    if (result.error) {
      console.error('Error saving the event venue:', result.error);
      setError(dbErrorMessage(result.error, fr.eventVenueSaveError));
      setStatus('idle');
      await load();
    } else {
      setError(null);
      if (!inFlight.current) setStatus('saved');
    }
    return result;
  };

  // Writes what the screen shows for one place: its override row, or none. One place's writes go
  // out one after the other, each built when its turn comes, so a quick off/on can't land in the
  // wrong order: the last one written is what the screen shows.
  const syncOverride = (placeId) => {
    const turn = (placeQueues.current[placeId] || Promise.resolve()).then(() => {
      const row = overridesRef.current[placeId];
      return track(row
        ? supabase.from('event_place_overrides').upsert({ event_id: event.id, place_id: placeId, ...row })
        : supabase.from('event_place_overrides').delete().eq('event_id', event.id).eq('place_id', placeId));
    });
    placeQueues.current[placeId] = turn;
    return turn;
  };

  // Capacity writes still waiting are dropped: the venue change clears this event's overrides.
  const dropPendingCapacities = () => {
    Object.values(capacityTimers.current).forEach(clearTimeout);
    capacityTimers.current = {};
  };

  const applyChange = (place, change) => {
    const write = overrideWrite(place, overridesRef.current[place.id] ?? null, change);
    if (write.op === 'none') return false;
    const next = { ...overridesRef.current };
    if (write.op === 'upsert') next[place.id] = { place_id: place.id, ...write.row };
    else delete next[place.id];
    setOverrideState(next);
    return true;
  };

  const exclude = (place, locationName, excluded) => {
    const names = occupants[place.id] || [];
    if (excluded && names.length) return setBlocked({ name: `${locationName} · ${place.label}`, names });
    if (applyChange(place, { is_excluded: excluded })) syncOverride(place.id);
  };

  const setCapacity = (place, capacity) => {
    if (!applyChange(place, { capacity })) return;
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
      const row = overridesRef.current[placeId];
      const write = row
        ? supabase.from('event_place_overrides').upsert({ event_id: event.id, place_id: placeId, ...row })
        : supabase.from('event_place_overrides').delete().eq('event_id', event.id).eq('place_id', placeId);
      write.then(({ error: writeError }) => { if (writeError) console.error('Error saving capacity:', writeError); });
    });
    capacityTimers.current = {};
  }, [event.id]);

  const assigned = Object.values(occupants).flat().sort((a, b) => a.localeCompare(b, 'fr'));

  const changeVenue = async (nextVenueId) => {
    dropPendingCapacities();
    setChangingVenue(true);
    try {
      const { error: updateError } = await supabase.from('events').update({ venue_id: nextVenueId }).eq('id', event.id);
      if (updateError) throw updateError;
      setError(null);
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
      await onVenueChange();
    } catch (createError) {
      console.error('Error creating the venue:', createError);
      setError(dbErrorMessage(createError, fr.venueCreateError));
    } finally {
      setChangingVenue(false);
    }
  };

  if (!venues || !locations) {
    return (
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-32 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  const venue = venues.find(v => v.id === venueId);
  const offered = venues.filter(v => !v.archived_at || v.id === venueId);
  const places = locations.flatMap(location => location.places);
  const available = flattenPlaces(locations, Object.values(overrides));
  const eventCapacity = available.reduce((sum, place) => sum + place.capacity, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-muted">{fr.eventVenueHint}</p>
        {venueId && <SaveStatus status={status} />}
      </div>
      {error && <Notice tone="bad" role="alert">{error}</Notice>}

      <Card as="section" aria-labelledby="event-venue-title" className="space-y-4 p-4 sm:p-5">
        <h3 id="event-venue-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <MapPin aria-hidden="true" className="size-4.5 text-neon" strokeWidth={1.75} />{fr.venueTitle}
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={fr.eventVenuePickerLabel} className="min-w-60 flex-1">
            {({ id }) => (
              <Select id={id} value={venueId ?? ''} disabled={changingVenue} onChange={e => pickVenue(e.target.value)}>
                {!venueId && <option value="">{fr.eventVenuePickerPlaceholder}</option>}
                {offered.map(v => <option key={v.id} value={v.id}>{venueOption(v)}</option>)}
              </Select>
            )}
          </Field>
          {venueId ? (
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
          <EmptyState icon={MapPin} title={fr.venueNone}>{fr.eventVenueNoneHint}</EmptyState>
        </Card>
      ) : places.length === 0 ? (
        <Card>
          <EmptyState icon={MapPin} title={fr.locationsEmpty}
            action={<Button onClick={() => navigate(`/admin?tab=venues&venue=${venueId}`)}><Pencil aria-hidden="true" className="size-4.5" />{fr.eventVenueEdit}</Button>}>
            {fr.eventVenueEmptyHint}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
            <Stat label={fr.eventVenueStatVenueCapacity} value={venueTotals(locations).capacity} />
            <Stat label={fr.eventVenueStatEventCapacity} value={eventCapacity} />
            <Stat label={fr.eventVenueStatAvailable} value={`${available.length}/${places.length}`} />
            <Stat label={fr.sleepingStatAssigned} value={assigned.length} tone={assigned.length > eventCapacity ? 'warn' : undefined} />
          </Card>

          {locations.filter(location => location.places.length).map(location => (
            <Card as="section" key={location.id} aria-label={location.name} className="p-4 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                <h3 className="text-lg font-semibold text-ink">{location.name}</h3>
                <p className="font-data text-xs text-faint">
                  {fr.eventVenueLocationAvailable
                    .replace('{available}', location.places.filter(place => !overrides[place.id]?.is_excluded).length)
                    .replace('{places}', location.places.length)}
                </p>
              </div>
              <ul className="divide-y divide-line">
                {location.places.map(place => (
                  <PlaceSetting
                    key={place.id}
                    place={place}
                    locationName={location.name}
                    override={overrides[place.id]}
                    occupants={occupants[place.id] || []}
                    onExclude={excluded => exclude(place, location.name, excluded)}
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
