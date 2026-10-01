import { isValidFsa, normalizeFsa } from './postalCode';

test('normalizeFsa keeps the first three characters of what was typed, in upper case', () => {
  expect(normalizeFsa('h2g')).toBe('H2G');
  expect(normalizeFsa(' h2g 1a1 ')).toBe('H2G');
  expect(normalizeFsa('H2G-1A1')).toBe('H2G');
  expect(normalizeFsa('')).toBe('');
  expect(normalizeFsa(undefined)).toBe('');
});

test('isValidFsa follows Canada Post\'s letters', () => {
  expect(['H2G', 'G1R', 'J4K', 'K1A', 'V5Z', 'X0A'].every(isValidFsa)).toBe(true);
  // Never-used letters, W or Z first, wrong shape.
  expect(['D2G', 'H2O', 'W1A', 'Z1A', '2HG', 'H2', 'H2GG', 'h2g', ''].some(isValidFsa)).toBe(false);
});
