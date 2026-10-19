import { TriangleAlert, Users } from 'lucide-react';
import fr from '../../locales/fr.json';
import { useRememberedToggle } from '../../hooks/useRememberedToggle';
import { plural } from '../../lib/eventDisplay';
import { ACCOMMODATION_OPTIONS, getAttendeeTypeLabel, getOptionLabel } from '../../lib/registrationOptions';
import { ACCOMMODATION_ICONS } from '../accommodationIcons';
import { Button, Card, Notice, Tag, cx } from '../ui';

// A place's chip says at a glance whether it has room: outlined in green while it does, greyed
// out once full, amber when overbooked.
const chipTone = ({ assigned, capacity }) => {
  if (assigned > capacity) return { chip: 'border-warn/50 tint-warn text-warn', count: 'text-warn' };
  if (assigned === capacity) return { chip: 'border-transparent bg-raised text-muted', count: 'text-faint' };
  return { chip: 'border-ok/40 text-ink', count: 'text-ok' };
};

const CHIP = 'inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-2 text-sm';

// A place's chip: type icon, label, assigned/capacity. `as` is the element (a list item in the
// compact view, the header of a place's block in the detailed one).
const PlaceChip = ({ place, as: Component = 'li', className }) => {
  const Icon = ACCOMMODATION_ICONS[place.type];
  const tone = chipTone(place);
  return (
    <Component className={cx(CHIP, tone.chip, className)}>
      {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />}
      <span className="sr-only">{`${getOptionLabel(ACCOMMODATION_OPTIONS, place.type)}, `}</span>
      {place.label}
      <span className={cx('font-data text-xs', tone.count)}>{`${place.assigned}/${place.capacity}`}</span>
    </Component>
  );
};

// The detailed view (#303): each place's chip, then who sleeps there, by party. An empty place
// has its chip only.
const PlaceBlock = ({ place }) => (
  <li className="min-w-0">
    <PlaceChip place={place} as="div" />
    {place.occupants.length > 0 && (
      <ul className="mt-1.5 space-y-0.5 pl-2.5 text-sm text-muted">
        {place.occupants.map(occupant => (
          <li key={occupant.id} className="break-words">
            {fr.occupantLine.replace('{name}', occupant.name || fr.participantFallback).replace('{type}', getAttendeeTypeLabel(occupant.type))}
          </li>
        ))}
      </ul>
    )}
  </li>
);

// Remembered on this device; off the first time: the compact chips.
const OCCUPANTS_KEY = 'bedaine:overview-occupants-shown';

// Vue d'ensemble (#115), for an event with sleeping locations: one row per location, its places
// as chips flowing across the width, and how many attendees still have no place. The toggle
// (#303) lists who sleeps in each place under its chip, places in columns.
// `stats` is computePlaceStats().
const PlaceOccupancy = ({ stats }) => {
  const [showOccupants, toggleOccupants] = useRememberedToggle(OCCUPANTS_KEY, false);
  const assigned = stats.locations.reduce((sum, location) => sum + location.assigned, 0);
  const capacity = stats.locations.reduce((sum, location) => sum + location.capacity, 0);
  return (
    <Card className="p-5 sm:p-6">
      {/* On a phone the toggle shares the title's row and the totals go under them; from sm up,
          title, totals, toggle. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 className="mr-auto text-lg font-semibold text-ink">{fr.occupancyTitle}</h3>
        <div className="order-last flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted sm:order-none sm:w-auto">
          <span><span className="font-data text-ink">{`${assigned}/${capacity}`}</span>{` ${fr.occupancyTaken}`}</span>
          {stats.unassigned > 0
            ? <Tag tone="warn">{plural(stats.unassigned, 'occupancyUnassignedOne', 'occupancyUnassignedOther')}</Tag>
            : <Tag tone="ok">{fr.occupancyAllPlaced}</Tag>}
        </div>
        {/* Icon only, as « Épingler le plan » (#293): neon while the names show. */}
        <Button variant="secondary" size="icon" aria-pressed={showOccupants} aria-label={fr.occupantsToggle} title={fr.occupantsToggle}
          onClick={toggleOccupants} className={cx(showOccupants && 'border-neon bg-raised text-neon')}>
          <Users aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {stats.locations.map(location => (
          <li key={location.id} className="grid gap-x-6 gap-y-2 py-3 last:pb-0 sm:grid-cols-[12rem_1fr] sm:items-baseline">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="min-w-0 truncate font-semibold text-ink">{location.name}</h4>
              <span className={cx('font-data text-sm', location.assigned > location.capacity ? 'text-warn' : 'text-muted')}>
                {`${location.assigned}/${location.capacity}`}
              </span>
            </div>
            {showOccupants
              ? (
                <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
                  {location.places.map(place => <PlaceBlock key={place.id} place={place} />)}
                </ul>
              )
              : (
                <ul className="flex flex-wrap gap-1.5">
                  {location.places.map(place => <PlaceChip key={place.id} place={place} />)}
                </ul>
              )}
          </li>
        ))}
      </ul>
    </Card>
  );
};

/** The places holding more people than their capacity, listed. Absent when there are none. */
export const OverbookedPlaces = ({ places }) => {
  if (!places.length) return null;
  return (
    <Notice tone="warn" icon={TriangleAlert} title={plural(places.length, 'overbookedTitleOne', 'overbookedTitleOther')}>
      <ul className="space-y-0.5">
        {places.map(place => (
          <li key={place.id}>
            {fr.overbookedPlace
              .replace('{location}', place.locationName)
              .replace('{place}', place.label)
              .replace('{taken}', place.assigned)
              .replace('{capacity}', place.capacity)}
          </li>
        ))}
      </ul>
    </Notice>
  );
};

export default PlaceOccupancy;
