// Jest setup file (CommonJS)
const path = require('path');
const dotenv = require('dotenv');
const { TextEncoder, TextDecoder } = require('util');

// Load .env.test if it exists, otherwise .env
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

// jest-environment-jsdom doesn't provide these, but react-router-dom's ESM build
// references them at import time.
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}