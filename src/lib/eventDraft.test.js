import { dateInputValue, dirtyFields, draftUpdate, validateDraft, validateNewEvent } from './eventDraft.js';

const event = {
  theme: 'Disco',
  max_attendees: 90,
  duration_days: 2,
  event_start_date: '2026-07-10',
  reg_start_date: null,
  external_links: [{ label: 'Carte', url: 'https://example.org' }]
};

describe('dirtyFields', () => {
  test('ignores fields the event no longer has', () => {
    expect(dirtyFields({ theme: 'Disco' }, { venue_address: '1 rue du Lac', theme: 'Rétro' })).toEqual(['theme']);
  });

  test('ignores fields typed back to their saved value', () => {
    expect(dirtyFields(event, { theme: 'Disco', max_attendees: '90', reg_start_date: '' })).toEqual([]);
  });

  test('lists the fields that differ', () => {
    expect(dirtyFields(event, { theme: 'Disco 2', max_attendees: '85' })).toEqual(['theme', 'max_attendees']);
  });

  test('compares links by content', () => {
    expect(dirtyFields(event, { external_links: [{ label: 'Carte', url: 'https://example.org' }] })).toEqual([]);
    expect(dirtyFields(event, { external_links: [] })).toEqual(['external_links']);
  });
});

describe('validateDraft', () => {
  test('accepts whole numbers at or above the minimum', () => {
    expect(validateDraft(event, { max_attendees: '85', z_intent_months: '0' })).toEqual({});
  });

  test('refuses empty, decimal and too-small numbers', () => {
    expect(validateDraft(event, { max_attendees: '', duration_days: '1.5', x_reg_close_weeks: '-1' }))
      .toEqual({ max_attendees: 'integer', duration_days: 'integer', x_reg_close_weeks: 'integer' });
    expect(validateDraft(event, { duration_days: '0' })).toEqual({ duration_days: 'min' });
  });

  test('requires a title', () => {
    expect(validateDraft(event, { theme: '  ' })).toEqual({ theme: 'required' });
    expect(validateDraft(event, { theme: 'Disco 2' })).toEqual({});
  });

  test('registration opens strictly before the event starts, when both dates are set', () => {
    expect(validateDraft(event, { reg_start_date: '2026-07-10' })).toEqual({ reg_start_date: 'order' });
    expect(validateDraft(event, { reg_start_date: '2026-07-11' })).toEqual({ reg_start_date: 'order' });
    expect(validateDraft(event, { reg_start_date: '2026-05-01' })).toEqual({});
    // Moving the event start is checked against the saved registration start too.
    expect(validateDraft({ ...event, reg_start_date: '2026-05-01' }, { event_start_date: '2026-04-30' }))
      .toEqual({ reg_start_date: 'order' });
    expect(validateDraft(event, { event_start_date: '' })).toEqual({});
  });

  test('links need a label and an http(s) URL; fully empty rows are fine', () => {
    expect(validateDraft(event, {
      external_links: [
        { label: '', url: '' },
        { label: 'Carte', url: '' },
        { label: 'Carte', url: 'example.org' },
        { label: 'Carte', url: 'javascript:alert(1)' },
        { label: 'Carte', url: 'https://example.org' }
      ]
    })).toEqual({ external_links: { 1: 'incomplete', 2: 'url', 3: 'url' } });
  });

  test('only checks the fields the draft holds', () => {
    expect(validateDraft({ ...event, theme: '', reg_start_date: '2026-08-01' }, { description: 'x' })).toEqual({});
  });
});

describe('draftUpdate', () => {
  test('drops empty link rows and trims the rest', () => {
    expect(draftUpdate(event, { external_links: [{ label: ' Carte ', url: 'https://example.org ' }, { label: '', url: ' ' }] }))
      .toEqual({});
    expect(draftUpdate(event, { external_links: [{ label: 'Plan', url: 'https://example.org/plan' }, { label: '', url: '' }] }))
      .toEqual({ external_links: [{ label: 'Plan', url: 'https://example.org/plan' }] });
  });

  test('sends only dirty fields, with numbers and empty dates converted', () => {
    expect(draftUpdate(event, { theme: 'Disco', max_attendees: '85', event_start_date: '' }))
      .toEqual({ max_attendees: 85, event_start_date: null });
  });
});

// #149: the inputs hold Toronto wall-clock text; the event holds instants.
describe('date and time fields', () => {
  const timed = { ...event, event_start_date: '2026-07-10T22:00:00+00:00', reg_start_date: '2026-05-01T04:00:00+00:00' };

  test('the input shows the saved instant in Toronto, or the draft as typed', () => {
    expect(dateInputValue(timed.event_start_date)).toBe('2026-07-10T18:00');
    expect(dateInputValue('2026-07-11T09:30')).toBe('2026-07-11T09:30');
    expect(dateInputValue(null)).toBe('');
    // A draft stored before #149 held a bare date.
    expect(dateInputValue('2026-07-10')).toBe('2026-07-10T00:00');
  });

  test('the saved time typed back is not a change; another time is', () => {
    expect(dirtyFields(timed, { event_start_date: '2026-07-10T18:00' })).toEqual([]);
    expect(dirtyFields(timed, { event_start_date: '2026-07-10T19:00' })).toEqual(['event_start_date']);
  });

  test('saves the Toronto time as an instant, and a cleared field as null', () => {
    expect(draftUpdate(timed, { event_start_date: '2026-12-04T19:30', reg_start_date: '' })).toEqual({
      event_start_date: '2026-12-05T00:30:00.000Z',
      reg_start_date: null
    });
  });

  test('registration must open before the event starts, to the minute', () => {
    expect(validateDraft(timed, { reg_start_date: '2026-07-10T17:59' })).toEqual({});
    expect(validateDraft(timed, { reg_start_date: '2026-07-10T18:00' })).toEqual({ reg_start_date: 'order' });
  });
});

describe('validateNewEvent (#111)', () => {
  test('a new event needs a title and an event start, touched or not', () => {
    expect(validateNewEvent({})).toEqual({ theme: 'required', event_start_date: 'required' });
    expect(validateNewEvent({ theme: '  ', event_start_date: '2027-03-05T20:00' })).toEqual({ theme: 'required' });
    expect(validateNewEvent({ theme: 'Soirée', event_start_date: '' })).toEqual({ event_start_date: 'required' });
    expect(validateNewEvent({ theme: 'Soirée', event_start_date: '2027-03-05T20:00' })).toEqual({});
  });

  test('still checks what was typed', () => {
    expect(validateNewEvent({ theme: 'Soirée', event_start_date: '2027-03-05T20:00', max_attendees: '0', reg_start_date: '2027-04-01T10:00' }))
      .toEqual({ max_attendees: 'min', reg_start_date: 'order' });
  });
});
