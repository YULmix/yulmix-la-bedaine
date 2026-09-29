import { getArrivalRange } from './eventDisplay';

describe('getArrivalRange', () => {
  it('defaults to midday on the first day and spans the whole event', () => {
    expect(getArrivalRange({ event_start_date: '2026-08-14', duration_days: 3 })).toEqual({
      min: '2026-08-14T00:00',
      max: '2026-08-16T23:59',
      defaultValue: '2026-08-14T12:00'
    });
  });

  it('treats a missing duration as a single day', () => {
    expect(getArrivalRange({ event_start_date: '2026-08-14' }).max).toBe('2026-08-14T23:59');
  });

  it('crosses a month boundary', () => {
    expect(getArrivalRange({ event_start_date: '2026-08-30', duration_days: 3 }).max).toBe('2026-09-01T23:59');
  });

  it('is blank without an event_start_date', () => {
    expect(getArrivalRange({})).toEqual({ min: '', max: '', defaultValue: '' });
    expect(getArrivalRange(null)).toEqual({ min: '', max: '', defaultValue: '' });
  });
});
