import { useEffect, useRef } from 'react';
import { ArrowRight, CheckCircle2, Hourglass, Wallet } from 'lucide-react';
import { getStamp } from './brand/Pass';
import { Button, Card, Notice } from './ui';
import fr from '../locales/fr.json';
import { formatCurrency } from '../lib/format';
import { ORGANISERS_EMAIL } from '../lib/organisers';

const PaymentRow = ({ label, children }) => (
  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
    <dt className="text-muted sm:w-28 sm:shrink-0">{label}</dt>
    <dd className="min-w-0 break-words font-data text-ink">{children}</dd>
  </div>
);

// What the member does next, from the same decision as the pass's stamp so the two can't
// disagree: an intent or waitlisted party is told not to pay yet, a paid one has nothing to do.
const NextStep = ({ tone, registration }) => {
  if (tone === 'intent') return <Notice tone="info" icon={Hourglass} title={fr.registrationSuccessNextStep}>{fr.registrationSuccessIntentNext}</Notice>;
  if (tone === 'waitlist') return <Notice tone="warn" icon={Hourglass} title={fr.registrationSuccessNextStep}>{fr.registrationSuccessWaitlistText}</Notice>;
  if (tone === 'paid') return <Notice tone="ok" icon={CheckCircle2} title={fr.registrationSuccessNextStep}>{fr.registrationSuccessPaidText}</Notice>;
  return (
    <Notice tone="warn" icon={Wallet} title={fr.registrationSuccessNextStep}>
      <p>{fr.registrationSuccessPaymentText}</p>
      <dl className="mt-3 space-y-2">
        <PaymentRow label={fr.registrationSuccessPaymentAmount}>{formatCurrency(registration.calculated_amount_owed || 0)}</PaymentRow>
        <PaymentRow label={fr.registrationSuccessPaymentRecipient}><span className="select-all">{ORGANISERS_EMAIL}</span></PaymentRow>
        <PaymentRow label={fr.registrationSuccessPaymentNote}>
          {fr.registrationSuccessPaymentNoteValue.replace('{name}', registration.attendees?.[0]?.name || '')}
        </PaymentRow>
      </dl>
      <p className="mt-3 text-faint">{fr.registrationSuccessPaymentSecurity}</p>
    </Notice>
  );
};

// Shown in place of the form once a new registration is saved (#155), so saving never just drops
// the member on the home page: it says the registration is in, and what to do about paying.
// `registration` is the saved party as the database returned it (amount, waitlist, payment).
const RegistrationConfirmation = ({ registration, event, isIntent, onContinue }) => {
  const headingRef = useRef(null);
  const { tone } = getStamp(registration, isIntent);

  // The form (and the button that had focus) is gone: move focus to the confirmation, which also
  // has a screen reader announce it, and bring it into view from the bottom of a long form.
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <Card aria-labelledby="registration-confirmation-title" className="animate-rise space-y-6 p-6 sm:p-8">
      <div>
        <CheckCircle2 aria-hidden="true" className="size-10 text-ok" strokeWidth={1.5} />
        <h2 id="registration-confirmation-title" ref={headingRef} tabIndex={-1} className="mt-4 font-display text-display-md text-ink outline-none">
          {isIntent ? fr.registrationSuccessIntentTitle : fr.registrationSuccessTitle}
        </h2>
        <p className="mt-2 max-w-xl text-muted">
          {(isIntent ? fr.registrationSuccessIntentText : fr.registrationSuccessText).replace('{theme}', event?.theme || '')}
        </p>
      </div>
      <NextStep tone={tone} registration={registration} />
      <Button onClick={onContinue} className="w-full sm:w-auto">
        {fr.registrationSuccessCta}
        <ArrowRight aria-hidden="true" className="size-4.5" />
      </Button>
    </Card>
  );
};

export default RegistrationConfirmation;
