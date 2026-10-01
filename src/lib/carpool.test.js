import { MATCHES_SHOWN, carpoolSections, timesLineUp } from './carpool.js';

const row = (entry, kind, fields = {}) => ({
  entry, kind, is_mine: false, contact_name: `P${entry}`, contact_email: `p${entry}@example.com`,
  departure_fsa: null, departure_place: null, arrival: null, departure: null, seats: 1, matches: [], ...fields
});

describe('timesLineUp', () => {
  test('arrivals and departures within two hours line up', () => {
    expect(timesLineUp(
      { arrival: '2026-07-10T18:00', departure: '2026-07-12T14:00' },
      { arrival: '2026-07-10T19:30', departure: '2026-07-12T12:00' }
    )).toBe(true);
  });

  test('an arrival, or a departure, further apart does not', () => {
    expect(timesLineUp({ arrival: '2026-07-10T18:00' }, { arrival: '2026-07-10T21:00' })).toBe(false);
    expect(timesLineUp({ departure: '2026-07-12T10:00' }, { departure: '2026-07-11T10:00' })).toBe(false);
  });

  test('a blank time cannot disagree', () => {
    expect(timesLineUp({ arrival: '', departure: null }, { arrival: '2026-07-10T18:00', departure: '2026-07-12T10:00' })).toBe(true);
  });
});

describe('carpoolSections', () => {
  test('splits offers and needs, puts the caller first, and resolves matches', () => {
    const rows = [
      row(1, 'offer', { matches: [{ entry: 4, detour_km: 2.5, distance_km: 6 }] }),
      row(2, 'offer', { is_mine: true }),
      row(3, 'need'),
      row(4, 'need', { departure_fsa: 'H2G', matches: [{ entry: 1, detour_km: 2.5, distance_km: 6 }] })
    ];
    const { offers, needs, mine } = carpoolSections(rows);
    expect(offers.map(entry => entry.entry)).toEqual([2, 1]);
    expect(needs.map(entry => entry.entry)).toEqual([3, 4]);
    expect(mine.entry).toBe(2);
    expect(offers[1].matches).toEqual([
      { entry: 4, contactName: 'P4', departureFsa: 'H2G', detourKm: 2.5, distanceKm: 6, timesLineUp: true }
    ]);
  });

  test('keeps the closest matches only, and flags the ones whose times differ', () => {
    const needs = [3, 4, 5, 6].map(entry => row(entry, 'need', { arrival: entry === 3 ? '2026-07-11T09:00' : '2026-07-10T18:00' }));
    const offer = row(1, 'offer', { arrival: '2026-07-10T18:00', matches: needs.map((need, i) => ({ entry: need.entry, detour_km: i, distance_km: i })) });
    const [entry] = carpoolSections([offer, ...needs]).offers;
    expect(entry.matches).toHaveLength(MATCHES_SHOWN);
    expect(entry.matches.map(match => [match.entry, match.timesLineUp])).toEqual([[3, false], [4, true], [5, true]]);
  });

  test('no rows: empty sections, nobody is the caller', () => {
    expect(carpoolSections([])).toEqual({ offers: [], needs: [], mine: null });
    expect(carpoolSections(null)).toEqual({ offers: [], needs: [], mine: null });
  });
});
