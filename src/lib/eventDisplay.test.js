import { getTravelRange } from './eventDisplay';

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
