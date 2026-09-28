import { useMemo, useState } from 'react';
import { Calculator, Plus, Trash2, Wallet } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatCurrency } from '../../lib/format';
import {
  attendeePrice,
  calculateBreakEvenPrice,
  priceRatiosOf,
  simulateEventPricing,
  totalPriceShares
} from '../../lib/pricingEngine';
import { BUDGET_CATEGORIES, PAYMENT_STATUS, TIER_OPTIONS } from '../../lib/registrationOptions';
import { Button, Card, ConfirmDialog, Field, Input, Select, Stat } from '../ui';

// Expected-headcount groups of the simulator. Newbies are their own groups: they pay the main
// price whatever tier they pick, so they are not counted in the tier groups too.
const GROUPS = [
  { key: 'adultWhole', labelKey: 'scenarioAdultWholeCount', attendee: { type: 'Adult', participation: 'Whole' } },
  { key: 'adultMain', labelKey: 'scenarioAdultMainCount', attendee: { type: 'Adult', participation: 'Main' } },
  { key: 'teenWhole', labelKey: 'scenarioTeenWholeCount', attendee: { type: 'Teenager', participation: 'Whole' } },
  { key: 'teenMain', labelKey: 'scenarioTeenMainCount', attendee: { type: 'Teenager', participation: 'Main' } },
  { key: 'newAdults', labelKey: 'scenarioNewAdultsCount', attendee: { type: 'Adult', participation: 'Main', isNewMember: true } },
  { key: 'newTeens', labelKey: 'scenarioNewTeensCount', attendee: { type: 'Teenager', participation: 'Main', isNewMember: true } },
  { key: 'kids', labelKey: 'scenarioKidsCount', attendee: { type: 'Kid', participation: 'After-Party' } }
];

const groupOf = (attendee) => {
  if (attendee.type === 'Adult') return attendee.is_new_member ? 'newAdults' : attendee.participation === 'Whole' ? 'adultWhole' : 'adultMain';
  if (attendee.type === 'Teenager') return attendee.is_new_member ? 'newTeens' : attendee.participation === 'Whole' ? 'teenWhole' : 'teenMain';
  return 'kids';
};

// Headcount of the active registrations, per simulator group.
export const headcountOf = (parties) => {
  const counts = Object.fromEntries(GROUPS.map(group => [group.key, 0]));
  parties.forEach(party => (party.attendees || []).forEach(attendee => { counts[groupOf(attendee)] += 1; }));
  return counts;
};

// Ratios are edited as percentages: 53.75 reads better than 0.5375.
const toPct = (ratio) => String(Math.round(ratio * 10000) / 100);
const fromPct = (pct) => {
  const value = parseFloat(pct);
  return Number.isFinite(value) && value > 0 && value <= 100 ? Math.round(value * 100) / 10000 : null;
};
const toPrice = (text) => {
  const value = parseFloat(text);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const sumLines = (lines) => lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

// Budget lines and contingency. `draft` holds unsaved edits (kept by the parent, so they survive
// switching tabs); null means "as saved".
const BudgetEditor = ({ budget, draft, onDraftChange, onSave, saving }) => {
  const lines = draft?.lines ?? budget?.lines ?? [];
  const contingency = draft?.contingency ?? String(budget?.contingency_pct ?? 20);
  const edit = (patch) => onDraftChange({ lines, contingency, ...patch });
  const editLine = (index, field, value) => edit({ lines: lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)) });

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Wallet aria-hidden="true" className="mt-1 size-5 shrink-0 text-neon" strokeWidth={1.75} />
        <div>
          <h3 className="text-lg font-semibold text-ink">{fr.budgetLinesTitle}</h3>
          <p className="mt-1 text-sm text-muted">{fr.budgetLinesSubtitle}</p>
        </div>
      </div>

      <ul className="mt-5 space-y-3">
        {lines.map((line, index) => (
          <li key={index} className="grid grid-cols-[1fr_7rem_auto] gap-2 sm:grid-cols-[10rem_1fr_8rem_auto]">
            <Select
              aria-label={fr.budgetLineCategory}
              value={line.category}
              onChange={e => editLine(index, 'category', e.target.value)}
            >
              {BUDGET_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
            </Select>
            <Input
              aria-label={fr.budgetLineDescription}
              placeholder={fr.budgetLineDescription}
              value={line.description ?? ''}
              onChange={e => editLine(index, 'description', e.target.value)}
              className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto"
            />
            <Input
              aria-label={fr.budgetLineAmount}
              placeholder={fr.budgetLineAmount}
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={line.amount ?? ''}
              onChange={e => editLine(index, 'amount', e.target.value)}
              className="font-data"
            />
            <Button variant="ghost" size="icon" onClick={() => edit({ lines: lines.filter((_, i) => i !== index) })} aria-label={fr.budgetLineRemove}>
              <Trash2 aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => edit({ lines: [...lines, { category: 'Other', description: '', amount: '' }] })}>
        <Plus aria-hidden="true" className="size-4" />{fr.budgetLineAdd}
      </Button>

      <div className="mt-5 space-y-5 border-t border-line pt-5">
        <Field label={fr.budgetContingencyLabel} hint={fr.budgetContingencyHint} className="max-w-xs">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} type="number" min="0" max="100" step="1" inputMode="decimal" className="font-data" value={contingency} onChange={e => edit({ contingency: e.target.value })} />
          )}
        </Field>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Stat label={fr.budgetTotalCost} value={formatCurrency(sumLines(lines))} />
          <Button onClick={() => onSave(lines, contingency)} disabled={!draft} loading={saving}>
            {fr.budgetSave}
          </Button>
        </div>
      </div>
    </Card>
  );
};

