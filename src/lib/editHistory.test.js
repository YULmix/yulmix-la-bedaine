import fr from '../locales/fr.json';
import { describeChanges } from './editHistory';

test('a transport change reads in French, with the departure place (#181)', () => {
  const [line] = describeChanges({
    transport: {
      old: { type: 'need', seats: 2 },
      new: { type: 'need', seats: 2, departure_place: 'Montréal (Rosemont)' }
    }
  });
  expect(line).toEqual({
    label: fr.transport,
    from: `${fr.transportTypeNeed}, ${fr.transportSeats}: 2`,
    to: `${fr.transportTypeNeed}, ${fr.transportSeats}: 2, ${fr.transportDeparturePlace}: Montréal (Rosemont)`
  });
});
