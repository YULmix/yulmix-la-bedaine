import fr from '../locales/fr.json';

// « Payé par » (#236): who paid an expense line of the budget, picked among the event's attendees.

export interface PayerOption {
  /** The attendee's id, what the line stores. */
  id: string;
  /** The attendee's full name. */
  name: string;
  /** The party's account name, to tell homonyms apart. */
  accountName: string;
  /** Lower-cased, accent-free text the search runs on. */
  haystack: string;
}

interface PartyLike {
  profiles?: { full_name?: string | null; email?: string | null } | null;
  attendees?: Array<{ id: string; name: string }> | null;
}

const normalise = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** The attendees of the given (active) parties, by name. */
export const payerOptions = (parties: PartyLike[]): PayerOption[] =>
  parties
    .flatMap(party => {
      const accountName = party.profiles?.full_name || party.profiles?.email || '';
      return (party.attendees ?? []).map(attendee => ({
        id: attendee.id,
        name: attendee.name,
        accountName,
        haystack: normalise(`${attendee.name} ${accountName}`)
      }));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));

/** The options matching every word of the query (name or account), ignoring case and accents. */
export const searchPayerOptions = (options: PayerOption[], query: string): PayerOption[] => {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  return options.filter(option => words.every(word => option.haystack.includes(word)));
};

export interface PayerLabel {
  name: string;
  removed: boolean;
}

/** What a line shows for its payer: the name, marked « (retiré) » when the attendee was removed. */
export const payerText = (payer: PayerLabel | null | undefined): string =>
  payer ? (payer.removed ? `${payer.name} ${fr.budgetPayerRemoved}` : payer.name) : '';
