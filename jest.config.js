export default {
  testEnvironment: 'jest-environment-jsdom',
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^(\\.{1,2}/.*)\\.jsx$': '$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@supabase/supabase-js)/)',
  ],
  setupFiles: ['<rootDir>/src/__tests__/setup.js'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setupAfterEnv.js'],
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  // rlsPolicies.test.js is an integration suite: it needs a running local Supabase instance
  // and a real SUPABASE_SERVICE_ROLE_KEY (see supabase/tests/README.md). It is excluded from
  // the default `npm test` run so CI stays green without that infrastructure, and runs
  // separately via `npm run test:rls`, which resets this ignore pattern.
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/__tests__/rlsPolicies.test.js'
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/**/*.test.{js,jsx}',
    '!src/__tests__/**'
  ],
};