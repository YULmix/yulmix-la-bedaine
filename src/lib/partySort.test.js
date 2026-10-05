import {
  DEFAULT_PARTY_SORT, parsePartySort, partySortParam, sortParties, toggledPartySort
} from './partySort';

const party = (id, name, created, edited = null, email = `${id}@x.test`) => ({
  id, created_at: created, last_edited_at: edited, profiles: { full_name: name, email }
});
const ids = list => list.map(p => p.id);

const A = party('a', 'Émile', '2026-03-02T10:00:00Z', '2026-03-09T10:00:00Z');
const B = party('b', 'zoé', '2026-03-01T10:00:00Z');
const C = party('c', 'Anne', '2026-03-03T10:00:00Z', '2026-03-04T10:00:00Z');
const D = party('d', null, '2026-03-05T10:00:00Z', null, 'bob@x.test');
const ALL = [A, B, C, D];

describe('sortParties', () => {
  it('defaults to name A→Z with French collation, falling back to email', () => {
    expect(ids(sortParties(ALL))).toEqual(['c', 'd', 'a', 'b']);
  });
  it('reverses the name sort', () => {
    expect(ids(sortParties(ALL, { key: 'name', direction: 'desc' }))).toEqual(['b', 'a', 'd', 'c']);
  });
  it('sorts by registration date both ways', () => {
    expect(ids(sortParties(ALL, { key: 'registered', direction: 'asc' }))).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(sortParties(ALL, { key: 'registered', direction: 'desc' }))).toEqual(['d', 'c', 'a', 'b']);
  });
  it('sorts by modification date, a never-edited party counting from its registration', () => {
    // b: 03-01, c: 03-04, d: 03-05, a: 03-09
    expect(ids(sortParties(ALL, { key: 'modified', direction: 'asc' }))).toEqual(['b', 'c', 'd', 'a']);
    expect(ids(sortParties(ALL, { key: 'modified', direction: 'desc' }))).toEqual(['a', 'd', 'c', 'b']);
  });
  it('puts missing values last whichever the direction', () => {
    const none = party('n', 'Nina', null);
    expect(sortParties([none, A], { key: 'registered', direction: 'asc' })[1].id).toBe('n');
    expect(sortParties([none, A], { key: 'registered', direction: 'desc' })[1].id).toBe('n');
    const nameless = { id: 'x', profiles: {} };
    expect(sortParties([nameless, A], { key: 'name', direction: 'desc' })[1].id).toBe('x');
  });
  it('breaks ties by name and does not mutate the input', () => {
    const copy = [...ALL];
    const same = [party('1', 'Zed', '2026-01-01T00:00:00Z'), party('2', 'Amy', '2026-01-01T00:00:00Z')];
    expect(ids(sortParties(same, { key: 'registered', direction: 'desc' }))).toEqual(['2', '1']);
    sortParties(ALL);
    expect(ALL).toEqual(copy);
  });
});

describe('?tri= param', () => {
  it('parses keys and direction, falling back to the default', () => {
    expect(parsePartySort('inscription')).toEqual({ key: 'registered', direction: 'asc' });
    expect(parsePartySort('-modification')).toEqual({ key: 'modified', direction: 'desc' });
    expect(parsePartySort('-nom')).toEqual({ key: 'name', direction: 'desc' });
    expect(parsePartySort('nope')).toEqual(DEFAULT_PARTY_SORT);
    expect(parsePartySort('-')).toEqual(DEFAULT_PARTY_SORT);
    expect(parsePartySort(null)).toEqual(DEFAULT_PARTY_SORT);
  });
  it('writes nothing for the default and round-trips the rest', () => {
    expect(partySortParam(DEFAULT_PARTY_SORT)).toBeNull();
    for (const key of ['name', 'registered', 'modified']) {
      for (const direction of ['asc', 'desc']) {
        const sort = { key, direction };
        expect(parsePartySort(partySortParam(sort) ?? '')).toEqual(sort);
      }
    }
  });
  it('toggles: the same key reverses, a date starts newest first, a name A→Z', () => {
    expect(toggledPartySort(DEFAULT_PARTY_SORT, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(toggledPartySort(DEFAULT_PARTY_SORT, 'modified')).toEqual({ key: 'modified', direction: 'desc' });
    expect(toggledPartySort({ key: 'modified', direction: 'desc' }, 'name')).toEqual(DEFAULT_PARTY_SORT);
  });
});
