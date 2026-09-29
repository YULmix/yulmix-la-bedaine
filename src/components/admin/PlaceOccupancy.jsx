import { ArrowRight, TriangleAlert } from 'lucide-react';
import fr from '../../locales/fr.json';
import { plural } from '../../lib/eventDisplay';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { Card, Notice, Stat } from '../ui';

const fill = (assigned, capacity) => (capacity > 0 ? Math.min(assigned / capacity, 1) : 0);

// Vue d'ensemble (#115), for an event with sleeping locations: each location's occupancy, its
// places on expand, and how many attendees still have no place. `stats` is computePlaceStats().
const PlaceOccupancy = ({ stats }) => (
  <Card className="p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <h3 className="text-lg font-semibold text-ink">{fr.occupancyTitle}</h3>
      <Stat label={fr.occupancyUnassigned} value={stats.unassigned} tone={stats.unassigned > 0 ? 'warn' : 'ok'} />
    </div>
    <ul className="mt-4 space-y-2">
      {stats.locations.map(location => (
        <li key={location.id}>
          <details className="group rounded-control border border-line bg-night/60">
            <summary className="flex min-h-11 cursor-pointer flex-col gap-2 px-4 py-3">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-2 font-semibold text-ink">
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-faint transition group-open:rotate-90" />
                  {location.name}
                </span>
                <span className="text-sm text-muted">
                  <span className="font-data text-ink">{`${location.assigned}/${location.capacity}`}</span>
                  {`, ${plural(location.left, 'occupancyLeftOne', 'occupancyLeftOther')}`}
                </span>
              </span>
              <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-raised">
                <span className={`block h-full rounded-full ${location.assigned > location.capacity ? 'bg-warn' : 'bg-neon/80'}`} style={{ width: `${fill(location.assigned, location.capacity) * 100}%` }} />
              </span>
            </summary>
            <ul className="divide-y divide-line border-t border-line px-4">
              {location.places.map(place => (
                <li key={place.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 text-muted">
                    {place.label}
                    <span className="text-faint">{`, ${getOptionLabel(ACCOMMODATION_OPTIONS, place.type)}`}</span>
                  </span>
                  <span className={`font-data ${place.assigned > place.capacity ? 'text-warn' : 'text-ink'}`}>{`${place.assigned}/${place.capacity}`}</span>
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  </Card>
);

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
