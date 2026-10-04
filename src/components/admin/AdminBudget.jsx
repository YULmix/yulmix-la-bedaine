import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, BadgeDollarSign, Calculator, ChevronDown, Plus, Receipt, Trash2 } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatCurrency } from '../../lib/format';
import { resolvePayers } from '../../lib/budget';
import { payerOptions } from '../../lib/budgetPayers';
import {
  attendeePrice,
  calculateBreakEvenPrice,
  priceRatiosOf,
  simulateEventPricing,
  totalPriceShares
} from '../../lib/pricingEngine';
import { BUDGET_CATEGORIES, PAYMENT_STATUS, TIER_OPTIONS } from '../../lib/registrationOptions';
import PayerPicker from './PayerPicker';
import { Button, Card, ConfirmDialog, Field, Input, Select, Stat, Tag, cx } from '../ui';

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

const formatPct = (ratio) => `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 }).format(ratio * 100)} %`;

const sumLines = (lines) => lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

// A card with an icon, a title and a subtitle. A collapsible one has its title as a disclosure
// button (inside the heading, per the WAI-ARIA accordion pattern) and shows `summary` next to it,
// so the key figure stays visible while it is closed.
const Section = ({ icon: Icon, title, subtitle, summary, collapsible = false, children }) => {
  const [open, setOpen] = useState(!collapsible);
  const bodyId = useId();
  // On a phone the summary goes under the title rather than squeezing it.
  const titleRow = (
    <span className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold text-ink">{title}</span>
        {subtitle && <span className="mt-1 block text-sm font-normal text-muted">{subtitle}</span>}
      </span>
      {summary && <span className="shrink-0 sm:text-right">{summary}</span>}
    </span>
  );
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-neon" strokeWidth={1.75} />
        <h3 className="min-w-0 flex-1">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen(value => !value)}
              className="flex w-full items-start gap-3 rounded-lg text-left"
            >
              {titleRow}
              <ChevronDown aria-hidden="true" className={cx('mt-1 size-5 shrink-0 text-faint transition-transform duration-150', open && 'rotate-180')} />
            </button>
          ) : (
            <span className="flex items-start gap-3">{titleRow}</span>
          )}
        </h3>
      </div>
      {open && <div id={bodyId} className="mt-5">{children}</div>}
    </Card>
  );
};

const SummaryFigure = ({ label, value, tone = 'text-ink' }) => (
  <>
    <span className="block text-xs font-normal text-faint">{label}</span>
    <span className={cx('block font-data text-base', tone)}>{value}</span>
  </>
);

// Budget lines and contingency. `draft` holds unsaved edits (kept by the parent, so they survive
// switching tabs); null means "as saved".
const BudgetEditor = ({ budget, draft, parties, onDraftChange, onSave, saving }) => {
  const lines = draft?.lines ?? budget?.lines ?? [];
  const contingency = draft?.contingency ?? String(budget?.contingency_pct ?? 20);
  const edit = (patch) => onDraftChange({ lines, contingency, ...patch });
  const payers = useMemo(() => payerOptions(parties), [parties]);
  // A payer who isn't in an active party (removed from it, or its party cancelled): resolved by id.
  const [resolved, setResolved] = useState(() => new Map());
  const unknownKey = lines
    .map(line => line.paid_by_attendee_id)
    .filter(id => id && !payers.some(payer => payer.id === id) && !resolved.has(id))
    .join(',');
  useEffect(() => {
    if (!unknownKey) return undefined;
    let cancelled = false;
    resolvePayers(unknownKey.split(',')).then((found) => {
      if (!cancelled) setResolved(previous => new Map([...previous, ...found]));
    });
    return () => { cancelled = true; };
  }, [unknownKey]);
  const payerOf = (id) => payers.find(payer => payer.id === id) ?? resolved.get(id) ?? null;
  const editLine = (index, field, value) => edit({ lines: lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)) });

  return (
    <Section
      icon={Receipt}
      title={fr.budgetLinesTitle}
      subtitle={fr.budgetLinesSubtitle}
      collapsible
      summary={(
        <>
          <SummaryFigure label={fr.budgetTotalCost} value={formatCurrency(sumLines(lines))} />
          {draft && <Tag tone="warn" className="mt-1">{fr.unsavedTag}</Tag>}
        </>
      )}
    >
      <ul className="space-y-3">
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
            <div className="col-span-3 row-start-3 sm:col-span-4 sm:row-start-auto sm:max-w-md">
              <span aria-hidden="true" className="mb-1 block text-xs text-faint">{fr.budgetLinePaidBy}</span>
              <PayerPicker
                label={fr.budgetLinePaidBy}
                options={payers}
                value={line.paid_by_attendee_id ?? null}
                selected={payerOf(line.paid_by_attendee_id)}
                onChange={id => editLine(index, 'paid_by_attendee_id', id)}
              />
            </div>
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
    </Section>
  );
};

const ChangedLabel = ({ text, changed }) => (
  <span className="inline-flex flex-wrap items-center gap-2">
    {text}
    {changed && <Tag tone="warn">{fr.modifiedTag}</Tag>}
  </span>
);

