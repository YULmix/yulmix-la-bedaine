import { OPTION_VALUES } from './options.js';
import {
  ACCOMMODATION_OPTIONS,
  BED_REASON_OPTIONS,
  DIETARY_OPTIONS,
  VOLUNTEERING_OPTIONS,
  TRANSPORT_TYPES,
  PAYMENT_STATUS
} from '../../src/lib/registrationOptions';
import { isValidFsa } from '../../src/lib/postalCode';

// The demo data generator can't import registrationOptions.js directly (it imports JSON), so it
// keeps its own copy of the values. If this fails, update scripts/preview-seed/options.js.
const values = (options) => options.map((option) => option.value).sort();

describe('preview seed option values match the app', () => {
  test.each([
    ['sleeping', ACCOMMODATION_OPTIONS],
    ['bedReason', BED_REASON_OPTIONS],
    ['dietary', DIETARY_OPTIONS],
    ['volunteering', VOLUNTEERING_OPTIONS],
    ['transport', TRANSPORT_TYPES]
  ])('%s', (key, appOptions) => {
    expect([...OPTION_VALUES[key]].sort()).toEqual(values(appOptions));
  });

  test('departures are valid postal code starts (#181)', () => {
    expect(OPTION_VALUES.departures.filter(([fsa]) => !isValidFsa(fsa))).toEqual([]);
  });

  test('paymentStatus', () => {
    expect([...OPTION_VALUES.paymentStatus].sort()).toEqual(Object.values(PAYMENT_STATUS).sort());
  });
});
