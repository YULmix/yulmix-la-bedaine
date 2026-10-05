import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import fr from '../../locales/fr.json';
import { ACCOMMODATION_OPTIONS, getOptionLabel } from '../../lib/registrationOptions';
import { ACCOMMODATION_ICONS } from '../accommodationIcons';
import { useRememberedToggle } from '../../hooks/useRememberedToggle';
import { Card, Stat, cx } from '../ui';

// Remembered per device; the card opens collapsed.
const OPEN_KEY = 'bedaine:logistics-summary-open';

const TONES = { ok: 'text-ok', warn: 'text-warn' };

// One count of the collapsed line: label then value, same markup as Stat's.
const InlineCount = ({ label, value, tone }) => (
  <div className="flex items-baseline gap-1.5">
    <p className="text-sm text-muted">{label}</p>
    <p className={cx('font-data text-base font-medium', TONES[tone] || 'text-ink')}>{value}</p>
  </div>
);

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
    <td className={cx('py-2 text-center font-data', demandTone(requested, capacity))}>
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
  const [open, toggle] = useRememberedToggle(OPEN_KEY, false);
  const bodyId = useId();
  const placedStat = { label: fr.logisticsSummaryPlaced, value: placed };
  const toPlaceStat = { label: fr.logisticsSummaryToPlace, value: stats.unassigned, tone: stats.unassigned ? 'warn' : 'ok' };
  const capacityStat = { label: fr.logisticsSummaryCapacity, value: capacity };
  const overbookedStat = { label: fr.logisticsSummaryOverbooked, value: stats.overbooked.length, tone: stats.overbooked.length ? 'warn' : undefined };
  const figures = [placedStat, toPlaceStat, capacityStat, overbookedStat];
  return (
    <Card aria-labelledby="logistics-summary-title" className="p-5 sm:p-6">
      <h3 id="logistics-summary-title" className="text-lg font-semibold text-ink">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${fr.occupancyTitle} – ${open ? fr.logisticsSummaryHide : fr.logisticsSummaryShow}`}
          onClick={toggle}
          className="-my-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-lg py-2 text-left"
        >
          <span>{fr.occupancyTitle}</span>
          <ChevronDown aria-hidden="true" className={cx('size-5 shrink-0 text-faint transition-transform duration-150', open && 'rotate-180')} />
        </button>
      </h3>
      {hasUnsaved && <p className="mt-1 text-sm text-warn">{fr.logisticsSummaryUnsaved}</p>}
      {open ? (
        <div id={bodyId} className="mt-2">
          <div className="grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
            {figures.map(figure => <Stat key={figure.label} {...figure} />)}
          </div>
      {/* As wide as its content, not the card: each count stays next to its type. */}
      <table className="mt-5 w-auto text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th scope="col" className="pb-1.5 pr-10 font-semibold">{fr.logisticsSummaryTypeHeader}</th>
            <th scope="col" className="w-40 pb-1.5 text-center font-semibold">{fr.logisticsSummaryDemandHeader}</th>
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
        </div>
      ) : (
        <div id={bodyId} className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
          {figures.map(figure => <InlineCount key={figure.label} {...figure} />)}
        </div>
      )}
    </Card>
  );
};

export default LogisticsSummary;
