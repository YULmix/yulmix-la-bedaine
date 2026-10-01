import fr from '../locales/fr.json';
import { describeChanges } from './editHistory';

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

test('agreeing to be on the carpool board shows in the transport change (#180)', () => {
  const [line] = describeChanges({
    transport: {
      old: { type: 'offer', seats: 3 },
      new: { type: 'offer', seats: 3, carpool_listed: true }
    }
  });
  expect(line.from).toBe(`${fr.transportTypeOffer}, ${fr.transportSeats}: 3`);
  expect(line.to).toBe(`${fr.transportTypeOffer}, ${fr.transportSeats}: 3, ${fr.historyCarpoolListed}`);
});
