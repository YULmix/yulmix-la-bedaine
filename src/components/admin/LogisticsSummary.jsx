import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { ACCOMMODATION_ICONS } from '../accommodationIcons';
import { Card, Stat, cx } from '../ui';

// French counts zero in the singular: « 0 demandé », « 0 place ».
const count = (n, key) => fr[`${key}${n <= 1 ? 'One' : 'Other'}`].replace('{count}', n);

const TypeRow = ({ icon: Icon, label, requested, capacity }) => (
  <li className="flex items-baseline justify-between gap-3 py-2">
    <span className="flex min-w-0 items-center gap-2 text-ink">
      {Icon
        ? <Icon aria-hidden="true" className="size-4 shrink-0 self-center text-muted" strokeWidth={1.75} />
        : <span aria-hidden="true" className="size-4 shrink-0" />}
      <span className="truncate">{label}</span>
    </span>
    <span className={cx('shrink-0 text-right font-data text-sm', capacity != null && requested > capacity ? 'text-warn' : 'text-muted')}>
      {count(requested, 'logisticsRequested')}
      {capacity != null && ` · ${count(capacity, 'logisticsPlaces')}`}
    </span>
  </li>
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
      <h4 className="mt-5 text-sm font-semibold text-muted">{fr.logisticsSummaryByType}</h4>
      <ul className="mt-1 divide-y divide-line">
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
      </ul>
    </Card>
  );
};

export default LogisticsSummary;
