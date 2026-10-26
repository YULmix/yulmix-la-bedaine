import { closesOnSave, getFeedbackWindow } from './eventFeedback';

// Each row is private.event_feedback_dates() of the same inputs, read from the database
// (start instant, duration_days, feedback_days -> opens_on, closes_on, closes_at in UTC): the
// helper must give the same close, across both daylight-saving changes and a late-evening start.
const FROM_DATABASE = [
  ['2026-10-31T02:00:00Z', 3, 14, '2026-11-02', '2026-11-15', '2026-11-16T05:00:00Z'],
  ['2027-03-13T01:00:00Z', 3, 1, '2027-03-15', '2027-03-15', '2027-03-16T04:00:00Z'],
  ['2027-03-13T01:00:00Z', 2, 7, '2027-03-14', '2027-03-20', '2027-03-21T04:00:00Z'],
  ['2026-10-31T03:30:00Z', 1, 365, '2026-10-31', '2027-10-30', '2027-10-31T04:00:00Z'],
  ['2026-10-31T04:30:00Z', 2, 30, '2026-11-02', '2026-12-01', '2026-12-02T05:00:00Z'],
  ['2026-11-01T05:30:00Z', 1, 1, '2026-11-02', '2026-11-02', '2026-11-03T05:00:00Z']
];

const dayText = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('getFeedbackWindow dates', () => {
  test.each(FROM_DATABASE)('start %s, %i day(s), +%i days closes like the database', (start, duration, days, opensOn, closesOn, closesAt) => {
    const window = getFeedbackWindow({ status: 'ACTIVE', event_start_date: start, duration_days: duration, feedback_days: days }, new Date('2020-01-01T00:00:00Z'));
    expect(dayText(window.closesOn)).toBe(closesOn);
    expect(window.closesAt.getTime()).toBe(new Date(closesAt).getTime());
    // The first answerable day is the day after the last: the state flips to open at its midnight.
    const [y, m, d] = opensOn.split('-').map(Number);
    expect(window.state).toBe('not_yet');
    const justAfterOpen = getFeedbackWindow({ status: 'ACTIVE', event_start_date: start, duration_days: duration, feedback_days: days }, new Date(Date.UTC(y, m - 1, d, 12)));
    expect(justAfterOpen.state).toBe('open');
  });

  test('a missing duration counts one day, a missing offset the default 14', () => {
    const window = getFeedbackWindow({ status: 'ACTIVE', event_start_date: '2026-10-31T02:00:00Z' }, new Date('2020-01-01'));
    expect(dayText(window.closesOn)).toBe('2026-11-13');
  });

  test('no start date, or an invalid offset, has no dates', () => {
    expect(getFeedbackWindow({ status: 'ACTIVE', feedback_days: 14 }).closesOn).toBeNull();
    for (const bad of ['', 0, '1.5', 'x']) {
      expect(getFeedbackWindow({ status: 'ACTIVE', event_start_date: '2026-10-31T02:00:00Z', feedback_days: bad }).closesOn).toBeNull();
    }
  });
});

describe('getFeedbackWindow state', () => {
  const event = { status: 'ACTIVE', event_start_date: '2026-10-31T02:00:00Z', duration_days: 3, feedback_days: 14 };
  test('open from the first answerable day, closed from the close instant, to the second', () => {
    expect(getFeedbackWindow(event, new Date('2026-11-02T04:59:59Z')).state).toBe('not_yet');
    expect(getFeedbackWindow(event, new Date('2026-11-02T05:00:00Z')).state).toBe('open');
    expect(getFeedbackWindow(event, new Date('2026-11-16T04:59:59Z')).state).toBe('open');
    expect(getFeedbackWindow(event, new Date('2026-11-16T05:00:00Z')).state).toBe('closed');
  });
  test('a DRAFT event is never open or closed by date', () => {
    expect(getFeedbackWindow({ ...event, status: 'DRAFT' }, new Date('2027-01-01')).state).toBe('not_yet');
  });
  test('archived, or with the marker set, is closed for good and reports the marker day', () => {
    expect(getFeedbackWindow({ ...event, status: 'ARCHIVED' }, new Date('2026-11-05')).state).toBe('closed');
    const marked = getFeedbackWindow({ ...event, status: 'ACTIVE', feedback_closed_at: '2026-11-16T05:00:00Z', feedback_days: 400 }, new Date('2026-11-05'));
    expect(marked.state).toBe('closed');
    // The scheduled close is a Toronto midnight: the day it closed on is the one before.
    expect(dayText(marked.closedOn)).toBe('2026-11-15');
    const early = getFeedbackWindow({ ...event, feedback_closed_at: '2026-11-05T15:00:00Z' }, new Date('2026-11-06'));
    expect(dayText(early.closedOn)).toBe('2026-11-05');
  });
});

describe('closesOnSave', () => {
  const saved = { status: 'ACTIVE', event_start_date: '2026-10-31T02:00:00Z', duration_days: 3, feedback_days: 14 };
  const now = new Date('2026-11-10T12:00:00Z');
  test('an offset that puts the close in the past closes it on save', () => {
    expect(closesOnSave(saved, { ...saved, feedback_days: 3 }, now)).toBe(true);
    expect(closesOnSave(saved, { ...saved, feedback_days: 30 }, now)).toBe(false);
  });
  test('an already closed feedback has nothing more to close', () => {
    expect(closesOnSave({ ...saved, feedback_closed_at: '2026-11-09T05:00:00Z' }, { ...saved, feedback_closed_at: '2026-11-09T05:00:00Z', feedback_days: 3 }, now)).toBe(false);
  });
});
