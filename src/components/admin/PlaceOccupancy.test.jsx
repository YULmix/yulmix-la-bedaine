import { fireEvent, render, screen } from '@testing-library/react';
import PlaceOccupancy from './PlaceOccupancy';
import { computePlaceStats } from '../../lib/adminStats';
import fr from '../../locales/fr.json';

const places = [
  { id: 'bedA', label: 'Lit A', type: 'bed', capacity: 1, locationId: 'l1', locationName: 'Chambre 2' },
  { id: 'floor', label: 'Matelas', type: 'floor', capacity: 2, locationId: 'l1', locationName: 'Chambre 2' }
];
const person = (id, name, type, placeId) => ({ id, name, type, participation: 'Whole', place: { place_id: placeId } });
const parties = [
  { id: 'a', attendees: [person('a1', 'Alice Tremblay', 'Adult', 'bedA')] },
  { id: 'b', attendees: [person('b1', '', 'Kid', 'bedA')] }
];
const renderCard = () => render(<PlaceOccupancy stats={computePlaceStats(parties, places)} />);
const toggle = () => screen.getByRole('button', { name: fr.occupantsToggle });

beforeEach(() => window.localStorage.clear());

test('off the first time: chips only, the toggle the only button', () => {
  renderCard();
  expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.queryByText(/Alice Tremblay/)).toBeNull();
});

test('on: each occupied place lists its occupants (fallback for no name); remembered on this device', () => {
  const { unmount } = renderCard();
  fireEvent.click(toggle());
  expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Alice Tremblay · Adulte')).toBeInTheDocument();
  expect(screen.getByText(`${fr.participantFallback} · Enfant`)).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  unmount();
  renderCard();
  expect(toggle()).toHaveAttribute('aria-pressed', 'true');
});
