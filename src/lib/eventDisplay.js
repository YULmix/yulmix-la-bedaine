import fr from '../locales/fr.json';
import { parseDate, formatDate, formatShortDate } from './format.js';

const DAY_MS = 86400000;

/**
 * The weekend's dates for display: "14 au 16 août 2026", or a single day, or '' if the event
 * has no event_start_date yet. reg_start_date is deliberately not used: it's when registration
 * opens, not when the party happens.
 */
export const formatEventDates = (event) => {
  const start = parseDate(event?.event_start_date);
  if (!start) return '';
  const days = Math.max(event.duration_days || 1, 1);
  if (days === 1) return formatDate(start);
  const end = new Date(start.getTime() + (days - 1) * DAY_MS);
  return fr.dateRange
    .replace('{start}', formatShortDate(start))
    .replace('{end}', formatDate(end));
};

/** "1 personne" / "3 personnes", from a pair of fr.json keys with a {count} placeholder. */
export const plural = (count, oneKey, otherKey) =>
  (count === 1 ? fr[oneKey] : fr[otherKey]).replace('{count}', count);

/** Headcount by age type for a stored attendees array (DB shape: type = Adult|Teenager|Kid). */
export const countAttendeesByType = (attendees = []) => attendees.reduce(
  (acc, attendee) => {
    if (attendee.type === 'Teenager') acc.teens += 1;
    else if (attendee.type === 'Kid') acc.kids += 1;
    else acc.adults += 1;
    return acc;
  },
  { adults: 0, teens: 0, kids: 0 }
);

/** "2 adultes, 1 ado, 1 enfant", skipping zero counts. */
export const formatHeadcountBreakdown = (attendees = []) => {
  const { adults, teens, kids } = countAttendeesByType(attendees);
  return [
    adults && plural(adults, 'countAdultOne', 'countAdultOther'),
    teens && plural(teens, 'countTeenOne', 'countTeenOther'),
    kids && plural(kids, 'countKidOne', 'countKidOther')
  ].filter(Boolean).join(', ');
};

/** Initials for an avatar chip: "Marie-Ève Tremblay" -> "MT". */
export const initials = (name = '') => name
  .split(/[\s-]+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0].toUpperCase())
  .join('') || '?';
