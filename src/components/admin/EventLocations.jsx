import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, BedDouble, Check, ChevronRight, Copy, Images, MapPin, Plus, Trash2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { supabase } from '../../lib/supabase';
import { dbErrorMessage } from '../../lib/dbErrors';
import { plural } from '../../lib/eventDisplay';
import { placeTypeBreakdown } from '../../lib/places';
import { invalidateEventPlaces } from '../../lib/eventPlaces';
import { VENUE_GALLERY_KINDS, copyGalleryImages, fetchLocationGalleries, removeUnusedGalleryImages } from '../../lib/galleries';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { ACCOMMODATION_ICONS } from '../accommodationIcons';
import GalleryEditor from './GalleryEditor';
import { formatCoordinates, parseCoordinates } from '../../lib/venue';
import { Button, Card, ConfirmDialog, Dialog, EmptyState, Field, Input, Notice, Select, Skeleton, Stat, Stepper, cx } from '../ui';

const bySortOrder = (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
const nextSortOrder = rows => (rows.length ? Math.max(...rows.map(row => row.sort_order)) + 1 : 0);
const capacityOf = places => places.reduce((sum, place) => sum + place.capacity, 0);

// A capacity change is written this long after the last Stepper click, so tapping + five times is
// one write, not five racing ones.
const CAPACITY_WRITE_DELAY_MS = 400;

// Deleting a place (or location) someone was given between the check and the delete: the foreign
// key refuses it.
const FOREIGN_KEY_VIOLATION = '23503';

// A text input that saves when it loses focus (or on Enter), and only if the value changed. A
// required value left empty goes back to what it was.
const BlurInput = ({ value, onCommit, onChange, required = false, ...props }) => {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    const next = draft.trim();
    if (required && !next) return setDraft(value ?? '');
    if (next !== (value ?? '')) onCommit(next);
  };
  return (
    <Input value={draft} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} {...props}
      onChange={e => { setDraft(e.target.value); onChange?.(e); }} />
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

const LocationList = ({ locations, selectedId, onSelect, onAdd, className }) => (
  <nav aria-label={fr.locationsListLabel} className={className}>
    <ul className="space-y-1">
      {locations.map(location => {
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
                  {fr.locationTotals.replace('{places}', location.places.length).replace('{capacity}', capacityOf(location.places))}
                </span>
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

const PlaceRow = ({ place, onUpdate, onCapacity, onDelete }) => (
  <li aria-label={place.label}
    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto_auto]">
    <BlurInput required aria-label={fr.placeLabelLabel} value={place.label} onCommit={label => onUpdate({ label })} />
    {/* Phone: name + delete, then type + capacity. From sm, one row, delete last (explicit
        orders, since the delete button comes second in source). */}
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
  </li>
);

// The venue's galleries (#177), each headed by where it shows.
const VenueGalleries = ({ venueId }) => (
  <Card as="section" aria-labelledby="venue-galleries-title" className="space-y-6 p-4 sm:p-5">
    <h3 id="venue-galleries-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
      <Images aria-hidden="true" className="size-4.5 text-neon" strokeWidth={1.75} />{fr.galleryVenueTitle}
    </h3>
    <GalleryEditor owner={{ venueId, kind: VENUE_GALLERY_KINDS.general }} headingLevel="h4"
      title={fr.galleryVenueGeneralTitle} hint={fr.galleryVenueGeneralHint} />
    <div className="border-t border-line pt-6">
      <GalleryEditor owner={{ venueId, kind: VENUE_GALLERY_KINDS.assignments }} headingLevel="h4"
        title={fr.galleryVenueAssignmentsTitle} hint={fr.galleryVenueAssignmentsHint} />
    </div>
  </Card>
);

// Where the venue is on a map (#180), pasted as « latitude, longitude »: what the carpool board
// measures detours to. Saved on blur like the other fields; something else is refused here.
const VenueCoordinates = ({ venue, onUpdate }) => {
  const [error, setError] = useState('');
  return (
    <Field label={fr.venueCoordinatesLabel} hint={fr.venueCoordinatesHint} error={error} className="sm:col-span-2">
      {({ id, describedBy, invalid }) => (
        <BlurInput id={id} inputMode="decimal" className="font-data" placeholder={fr.venueCoordinatesPlaceholder}
          aria-describedby={describedBy} invalid={invalid} value={formatCoordinates(venue)}
          onChange={() => setError('')}
          onCommit={text => {
            const coordinates = parseCoordinates(text);
            if (coordinates === undefined) return setError(fr.venueCoordinatesInvalid);
            setError('');
            onUpdate(coordinates || { lat: null, lng: null });
          }} />
      )}
    </Field>
  );
};

// The venue's name, address and coordinates, saved like the rest of the section. Shared by every
// event held there, which the hint says.
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
      <VenueCoordinates venue={venue} onUpdate={onUpdate} />
    </div>
  </Card>
);

// Under the totals (#164): how the places split by type, each with its capacity.
const PlaceTypeBreakdown = ({ locations }) => {
  const rows = placeTypeBreakdown(locations);
  if (!rows.length) return null;
  return (
    <ul aria-label={fr.sleepingByTypeLabel} className="col-span-full flex flex-wrap gap-2 border-t border-line pt-4">
      {rows.map(row => {
        const Icon = ACCOMMODATION_ICONS[row.type];
        return (
          <li key={row.type} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised py-1 pr-3 pl-2.5 text-sm text-muted">
            {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />}
            <span>
              {`${getOptionLabel(ACCOMMODATION_OPTIONS, row.type)} : `}
              <span className="font-data font-medium text-ink">{row.places}</span>
              <span className="text-faint">{` · ${plural(row.capacity, 'countPersonOne', 'countPersonOther')}`}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
};

// A venue, its locations and places (#145), on the venue's page of the Sites tab (#146). A venue
// lives outside any event, so this shows none of their assignments: who sleeps where is the
// Logistique tab's. Every change is saved right away: the rows are separate tables, and
// assignments point at them. Field edits show at once and are written behind; adding, removing
// and moving rows reload from the database. Deleting a place someone holds, in any event, is
// refused with their names, looked up then; the database refuses it anyway (a foreign key).
export const VenuePlan = ({ venueId, locationId, onLocationChange, onVenueChange }) => {
  const [venue, setVenue] = useState(null);
  const [locations, setLocations] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const inFlight = useRef(0);
  const pane = useRef(null);
  const capacityWrites = useRef({});

  const load = useCallback(async () => {
    const [venueResult, locationsResult] = await Promise.all([
      supabase.from('venues').select('id, name, address, lat, lng').eq('id', venueId).single(),
      supabase
        .from('locations')
        .select('id, name, note, sort_order, created_at, places(id, label, type, capacity, sort_order, created_at)')
        .eq('venue_id', venueId)
    ]);
    const loadError = venueResult.error || locationsResult.error;
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
  }, [venueId]);

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
      // Every event at this venue sees its places through it (#193).
      invalidateEventPlaces();
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
        else invalidateEventPlaces();
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
    // The copy's gallery points at the same images; a copy without them is still a copy.
    try {
      const images = (await fetchLocationGalleries([location.id])).get(location.id) || [];
      await copyGalleryImages(images, data.id);
    } catch (copyError) {
      console.error('Error copying a location gallery:', copyError);
      setError(dbErrorMessage(copyError, fr.gallerySaveError));
    }
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

  // Who holds these places, in any event: asked only when deleting, to say whom to move first. If
  // the question fails, the delete goes ahead and the foreign key has the last word.
  const holdersOf = async (places) => {
    if (!places.length) return [];
    const { data, error: readError } = await supabase.from('attendee_places').select('attendee_name')
      .in('place_id', places.map(place => place.id));
    if (readError) console.error('Error reading who holds the places:', readError);
    return (data || []).map(row => row.attendee_name);
  };

  // The gallery goes with the location (a cascade); its images' objects are removed after, unless
  // a frozen copy still shows them.
  const deleteLocation = async (location) => {
    const images = await fetchLocationGalleries([location.id])
      .then(galleries => galleries.get(location.id) || [], () => []);
    const result = await trackAndReload(supabase.from('locations').delete().eq('id', location.id));
    if (!result.error) removeUnusedGalleryImages(images.map(image => image.path));
    onLocationChange(null);
  };

  const requestLocationDelete = async (location) => {
    const names = await holdersOf(location.places);
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

  const deletePlace = async (place) => {
    const names = await holdersOf([place]);
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
      {venue && <VenueGalleries venueId={venue.id} />}

      {locations.length === 0 ? (
        <Card>
          <EmptyState icon={BedDouble} title={fr.locationsEmpty}
            action={<Button onClick={addLocation}><Plus aria-hidden="true" className="size-4.5" />{fr.locationAdd}</Button>}>
            {fr.locationsEmptyHint}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="grid grid-cols-3 gap-4 p-4 sm:p-5">
            <Stat label={fr.sleepingStatLocations} value={locations.length} />
            <Stat label={fr.sleepingStatPlaces} value={allPlaces.length} />
            <Stat label={fr.sleepingStatCapacity} value={capacityOf(allPlaces)} />
            <PlaceTypeBreakdown locations={locations} />
          </Card>

          {/* Master-detail from lg; below it, the list, then one location full-width. Which one
              shows on a phone depends on whether a location is in the URL. */}
          <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6">
            <LocationList
              locations={locations}
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

              <GalleryEditor key={selected.id} owner={{ locationId: selected.id }}
                title={fr.galleryLocationTitle} hint={fr.galleryLocationHint} />

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
