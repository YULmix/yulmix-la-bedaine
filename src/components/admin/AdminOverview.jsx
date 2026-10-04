import { useMemo } from 'react';
import fr from '../../locales/fr.json';
import { formatCurrency } from '../../lib/format';
import { computeAdminStats, computePlaceStats } from '../../lib/adminStats';
import { attendeePrice, calculateBreakEvenPrice, priceRatiosOf, totalPriceShares } from '../../lib/pricingEngine';
import { ACCOMMODATION_OPTIONS, DIETARY_OPTIONS, TIER_OPTIONS, getOptionLabel, isActiveRegistration } from '../../lib/registrationOptions';
import { Card, Stat } from '../ui';
import EmailProblems from './EmailProblems';
import PlaceOccupancy, { OverbookedPlaces } from './PlaceOccupancy';

// Horizontal bars without a background track: the number is the information, the bar is the
// shape. Widths are relative to the largest value in the list.
const BarList = ({ rows, emptyLabel }) => {
  const max = Math.max(...rows.map(row => row.value), 1);
  if (!rows.length) return <p className="text-sm text-faint">{emptyLabel}</p>;
  return (
    <ul className="space-y-3">
      {rows.map(row => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted">{row.label}</span>
            <span className="font-data text-ink">{row.value}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-neon/80" style={{ width: `${Math.max((row.value / max) * 100, 4)}%` }} />
        </li>
      ))}
    </ul>
  );
};

const TIER_LABEL_KEYS = {
  adult_whole: 'exportAdultWhole',
  adult_main: 'exportAdultMain',
  teen_whole: 'exportTeenWhole',
  teen_main: 'exportTeenMain',
  kids: 'exportKids'
};

