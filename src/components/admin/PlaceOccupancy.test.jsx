import { act, fireEvent, render, screen } from '@testing-library/react';
import PlaceOccupancy from './PlaceOccupancy';
import { computePlaceStats } from '../../lib/adminStats';

const places = [
  { id: 'bedA', label: 'Lit A', type: 'bed', capacity: 1, locationId: 'l1', locationName: 'Chambre 2' },
  { id: 'floor', label: 'Matelas', type: 'floor', capacity: 2, locationId: 'l1', locationName: 'Chambre 2' },
  { id: 'sofa', label: 'Canapé', type: 'sofa', capacity: 1, locationId: 'l2', locationName: 'Salon' }
];
const person = (id, name, type, placeId) => ({ id, name, type, participation: 'Whole', place: placeId ? { place_id: placeId } : null });
const parties = [
  { id: 'a', attendees: [person('a1', 'Alice Tremblay', 'Adult', 'bedA'), person('a2', 'Léo Tremblay', 'Kid', 'floor')] },
  { id: 'b', attendees: [person('b1', '', 'Teenager', 'bedA')] }
];

// jsdom has no PointerEvent: without one, fireEvent drops pointerType.
if (!window.PointerEvent) {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerType = init.pointerType || '';
    }
  };
}

const renderCard = () => render(<PlaceOccupancy stats={computePlaceStats(parties, places)} />);
const chip = id => document.querySelector(`[data-place-chip="${id}"]`);

afterEach(() => jest.useRealTimers());

test('hovering an occupied chip lists its occupants by party; leaving closes it', () => {
  jest.useFakeTimers();
  renderCard();
  fireEvent.pointerOver(chip('bedA'), { pointerType: 'mouse' });
  const bubble = screen.getByRole('tooltip');
  expect(bubble).toHaveTextContent('Lit A · 2/1');
  expect([...bubble.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Alice Tremblay · Adulte', 'Participant · Adolescent']);
  expect(chip('bedA')).toHaveAttribute('aria-expanded', 'true');
  expect(chip('bedA')).toHaveAttribute('aria-describedby', bubble.id);
  fireEvent.pointerOut(chip('bedA'), { pointerType: 'mouse' });
  act(() => jest.runAllTimers());
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('keyboard focus opens it, Escape closes it, one bubble at a time', () => {
  renderCard();
  fireEvent.pointerOver(chip('floor'), { pointerType: 'mouse' });
  act(() => chip('bedA').focus());
  expect(screen.getAllByRole('tooltip')).toHaveLength(1);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Lit A');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('a tap toggles it, and a tap outside closes it', () => {
  renderCard();
  fireEvent.pointerDown(chip('floor'), { pointerType: 'touch' });
  fireEvent.click(chip('floor'));
  expect(screen.getByRole('tooltip')).toHaveTextContent('Léo Tremblay · Enfant');
  fireEvent.pointerDown(chip('floor'), { pointerType: 'touch' });
  fireEvent.click(chip('floor'));
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.pointerDown(chip('floor'), { pointerType: 'touch' });
  fireEvent.click(chip('floor'));
  fireEvent.pointerDown(document.body, { pointerType: 'touch' });
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('an empty place is a plain chip, not a button', () => {
  renderCard();
  expect(chip('sofa')).toBeNull();
  expect(screen.getByText('Canapé').closest('button')).toBeNull();
});
