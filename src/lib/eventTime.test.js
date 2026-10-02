import { addEventMonths, eventClock, eventDay, formatEventTime, fromEventLocal, hasEventTime, toEventLocal, toInstant } from './eventTime';

// These must hold in any browser zone: run this file with TZ=Europe/Paris or TZ=Pacific/Auckland too.

describe('fromEventLocal / toEventLocal', () => {
  test('Toronto wall time to the instant, in summer (EDT) and winter (EST)', () => {
    expect(fromEventLocal('2026-10-23T18:00').toISOString()).toBe('2026-10-23T22:00:00.000Z');
    expect(fromEventLocal('2027-01-15T18:00').toISOString()).toBe('2027-01-15T23:00:00.000Z');
    expect(fromEventLocal('2026-10-23T00:00').toISOString()).toBe('2026-10-23T04:00:00.000Z');
  });

  test('round trip, including a late evening that is already the next day in UTC', () => {
    ['2026-10-23T23:30', '2027-01-15T00:00', '2026-03-08T12:00', '2026-11-01T03:15'].forEach(text => {
      expect(toEventLocal(fromEventLocal(text))).toBe(text);
    });
    expect(toEventLocal('2026-10-24T03:30:00+00:00')).toBe('2026-10-23T23:30');
  });

  test('either side of the daylight-saving changes', () => {
    // Spring forward 2026-03-08 at 02:00 EST; fall back 2026-11-01 at 02:00 EDT.
    expect(fromEventLocal('2026-03-08T01:30').toISOString()).toBe('2026-03-08T06:30:00.000Z');
    expect(fromEventLocal('2026-03-08T03:30').toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(fromEventLocal('2026-11-01T00:30').toISOString()).toBe('2026-11-01T04:30:00.000Z');
    expect(fromEventLocal('2026-11-01T03:30').toISOString()).toBe('2026-11-01T08:30:00.000Z');
    // The skipped hour lands an hour earlier; the repeated one is the first (EDT) of the two.
    expect(toEventLocal(fromEventLocal('2026-03-08T02:30'))).toBe('2026-03-08T01:30');
    expect(fromEventLocal('2026-11-01T01:30').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  test('empty or malformed input', () => {
    expect(fromEventLocal('')).toBeNull();
    expect(fromEventLocal('2026-10-23')).toBeNull();
    expect(toEventLocal(null)).toBe('');
  });
});

describe('toInstant', () => {
  test('a bare date (a pre-#149 value) is midnight in Toronto', () => {
    expect(toInstant('2026-10-23').toISOString()).toBe('2026-10-23T04:00:00.000Z');
  });
  test('an instant string as is; garbage as null', () => {
    expect(toInstant('2026-10-23T22:00:00+00:00').toISOString()).toBe('2026-10-23T22:00:00.000Z');
    expect(toInstant('nope')).toBeNull();
  });
});

describe('eventDay', () => {
  test('the Toronto calendar day, as a local-midnight date', () => {
    const day = eventDay('2026-10-24T03:30:00Z'); // 23:30 on the 23rd in Toronto
    expect([day.getFullYear(), day.getMonth() + 1, day.getDate(), day.getHours()]).toEqual([2026, 10, 23, 0]);
  });
});

describe('time display', () => {
  test('midnight has no time worth showing', () => {
    expect(hasEventTime('2026-10-23T04:00:00Z')).toBe(false);
    expect(hasEventTime('2026-10-23T22:00:00Z')).toBe(true);
  });
  test('French time in Toronto', () => {
    expect(formatEventTime('2026-10-23T22:00:00Z')).toMatch(/^18\sh\s00$/);
    expect(eventClock('2027-01-15T23:00:00Z')).toMatchObject({ day: 15, hour: 18, minute: 0 });
  });
});

describe('addEventMonths', () => {
  test('keeps the wall-clock time across a daylight-saving change', () => {
    // 23 Oct 18:00 EDT minus 2 months: 23 Aug 18:00 EDT; 15 Jan 18:00 EST minus 3: 15 Oct 18:00 EDT.
    expect(addEventMonths('2026-10-23T22:00:00Z', -2).toISOString()).toBe('2026-08-23T22:00:00.000Z');
    expect(addEventMonths('2027-01-15T23:00:00Z', -3).toISOString()).toBe('2026-10-15T22:00:00.000Z');
  });
  test('clamps the day to the target month', () => {
    expect(toEventLocal(addEventMonths(fromEventLocal('2026-03-31T10:00'), -1))).toBe('2026-02-28T10:00');
  });
});
