// Jest setup file for RLS policy testing (CommonJS)
const path = require('path');
const dotenv = require('dotenv');

// Load .env.test if it exists, otherwise .env
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });