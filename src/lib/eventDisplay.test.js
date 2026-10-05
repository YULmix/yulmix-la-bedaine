import { formatEventDates, getTravelRange, ofName } from './eventDisplay';

describe('getTravelRange', () => {
  it('arrives midday on the first day, leaves mid-afternoon on the last, and spans the whole event', () => {
    expect(getTravelRange({ event_start_date: '2026-08-14', duration_days: 3 })).toEqual({
      min: '2026-08-14T00:00',
      max: '2026-08-16T23:59',
      defaultArrival: '2026-08-14T12:00',
      defaultDeparture: '2026-08-16T15:00'
    });
  });

  it('still leaves after arriving on a one-day event', () => {
    const { defaultArrival, defaultDeparture } = getTravelRange({ event_start_date: '2026-08-14', duration_days: 1 });
    expect(defaultDeparture > defaultArrival).toBe(true);
  });

  it('treats a missing duration as a single day', () => {
    expect(getTravelRange({ event_start_date: '2026-08-14' }).max).toBe('2026-08-14T23:59');
  });

  it('crosses a month boundary', () => {
    expect(getTravelRange({ event_start_date: '2026-08-30', duration_days: 3 }).max).toBe('2026-09-01T23:59');
  });

  it('is blank without an event_start_date', () => {
    const blank = { min: '', max: '', defaultArrival: '', defaultDeparture: '' };
    expect(getTravelRange({})).toEqual(blank);
    expect(getTravelRange(null)).toEqual(blank);
  });
});

// #149: event_start_date is an instant, read in Toronto.
describe('with a start time', () => {
  // 14 August 2026 at 23:30 in Toronto: already the 15th in UTC.
  const lateStart = '2026-08-15T03:30:00+00:00';

  test('the event days are Toronto days', () => {
    expect(getTravelRange({ event_start_date: lateStart, duration_days: 3 })).toMatchObject({
      min: '2026-08-14T00:00',
      max: '2026-08-16T23:59'
    });
  });

  test('the dates show the start time, unless it is midnight', () => {
    expect(formatEventDates({ event_start_date: lateStart, duration_days: 3 })).toMatch(/^14 août au 16 août 2026, dès 23\sh\s30$/);
    expect(formatEventDates({ event_start_date: '2026-08-14T22:00:00Z', duration_days: 1 })).toMatch(/^14 août 2026, dès 18\sh\s00$/);
    expect(formatEventDates({ event_start_date: '2026-08-14T04:00:00Z', duration_days: 3 })).toBe('14 août au 16 août 2026');
  });
});

describe('ofName', () => {
  it('elides « de » before a vowel, accented or not, whatever the case', () => {
    expect(ofName('Absalon Guillot')).toBe("d'Absalon Guillot");
    expect(ofName('Émile')).toBe("d'Émile");
    expect(ofName('yves')).toBe("d'yves");
  });

  it('keeps « de » before a consonant or an h', () => {
    expect(ofName('Marc Guillot')).toBe('de Marc Guillot');
    expect(ofName('Hélier Royer')).toBe('de Hélier Royer');
  });
});
