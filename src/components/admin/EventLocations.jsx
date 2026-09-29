import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, BedDouble, Check, ChevronRight, Copy, MapPin, Plus, Trash2, TriangleAlert } from 'lucide-react';
import fr from '../../locales/fr.json';
import { supabase } from '../../lib/supabase';
import { dbErrorMessage } from '../../lib/dbErrors';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Notice, Select, Skeleton, Stat, Stepper, cx } from '../ui';

const bySortOrder = (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
const nextSortOrder = rows => (rows.length ? Math.max(...rows.map(row => row.sort_order)) + 1 : 0);
const capacityOf = places => places.reduce((sum, place) => sum + place.capacity, 0);

// A capacity change is written this long after the last Stepper click, so tapping + five times is
// one write, not five racing ones.
const CAPACITY_WRITE_DELAY_MS = 400;

// Deleting a place (or location) someone holds, whom this screen didn't know about: someone of
// another event at the venue, or assigned since it loaded. The foreign key refuses it.
const FOREIGN_KEY_VIOLATION = '23503';

// A text input that saves when it loses focus (or on Enter), and only if the value changed. A
// required value left empty goes back to what it was.
const BlurInput = ({ value, onCommit, required = false, ...props }) => {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    const next = draft.trim();
    if (required && !next) return setDraft(value ?? '');
    if (next !== (value ?? '')) onCommit(next);
  };
  return (
    <Input value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} {...props} />
  );
};

// "Enregistré automatiquement" / "Enregistrement…" / "Enregistré": the sleeping plan has no Save
// button, so it says what happened to each change.
const SaveStatus = ({ status }) => (
  <p role="status" className="flex items-center gap-1.5 text-sm text-faint">
    {status === 'saved' && <Check aria-hidden="true" className="size-4 text-ok" strokeWidth={2} />}
    {status === 'saving' ? fr.sleepingSaving : status === 'saved' ? fr.sleepingSaved : fr.sleepingAutosave}
  </p>
);

const LocationList = ({ locations, occupantCount, selectedId, onSelect, onAdd, className }) => (
  <nav aria-label={fr.locationsListLabel} className={className}>
    <ul className="space-y-1">
      {locations.map(location => {
        const capacity = capacityOf(location.places);
        const taken = occupantCount(location.places);
        const selected = location.id === selectedId;
        return (
          <li key={location.id}>
            <button type="button" onClick={() => onSelect(location.id)} aria-current={selected || undefined}
              className={cx(
                'flex min-h-14 w-full items-center gap-3 rounded-control border px-3 py-2 text-left transition duration-150',
                selected ? 'border-neon tint-neon' : 'border-transparent hover:bg-raised'
              )}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{location.name}</span>
                <span className="block text-sm text-faint">
                  {fr.locationTotals.replace('{places}', location.places.length).replace('{capacity}', capacity)}
                </span>
              </span>
              <span className={cx('font-data text-sm', taken > capacity ? 'text-warn' : 'text-muted')}
                aria-label={fr.locationOccupancyLabel.replace('{taken}', taken).replace('{capacity}', capacity)}>
                {taken}/{capacity}
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-faint lg:hidden" />
            </button>
          </li>
        );
      })}
    </ul>
    <Button variant="secondary" size="sm" onClick={onAdd} className="mt-3 w-full">
      <Plus aria-hidden="true" className="size-4" />{fr.locationAdd}
    </Button>
  </nav>
);

// Adds n places of one type at once, named after the type and numbered after the location's
// existing places of that type ("Lit 3", "Lit 4"…).
const AddPlaces = ({ onAdd }) => {
  const [count, setCount] = useState(1);
  const [type, setType] = useState('bed');
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-control bg-night/60 p-3">
      <span className="text-sm font-semibold text-muted">{fr.placeAddLead}</span>
      <Stepper value={count} onChange={setCount} min={1} max={20} label={fr.placeAddCountLabel} />
      <div className="min-w-36 flex-1 sm:max-w-52">
        <Select aria-label={fr.placeAddTypeLabel} value={type} onChange={e => setType(e.target.value)}>
          {ACCOMMODATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>
      <Button variant="secondary" onClick={() => onAdd(count, type)}>
        <Plus aria-hidden="true" className="size-4" />{fr.placeAddButton}
      </Button>
    </div>
  );
};

