import { useMemo } from 'react';
import fr from '../../locales/fr.json';
import { formatCurrency } from '../../lib/format';
import { formatEventDates, formatHeadcountBreakdown, plural } from '../../lib/eventDisplay';
import { PAYMENT_STATUS } from '../../lib/registrationOptions';
import { cx } from '../ui';
import PaymentDetails from '../PaymentDetails';
import interacLogo from '../../assets/interac-logo.svg';

// Deterministic bar widths from the registration id, echoing the YULmix barcode mark.
// Decorative only: aria-hidden, and the id itself is printed next to it in mono.
const Barcode = ({ seed = '' }) => {
  const bars = useMemo(() => {
    let hash = 2166136261;
    const out = [];
    for (let i = 0; i < 44; i++) {
      hash ^= seed.charCodeAt(i % Math.max(seed.length, 1)) + i;
      hash = Math.imul(hash, 16777619) >>> 0;
      out.push({ width: 1 + (hash % 3), gap: 1 + ((hash >> 3) % 3) });
    }
    return out;
  }, [seed]);
  return (
    <div aria-hidden="true" className="flex h-10 items-stretch overflow-hidden">
      {bars.map((bar, index) => (
        <span key={index} className="bg-ink/85" style={{ width: bar.width, marginRight: bar.gap }} />
      ))}
    </div>
  );
};

const STAMP_TONES = {
  paid: 'border-ok text-ok',
  unpaid: 'border-warn text-warn',
  waitlist: 'border-warn text-warn',
  intent: 'border-info text-info'
};

// The amount label comes from the same decision as the stamp, so the two can't disagree: an
// intent or waitlisted party is only an estimate (they're told not to pay yet), a paid one has paid.
export const getStamp = (registration, isIntent) => {
  if (isIntent) return { tone: 'intent', label: fr.stampIntent, amountLabel: fr.estimatedAmountDueLabel };
  if (registration.is_waitlisted) return { tone: 'waitlist', label: fr.stampWaitlist, amountLabel: fr.estimatedAmountDueLabel };
  if (registration.payment_status === PAYMENT_STATUS.PAID) return { tone: 'paid', label: fr.stampPaid, amountLabel: fr.amountPaid };
  return { tone: 'unpaid', label: fr.stampUnpaid, amountLabel: fr.amountDue };
};

// Signature element (DESIGN.md): the member's registration as a wristband / ticket stub.
// Body on the left (event, group), stub on the right (amount, stamp, action); stacked on phones
// with the tear line running horizontally.
const Pass = ({ registration, event, isIntent = false, animateStamp = false, action, payerName = '' }) => {
  const attendees = registration.attendees || [];
  const stamp = getStamp(registration, isIntent);
  const dates = formatEventDates(event);
  const code = (registration.id || '').replace(/-/g, '').slice(0, 10).toUpperCase();

  return (
    <article
      aria-label={fr.passLabel}
      className="relative isolate grid overflow-hidden rounded-card border border-neon/40 bg-surface shadow-glow animate-rise md:grid-cols-[1fr_auto]"
    >
      <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
        <div>
          <p className="font-data text-xs uppercase tracking-widest text-neon">{fr.passKicker}</p>
          <h2 className="mt-2 font-display text-display-md text-ink">{event?.theme}</h2>
          {dates && <p className="mt-1 font-data text-sm text-muted">{dates}</p>}
        </div>
        <div>
          <p className="text-lg font-semibold text-ink">{plural(attendees.length, 'countPersonOne', 'countPersonOther')}</p>
          <p className="text-sm text-muted">{formatHeadcountBreakdown(attendees)}</p>
        </div>
        <div className="mt-auto flex items-end gap-3">
          <Barcode seed={registration.id || registration.user_id || ''} />
          <span className="font-data text-xs text-faint">{code}</span>
        </div>
      </div>

      {/* Tear line: dashed rule + two notches clipped by the card's overflow-hidden. */}
      <div aria-hidden="true" className="relative h-0 border-t-2 border-dashed border-line md:hidden">
        <span className="absolute -left-3 -top-3 size-6 rounded-full border border-neon/40 bg-night" />
        <span className="absolute -right-3 -top-3 size-6 rounded-full border border-neon/40 bg-night" />
      </div>

      <div className="relative flex flex-col gap-4 p-5 sm:p-6 md:w-72 md:border-l-2 md:border-dashed md:border-line">
        <span aria-hidden="true" className="absolute -left-3 -top-3 hidden size-6 rounded-full border border-neon/40 bg-night md:block" />
        <span aria-hidden="true" className="absolute -bottom-3 -left-3 hidden size-6 rounded-full border border-neon/40 bg-night md:block" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{stamp.amountLabel}</p>
            <p className="font-data text-3xl font-medium text-ink">{formatCurrency(registration.calculated_amount_owed || 0)}</p>
          </div>
          <span
            key={`${stamp.tone}-${animateStamp}`}
            className={cx(
              'inline-block -rotate-6 rounded-control border-2 px-2.5 py-1 font-display text-sm leading-none',
              STAMP_TONES[stamp.tone],
              animateStamp && 'animate-stamp'
            )}
          >
            {stamp.label}
          </span>
        </div>
        {stamp.tone === 'waitlist' && <p className="text-sm text-muted">{fr.waitlistedMessage}</p>}
        {stamp.tone === 'unpaid' && <p className="text-sm text-muted">{fr.passUnpaidHint}</p>}
        {stamp.tone === 'unpaid' && (
          <details className="group text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold text-ink">
              <img src={interacLogo} alt={fr.paymentInteracLogoAlt} className="size-6 shrink-0" />
              {fr.paymentHowTo}
            </summary>
            <PaymentDetails stacked name={payerName} className="mt-2" />
          </details>
        )}
        {action && <div className="mt-auto">{action}</div>}
      </div>
    </article>
  );
};

export default Pass;
