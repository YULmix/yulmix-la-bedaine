import fr from '../locales/fr.json';
import { FEEDBACK_CATEGORIES } from './eventFeedback';
import { authorLabel, fetchEventFeedbackCounts, groupByCategory, responseRate, shownCounts, toFeedbackCounts } from './eventFeedbackAdmin';

// event_feedback_answers()'s shape (#354, ADR 0029): live, signed items with their author, private
// texts once released.
const author = (name, email = `${name.toLowerCase()}@test.local`) => ({ id: `id-${name}`, party: `party-${name}`, name, email });
const result = {
  closed: false,
  closes_on: '2026-10-20',
  closes_at: '2026-10-21T04:00:00+00:00',
  closed_at: null,
  released: true,
  signed: [
    { category: 'welcome', text: 'Accueil top', author: author('Alice') },
    { category: 'welcome', text: 'Bof', author: author('Bruno') },
    { category: 'food', text: 'Bon', author: author('Bruno') },
    { category: 'other', text: '   ', author: author('Alice') }
  ],
  // The database's random order: kept as is.
  private: [
    { category: 'welcome', text: 'Zèbre' },
    { category: 'food', text: 'Trop salé' },
    { category: 'welcome', text: 'Abricot' },
    { category: 'safety', text: 'RAS' },
    { category: 'welcome', text: 'Mangue' }
  ]
};
const group = (payload, category) => groupByCategory(payload).find(entry => entry.category === category);

describe('groupByCategory', () => {
  test('every category, in display order, an empty one included', () => {
    expect(groupByCategory(result).map(entry => entry.category)).toEqual([...FEEDBACK_CATEGORIES]);
    expect(group(result, 'schedule')).toEqual({ category: 'schedule', named: [], anonymous: [] });
  });

  test('signed items with their author, in the database\'s order; blank texts skipped', () => {
    expect(group(result, 'welcome').named).toEqual([{ author: 'Alice', text: 'Accueil top' }, { author: 'Bruno', text: 'Bof' }]);
    expect(group(result, 'food').named).toEqual([{ author: 'Bruno', text: 'Bon' }]);
    expect(group(result, 'other').named).toEqual([]);
  });

  test('private items are their texts only, in the database\'s order, never re-sorted', () => {
    expect(group(result, 'welcome').anonymous).toEqual(['Zèbre', 'Abricot', 'Mangue']);
    expect(group(result, 'food').anonymous).toEqual(['Trop salé']);
    expect(group(result, 'safety').anonymous).toEqual(['RAS']);
  });

  test('anything else a private entry might carry is dropped', () => {
    const leaky = { ...result, private: [{ category: 'welcome', text: 'Texte', id: 'secret-id', created_at: '2026-10-12', author: author('Eve') }] };
    expect(JSON.stringify(groupByCategory(leaky))).not.toMatch(/secret-id|2026-10-12|Eve/);
  });

  test('live, before the close too; nothing without a result', () => {
    expect(group(result, 'welcome').named).toHaveLength(2);
    expect(groupByCategory({ ...result, closed: true }).map(entry => entry.category)).toEqual([...FEEDBACK_CATEGORIES]);
    expect(groupByCategory(null)).toEqual([]);
  });

  test('not released: the signed items only', () => {
    expect(group({ ...result, released: false, private: [] }, 'welcome').anonymous).toEqual([]);
  });
});

// event_feedback_counts()'s shape (#354, ADR 0029).
const counts = {
  closed: false,
  closes_on: '2026-11-08',
  eligible: 12,
  signed_members: 4,
  released: true,
  categories: FEEDBACK_CATEGORIES.map((category, index) => ({ category, signed: index, private: index % 2 })),
  signed_total: 28,
  private_total: 4
};