// `budget` is the event's admin-only event_budgets row, or null when none was saved yet. `places`
// are the event's sleeping places (the event places module's `available`, #193); without any, the bed counts stand in.
// `showBudget` false (Comité, #217) leaves the budget card out. Without `onOpenParty`, the email
// problems name their parties without opening them.
// `showEmailProblems` false (Comité) leaves out the emails to follow up.
const AdminOverview = ({ event, budget, showBudget = true, showEmailProblems = true, parties, places, onOpenParty }) => {
  const stats = useMemo(() => computeAdminStats(parties), [parties]);
  const placeStats = useMemo(() => (places.length ? computePlaceStats(parties, places) : null), [parties, places]);
  const receivedShare = stats.totalDue > 0 ? stats.received / stats.totalDue : 0;
  const capacity = event?.max_attendees || 0;

  const ratios = useMemo(() => priceRatiosOf(event), [event]);

  const tierPrices = useMemo(() => {
    const sellingPrice = Number(event?.selling_price_whole_event);
    if (!sellingPrice) return [];
    return [
      ...TIER_OPTIONS.filter(opt => opt.type !== 'Kid').map(opt => ({ label: opt.label, attendee: opt })),
      { label: fr.tierNewbieLabel, attendee: { type: 'Adult', participation: 'Whole', isNewMember: true } },
      ...TIER_OPTIONS.filter(opt => opt.type === 'Kid').map(opt => ({ label: opt.label, attendee: opt }))
    ].map(tier => ({ label: tier.label, price: attendeePrice(tier.attendee, sellingPrice, ratios) }));
  }, [event?.selling_price_whole_event, ratios]);

  const totalCost = Number(budget?.total_cost) || 0;
  const margin = totalCost ? stats.totalDue - totalCost : null;
  // The base price at which the people registered so far would cover the budget (#109).
  const breakEvenPrice = useMemo(() => {
    const attendees = parties.filter(isActiveRegistration).flatMap(party => party.attendees || []);
    return calculateBreakEvenPrice(totalCost, Number(budget?.contingency_pct ?? 20), totalPriceShares(attendees, ratios));
  }, [parties, totalCost, budget?.contingency_pct, ratios]);

  // Columns follow the page's own width (container queries), not the window's: the admin
  // sidebar takes 15rem of it from md up.
  return (
    <div className="@container space-y-6">

      {showEmailProblems && <EmailProblems eventId={event?.id} parties={parties} onOpenParty={onOpenParty} />}
      {placeStats && <OverbookedPlaces places={placeStats.overbooked} />}

      {/* KPI strip: one ruled row, not a grid of identical cards. */}
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4">
        <div className="bg-surface p-5">
          <Stat label={fr.kpiPeople} value={stats.people} hint={capacity ? fr.kpiCapacity.replace('{max}', capacity) : undefined} />
        </div>
        <div className="bg-surface p-5">
          <Stat label={fr.registeredGroupsStatLabel} value={stats.parties} hint={stats.waitlistedParties ? fr.kpiWaitlisted.replace('{count}', stats.waitlistedParties) : undefined} />
        </div>
        <div className="bg-surface p-5">
          <Stat label={fr.kpiPaidGroups} value={`${stats.paidParties}/${stats.parties}`} tone={stats.parties && stats.paidParties === stats.parties ? 'ok' : undefined} />
        </div>
        <div className="bg-surface p-5">
          <Stat label={fr.kpiNewMembers} value={stats.newMembers} />
        </div>
      </Card>

      <div className={showBudget ? 'grid gap-6 @4xl:grid-cols-[3fr_2fr]' : 'grid gap-6'}>
        {showBudget && (
          <Card className="space-y-6 p-5 sm:p-6">
            <h3 className="text-lg font-semibold text-ink">{fr.budgetTitle}</h3>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
              <Stat label={fr.budgetTotalAmountDue} value={formatCurrency(stats.totalDue)} />
              <Stat label={fr.budgetAmountReceived} value={formatCurrency(stats.received)} tone="ok" />
              <Stat label={fr.budgetAmountToReceive} value={formatCurrency(stats.outstanding)} tone={stats.outstanding > 0 ? 'warn' : undefined} />
            </div>
            <div>
              <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={fr.budgetBarLabel.replace('{percent}', Math.round(receivedShare * 100))}>
                <span className="bg-ok" style={{ width: `${receivedShare * 100}%` }} />
                <span className="flex-1 bg-warn/70" />
              </div>
              <p className="mt-2 text-sm text-faint">{fr.budgetBarLabel.replace('{percent}', Math.round(receivedShare * 100))}</p>
            </div>
            <dl className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted">{fr.budgetTotalCost}</dt>
                <dd className="font-data text-lg text-ink">{totalCost ? formatCurrency(totalCost) : fr.notSpecified}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{fr.budgetMargin}</dt>
                <dd className={`font-data text-lg ${margin === null ? 'text-faint' : margin >= 0 ? 'text-ok' : 'text-bad'}`}>
                  {margin === null ? fr.notSpecified : formatCurrency(margin)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{fr.breakEvenPriceLabel}</dt>
                <dd className="font-data text-lg text-ink">{breakEvenPrice ? formatCurrency(breakEvenPrice) : fr.notSpecified}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">{fr.eventSellingPriceLabel}</dt>
                <dd className="font-data text-lg text-ink">{event?.selling_price_whole_event ? formatCurrency(event.selling_price_whole_event) : fr.notSpecified}</dd>
              </div>
            </dl>
          </Card>
        )}

        <Card className="p-5 sm:p-6">
          <h3 className="text-lg font-semibold text-ink">{fr.costVsPriceTitle}</h3>
          {tierPrices.length ? (
            <ul className="mt-4 divide-y divide-line">
              {tierPrices.map(tier => (
                <li key={tier.label} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm text-muted">{tier.label}</span>
                  <span className="font-data text-ink">{formatCurrency(tier.price)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-sm text-faint">{fr.notSpecified}</p>}
        </Card>
      </div>

      <div className="grid gap-6 @xl:grid-cols-2 @3xl:grid-cols-3">
        <Card className="p-5 sm:p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">{fr.kpiTiersTitle}</h3>
          <BarList
            emptyLabel={fr.adminNoData}
            rows={Object.entries(stats.tiers).filter(([, value]) => value > 0).map(([key, value]) => ({ key, value, label: fr[TIER_LABEL_KEYS[key]] }))}
          />
        </Card>
        <Card className="p-5 sm:p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">{fr.accommodation}</h3>
          <BarList
            emptyLabel={fr.adminNoData}
            rows={ACCOMMODATION_OPTIONS.filter(opt => stats.accommodation[opt.value]).map(opt => ({ key: opt.value, value: stats.accommodation[opt.value], label: opt.label }))}
          />
          {!placeStats && stats.bedRequests > 0 && (
            <p className="mt-4 text-sm text-faint">{fr.kpiBedsAssigned.replace('{assigned}', stats.bedsAssigned).replace('{requested}', stats.bedRequests)}</p>
          )}
        </Card>
        <Card className="p-5 sm:p-6">
          <h3 className="mb-4 text-lg font-semibold text-ink">{fr.foodPreferences}</h3>
          <BarList
            emptyLabel={fr.adminNoData}
            rows={Object.entries(stats.dietary).sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, value, label: getOptionLabel(DIETARY_OPTIONS, key) }))}
          />
        </Card>
      </div>

      {placeStats && <PlaceOccupancy stats={placeStats} />}
    </div>
  );
};

export default AdminOverview;
