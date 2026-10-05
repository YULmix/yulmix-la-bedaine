// Sort order of the Inscrits list (#259). Pure; the choice lives in the URL as ?tri=.
// `?tri=<key>` is ascending, `?tri=-<key>` descending; the default (name A→Z) has no param.

export const PARTY_SORT_KEYS = ['name', 'registered', 'modified'] as const;
export type PartySortKey = (typeof PARTY_SORT_KEYS)[number];
export type PartySortDirection = 'asc' | 'desc';
export type PartySort = { key: PartySortKey; direction: PartySortDirection };

export const DEFAULT_PARTY_SORT: PartySort = { key: 'name', direction: 'asc' };

// URL names (French, like the rest of the admin URLs) of each key.
const PARAM_OF: Record<PartySortKey, string> = { name: 'nom', registered: 'inscription', modified: 'modification' };

/** A first click on a date sorts newest first; a name, A→Z. */
export const firstDirection = (key: PartySortKey): PartySortDirection => (key === 'name' ? 'asc' : 'desc');

/** The sort a `?tri=` value means; anything unknown is the default. */
export const parsePartySort = (value: string | null | undefined): PartySort => {
  const raw = value ?? '';
  const descending = raw.startsWith('-');
  const key = PARTY_SORT_KEYS.find(k => PARAM_OF[k] === (descending ? raw.slice(1) : raw));
  return key ? { key, direction: descending ? 'desc' : 'asc' } : DEFAULT_PARTY_SORT;
};

/** The `?tri=` value of a sort, or null for the default (the param is then left out). */
export const partySortParam = ({ key, direction }: PartySort): string | null =>
  key === DEFAULT_PARTY_SORT.key && direction === DEFAULT_PARTY_SORT.direction
    ? null
    : `${direction === 'desc' ? '-' : ''}${PARAM_OF[key]}`;

/** The sort after the header of `key` is clicked: the same key reverses, a new one starts at its first direction. */
export const toggledPartySort = (current: PartySort, key: PartySortKey): PartySort =>
  current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: firstDirection(key) };

type SortableParty = {
  id?: string;
  created_at?: string | null;
  last_edited_at?: string | null;
  profiles?: { full_name?: string | null; email?: string | null } | null;
};

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/** The contact's name, else their email. */
export const partyName = (party: SortableParty): string => party.profiles?.full_name?.trim() || party.profiles?.email?.trim() || '';

/** When the registration last changed: the last edit, else the registration itself. */
export const partyModifiedAt = (party: SortableParty): string | null => party.last_edited_at || party.created_at || null;

const time = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

/** A copy of `parties` in the given order. Missing values come last whichever the direction. */
export const sortParties = <T extends SortableParty>(parties: readonly T[], { key, direction }: PartySort = DEFAULT_PARTY_SORT): T[] => {
  const sign = direction === 'desc' ? -1 : 1;
  const byName = (a: T, b: T) => {
    const x = partyName(a);
    const y = partyName(b);
    if (!x || !y) return x === y ? 0 : x ? -1 : 1;
    return collator.compare(x, y);
  };
  const compare = (a: T, b: T): number => {
    if (key === 'name') {
      const x = partyName(a);
      const y = partyName(b);
      if (!x || !y) return x === y ? 0 : x ? -1 : 1;
      return sign * collator.compare(x, y);
    }
    const x = time(key === 'registered' ? a.created_at : partyModifiedAt(a));
    const y = time(key === 'registered' ? b.created_at : partyModifiedAt(b));
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  };
  return [...parties].sort((a, b) => compare(a, b) || byName(a, b) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
};
