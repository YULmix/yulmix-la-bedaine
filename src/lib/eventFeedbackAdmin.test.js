import fr from '../locales/fr.json';
import { FEEDBACK_CATEGORIES } from './eventFeedback';
import { answerCounts, authorLabel, groupByCategory } from './eventFeedbackAdmin';

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
