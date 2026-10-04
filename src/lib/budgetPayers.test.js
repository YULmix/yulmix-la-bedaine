import fr from '../locales/fr.json';
import { payerOptions, payerText, searchPayerOptions } from './budgetPayers';

const parties = [
  { profiles: { full_name: 'Zoé Martin', email: 'zoe@x.ca' }, attendees: [{ id: 'z1', name: 'Zoé Martin' }, { id: 'z2', name: 'Éloïse Tremblay' }] },
  { profiles: { full_name: null, email: 'bob@x.ca' }, attendees: [{ id: 'b1', name: 'Bob Roy' }] },
  { profiles: { full_name: 'Ann Roy' }, attendees: [{ id: 'a1', name: 'Bob Roy' }] }
];

describe('« Payé par » options (#236)', () => {
  const options = payerOptions(parties);
  const ids = query => searchPayerOptions(options, query).map(option => option.id);

  test('every attendee, by name, with the party\'s account name (or email) as secondary text', () => {
    expect(Object.fromEntries(options.map(o => [o.id, o.accountName])))
      .toEqual({ b1: 'bob@x.ca', a1: 'Ann Roy', z1: 'Zoé Martin', z2: 'Zoé Martin' });
    expect(options.map(o => o.name)).toEqual(['Bob Roy', 'Bob Roy', 'Éloïse Tremblay', 'Zoé Martin']);
  });

  test('the search ignores case and accents, and needs every word', () => {
    expect(ids('')).toHaveLength(4);
    expect(ids('eloise')).toEqual(['z2']);
    expect(ids('ÉLOÏSE')).toEqual(['z2']);
    expect(ids('zoe')).toEqual(expect.arrayContaining(['z1', 'z2']));
    expect(ids('roy bob')).toHaveLength(2);
    expect(ids('ann')).toEqual(['a1']); // the account name tells homonyms apart
    expect(ids('nobody')).toEqual([]);
  });

  test('a removed payer shows with « (retiré) »', () => {
    expect(payerText({ name: 'Bob', removed: false })).toBe('Bob');
    expect(payerText({ name: 'Bob', removed: true })).toBe(`Bob ${fr.budgetPayerRemoved}`);
    expect(payerText(null)).toBe('');
  });
});
