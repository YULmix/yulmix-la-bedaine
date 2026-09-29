import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { supabase } from '../../lib/supabase';
import { dbErrorMessage } from '../../lib/dbErrors';
import { ACCOMMODATION_OPTIONS } from '../../lib/registrationOptions';
import { Button, ConfirmDialog, Dialog, Field, Input, Notice, Select, Skeleton } from '../ui';

const bySortOrder = (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);

// A text input that saves when it loses focus, and only if the value changed. A required value
// left empty goes back to what it was.
const BlurInput = ({ value, onCommit, required = false, ...props }) => {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    const next = draft.trim();
    if (required && !next) return setDraft(value ?? '');
    if (next !== (value ?? '')) onCommit(next);
  };
  return <Input value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} {...props} />;
};

// Locations and places of an event (#113), edited in the event dialog. Unlike the rest of the
// dialog, every change is saved right away: the rows are separate tables, and assignments point
// at them. Deleting a place someone holds is refused, here with their names and in the database
// by a foreign key.
export const EventLocationsEditor = ({ eventId }) => {
  const [locations, setLocations] = useState(null);
  const [error, setError] = useState(null);
  const [occupants, setOccupants] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null);
  const [blocked, setBlocked] = useState(null);

  const load = useCallback(async () => {
    const [locationsResult, assignmentsResult] = await Promise.all([
      supabase
        .from('event_locations')
        .select('id, name, note, sort_order, created_at, event_places(id, label, type, capacity, sort_order, created_at)')
        .eq('event_id', eventId),
      supabase
        .from('place_assignments')
        .select('place_id, attendee_id, user_parties!inner(event_id, attendees)')
        .eq('user_parties.event_id', eventId)
    ]);
    const loadError = locationsResult.error || assignmentsResult.error;
    if (loadError) {
      console.error('Error loading locations:', loadError);
      setError(fr.locationsLoadError);
      setLocations([]);
      return;
    }
    setLocations(locationsResult.data
      .map(location => ({ ...location, places: [...location.event_places].sort(bySortOrder) }))
      .sort(bySortOrder));
    const names = {};
    assignmentsResult.data.forEach(({ place_id: placeId, attendee_id: attendeeId, user_parties: party }) => {
      const attendee = (party.attendees || []).find(a => a.id === attendeeId);
      (names[placeId] ||= []).push(attendee?.name?.trim() || fr.occupiedDeleteUnknownName);
    });
    setOccupants(names);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // Runs a write, then reloads: the list always shows what the database holds.
  const run = async (write) => {
    const { error: writeError } = await write;
    if (writeError) console.error('Error saving locations:', writeError);
    setError(writeError ? dbErrorMessage(writeError, fr.locationsSaveError) : null);
    await load();
  };

  const addLocation = () => run(supabase.from('event_locations').insert({
    event_id: eventId,
    name: fr.locationDefaultName.replace('{n}', locations.length + 1),
    sort_order: locations.length ? Math.max(...locations.map(l => l.sort_order)) + 1 : 0
  }));

  const updateLocation = (id, fields) => run(supabase.from('event_locations').update(fields).eq('id', id));

  // Swaps with the neighbour, then renumbers everyone so equal sort_orders can't stick.
  const moveLocation = async (index, delta) => {
    const reordered = [...locations];
    [reordered[index], reordered[index + delta]] = [reordered[index + delta], reordered[index]];
    const results = await Promise.all(reordered
      .map((location, order) => ({ location, order }))
      .filter(({ location, order }) => location.sort_order !== order)
      .map(({ location, order }) => supabase.from('event_locations').update({ sort_order: order }).eq('id', location.id)));
    const failed = results.find(result => result.error);
    setError(failed ? dbErrorMessage(failed.error, fr.locationsSaveError) : null);
    await load();
  };

  const occupantsOf = (places) => places.flatMap(place => occupants[place.id] || []);

  const requestLocationDelete = (location) => {
    const names = occupantsOf(location.places);
    if (names.length) return setBlocked({ name: location.name, names });
    if (!location.places.length) return run(supabase.from('event_locations').delete().eq('id', location.id));
    setPendingDelete(location);
  };

  const addPlace = (location) => run(supabase.from('event_places').insert({
    location_id: location.id,
    label: fr.placeDefaultLabel.replace('{n}', location.places.length + 1),
    type: 'bed',
    sort_order: location.places.length ? Math.max(...location.places.map(p => p.sort_order)) + 1 : 0
  }));

  const updatePlace = (id, fields) => run(supabase.from('event_places').update(fields).eq('id', id));

  const deletePlace = (place) => {
    const names = occupants[place.id] || [];
    if (names.length) return setBlocked({ name: place.label, names });
    run(supabase.from('event_places').delete().eq('id', place.id));
  };

  if (!locations) return <Skeleton className="h-24" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{fr.locationsHint}</p>
      {error && <Notice tone="bad" role="alert">{error}</Notice>}
      {locations.length === 0 && <p className="text-sm text-faint">{fr.locationsEmpty}</p>}

      <ul className="space-y-4">
        {locations.map((location, index) => {
          const capacity = location.places.reduce((sum, place) => sum + place.capacity, 0);
          return (
            <li key={location.id} className="space-y-3 rounded-card border border-line p-4" aria-label={location.name}>
              <div className="flex items-end gap-2">
                <Field label={fr.locationNameLabel} className="min-w-0 flex-1">
                  {({ id }) => <BlurInput id={id} required value={location.name} onCommit={name => updateLocation(location.id, { name })} />}
                </Field>
                <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => moveLocation(index, -1)}
                  aria-label={fr.locationMoveUp.replace('{name}', location.name)}>
                  <ArrowUp aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                </Button>
                <Button variant="ghost" size="icon" disabled={index === locations.length - 1} onClick={() => moveLocation(index, 1)}
                  aria-label={fr.locationMoveDown.replace('{name}', location.name)}>
                  <ArrowDown aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => requestLocationDelete(location)}
                  aria-label={fr.locationDelete.replace('{name}', location.name)}>
                  <Trash2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                </Button>
              </div>
              <Field label={fr.locationNoteLabel}>
                {({ id }) => <BlurInput id={id} value={location.note} onCommit={note => updateLocation(location.id, { note: note || null })} />}
              </Field>

              <ul className="space-y-2">
                {location.places.map(place => (
                  <li key={place.id} className="space-y-1">
                    <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_10rem_6rem_auto]">
                      <BlurInput required aria-label={fr.placeLabelLabel} placeholder={fr.placeLabelLabel} value={place.label}
                        onCommit={label => updatePlace(place.id, { label })} />
                      <Button variant="ghost" size="icon" onClick={() => deletePlace(place)} className="sm:order-last"
                        aria-label={fr.placeDelete.replace('{label}', place.label)}>
                        <Trash2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                      </Button>
                      <Select aria-label={fr.placeTypeLabel} value={place.type} onChange={e => updatePlace(place.id, { type: e.target.value })}>
                        {ACCOMMODATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </Select>
                      <BlurInput required type="number" min={1} inputMode="numeric" aria-label={fr.placeCapacityLabel}
                        value={String(place.capacity)}
                        onCommit={text => {
                          const value = parseInt(text, 10);
                          if (value >= 1) updatePlace(place.id, { capacity: value });
                          else load();
                        }} />
                    </div>
                    {occupants[place.id]?.length > 0 && (
                      <p className="text-xs text-faint">{fr.placeOccupants.replace('{names}', occupants[place.id].join(', '))}</p>
                    )}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => addPlace(location)}>
                  <Plus aria-hidden="true" className="size-4" />{fr.placeAdd}
                </Button>
                <p className="font-data text-xs text-faint">
                  {fr.locationTotals.replace('{places}', location.places.length).replace('{capacity}', capacity)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <Button variant="secondary" size="sm" onClick={addLocation}>
        <Plus aria-hidden="true" className="size-4" />{fr.locationAdd}
      </Button>

      <ConfirmDialog
        open={!!pendingDelete}
        title={fr.locationDeleteConfirmTitle}
        confirmLabel={fr.delete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const location = pendingDelete;
          setPendingDelete(null);
          await run(supabase.from('event_locations').delete().eq('id', location.id));
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