const PlaceRow = ({ place, occupants, onUpdate, onCapacity, onDelete }) => {
  const overbooked = occupants.length > place.capacity;
  return (
    <li aria-label={place.label}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto_auto]">
      <BlurInput required aria-label={fr.placeLabelLabel} value={place.label} onCommit={label => onUpdate({ label })} />
      {/* Phone: name + delete, then type + capacity. From sm, one row, delete last, with the
          occupants line under it (explicit orders, since the delete button comes second in source). */}
      <Button variant="ghost" size="icon" onClick={onDelete} className="sm:order-3"
        aria-label={fr.placeDelete.replace('{label}', place.label)}>
        <Trash2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
      </Button>
      <Select aria-label={fr.placeTypeLabel} value={place.type} onChange={e => onUpdate({ type: e.target.value })} className="sm:order-1">
        {ACCOMMODATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
      <div className="justify-self-end sm:order-2 sm:justify-self-auto">
        <Stepper value={place.capacity} onChange={onCapacity} min={1} max={50} label={fr.placeCapacityLabel} />
      </div>
      <p className={cx('col-span-full flex items-center sm:order-4 gap-1.5 text-sm', overbooked ? 'text-warn' : 'text-faint')}>
        {overbooked && <TriangleAlert aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />}
        {occupants.length ? fr.placeOccupants.replace('{names}', occupants.join(', ')) : fr.placeFree}
      </p>
    </li>
  );
};

// The venue's name and address, saved like the rest of the section. Shared by every event held
// there, which the hint says.
const VenueCard = ({ venue, onUpdate }) => (
  <Card as="section" aria-labelledby="venue-card-title" className="space-y-4 p-4 sm:p-5">
    <div className="space-y-1">
      <h3 id="venue-card-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
        <MapPin aria-hidden="true" className="size-4.5 text-neon" strokeWidth={1.75} />{fr.venueTitle}
      </h3>
      <p className="max-w-prose text-sm text-faint">{fr.venueSharedHint}</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={fr.venueNameLabel}>
        {({ id }) => <BlurInput id={id} required value={venue.name} onCommit={name => onUpdate({ name })} />}
      </Field>
      <Field label={fr.venueAddressLabel}>
        {({ id }) => <BlurInput id={id} value={venue.address} onCommit={address => onUpdate({ address: address || null })} />}
      </Field>
    </div>
  </Card>
);

// The Couchage section of the event editor: the event's venue (#145), its locations and places
// (#113). Until the venues tab (#146) and the venue picker (#147), this is where a venue is
// created and edited; an event without one offers to create it.
export const EventSleepingPlan = ({ event, locationId, onLocationChange, onVenueChange }) => {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  // One call: the venue and the event's link to it are written together (create_event_venue).
  const createVenue = async () => {
    setCreating(true);
    try {
      const { error: createError } = await supabase.rpc('create_event_venue', { p_event_id: event.id });
      if (createError) throw createError;
      setError(null);
      await onVenueChange();
    } catch (createError) {
      console.error('Error creating the venue:', createError);
      setError(dbErrorMessage(createError, fr.venueCreateError));
    } finally {
      setCreating(false);
    }
  };

  if (!event.venue_id) {
    return (
      <div className="space-y-5">
        {error && <Notice tone="bad" role="alert">{error}</Notice>}
        <Card>
          <EmptyState icon={MapPin} title={fr.venueNone}
            action={<Button onClick={createVenue} loading={creating}><Plus aria-hidden="true" className="size-4.5" />{fr.venueCreate}</Button>}>
            {fr.venueNoneHint}
          </EmptyState>
        </Card>
      </div>
    );
  }
  return (
    <VenuePlan key={event.venue_id} eventIds={[event.id]} venueId={event.venue_id}
      locationId={locationId} onLocationChange={onLocationChange} onVenueChange={onVenueChange} />
  );
};

