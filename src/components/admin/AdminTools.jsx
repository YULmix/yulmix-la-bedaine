import { Calculator, CheckCircle2, ClipboardCopy, Download, Inbox } from 'lucide-react';
import fr from '../../locales/fr.json';
import { formatCurrency } from '../../lib/format';
import { Button, Card, EmptyState, Field, Input, Stat, Tag, Toggle } from '../ui';

const SCENARIO_FIELDS = [
  { key: 'adultWhole', labelKey: 'scenarioAdultWholeCount' },
  { key: 'adultMain', labelKey: 'scenarioAdultMainCount' },
  { key: 'teenWhole', labelKey: 'scenarioTeenWholeCount' },
  { key: 'teenMain', labelKey: 'scenarioTeenMainCount' },
  { key: 'kids', labelKey: 'scenarioKidsCount' },
  { key: 'newMembers', labelKey: 'scenarioNewMembersCount' }
];

export const ScenarioSimulator = ({ event, values, onChange, onRun, result }) => (
  <Card className="p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <Calculator aria-hidden="true" className="mt-1 size-5 shrink-0 text-neon" strokeWidth={1.75} />
      <div>
        <h3 className="text-lg font-semibold text-ink">{fr.scenarioSimulatorTitle}</h3>
        <p className="mt-1 text-sm text-muted">{fr.scenarioSimulatorSubtitle}</p>
      </div>
    </div>
    <form
      className="mt-5 space-y-5"
      onSubmit={e => { e.preventDefault(); onRun(); }}
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {SCENARIO_FIELDS.map(field => (
          <Field key={field.key} label={fr[field.labelKey]}>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                min="0"
                inputMode="numeric"
                className="font-data"
                value={values[field.key]}
                onChange={e => onChange(field.key, parseInt(e.target.value) || 0)}
              />
            )}
          </Field>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`${fr.scenarioSellingPriceOverride} ${fr.currencyCadSuffix}`}>
          {({ id }) => (
            <Input id={id} type="number" step="0.01" min="0" inputMode="decimal" className="font-data" value={values.sellingPriceOverride} onChange={e => onChange('sellingPriceOverride', e.target.value)} placeholder={String(event?.selling_price_whole_event || fr.currentSellingPricePlaceholder)} />
          )}
        </Field>
        <Field label={`${fr.scenarioPricePerPointOverride} ${fr.currencyCadSuffix}`}>
          {({ id }) => (
            <Input id={id} type="number" step="0.01" min="0" inputMode="decimal" className="font-data" value={values.pricePerPointOverride} onChange={e => onChange('pricePerPointOverride', e.target.value)} placeholder={event?.selling_price_whole_event ? (event.selling_price_whole_event / 2).toFixed(2) : fr.currentPricePerPointPlaceholder} />
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-5 border-t border-line pt-5">
        <Button type="submit" className="self-start">{fr.scenarioSimulateButton}</Button>
        {result && (
          <div aria-live="polite" className="grid gap-5 sm:grid-cols-3">
            <Stat label={fr.scenarioTotalPoints} value={result.totalPoints.toFixed(2)} />
            <Stat label={fr.scenarioBasePricePerPoint} value={formatCurrency(result.basePricePerPoint)} />
            <Stat label={fr.scenarioCalculatedAmountOwed} value={formatCurrency(result.calculated_amount_owed)} tone="neon" />
          </div>
        )}
      </div>
    </form>
  </Card>
);

export const DataExport = ({ hasData, onExportCSV, onCopyTSV }) => (
  <Card className="p-5 sm:p-6">
    <h3 className="text-lg font-semibold text-ink">{fr.dataExportTitle}</h3>
    <p className="mt-1 text-sm text-muted">{fr.dataExportDescription}</p>
    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
      <Button variant="secondary" onClick={onExportCSV} disabled={!hasData}>
        <Download aria-hidden="true" className="size-4.5" strokeWidth={1.75} />{fr.exportCSVButton}
      </Button>
      <Button variant="secondary" onClick={onCopyTSV} disabled={!hasData}>
        <ClipboardCopy aria-hidden="true" className="size-4.5" strokeWidth={1.75} />{fr.exportCopyTSVButton}
      </Button>
    </div>
    <p className="mt-3 text-sm text-faint">{fr.exportCopyTSVSubtext}</p>
  </Card>
);

export const FeedbackInbox = ({ items, showResolved, onToggleResolved, onResolve }) => {
  const visible = items.filter(item => showResolved || !item.is_resolved);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold text-ink">{fr.adminFeedbackSectionTitle}</h3>
        <Toggle label={fr.adminFeedbackShowResolved} checked={showResolved} onChange={onToggleResolved} className="sm:justify-end" />
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={Inbox} title={fr.adminFeedbackEmpty} />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {visible.map(item => (
            <li key={item.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{item.profiles?.full_name || item.profiles?.email || fr.adminFeedbackUnknownAuthor}</p>
                  <p className="font-data text-xs text-faint">{new Date(item.created_at).toLocaleString('fr-CA')}</p>
                </div>
                {item.is_resolved ? (
                  <Tag tone="ok" icon={CheckCircle2}>{fr.adminFeedbackResolved}</Tag>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => onResolve(item.id)}>{fr.adminFeedbackResolve}</Button>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{item.content}</p>
              {item.screenshot_url && (
                <a href={item.screenshot_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block">
                  <img src={item.screenshot_url} alt={fr.feedbackScreenshotAlt} loading="lazy" className="max-h-48 rounded-control border border-line" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
