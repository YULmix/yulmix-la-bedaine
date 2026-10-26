import fr from '../../locales/fr.json';
import { signedRate } from '../../lib/eventFeedbackAdmin';
import { Card, Tag, cx } from '../ui';

// The « Bilan » section's counts (#346's approved design, reworked for items by #356):
// « Réponses reçues » with the window's state, a ruled strip of three figures (signed comments,
// private comments, members who signed at least one over the eligible registrations) and the members'
// bar. No breakdown per category (#363): each category card below shows its own comments. `counts` is
// event_feedback_counts()'s shape (ADR 0029, #354); `status` is the tag's text (« S'ouvre le… »,
// « Ouvert jusqu'au… », « Clos le… »).
//
// Threat model (#346, #356): counts only, as loaded. No time of any kind, no animation, no badge on
// change. Until the release every private number is null and reads « moins de 3 »: the database
// sends none, and nothing here adds signed and private up (a total would give the private one away).
//
// Layout: the card fills its slot; BilanSection gives that slot at most two columns of the category-card grid.

const Cell = ({ label, hint, children, className }) => (
  <div className={cx('min-w-0 bg-surface p-4 sm:p-5', className)}>
    <p className="text-sm text-muted">{label}</p>
    <div className="mt-1">{children}</div>
    {hint && <p className="mt-0.5 text-sm text-faint">{hint}</p>}
  </div>
);

const Figure = ({ children, className = 'text-ink' }) => (
  <p className={cx('font-data text-3xl font-medium', className)}>{children}</p>
);

const Hidden = () => <span className="font-semibold text-ink">{fr.adminBilanCountsPrivateHidden}</span>;

const BilanDashboard = ({ counts, closed, status }) => {
  const { eligible, signed_members: members, released, signed_total: signed, private_total: privateTotal } = counts;
  const rate = signedRate(counts);
  const width = eligible > 0 ? Math.min(100, (members / eligible) * 100) : 0;

  return (
    <Card className="overflow-hidden" aria-labelledby="bilan-counts-title" data-testid="bilan-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-4 sm:p-6 sm:pb-4">
        <h2 id="bilan-counts-title" className="text-lg font-semibold text-ink">{fr.adminBilanCountsTitle}</h2>
        <Tag tone={closed ? 'neutral' : 'info'}>{status}</Tag>
      </div>
      {eligible === 0 ? (
        <p className="px-5 pb-5 text-muted sm:px-6 sm:pb-6">{fr.adminBilanCountsNoEligible}</p>
      ) : (
        <div className="@container border-t border-line">
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3">
            <Cell label={fr.adminBilanCountsSigned} hint={fr.adminBilanCountsSignedHint}>
              <Figure>{signed}</Figure>
            </Cell>
            <Cell label={fr.adminBilanCountsPrivate}
              hint={released ? fr.adminBilanCountsPrivateHint : fr.adminBilanCountsPrivateHiddenHint}>
              {released ? <Figure>{privateTotal}</Figure> : <p className="text-xl"><Hidden /></p>}
            </Cell>
            <Cell className="col-span-2 sm:col-span-1" label={fr.adminBilanCountsMembers}
              hint={fr.adminBilanCountsMembersHint.replace('{rate}', rate)}>
              <Figure className="text-neon">
                {members}<span className="text-xl text-muted"> {fr.adminBilanCountsMembersOf.replace('{n}', eligible)}</span>
              </Figure>
            </Cell>
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex h-3 overflow-hidden rounded-full bg-raised" role="img"
              aria-label={fr.adminBilanCountsBar.replace('{n}', members).replace('{eligible}', eligible).replace('{rate}', rate)}>
              <span className="bg-neon" style={{ width: `${width}%` }} />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

export default BilanDashboard;
