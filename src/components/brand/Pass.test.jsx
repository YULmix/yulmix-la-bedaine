import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Pass from './Pass';
import fr from '../../locales/fr.json';
import { notify } from '../../lib/toasts';
import { INTERAC_RECIPIENT, interacMessage } from '../../../supabase/functions/_shared/interac';
import { PAYMENT_STATUS } from '../../lib/registrationOptions';

jest.mock('../../lib/toasts', () => ({ notify: jest.fn() }));

const event = { theme: 'Test Party' };
const registration = (overrides = {}) => ({
  id: 'a0000000-0000-0000-0000-000000000090',
  attendees: [{ name: 'Ann', type: 'Adult', participation: 'Whole' }],
  calculated_amount_owed: 120,
  payment_status: PAYMENT_STATUS.UNPAID,
  is_waitlisted: false,
  ...overrides
});

// #90: the amount label follows the stamp.
describe('Pass amount label', () => {
  test('an unpaid registration shows "Montant dû" next to "À payer"', () => {
    render(<Pass registration={registration()} event={event} />);
    expect(screen.getByText(fr.amountDue)).toBeInTheDocument();
    expect(screen.getByText(fr.stampUnpaid)).toBeInTheDocument();
  });

  test('a paid registration shows "Montant payé" next to "Payé"', () => {
    render(<Pass registration={registration({ payment_status: PAYMENT_STATUS.PAID })} event={event} />);
    expect(screen.getByText(fr.amountPaid)).toBeInTheDocument();
    expect(screen.getByText(fr.stampPaid)).toBeInTheDocument();
    expect(screen.queryByText(fr.amountDue)).not.toBeInTheDocument();
  });

  test('a waitlisted registration shows "Total estimé", even if marked paid', () => {
    render(<Pass registration={registration({ is_waitlisted: true, payment_status: PAYMENT_STATUS.PAID })} event={event} />);
    expect(screen.getByText(fr.estimatedAmountDueLabel)).toBeInTheDocument();
    expect(screen.getByText(fr.stampWaitlist)).toBeInTheDocument();
  });

  test('a registration in the intent phase shows "Total estimé"', () => {
    render(<Pass registration={registration()} event={event} isIntent />);
    expect(screen.getByText(fr.estimatedAmountDueLabel)).toBeInTheDocument();
    expect(screen.getByText(fr.stampIntent)).toBeInTheDocument();
  });
});

// #301: « Comment payer » is for the unpaid tone only, closed until the member opens it.
describe('Pass « Comment payer »', () => {
  test('an unpaid pass has it closed, with the recipient and the message built from the payer name', () => {
    const { container } = render(<Pass registration={registration()} event={event} payerName="Ann Roy" />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(screen.getByText(fr.paymentHowTo)).toBeInTheDocument();
    expect(screen.getByAltText(fr.paymentInteracLogoAlt)).toBeInTheDocument();
    expect(screen.getByText(INTERAC_RECIPIENT)).toBeInTheDocument();
    expect(screen.getByText(interacMessage('Ann Roy'))).toBeInTheDocument();
  });

  test.each([
    ['paid', { payment_status: PAYMENT_STATUS.PAID }, false],
    ['waitlisted', { is_waitlisted: true }, false],
    ['intent', {}, true]
  ])('a %s pass does not have it', (_tone, overrides, isIntent) => {
    render(<Pass registration={registration(overrides)} event={event} isIntent={isIntent} payerName="Ann Roy" />);
    expect(screen.queryByText(fr.paymentHowTo)).not.toBeInTheDocument();
    expect(screen.queryByText(INTERAC_RECIPIENT)).not.toBeInTheDocument();
  });

  test('the copy button puts the recipient on the clipboard and says so', async () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Pass registration={registration()} event={event} payerName="Ann" />);
    fireEvent.click(screen.getByRole('button', { name: fr.paymentCopyRecipient }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INTERAC_RECIPIENT));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(fr.paymentRecipientCopied, 'success'));
  });

  test('a rejected clipboard write shows an error toast', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<Pass registration={registration()} event={event} payerName="Ann" />);
    fireEvent.click(screen.getByRole('button', { name: fr.paymentCopyRecipient }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(fr.copyError, 'error'));
  });
});
