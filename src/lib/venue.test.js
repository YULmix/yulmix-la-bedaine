import { formatCoordinates, parseCoordinates } from './venue.js';

describe('parseCoordinates (#180)', () => {
  test('a latitude and a longitude, as pasted from a map', () => {
    expect(parseCoordinates('45.0050, -72.1000')).toEqual({ lat: 45.005, lng: -72.1 });
    expect(parseCoordinates(' 45.5 -73.6 ')).toEqual({ lat: 45.5, lng: -73.6 });
    expect(parseCoordinates('45;-73')).toEqual({ lat: 45, lng: -73 });
  });

  test('blank clears them', () => {
    expect(parseCoordinates('  ')).toBeNull();
    expect(parseCoordinates(null)).toBeNull();
  });

  test('anything else, or out of range, is not coordinates', () => {
    expect(parseCoordinates('Stanstead')).toBeUndefined();
    expect(parseCoordinates('45.5')).toBeUndefined();
    expect(parseCoordinates('95, -73')).toBeUndefined();
    expect(parseCoordinates('45, -190')).toBeUndefined();
  });

  test('formatCoordinates round-trips, and is blank without them', () => {
    expect(parseCoordinates(formatCoordinates({ lat: 45.005, lng: -72.1 }))).toEqual({ lat: 45.005, lng: -72.1 });
    expect(formatCoordinates({ lat: null, lng: null })).toBe('');
    expect(formatCoordinates(null)).toBe('');
  });
});
