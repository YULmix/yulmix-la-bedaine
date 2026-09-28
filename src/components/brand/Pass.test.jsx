import { render, screen } from '@testing-library/react';
import Pass from './Pass';
import fr from '../../locales/fr.json';
import { PAYMENT_STATUS } from '../../lib/registrationOptions';

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
