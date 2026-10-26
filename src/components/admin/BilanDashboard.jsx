import fr from '../../locales/fr.json';
import { responseRate } from '../../lib/eventFeedbackAdmin';
import { Card, Tag } from '../ui';

// The « Bilan » section's counts (#346, approved design): « Réponses reçues », a ruled strip of
// three figures (signed, anonymous, response rate over the eligible registrations) and one bar.
// `counts` is event_feedback_counts()'s shape (ADR 0029); after the close the section passes the
// counts of the answers it shows (shownCounts). `closedOn` is the close's date, formatted.
//
// Threat model (#346): counts only, as loaded. No time of any kind, no animation, no badge on
// change. While `anonymous` is null (fewer than 3) there is no total and the rate is the signed
// answers' only: a total would give the anonymous count away.

const Cell = ({ label, hint, children, className }) => (
  <div className={`min-w-0 bg-surface p-4 sm:p-5 ${className ?? ''}`}>
    <p className="text-sm text-muted">{label}</p>
    <div className="mt-1">{children}</div>
    {hint && <p className="mt-0.5 text-sm text-faint">{hint}</p>}
  </div>
);

const Figure = ({ children, className = 'text-ink' }) => (
  <p className={`font-data text-3xl font-medium ${className}`}>{children}</p>
);

const BilanDashboard = ({ counts, closedOn }) => {
  const { closed, eligible, signed, anonymous, total } = counts;
  const hidden = anonymous === null;
  const combined = total !== null;
  const rate = responseRate(counts);
  const signedWidth = eligible > 0 ? Math.min(100, (signed / eligible) * 100) : 0;
  const anonymousWidth = combined && eligible > 0 ? Math.min(100 - signedWidth, (anonymous / eligible) * 100) : 0;

  return (
    <Card className="overflow-hidden" aria-labelledby="bilan-counts-title" data-testid="bilan-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-4 sm:p-6 sm:pb-4">
        <h2 id="bilan-counts-title" className="text-lg font-semibold text-ink">{fr.adminBilanCountsTitle}</h2>
        <Tag tone={closed ? 'neutral' : 'info'}>
          {closed ? fr.adminBilanCountsClosedOn.replace('{date}', closedOn) : fr.adminBilanCountsBeforeClose}
        </Tag>
      </div>
      {eligible === 0 ? (
        <p className="px-5 pb-5 text-muted sm:px-6 sm:pb-6">{fr.adminBilanCountsNoEligible}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-3">
            <Cell label={fr.adminBilanCountsSigned} hint={fr.adminBilanCountsSignedHint}>
              <Figure>{signed}</Figure>
            </Cell>
            <Cell label={fr.adminBilanCountsAnonymous} hint={hidden ? fr.adminBilanCountsAnonymousHiddenHint : fr.adminBilanCountsAnonymousHint}>
              {hidden
                ? <p className="text-xl font-semibold text-ink">{fr.adminBilanCountsAnonymousHidden}</p>
                : <Figure>{anonymous}</Figure>}
            </Cell>
            <Cell className="col-span-2 sm:col-span-1"
              label={combined ? fr.adminBilanCountsRate : fr.adminBilanCountsRateSigned}
              hint={eligible === 1 ? fr.adminBilanCountsEligibleOne : fr.adminBilanCountsEligible.replace('{n}', eligible)}>
              <Figure className="text-neon">{rate}<span className="text-xl text-muted"> %</span></Figure>
            </Cell>
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex h-3 overflow-hidden rounded-full bg-raised" role="img"
              aria-label={(combined ? fr.adminBilanCountsBarAll : fr.adminBilanCountsBarSigned).replace('{rate}', rate)}>
              <span className="bg-neon" style={{ width: `${signedWidth}%` }} />
              <span className="bg-info" style={{ width: `${anonymousWidth}%` }} />
            </div>
            <div aria-hidden="true" className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full bg-neon" />{fr.adminBilanCountsSigned}</span>
              <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full bg-info" />{fr.adminBilanCountsAnonymous}</span>
            </div>
          </div>
        </>
      )}
    </Card>
  );
};

export default BilanDashboard;