// What-if pricing: expected headcount, a base price and main-event ratio to try, the break-even base price
// for the budget, and "apply", which saves the price and ratio (and so reprices unpaid parties).
const PricingSimulator = ({ event, parties, totalCost, contingencyPct, onApply }) => {
  const saved = priceRatiosOf(event);
  const savedPrice = Number(event?.selling_price_whole_event) || 0;
  const [counts, setCounts] = useState(() => headcountOf(parties));
  const [tried, setTried] = useState(() => ({
    price: savedPrice ? String(savedPrice) : '',
    mainWhole: toPct(saved.mainWhole)
  }));
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);

  const price = toPrice(tried.price);
  const mainWhole = fromPct(tried.mainWhole);
  const valid = price !== null && mainWhole !== null;
  const ratios = valid ? { mainWhole } : saved;

  const attendees = useMemo(
    () => GROUPS.flatMap(group => Array(counts[group.key] || 0).fill(group.attendee)),
    [counts]
  );
  const breakEven = calculateBreakEvenPrice(totalCost, contingencyPct, totalPriceShares(attendees, ratios));
  const revenue = valid ? simulateEventPricing([{ id: 'sim', attendees }], price, ratios).calculated_amount_owed : 0;
  const margin = revenue - totalCost;
  const unchanged = valid && price === savedPrice && mainWhole === saved.mainWhole;
  const unpaidCount = parties.filter(party => party.payment_status !== PAYMENT_STATUS.PAID).length;

  const tierPrices = valid ? [
    ...TIER_OPTIONS.filter(opt => opt.type !== 'Kid').map(opt => ({ label: opt.label, attendee: opt })),
    { label: fr.tierNewbieLabel, attendee: { type: 'Adult', participation: 'Whole', isNewMember: true } }
  ].map(tier => ({ label: tier.label, price: attendeePrice(tier.attendee, price, ratios) })) : [];

  const apply = async () => {
    setApplying(true);
    try {
      await onApply({ selling_price_whole_event: price, ratio_main_whole: mainWhole });
    } finally {
      setApplying(false);
      setConfirming(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Calculator aria-hidden="true" className="mt-1 size-5 shrink-0 text-neon" strokeWidth={1.75} />
        <div>
          <h3 className="text-lg font-semibold text-ink">{fr.scenarioSimulatorTitle}</h3>
          <p className="mt-1 text-sm text-muted">{fr.scenarioSimulatorSubtitle}</p>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-muted">{fr.scenarioHeadcountLegend}</legend>
        <div className="mt-3 grid grid-cols-2 items-end gap-4 sm:grid-cols-4">
          {GROUPS.map(group => (
            <Field key={group.key} label={fr[group.labelKey]}>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  className="font-data"
                  value={counts[group.key]}
                  onChange={e => setCounts(prev => ({ ...prev, [group.key]: Math.max(parseInt(e.target.value, 10) || 0, 0) }))}
                />
              )}
            </Field>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setCounts(headcountOf(parties))}>
          {fr.scenarioResetHeadcount}
        </Button>
      </fieldset>

      <fieldset className="mt-5 border-t border-line pt-5">
        <legend className="sr-only">{fr.scenarioPricingLegend}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={fr.eventSellingPriceLabel} hint={fr.sellingPriceHint}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="number" min="0" step="1" inputMode="decimal" className="font-data" value={tried.price} onChange={e => setTried(prev => ({ ...prev, price: e.target.value }))} />
            )}
          </Field>
          <Field label={fr.ratioMainWholeLabel} hint={fr.ratioMainWholeHint}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="number" min="0" max="100" step="0.01" inputMode="decimal" className="font-data" value={tried.mainWhole} onChange={e => setTried(prev => ({ ...prev, mainWhole: e.target.value }))} />
            )}
          </Field>
        </div>
        {!valid && <p className="mt-2 text-sm text-bad">{fr.scenarioInvalidPricing}</p>}
      </fieldset>

      <div aria-live="polite" className="mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-3">
        <div>
          <Stat label={fr.breakEvenPriceLabel} value={breakEven ? formatCurrency(breakEven) : '—'} tone="neon" />
          {breakEven > 0 && (
            <Button variant="ghost" size="sm" className="mt-1 -ml-3" onClick={() => setTried(prev => ({ ...prev, price: String(breakEven) }))}>
              {fr.scenarioUseBreakEven}
            </Button>
          )}
        </div>
        <Stat label={fr.scenarioProjectedRevenue} value={formatCurrency(revenue)} />
        <Stat label={fr.budgetMargin} value={formatCurrency(margin)} tone={margin >= 0 ? 'ok' : 'bad'} />
      </div>

      {tierPrices.length > 0 && (
        <ul className="mt-5 divide-y divide-line border-t border-line">
          {tierPrices.map(tier => (
            <li key={tier.label} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm text-muted">{tier.label}</span>
              <span className="font-data text-ink">{formatCurrency(tier.price)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-line pt-5">
        <Button onClick={() => setConfirming(true)} disabled={!valid || unchanged}>{fr.scenarioApply}</Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={fr.scenarioApplyConfirmTitle}
        confirmLabel={fr.scenarioApply}
        tone="primary"
        loading={applying}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      >
        {fr.scenarioApplyConfirm
          .replace('{price}', valid ? formatCurrency(price) : '')
          .replace('{mainWhole}', tried.mainWhole)
          .replace('{count}', unpaidCount)}
      </ConfirmDialog>
    </Card>
  );
};

// The "Budget" admin tab (#109): the active event's costs and the simulator used to set its base
// price. `parties` are the active (not cancelled) registrations.
const AdminBudget = ({ event, budget, draft, parties, onDraftChange, onSaveBudget, savingBudget, onApplyPricing }) => {
  // The simulator follows the lines being edited, saved or not.
  const totalCost = draft ? sumLines(draft.lines) : Number(budget?.total_cost) || 0;
  const contingencyPct = Number(draft?.contingency ?? budget?.contingency_pct ?? 20) || 0;
  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold text-ink">{fr.adminTabBudget}</h2>
      <div className="grid gap-6">
        <BudgetEditor budget={budget} draft={draft} onDraftChange={onDraftChange} onSave={onSaveBudget} saving={savingBudget} />
        {/* Keyed on the saved price and ratio, so applying them resets the tried values. */}
        <PricingSimulator
          key={`${event.selling_price_whole_event}-${event.ratio_main_whole}`}
          event={event}
          parties={parties}
          totalCost={totalCost}
          contingencyPct={contingencyPct}
          onApply={onApplyPricing}
        />
      </div>
    </section>
  );
};

export default AdminBudget;
