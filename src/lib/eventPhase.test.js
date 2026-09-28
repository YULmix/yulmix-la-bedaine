import { getEventPhase, getEventTimeline } from './eventPhase';

const event = {
  status: 'ACTIVE',
  is_reg_open: true,
  reg_start_date: '2026-06-01',
  event_start_date: '2026-08-14',
  z_intent_months: 2,
  x_reg_close_weeks: 1,
  duration_days: 3
};

describe('getEventPhase', () => {
  test('intent phase between intent start and registration start', () => {
    expect(getEventPhase(event, new Date(2026, 4, 10))).toBe('INTENT_PHASE');
  });
  test('registration open after registration start', () => {
    expect(getEventPhase(event, new Date(2026, 5, 2))).toBe('REGISTRATION_OPEN');
  });
  test('no event', () => {
    expect(getEventPhase(null)).toBe('NO_EVENT');
  });
});

describe('getEventTimeline', () => {
  test('derives milestone dates from the tunables, date-only strings read as local days', () => {
    const { steps, eventEnd } = getEventTimeline(event, new Date(2026, 0, 1));
    const byId = Object.fromEntries(steps.map(s => [s.id, s.date]));
    expect(byId.intent).toEqual(new Date(2026, 3, 1));
    expect(byId.registration).toEqual(new Date(2026, 5, 1));
    expect(byId.payment).toEqual(new Date(2026, 7, 7));
    expect(byId.weekend).toEqual(new Date(2026, 7, 14));
    expect(eventEnd).toEqual(new Date(2026, 7, 16));
  });
  test('current step follows today', () => {
    expect(getEventTimeline(event, new Date(2026, 0, 1)).currentId).toBeNull();
    expect(getEventTimeline(event, new Date(2026, 4, 1)).currentId).toBe('intent');
    expect(getEventTimeline(event, new Date(2026, 6, 1)).currentId).toBe('registration');
    expect(getEventTimeline(event, new Date(2026, 7, 10)).currentId).toBe('payment');
    expect(getEventTimeline(event, new Date(2026, 7, 15)).currentId).toBe('weekend');
    expect(getEventTimeline(event, new Date(2026, 7, 20)).currentId).toBe('done');
  });
  test('no event start date: later milestones undated', () => {
    const { steps } = getEventTimeline({ ...event, event_start_date: null }, new Date(2026, 6, 1));
    expect(steps.find(s => s.id === 'weekend').date).toBeNull();
  });
});
