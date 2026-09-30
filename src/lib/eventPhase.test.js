import { getEventPhase, getEventTimeline, getRegistrationCloseDate, isRegistrationLocked } from './eventPhase';

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

describe('registration close date (#38, #35)', () => {
  test('is the event start minus x_reg_close_weeks weeks, as a local day', () => {
    expect(getRegistrationCloseDate(event)).toEqual(new Date(2026, 7, 7));
    expect(getRegistrationCloseDate({ ...event, x_reg_close_weeks: 2 })).toEqual(new Date(2026, 6, 31));
  });
  test('counts calendar days across a daylight-saving change', () => {
    // Clocks go back on 2026-11-01 in Quebec; the close date must still be a Sunday midnight.
    expect(getRegistrationCloseDate({ event_start_date: '2026-11-08', x_reg_close_weeks: 1 })).toEqual(new Date(2026, 10, 1));
  });
  test('is unknown when either input is missing, like the database trigger', () => {
    expect(getRegistrationCloseDate({ ...event, event_start_date: null })).toBeNull();
    expect(getRegistrationCloseDate({ ...event, x_reg_close_weeks: null })).toBeNull();
    expect(isRegistrationLocked({ ...event, event_start_date: null }, new Date(2030, 0, 1))).toBe(false);
  });
  test("locks only after the close date's day ends in Toronto, whatever the browser zone", () => {
    // Close date 2026-08-07: open until 2026-08-08 00:00 EDT (04:00 UTC).
    expect(isRegistrationLocked(event, new Date('2026-08-07T03:59:00Z'))).toBe(false);
    expect(isRegistrationLocked(event, new Date('2026-08-08T03:59:00Z'))).toBe(false);
    expect(isRegistrationLocked(event, new Date('2026-08-08T04:01:00Z'))).toBe(true);
  });
});

// #149: the dates are instants, read in Toronto.
describe('with times of day', () => {
  // Registration opens 1 June at 18:00; the event starts 14 August at 23:30 (15 August in UTC).
  const timed = { ...event, reg_start_date: '2026-06-01T22:00:00+00:00', event_start_date: '2026-08-15T03:30:00+00:00' };

  test('the intent phase ends when registration opens, to the minute', () => {
    expect(getEventPhase(timed, new Date('2026-06-01T21:59:00Z'))).toBe('INTENT_PHASE');
    expect(getEventPhase(timed, new Date('2026-06-01T22:01:00Z'))).toBe('REGISTRATION_OPEN');
    // And starts z_intent_months before, at the same Toronto time.
    expect(getEventPhase(timed, new Date('2026-04-01T21:59:00Z'))).toBe('REGISTRATION_OPEN');
    expect(getEventPhase(timed, new Date('2026-04-01T22:01:00Z'))).toBe('INTENT_PHASE');
  });

  test("the close date counts from the start's Toronto day, not its UTC one", () => {
    expect(getRegistrationCloseDate(timed)).toEqual(new Date(2026, 7, 7));
    expect(isRegistrationLocked(timed, new Date('2026-08-08T03:59:00Z'))).toBe(false);
    expect(isRegistrationLocked(timed, new Date('2026-08-08T04:01:00Z'))).toBe(true);
  });

  test('the track shows Toronto days, with the time of the opening and the start', () => {
    const { steps, eventEnd } = getEventTimeline(timed, new Date('2026-01-01T12:00:00Z'));
    const byId = Object.fromEntries(steps.map(s => [s.id, s]));
    expect(byId.registration.date).toEqual(new Date(2026, 5, 1));
    expect(byId.registration.time).toMatch(/^18\sh\s00$/);
    expect(byId.weekend.date).toEqual(new Date(2026, 7, 14));
    expect(byId.weekend.time).toMatch(/^23\sh\s30$/);
    expect(eventEnd).toEqual(new Date(2026, 7, 16));
    // Midnight is no time worth showing.
    expect(getEventTimeline(event).steps.find(s => s.id === 'weekend').time).toBeUndefined();
  });
});