describe('toFeedbackCounts', () => {
  test('the database\'s counts as they are', () => {
    expect(toFeedbackCounts(counts)).toEqual(counts);
  });

  test('not released: every private number null, whatever the payload says', () => {
    const parsed = toFeedbackCounts({ ...counts, released: false });
    expect(parsed.private_total).toBeNull();
    expect(parsed.categories.every(row => row.private === null)).toBe(true);
    expect(parsed.categories.map(row => row.signed)).toEqual(counts.categories.map(row => row.signed));
  });

  test('only the known fields are kept, every category in display order', () => {
    const leaky = { ...counts, author: 'Eve', created_at: '2026-10-12', categories: [{ category: 'food', signed: 2, private: 1, ids: ['secret-id'] }] };
    const parsed = toFeedbackCounts(leaky);
    expect(Object.keys(parsed).sort()).toEqual(['categories', 'closed', 'closes_on', 'eligible', 'private_total', 'released', 'signed_members', 'signed_total']);
    expect(parsed.categories.map(row => row.category)).toEqual([...FEEDBACK_CATEGORIES]);
    expect(parsed.categories.find(row => row.category === 'food')).toEqual({ category: 'food', signed: 2, private: 1 });
    expect(parsed.categories.find(row => row.category === 'welcome')).toEqual({ category: 'welcome', signed: 0, private: 0 });
    expect(JSON.stringify(parsed)).not.toMatch(/Eve|secret-id|2026-10-12/);
  });

  test('a missing payload reads as nothing yet', () => {
    expect(toFeedbackCounts(null)).toEqual({
      closed: false, closes_on: null, eligible: 0, signed_members: 0, released: false,
      categories: FEEDBACK_CATEGORIES.map(category => ({ category, signed: 0, private: null })), signed_total: 0, private_total: null
    });
  });
});

// Transitional, until #356: the dashboard's figures.
describe('shownCounts', () => {
  test('the signed members, the private items once released, never a total', () => {
    expect(shownCounts(toFeedbackCounts(counts))).toEqual({ closed: false, closes_on: '2026-11-08', eligible: 12, signed: 4, anonymous: 4, total: null });
    expect(shownCounts(toFeedbackCounts({ ...counts, released: false }))).toMatchObject({ signed: 4, anonymous: null, total: null });
  });
});

describe('responseRate', () => {
  const base = { closed: false, closes_on: null, eligible: 86, signed: 23, anonymous: null, total: null };
  test('signed only while the total is hidden, all answers once it is shown', () => {
    expect(responseRate(base)).toBe(27);
    expect(responseRate({ ...base, signed: 31, anonymous: 12, total: 43 })).toBe(50);
  });
  test('0 without eligible registrations, never above 100', () => {
    expect(responseRate({ ...base, eligible: 0 })).toBe(0);
    expect(responseRate({ ...base, eligible: 2, signed: 3 })).toBe(100);
  });
});

describe('authorLabel', () => {
  test('the name, else the email, else « Compte supprimé »', () => {
    expect(authorLabel(author('Alice'))).toBe('Alice');
    expect(authorLabel({ ...author('Alice'), name: ' ' })).toBe('alice@test.local');
    expect(authorLabel(null)).toBe(fr.adminBilanDeletedAuthor);
  });
});

describe('fetchEventFeedbackCounts', () => {
  const clientReturning = (payload) => ({ rpc: jest.fn().mockResolvedValue(payload) });

  test('calls event_feedback_counts with the event', async () => {
    const client = clientReturning({ data: counts, error: null });
    await expect(fetchEventFeedbackCounts(client, 'event-1')).resolves.toEqual(counts);
    expect(client.rpc).toHaveBeenCalledWith('event_feedback_counts', { p_event_id: 'event-1' });
  });

  test('an error throws in French', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const client = clientReturning({ data: null, error: { message: 'boom', code: 'XX000' } });
    await expect(fetchEventFeedbackCounts(client, 'event-1')).rejects.toThrow(fr.adminBilanLoadError);
    console.error.mockRestore();
  });
});
