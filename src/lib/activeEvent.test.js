import { splitEvents } from './activeEvent';

const newer = { id: 'newer', is_active: false };
const active = { id: 'active', is_active: true };
const older = { id: 'older', is_active: false };

test('the active event is the one marked so; the others keep their order', () => {
  expect(splitEvents([newer, active, older])).toEqual({ activeEvent: active, otherEvents: [newer, older] });
});

test('with none marked active, the newest stands in', () => {
  expect(splitEvents([newer, older])).toEqual({ activeEvent: newer, otherEvents: [older] });
});

test('no events, or none loaded: no active event', () => {
  expect(splitEvents([])).toEqual({ activeEvent: null, otherEvents: [] });
  expect(splitEvents(null)).toEqual({ activeEvent: null, otherEvents: [] });
});
