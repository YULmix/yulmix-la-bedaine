import fr from '../locales/fr.json';
import { FEEDBACK_CATEGORIES } from './eventFeedback';
import { answerCounts, authorLabel, fetchEventFeedbackCounts, groupByCategory, toFeedbackCounts } from './eventFeedbackAdmin';

// event_feedback_answers()'s shape (#315, ADR 0029).
const author = (name, email = `${name.toLowerCase()}@test.local`) => ({ user_id: `id-${name}`, party_id: `party-${name}`, full_name: name, email });
const closed = {
  closed: true,
  closes_on: '2026-10-20',
  closes_at: '2026-10-21T04:00:00+00:00',
  closed_at: '2026-10-21T05:00:00+00:00',
  named: [
    { answers: { welcome: 'Accueil top', food: null, other: '   ' }, author: author('Alice'), created_at: '2026-10-10', updated_at: '2026-10-10' },
    { answers: { welcome: 'Bof', food: 'Bon' }, author: author('Bruno'), created_at: '2026-10-11', updated_at: '2026-10-11' }
  ],
  // The database's random order: kept as is.
  anonymous: [
    { answers: { welcome: 'Zèbre', food: 'Trop salé' } },
    { answers: { welcome: 'Abricot' } },
    { answers: { welcome: 'Mangue', safety: 'RAS' } }
  ]
};
const group = (result, category) => groupByCategory(result).find(entry => entry.category === category);

describe('groupByCategory', () => {
  test('every category, in display order, an empty one included', () => {
    expect(groupByCategory(closed).map(entry => entry.category)).toEqual([...FEEDBACK_CATEGORIES]);
    expect(group(closed, 'schedule')).toEqual({ category: 'schedule', named: [], anonymous: [] });
  });

  test('named answers with their author, in the database\'s order; blank and null texts skipped', () => {
    expect(group(closed, 'welcome').named).toEqual([{ author: 'Alice', text: 'Accueil top' }, { author: 'Bruno', text: 'Bof' }]);
    expect(group(closed, 'food').named).toEqual([{ author: 'Bruno', text: 'Bon' }]);
    expect(group(closed, 'other').named).toEqual([]);
  });

  test('anonymous answers are their texts only, in the database\'s order, never re-sorted', () => {
    expect(group(closed, 'welcome').anonymous).toEqual(['Zèbre', 'Abricot', 'Mangue']);
    expect(group(closed, 'food').anonymous).toEqual(['Trop salé']);
    expect(group(closed, 'safety').anonymous).toEqual(['RAS']);
  });

  test('anything else an anonymous entry might carry is dropped', () => {
    const leaky = { ...closed, anonymous: [{ answers: { welcome: 'Texte' }, id: 'secret-id', created_at: '2026-10-12', author: author('Eve') }] };
    expect(JSON.stringify(groupByCategory(leaky))).not.toMatch(/secret-id|2026-10-12|Eve/);
  });

  test('before the close: nothing', () => {
    expect(groupByCategory({ ...closed, closed: false, named: null, anonymous: null })).toEqual([]);
    expect(groupByCategory(null)).toEqual([]);
  });
});

describe('answerCounts', () => {
  test('named and shown anonymous answers after the close; zero otherwise', () => {
    expect(answerCounts(closed)).toEqual({ named: 2, anonymous: 3 });
    expect(answerCounts({ ...closed, anonymous: [] })).toEqual({ named: 2, anonymous: 0 });
    expect(answerCounts({ ...closed, closed: false, named: null, anonymous: null })).toEqual({ named: 0, anonymous: 0 });
  });
});

describe('authorLabel', () => {
  test('the name, else the email, else « Compte supprimé »', () => {
    expect(authorLabel(author('Alice'))).toBe('Alice');
    expect(authorLabel({ ...author('Alice'), full_name: ' ' })).toBe('alice@test.local');
    expect(authorLabel(null)).toBe(fr.adminBilanDeletedAuthor);
  });
});

// event_feedback_counts()'s shape (#345, ADR 0029).
describe('toFeedbackCounts', () => {
  const counts = { closed: false, closes_on: '2026-11-08', eligible: 12, signed: 4, anonymous: 3, total: 7 };

  test('the database\'s counts as they are', () => {
    expect(toFeedbackCounts(counts)).toEqual(counts);
  });

  test('anonymous under the threshold: anonymous and total null', () => {
    expect(toFeedbackCounts({ ...counts, anonymous: null, total: null })).toEqual({ ...counts, anonymous: null, total: null });
    // Never a total without the anonymous count, whatever the payload says.
    expect(toFeedbackCounts({ ...counts, anonymous: null, total: 6 }).total).toBeNull();
  });

  test('only the known fields are kept', () => {
    const leaky = { ...counts, author: 'Eve', created_at: '2026-10-12', ids: ['secret-id'] };
    expect(Object.keys(toFeedbackCounts(leaky)).sort()).toEqual(['anonymous', 'closed', 'closes_on', 'eligible', 'signed', 'total']);
  });

  test('a missing payload reads as nothing yet', () => {
    expect(toFeedbackCounts(null)).toEqual({ closed: false, closes_on: null, eligible: 0, signed: 0, anonymous: null, total: null });
  });
});

describe('fetchEventFeedbackCounts', () => {
  const clientReturning = (result) => ({ rpc: jest.fn().mockResolvedValue(result) });

  test('calls event_feedback_counts with the event', async () => {
    const client = clientReturning({ data: { closed: true, closes_on: null, eligible: 3, signed: 1, anonymous: null, total: null }, error: null });
    await expect(fetchEventFeedbackCounts(client, 'event-1')).resolves.toEqual(
      { closed: true, closes_on: null, eligible: 3, signed: 1, anonymous: null, total: null });
    expect(client.rpc).toHaveBeenCalledWith('event_feedback_counts', { p_event_id: 'event-1' });
  });

  test('an error throws in French', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const client = clientReturning({ data: null, error: { message: 'boom', code: 'XX000' } });
    await expect(fetchEventFeedbackCounts(client, 'event-1')).rejects.toThrow(fr.adminBilanLoadError);
    console.error.mockRestore();
  });
});
