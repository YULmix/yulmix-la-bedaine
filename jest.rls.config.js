// Config for the RLS integration suite (`npm run test:rls`).
// Identical to jest.config.js except it does not exclude src/__tests__/rlsPolicies.test.js —
// that exclusion in the default config is what keeps `npm test` green without a live Supabase.
import baseConfig from './jest.config.js';

export default {
  ...baseConfig,
  testPathIgnorePatterns: ['/node_modules/'],
};
