import { Copy } from 'lucide-react';
import fr from '../locales/fr.json';
import { cx } from './ui';
import { notify } from '../lib/toasts';
import {
  INTERAC_RECIPIENT,
  INTERAC_SECURITY_ANSWER,
  INTERAC_SECURITY_QUESTION,
  interacMessage
} from '../../supabase/functions/_shared/interac';

const Row = ({ label, stacked, children }) => (
  <div className={cx('flex flex-col gap-0.5', !stacked && 'sm:flex-row sm:items-baseline sm:gap-4')}>
    <dt className={cx('text-muted', !stacked && 'sm:w-28 sm:shrink-0')}>{label}</dt>
    <dd className="min-w-0 break-words font-data text-ink">{children}</dd>
  </div>
);

const copyRecipient = async () => {
  try {
    await navigator.clipboard.writeText(INTERAC_RECIPIENT);
    notify(fr.paymentRecipientCopied, 'success');
  } catch (error) {
    console.error('Failed to copy the Interac recipient:', error);
    notify(fr.copyError, 'error');
  }
};

// How to pay by Interac e-Transfer (#301): recipient (with a copy button), the transfer's message
// and the security question. Shared by the pass and the registration confirmation, which render the
// same values from supabase/functions/_shared/interac.ts, the module the emails also read.
// `stacked` puts each label above its value (the narrow stub). `name` is the account's full name (see useAccountName); `amount` adds an « Amount » row first.
const PaymentDetails = ({ name, amount, className, stacked = false }) => (
  <div className={className}>
    <dl className="space-y-2">
      {amount != null && <Row stacked={stacked} label={fr.registrationSuccessPaymentAmount}>{amount}</Row>}
      <Row stacked={stacked} label={fr.registrationSuccessPaymentRecipient}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="select-all [overflow-wrap:anywhere]">{INTERAC_RECIPIENT}</span>
          <button
            type="button"
            onClick={copyRecipient}
            aria-label={fr.paymentCopyRecipient}
            title={fr.paymentCopyRecipient}
            className="grid size-9 shrink-0 place-items-center rounded-control border border-edge text-muted hover:bg-raised hover:text-ink"
          >
            <Copy aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </button>
        </span>
      </Row>
      <Row stacked={stacked} label={fr.registrationSuccessPaymentNote}>{interacMessage(name)}</Row>
    </dl>
    <p className="mt-3 text-faint">
      {fr.registrationSuccessPaymentSecurity
        .replace('{question}', INTERAC_SECURITY_QUESTION)
        .replace('{answer}', INTERAC_SECURITY_ANSWER)}
    </p>
  </div>
);

export default PaymentDetails;
