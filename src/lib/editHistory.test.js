import fr from '../locales/fr.json';
import { describeChanges } from './editHistory';
import { formatCurrency } from './format';

test('a transport change reads in French, with the departure place (#181)', () => {
  const [line] = describeChanges({
    transport: {
      old: { type: 'need', seats: 2 },
      new: { type: 'need', seats: 2, departure_fsa: 'H2S', departure_place: 'métro Jean-Talon' }
    }
  });
  expect(line).toEqual({
    label: fr.transport,
    from: `${fr.transportTypeNeed}, ${fr.transportSeats}: 2`,
    to: `${fr.transportTypeNeed}, ${fr.transportSeats}: 2, ${fr.transportDeparturePlaceShort}: H2S · métro Jean-Talon`
  });
});

test('a creation entry is one line with no old value: head count, status, amount (#173)', () => {
  expect(describeChanges({
    created: {
      old: null,
      new: { attendees: [{ name: 'A' }, { name: 'B' }], status: 'registered', is_waitlisted: false, calculated_amount_owed: 520 }
    }
  })).toEqual([{
    label: fr.historyFieldCreated,
    from: '',
    to: `${fr.countPersonOther.replace('{count}', 2)} · ${fr.statusRegistered} · ${formatCurrency(520)}`
  }]);
});

test('a waitlisted creation says so instead of the status (#173)', () => {
  const [line] = describeChanges({
    created: { old: null, new: { attendees: [{ name: 'A' }], status: 'registered', is_waitlisted: true, calculated_amount_owed: 0 } }
  });
  expect(line.to).toBe(`${fr.countPersonOne.replace('{count}', 1)} · ${fr.filterWaitlist} · ${formatCurrency(0)}`);
});
