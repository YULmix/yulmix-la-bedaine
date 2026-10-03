import { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, MapPin, Pencil, Plus } from 'lucide-react';
import fr from '../../locales/fr.json';
import { supabase } from '../../lib/supabase';
import { dbErrorMessage } from '../../lib/dbErrors';
import { venueTotals } from '../../lib/places';
import { Button, Dialog, EmptyState, Field, Input, Notice, Skeleton, Tag, Toggle } from '../ui';
import { VenuePlan } from './EventLocations';
import { AdminHeaderActions } from './AdminNav';

// The events held at a venue: on it, or on one of its frozen copies (an archived edition, #148).
// Those still to come (not archived) are whose occupants the venue page shows.
const eventsAt = (events, venueIds) => events.filter(event => venueIds.includes(event.venue_id));

const Totals = ({ totals }) => (
  <p className="font-data text-xs text-faint">
    {fr.venueTotals
      .replace('{locations}', totals.locations)
      .replace('{places}', totals.places)
      .replace('{capacity}', totals.capacity)}
  </p>
);

const EventNames = ({ events }) => (
  <p className="text-sm text-muted">
    {events.length ? fr.venueUsedBy.replace('{events}', events.map(event => event.theme).join(', ')) : fr.venueUnused}
  </p>
);

// Name and address of a new venue; its locations are added on its page, where it opens.
const NewVenueDialog = ({ open, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) { setName(''); setAddress(''); setError(null); }
  }, [open]);

  const create = async (submitEvent) => {
    submitEvent.preventDefault();
    if (!name.trim()) return setError(fr.venueNameRequired);
    setSaving(true);
    const { data, error: insertError } = await supabase.from('venues')
      .insert({ name: name.trim(), address: address.trim() || null }).select('id').single();
    setSaving(false);
    if (insertError) {
      console.error('Error creating a venue:', insertError);
      return setError(dbErrorMessage(insertError, fr.venueCreateError));
    }
    onCreated(data.id);
  };

  return (
    <Dialog open={open} onClose={onClose} title={fr.venueNewTitle} size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{fr.cancel}</Button>
          <Button type="submit" form="new-venue-form" loading={saving}>{fr.venueCreate}</Button>
        </>
      )}>
      <form id="new-venue-form" onSubmit={create} noValidate className="space-y-4 px-5 py-5 sm:px-6">
        {error && <Notice tone="bad">{error}</Notice>}
        <Field label={fr.venueNameLabel}>
          {({ id }) => <Input id={id} value={name} onChange={e => setName(e.target.value)} autoFocus />}
        </Field>
        <Field label={fr.venueAddressLabel}>
          {({ id }) => <Input id={id} value={address} onChange={e => setAddress(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
};

const VenueList = ({ events, onOpen }) => {
  const [venues, setVenues] = useState(null);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.from('venues')
      .select('id, name, address, archived_at, snapshot_of, locations(places(capacity))')
      .order('name')
      .then(({ data, error: loadError }) => {
        if (loadError) {
          console.error('Error loading venues:', loadError);
          setError(fr.venuesLoadError);
          return setVenues([]);
        }
        setVenues(data);
      });
  }, []);

  if (!venues) {
    return (
      <div aria-busy="true" className="space-y-3">
        <Skeleton className="h-10 w-48 rounded-control" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    );
  }

  // Frozen copies (#148) aren't venues to manage: their events show under the venue copied.
  const live = venues.filter(venue => !venue.snapshot_of);
  const copiesOf = id => [id, ...venues.filter(venue => venue.snapshot_of === id).map(venue => venue.id)];
  const archivedCount = live.filter(venue => venue.archived_at).length;
  const shown = live.filter(venue => showArchived || !venue.archived_at);

  return (
    <section className="space-y-4">
      <p className="max-w-prose text-sm text-faint">{fr.venuesHint}</p>
      <AdminHeaderActions>
        <Button onClick={() => setCreating(true)}><Plus aria-hidden="true" className="size-4.5" />{fr.venueNew}</Button>
      </AdminHeaderActions>
      {error && <Notice tone="bad">{error}</Notice>}
      {archivedCount > 0 && (
        <Toggle checked={showArchived} onChange={setShowArchived}
          label={fr.venuesShowArchived.replace('{count}', archivedCount)} className="max-w-md" />
      )}

      {shown.length === 0 ? (
        <EmptyState icon={MapPin} title={fr.venuesEmpty}
          action={<Button onClick={() => setCreating(true)}><Plus aria-hidden="true" className="size-4.5" />{fr.venueNew}</Button>}>
          {fr.venuesEmptyHint}
        </EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-card border border-line bg-surface divide-y divide-line">
          {shown.map(venue => (
            <li key={venue.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{venue.name}</p>
                  {venue.archived_at && <Tag>{fr.venueArchivedTag}</Tag>}
                </div>
                {venue.address && <p className="text-sm text-muted">{venue.address}</p>}
                <Totals totals={venueTotals(venue.locations)} />
                <EventNames events={eventsAt(events, copiesOf(venue.id))} />
              </div>
              <Button size="sm" variant="secondary" onClick={() => onOpen(venue.id)}
                aria-label={fr.venueOpen.replace('{name}', venue.name)}>
                <Pencil aria-hidden="true" className="size-4" />{fr.edit}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <NewVenueDialog open={creating} onClose={() => setCreating(false)} onCreated={onOpen} />
    </section>
  );
};

// One venue: its name, address, locations and places (the editor the event page uses), with the
// occupants of its events still to come, and archiving.
const VenuePage = ({ venueId, events, locationId, onLocationChange, onOpen, onBack, onVenueChange, notify }) => {
  const [venue, setVenue] = useState(undefined);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    const [venueResult, copiesResult] = await Promise.all([
      supabase.from('venues').select('id, name, archived_at, snapshot_of').eq('id', venueId).maybeSingle(),
      supabase.from('venues').select('id').eq('snapshot_of', venueId)
    ]);
    const error = venueResult.error || copiesResult.error;
    if (error) console.error('Error loading the venue:', error);
    setVenue(venueResult.data ? { ...venueResult.data, copies: (copiesResult.data || []).map(copy => copy.id) } : null);
  }, [venueId]);
  useEffect(() => { load(); }, [load]);

  const back = (
    <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3">
      <ArrowLeft aria-hidden="true" className="size-4" />{fr.venuesBack}
    </Button>
  );

  if (venue === undefined) return <Skeleton className="h-64 rounded-card" />;
  if (venue === null) {
    return <EmptyState icon={MapPin} title={fr.venueNotFound} action={<Button variant="secondary" onClick={onBack}>{fr.venuesBack}</Button>} />;
  }

  // A frozen copy (reached from an archived event) is shown for what it is, not edited.
  if (venue.snapshot_of) {
    return (
      <section className="space-y-4">
        {back}
        <Notice tone="info" title={fr.venueSnapshotTitle.replace('{name}', venue.name)}
          action={<Button variant="secondary" size="sm" onClick={() => onOpen(venue.snapshot_of)}>{fr.venueSnapshotOpenLive}</Button>}>
          {fr.venueSnapshotBody}
        </Notice>
      </section>
    );
  }

  const held = eventsAt(events, [venueId, ...venue.copies]);
  const toggleArchived = async () => {
    setArchiving(true);
    const archivedAt = venue.archived_at ? null : new Date().toISOString();
    const { error } = await supabase.from('venues').update({ archived_at: archivedAt }).eq('id', venueId);
    setArchiving(false);
    if (error) {
      console.error('Error archiving the venue:', error);
      return notify(dbErrorMessage(error, fr.locationsSaveError), 'error');
    }
    notify((archivedAt ? fr.venueArchivedToast : fr.venueRestoredToast).replace('{name}', venue.name), 'success');
    load();
  };

  return (
    <section className="space-y-6" aria-labelledby="venue-page-title">
      <div className="space-y-3">
        {back}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="venue-page-title" className="min-w-0 text-display-md font-display text-ink [overflow-wrap:anywhere]">{venue.name}</h2>
          {venue.archived_at && <Tag>{fr.venueArchivedTag}</Tag>}
          <Button variant="ghost" size="sm" onClick={toggleArchived} loading={archiving} className="sm:ml-auto">
            {venue.archived_at
              ? <><ArchiveRestore aria-hidden="true" className="size-4" />{fr.venueRestore}</>
              : <><Archive aria-hidden="true" className="size-4" />{fr.venueArchive}</>}
          </Button>
        </div>
        <EventNames events={held} />
        {venue.archived_at && <Notice tone="info">{fr.venueArchivedHint}</Notice>}
      </div>
      <VenuePlan
        venueId={venueId}
        locationId={locationId}
        onLocationChange={onLocationChange}
        onVenueChange={async () => { await load(); await onVenueChange(); }}
      />
    </section>
  );
};

// The Sites tab (#146): every venue with its capacity and the events held there; a venue's page
// edits it. Venues are archived, never deleted; an archived one isn't offered for an event (#147).
export const AdminVenues = ({ venueId, ...props }) => (
  venueId ? <VenuePage key={venueId} venueId={venueId} {...props} /> : <VenueList events={props.events} onOpen={props.onOpen} />
);
