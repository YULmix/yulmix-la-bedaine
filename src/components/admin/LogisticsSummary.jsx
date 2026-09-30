import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { ACCOMMODATION_ICONS } from '../accommodationIcons';
import { Card, Stat, cx } from '../ui';

// French counts zero in the singular: « 0 demandé », « 0 place ».
const count = (n, key) => fr[`${key}${n <= 1 ? 'One' : 'Other'}`].replace('{count}', n);

// Demand against supply as « 26/12 »: amber when more people asked than there are places, green
// when it fits, faint when nobody asked. Screen readers get the words.
const demandTone = (requested, capacity) => {
  if (!requested) return 'text-faint';
  if (capacity == null) return 'text-muted';
  return requested > capacity ? 'text-warn' : 'text-ok';
};

const TypeRow = ({ icon: Icon, label, requested, capacity }) => (
  <tr>
    <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
      <span className="flex min-w-0 items-center gap-2">
        {Icon
          ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" strokeWidth={1.75} />
          : <span aria-hidden="true" className="size-4 shrink-0" />}
        <span className="truncate">{label}</span>
      </span>
    </th>
    <td className={cx('py-2 text-right font-data', demandTone(requested, capacity))}>
      <span aria-hidden="true">{`${requested}/${capacity ?? '–'}`}</span>
      <span className="sr-only">
        {count(requested, 'logisticsRequested')}
        {capacity != null && `, ${count(capacity, 'logisticsPlaces')}`}
      </span>
    </td>
  </tr>
);

// The Logistique tab's header (#166). `stats` is computePlaceStats() with the unsaved changes, so
// the totals move as places are picked; `demand` is placeDemandByType(), which they don't move.
const LogisticsSummary = ({ stats, demand, hasUnsaved }) => {
  const placed = stats.locations.reduce((sum, location) => sum + location.assigned, 0);
  const capacity = stats.locations.reduce((sum, location) => sum + location.capacity, 0);
  return (
    <Card aria-labelledby="logistics-summary-title" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="logistics-summary-title" className="text-lg font-semibold text-ink">{fr.occupancyTitle}</h3>
        {hasUnsaved && <p className="text-sm text-warn">{fr.logisticsSummaryUnsaved}</p>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label={fr.logisticsSummaryPlaced} value={placed} />
        <Stat label={fr.logisticsSummaryToPlace} value={stats.unassigned} tone={stats.unassigned ? 'warn' : 'ok'} />
        <Stat label={fr.logisticsSummaryCapacity} value={capacity} />
        <Stat label={fr.logisticsSummaryOverbooked} value={stats.overbooked.length} tone={stats.overbooked.length ? 'warn' : undefined} />
      </div>
      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="pb-1.5 font-semibold">{fr.logisticsSummaryTypeHeader}</th>
            <th scope="col" className="pb-1.5 text-right font-semibold">{fr.logisticsSummaryDemandHeader}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {demand.types.map(row => (
            <TypeRow
              key={row.type}
              icon={ACCOMMODATION_ICONS[row.type]}
              label={getOptionLabel(ACCOMMODATION_OPTIONS, row.type)}
              requested={row.requested}
              capacity={row.capacity}
            />
          ))}
          {demand.noPreference > 0 && <TypeRow label={fr.logisticsSummaryNoPreference} requested={demand.noPreference} />}
        </tbody>
      </table>
    </Card>
  );
};

export default LogisticsSummary;