// The simulator (expected headcount → break-even base price, revenue, margin) and the pricing
// section (the base price and main-event % the event stores, and "Appliquer", which saves them for
// new registrations: existing ones keep the price they locked, #117). They share the values being
// tried, so they live together.
const Pricing = ({ event, parties, totalCost, contingencyPct, onApply }) => {
  const saved = priceRatiosOf(event);
  const savedPrice = Number(event?.selling_price_whole_event) || 0;
  const [counts, setCounts] = useState(() => headcountOf(parties));
  const [tried, setTried] = useState(() => ({
    price: savedPrice ? String(savedPrice) : '',
    mainWhole: toPct(saved.mainWhole)
  }));
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const priceInput = useRef(null);

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
  // Invalid input counts as changed: it is not what is saved.
  const priceChanged = price !== savedPrice;
  const ratioChanged = mainWhole !== saved.mainWhole;
  // Registrations made while the event had no price are the only ones a price change reaches.
  const unpricedCount = parties.filter(party =>
    party.payment_status !== PAYMENT_STATUS.PAID && !(Number(party.locked_selling_price_whole_event) > 0)
  ).length;

  const tierPrices = valid ? [
    ...TIER_OPTIONS.filter(opt => opt.type !== 'Kid').map(opt => ({ label: opt.label, attendee: opt })),
    { label: fr.tierNewbieLabel, attendee: { type: 'Adult', participation: 'Whole', isNewMember: true } }
  ].map(tier => ({ label: tier.label, price: attendeePrice(tier.attendee, price, ratios) })) : [];

  const copyBreakEven = () => {
    setTried(prev => ({ ...prev, price: String(breakEven) }));
    priceInput.current?.focus();
  };

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
    <>
      <Section
        icon={Calculator}
        title={fr.scenarioSimulatorTitle}
        subtitle={fr.scenarioSimulatorSubtitle}
        collapsible
        summary={<SummaryFigure label={fr.breakEvenPriceLabel} value={breakEven ? formatCurrency(breakEven) : '—'} tone="text-neon" />}
      >
        <fieldset>
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

        <div aria-live="polite" className="mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-3">
          <div>
            <Stat label={fr.breakEvenPriceLabel} value={breakEven ? formatCurrency(breakEven) : '—'} tone="neon" />
            {breakEven > 0 && (
              <Button variant="secondary" size="sm" className="mt-3" onClick={copyBreakEven}>
                <ArrowDownToLine aria-hidden="true" className="size-4" />{fr.scenarioUseBreakEven}
              </Button>
            )}
          </div>
          <Stat label={fr.scenarioProjectedRevenue} value={formatCurrency(revenue)} />
          <Stat label={fr.budgetMargin} value={formatCurrency(margin)} tone={margin >= 0 ? 'ok' : 'bad'} />
        </div>
      </Section>

      <Section icon={BadgeDollarSign} title={fr.pricingSectionTitle} subtitle={fr.pricingSectionSubtitle}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={<ChangedLabel text={fr.eventSellingPriceLabel} changed={priceChanged} />} hint={fr.sellingPriceHint}>
            {({ id, describedBy }) => (
              <Input ref={priceInput} id={id} aria-describedby={describedBy} type="number" min="0" step="1" inputMode="decimal" className="font-data" value={tried.price} onChange={e => setTried(prev => ({ ...prev, price: e.target.value }))} />
            )}
          </Field>
          <Field label={<ChangedLabel text={fr.ratioMainWholeLabel} changed={ratioChanged} />} hint={fr.ratioMainWholeHint}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="number" min="0" max="100" step="0.01" inputMode="decimal" className="font-data" value={tried.mainWhole} onChange={e => setTried(prev => ({ ...prev, mainWhole: e.target.value }))} />
            )}
          </Field>
        </div>
        {!valid && <p className="mt-2 text-sm text-bad">{fr.scenarioInvalidPricing}</p>}

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

        <div className="mt-5 flex justify-end border-t border-line pt-5">
          <Button onClick={() => setConfirming(true)} disabled={!valid || (!priceChanged && !ratioChanged)}>
            {fr.scenarioApply}
          </Button>
        </div>
      </Section>

      <ConfirmDialog
        open={confirming}
        title={fr.scenarioApplyConfirmTitle}
        confirmLabel={fr.scenarioApply}
        tone="primary"
        loading={applying}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      >
        {valid && (
          <ul className="space-y-3">
            {priceChanged && (
              <li>{fr.applyImpactPrice.replace('{before}', formatCurrency(savedPrice)).replace('{after}', formatCurrency(price))}</li>
            )}
            {ratioChanged && (
              <li>{fr.applyImpactRatio.replace('{before}', formatPct(saved.mainWhole)).replace('{after}', formatPct(mainWhole))}</li>
            )}
            <li>{fr.applyImpactExisting}</li>
            {savedPrice <= 0 && price > 0 && unpricedCount > 0 && (
              <li>{fr.applyImpactUnpriced.replace('{count}', unpricedCount)}</li>
            )}
          </ul>
        )}
      </ConfirmDialog>
    </>
  );
};

// The "Budget" admin tab (#109): what the weekend costs and the simulator (both collapsed by
// default, they only inform), then the price members pay, which is what gets saved.
// `parties` are the active (not cancelled) registrations.
const AdminBudget = ({ event, budget, draft, parties, onDraftChange, onSaveBudget, savingBudget, onApplyPricing }) => {
  // The simulator follows the lines being edited, saved or not.
  const totalCost = draft ? sumLines(draft.lines) : Number(budget?.total_cost) || 0;
  const contingencyPct = Number(draft?.contingency ?? budget?.contingency_pct ?? 20) || 0;
  return (
    <section className="space-y-6">
      <BudgetEditor budget={budget} draft={draft} parties={parties} onDraftChange={onDraftChange} onSave={onSaveBudget} saving={savingBudget} />
      {/* Keyed on the saved price and ratio, so applying them resets the tried values. */}
      <Pricing
        key={`${event.selling_price_whole_event}-${event.ratio_main_whole}`}
        event={event}
        parties={parties}
        totalCost={totalCost}
        contingencyPct={contingencyPct}
        onApply={onApplyPricing}
      />
    </section>
  );
};

export default AdminBudget;