// A venue, its locations and places (#145), shared by the event editor's Couchage section and the
// venues tab (#146). Occupants are those of `eventIds`: the event being edited, or the venue's
// events still to come. Every change is saved right away: the rows are separate tables, and
// assignments point at them. Field edits show at once and are written behind; adding, removing
// and moving rows reload from the database. Deleting a place one of those occupants holds is
// refused, here with their names; the database refuses it for anyone at the venue (a foreign key).
export const VenuePlan = ({ eventIds, venueId, locationId, onLocationChange, onVenueChange }) => {
  const eventKey = eventIds.join(',');
  const [venue, setVenue] = useState(null);
  const [locations, setLocations] = useState(null);
  const [error, setError] = useState(null);
  const [occupants, setOccupants] = useState({});
  const [status, setStatus] = useState('idle');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const inFlight = useRef(0);
  const pane = useRef(null);
  const capacityWrites = useRef({});

  const load = useCallback(async () => {
    const [venueResult, locationsResult, assignmentsResult] = await Promise.all([
      supabase.from('venues').select('id, name, address').eq('id', venueId).single(),
      supabase
        .from('locations')
        .select('id, name, note, sort_order, created_at, places(id, label, type, capacity, sort_order, created_at)')
        .eq('venue_id', venueId),
      eventIds.length
        ? supabase.from('attendee_places').select('place_id, attendee_name').in('event_id', eventIds)
        : { data: [] }
    ]);
    const loadError = venueResult.error || locationsResult.error || assignmentsResult.error;
    if (loadError) {
      console.error('Error loading locations:', loadError);
      setError(fr.locationsLoadError);
      setLocations(current => current || []);
      return;
    }
    setVenue(venueResult.data);
    setLocations(locationsResult.data
      .map(location => ({ ...location, places: [...location.places].sort(bySortOrder) }))
      .sort(bySortOrder));
    const names = {};
    assignmentsResult.data.forEach(({ place_id: placeId, attendee_name: name }) => {
      (names[placeId] ||= []).push(name);
    });
    setOccupants(names);
    // eventKey stands for eventIds, a new array on every render.
  }, [eventKey, venueId]);

  useEffect(() => { load(); }, [load]);

  // Below lg the location replaces the list; bring it to the top instead of leaving the admin
  // scrolled past the totals.
  const openedId = locations?.some(location => location.id === locationId) ? locationId : null;
  useEffect(() => {
    if (openedId && window.matchMedia('(max-width: 1023.98px)').matches) pane.current?.scrollIntoView({ block: 'start' });
  }, [openedId]);

  // Runs a write and reports it in the status line. A failed write reloads, so the screen goes
  // back to what the database holds.
  const track = async (write) => {
    inFlight.current += 1;
    setStatus('saving');
    const result = await write;
    inFlight.current -= 1;
    if (result.error) {
      console.error('Error saving locations:', result.error);
      setError(result.error.code === FOREIGN_KEY_VIOLATION
        ? fr.placeOccupiedUnseen
        : dbErrorMessage(result.error, fr.locationsSaveError));
      setStatus('idle');
      await load();
    } else {
      setError(null);
      if (!inFlight.current) setStatus('saved');
    }
    return result;
  };
  const trackAndReload = async (write) => {
    const result = await track(write);
    if (!result.error) await load();
    return result;
  };

  // Pending capacity writes go out when the admin leaves the section, not never.
  const flushCapacity = useCallback(() => {
    Object.entries(capacityWrites.current).forEach(([placeId, { timer, capacity }]) => {
      clearTimeout(timer);
      supabase.from('places').update({ capacity }).eq('id', placeId).then(({ error: writeError }) => {
        if (writeError) console.error('Error saving capacity:', writeError);
      });
    });
    capacityWrites.current = {};
  }, []);
  useEffect(() => flushCapacity, [flushCapacity]);

  const patchLocation = (id, fields) => {
    setLocations(current => current.map(location => (location.id === id ? { ...location, ...fields } : location)));
    return track(supabase.from('locations').update(fields).eq('id', id));
  };

  // The event's page shows the venue's address, so the editor's events reload after a change.
  const patchVenue = async (fields) => {
    setVenue(current => ({ ...current, ...fields }));
    const result = await track(supabase.from('venues').update(fields).eq('id', venueId));
    if (!result.error) onVenueChange();
  };

  const patchPlaceLocally = (id, fields) => setLocations(current => current.map(location => ({
    ...location,
    places: location.places.map(place => (place.id === id ? { ...place, ...fields } : place))
  })));

  const patchPlace = (id, fields) => {
    patchPlaceLocally(id, fields);
    return track(supabase.from('places').update(fields).eq('id', id));
  };

  const setCapacity = (id, capacity) => {
    patchPlaceLocally(id, { capacity });
    clearTimeout(capacityWrites.current[id]?.timer);
    setStatus('saving');
    const timer = setTimeout(() => {
      delete capacityWrites.current[id];
      track(supabase.from('places').update({ capacity }).eq('id', id));
    }, CAPACITY_WRITE_DELAY_MS);
    capacityWrites.current[id] = { timer, capacity };
  };

  const addLocation = async () => {
    const { data } = await trackAndReload(supabase.from('locations').insert({
      venue_id: venueId,
      name: fr.locationDefaultName.replace('{n}', locations.length + 1),
      sort_order: nextSortOrder(locations)
    }).select('id').single());
    if (data) onLocationChange(data.id);
  };

  const duplicateLocation = async (location) => {
    const { data, error: insertError } = await track(supabase.from('locations').insert({
      venue_id: venueId,
      name: fr.locationCopyName.replace('{name}', location.name),
      note: location.note,
      sort_order: nextSortOrder(locations)
    }).select('id').single());
    if (insertError) return;
    if (location.places.length) {
      await track(supabase.from('places').insert(location.places.map(({ label, type, capacity, sort_order: sortOrder }) => ({
        location_id: data.id, label, type, capacity, sort_order: sortOrder
      }))));
    }
    await load();
    onLocationChange(data.id);
  };

  // Swaps with the neighbour, then renumbers everyone so equal sort_orders can't stick.
  const moveLocation = async (index, delta) => {
    const reordered = [...locations];
    [reordered[index], reordered[index + delta]] = [reordered[index + delta], reordered[index]];
    setLocations(reordered);
    const writes = reordered
      .map((location, order) => ({ location, order }))
      .filter(({ location, order }) => location.sort_order !== order)
      .map(({ location, order }) => supabase.from('locations').update({ sort_order: order }).eq('id', location.id));
    await trackAndReload(Promise.all(writes).then(results => results.find(result => result.error) || {}));
  };

  const occupantsOf = places => places.flatMap(place => occupants[place.id] || []);
  const occupantCount = places => occupantsOf(places).length;

  const deleteLocation = async (location) => {
    await trackAndReload(supabase.from('locations').delete().eq('id', location.id));
    onLocationChange(null);
  };

  const requestLocationDelete = (location) => {
    const names = occupantsOf(location.places);
    if (names.length) return setBlocked({ name: location.name, names });
    if (!location.places.length) return deleteLocation(location);
    setPendingDelete(location);
  };

  const addPlaces = (location, count, type) => {
    const typeLabel = getOptionLabel(ACCOMMODATION_OPTIONS, type);
    const first = location.places.filter(place => place.type === type).length + 1;
    const sortOrder = nextSortOrder(location.places);
    return trackAndReload(supabase.from('places').insert(Array.from({ length: count }, (_, i) => ({
      location_id: location.id,
      label: fr.placeDefaultLabel.replace('{type}', typeLabel).replace('{n}', first + i),
      type,
      sort_order: sortOrder + i
    }))));
  };

  const deletePlace = (place) => {
    const names = occupants[place.id] || [];
    if (names.length) return setBlocked({ name: place.label, names });
    trackAndReload(supabase.from('places').delete().eq('id', place.id));
  };

  if (!locations) {
    return (
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-20 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  const allPlaces = locations.flatMap(location => location.places);
  const explicit = locations.find(location => location.id === locationId);
  const selected = explicit || locations[0];
  const selectedIndex = locations.indexOf(selected);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-muted">{fr.locationsHint}</p>
        <SaveStatus status={status} />
      </div>
      {error && <Notice tone="bad" role="alert">{error}</Notice>}

      {venue && <VenueCard venue={venue} onUpdate={patchVenue} />}

      {locations.length === 0 ? (
        <Card>
          <EmptyState icon={BedDouble} title={fr.locationsEmpty}
            action={<Button onClick={addLocation}><Plus aria-hidden="true" className="size-4.5" />{fr.locationAdd}</Button>}>
            {fr.locationsEmptyHint}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
            <Stat label={fr.sleepingStatLocations} value={locations.length} />
            <Stat label={fr.sleepingStatPlaces} value={allPlaces.length} />
            <Stat label={fr.sleepingStatCapacity} value={capacityOf(allPlaces)} />
            <Stat label={fr.sleepingStatAssigned} value={occupantCount(allPlaces)}
              tone={occupantCount(allPlaces) > capacityOf(allPlaces) ? 'warn' : undefined} />
          </Card>

          {/* Master-detail from lg; below it, the list, then one location full-width. Which one
              shows on a phone depends on whether a location is in the URL. */}
          <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6">
            <LocationList
              locations={locations}
              occupantCount={occupantCount}
              selectedId={selected.id}
              onSelect={onLocationChange}
              onAdd={addLocation}
              className={cx('lg:sticky lg:top-20', explicit && 'hidden lg:block')}
            />

            <Card as="section" aria-label={selected.name} key={selected.id} ref={pane}
              className={cx('scroll-mt-20 space-y-5 p-4 sm:p-6', !explicit && 'hidden lg:block')}>
              <Button variant="ghost" size="sm" onClick={() => onLocationChange(null)} className="-ml-2 lg:hidden">
                <ArrowLeft aria-hidden="true" className="size-4" />{fr.locationsBackToList}
              </Button>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={fr.locationNameLabel}>
                  {({ id }) => <BlurInput id={id} required value={selected.name} onCommit={name => patchLocation(selected.id, { name })} />}
                </Field>
                <Field label={fr.locationNoteLabel}>
                  {({ id }) => <BlurInput id={id} value={selected.note} onCommit={note => patchLocation(selected.id, { note: note || null })} />}
                </Field>
              </div>

              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" disabled={selectedIndex === 0} onClick={() => moveLocation(selectedIndex, -1)}
                  aria-label={fr.locationMoveUp.replace('{name}', selected.name)}>
                  <ArrowUp aria-hidden="true" className="size-4" strokeWidth={1.75} />{fr.moveUp}
                </Button>
                <Button variant="ghost" size="sm" disabled={selectedIndex === locations.length - 1} onClick={() => moveLocation(selectedIndex, 1)}
                  aria-label={fr.locationMoveDown.replace('{name}', selected.name)}>
                  <ArrowDown aria-hidden="true" className="size-4" strokeWidth={1.75} />{fr.moveDown}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => duplicateLocation(selected)}
                  aria-label={fr.locationDuplicate.replace('{name}', selected.name)}>
                  <Copy aria-hidden="true" className="size-4" strokeWidth={1.75} />{fr.duplicate}
                </Button>
                <Button variant="dangerGhost" size="sm" onClick={() => requestLocationDelete(selected)}
                  aria-label={fr.locationDelete.replace('{name}', selected.name)} className="sm:ml-auto">
                  <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />{fr.delete}
                </Button>
              </div>

              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                  <h3 className="text-lg font-semibold text-ink">{fr.placesTitle}</h3>
                  <p className="font-data text-xs text-faint">
                    {fr.locationTotals.replace('{places}', selected.places.length).replace('{capacity}', capacityOf(selected.places))}
                  </p>
                </div>
                {selected.places.length === 0 ? (
                  <p className="py-4 text-sm text-faint">{fr.placesEmpty}</p>
                ) : (
                  <>
                    <div aria-hidden="true" className="hidden gap-2 pt-3 text-sm font-semibold text-faint sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_8rem_2.75rem]">
                      <span>{fr.placeLabelLabel}</span><span>{fr.placeTypeLabel}</span><span>{fr.placeCapacityLabel}</span><span />
                    </div>
                    <ul className="divide-y divide-line">
                      {selected.places.map(place => (
                        <PlaceRow
                          key={place.id}
                          place={place}
                          occupants={occupants[place.id] || []}
                          onUpdate={fields => patchPlace(place.id, fields)}
                          onCapacity={capacity => setCapacity(place.id, capacity)}
                          onDelete={() => deletePlace(place)}
                        />
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <AddPlaces onAdd={(count, type) => addPlaces(selected, count, type)} />
            </Card>
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={fr.locationDeleteConfirmTitle}
        confirmLabel={fr.delete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const location = pendingDelete;
          setPendingDelete(null);
          await deleteLocation(location);
        }}
      >
        {pendingDelete && fr.locationDeleteConfirmBody
          .replace('{name}', pendingDelete.name)
          .replace('{count}', pendingDelete.places.length)}
      </ConfirmDialog>

      <Dialog
        open={!!blocked}
        onClose={() => setBlocked(null)}
        title={fr.occupiedDeleteTitle}
        size="sm"
        footer={<Button variant="secondary" onClick={() => setBlocked(null)}>{fr.close}</Button>}
      >
        {blocked && (
          <div className="space-y-3 px-5 py-5 text-muted sm:px-6">
            <p>{fr.occupiedDeleteBody.replace('{name}', blocked.name)}</p>
            <ul className="list-disc pl-5 text-ink">
              {blocked.names.map((name, i) => <li key={i}>{name}</li>)}
            </ul>
          </div>
        )}
      </Dialog>
    </div>
  );
};
