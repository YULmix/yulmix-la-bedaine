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

const Row = ({ label, stacked, accent = true, children }) => (
  <div className={cx('flex flex-col gap-0.5', !stacked && 'sm:flex-row sm:items-baseline sm:gap-4')}>
    <dt className={cx(accent ? 'text-neon' : 'text-muted', !stacked && 'sm:w-28 sm:shrink-0')}>{label}</dt>
    <dd className="min-w-0 break-words font-data text-ink">{children}</dd>
  </div>
);

const copyText = async (text, doneMessage) => {
  try {
    await navigator.clipboard.writeText(text);
    notify(doneMessage, 'success');
  } catch (error) {
    console.error('Failed to copy the Interac details:', error);
    notify(fr.copyError, 'error');
  }
};

const CopyButton = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="grid size-9 shrink-0 place-items-center rounded-control border border-edge text-muted hover:bg-raised hover:text-ink"
  >
    <Copy aria-hidden="true" className="size-4" strokeWidth={1.75} />
  </button>
);

// How to pay by Interac e-Transfer (#301): recipient (with a copy button), the transfer's message
// and the security question. Shared by the pass and the registration confirmation, which render the
// same values from supabase/functions/_shared/interac.ts, the module the emails also read.
// `stacked` puts each label above its value (the narrow stub). `name` is the account's full name (see useAccountName); `amount` adds an « Amount » row first.
const PaymentDetails = ({ name, amount, className, stacked = false }) => {
  const message = interacMessage(name);
  return (
  <div className={className}>
    <dl className="space-y-2">
      {amount != null && <Row stacked={stacked} accent={false} label={fr.registrationSuccessPaymentAmount}>{amount}</Row>}
      <Row stacked={stacked} label={fr.registrationSuccessPaymentRecipient}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="select-all [overflow-wrap:anywhere]">{INTERAC_RECIPIENT}</span>
          <CopyButton label={fr.paymentCopyRecipient} onClick={() => copyText(INTERAC_RECIPIENT, fr.paymentRecipientCopied)} />
        </span>
      </Row>
      <Row stacked={stacked} label={fr.registrationSuccessPaymentNote}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="select-all [overflow-wrap:anywhere]">{message}</span>
          <CopyButton label={fr.paymentCopyMessage} onClick={() => copyText(message, fr.paymentMessageCopied)} />
        </span>
      </Row>
    </dl>
    <p className="mt-6 text-faint">
      {fr.registrationSuccessPaymentSecurity
        .replace('{question}', INTERAC_SECURITY_QUESTION)
        .replace('{answer}', INTERAC_SECURITY_ANSWER)}
    </p>
  </div>
  );
};

export default PaymentDetails;
