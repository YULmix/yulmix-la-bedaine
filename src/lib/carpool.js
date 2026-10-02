// The carpool board (#180), shaped for the page from carpool_board()'s rows. Pure
// (carpool.test.js). The database decides who is listed and computes the detours; this only
// sorts the rows into offers and needs, keeps each one's closest matches, and flags the matches
// whose times don't line up.
import { fromEventLocal, toInstant } from './eventTime';

// How far apart two arrivals (or two departures) can be and still share a car.
export const TIME_TOLERANCE_HOURS = 2;
// Matches shown under each offer or need, closest first.
export const MATCHES_SHOWN = 3;

const instantOf = value => (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? fromEventLocal(value) : toInstant(value));

const closeEnough = (a, b) => {
  const [x, y] = [instantOf(a), instantOf(b)];
  return !x || !y || Math.abs(x - y) <= TIME_TOLERANCE_HOURS * 3600 * 1000;
};

/**
 * False when two parties' arrivals, or their departures, are more than TIME_TOLERANCE_HOURS
 * apart. A time either one left blank can't disagree.
 */
export const timesLineUp = (a, b) => closeEnough(a.arrival, b.arrival) && closeEnough(a.departure, b.departure);

/**
 * The board's two sections from carpool_board()'s rows. In each, the caller's own party first,
 * then as the database sorted them. Each entry's `matches` are the other side's parties, closest
 * first, at most MATCHES_SHOWN, each with `detourKm`, `distanceKm` and `timesLineUp`.
 * @returns {{ offers: Array, needs: Array, mine: object|null }}
 */
export const carpoolSections = (rows) => {
  const byEntry = new Map((rows || []).map(row => [row.entry, row]));
  const entries = (rows || []).map(row => ({
    ...row,
    matches: (row.matches || [])
      .filter(match => byEntry.has(match.entry))
      .slice(0, MATCHES_SHOWN)
      .map(match => {
        const other = byEntry.get(match.entry);
        return {
          entry: other.entry,
          contactName: other.contact_name,
          departureFsa: other.departure_fsa,
          detourKm: match.detour_km ?? null,
          distanceKm: match.distance_km ?? null,
          timesLineUp: timesLineUp(row, other)
        };
      })
  }));
  const section = kind => entries
    .filter(entry => entry.kind === kind)
    .sort((a, b) => Number(b.is_mine) - Number(a.is_mine));
  return { offers: section('offer'), needs: section('need'), mine: entries.find(entry => entry.is_mine) || null };
};
