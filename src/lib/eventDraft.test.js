import { dirtyFields, draftUpdate, validateDraft } from './eventDraft.js';

const event = {
  theme: 'Disco',
  max_attendees: 90,
  duration_days: 2,
  event_start_date: '2026-07-10',
  reg_start_date: null,
  external_links: [{ label: 'Carte', url: 'https://example.org' }]
};

describe('dirtyFields', () => {
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
