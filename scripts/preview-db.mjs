#!/usr/bin/env node
// Resets the PREVIEW Supabase database (ADR 0015) and fills it with generated fake data, so a
// branch's preview deployment can be tested. Never production.
//
// Usage:
//   npm run db:preview:reset                 wipe Preview, re-apply this branch's migrations,
//                                            load supabase/seed.sql + generated demo data
//   npm run db:local:demo                    same data into the LOCAL Supabase instead
//   npm run db:seed:generate                 only write the generated SQL, to inspect it
// Options (after `--`, e.g. `npm run db:preview:reset -- --seed 7`):
//   --seed <n>    one-off seed instead of supabase/preview-seed.json's "seed"
//   --dry-run     (reset) print what would run, generate the SQL, touch no database
//   --yes         (reset) skip the "type the project ref" confirmation (used by CI)
//
// The knobs (how many members, registrations, past events, paid share...) live in
// supabase/preview-seed.json; see docs/07-development-setup.md. The generated SQL is written to
// supabase/seeds/preview.generated.sql (gitignored) on every run.
//
// A reset (`supabase db reset --db-url`) drops everything in `public` and truncates every `auth`
// table: all users are deleted. The generated seed ends by installing a Preview-only trigger that
// makes every account created afterwards an admin, so people signing in with Google on a preview
// deployment are admins; the seeded fake users stay regular members.
//
// Connection: only ever an explicit PREVIEW_DB_URL (env or .env.preview.local), never `--linked`
// (the CLI's linked project in this repo is production). `--project-ref` isn't used either: it
// needs IPv6 to reach the direct host, and its IPv4 fallback is the pooler URL cached in
// supabase/.temp/, which is production's, so the CLI rejects it for Preview.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { generatePreviewSeed } from './preview-seed/generate.mjs';

const PREVIEW_REF = 'uacfrldoiixfstigosqv';
const PRODUCTION_REF = 'ceacurlofmasyvhsoska';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_FILE = join(ROOT, '.env.preview.local');
const CONFIG_FILE = join(ROOT, 'supabase', 'preview-seed.json');
const GENERATED_FILE = join(ROOT, 'supabase', 'seeds', 'preview.generated.sql');
// Relative to supabase/, as `db reset --sql-paths` expects. seed.sql first: it creates the
// fixed test users the generated data refers to.
const SEED_PATHS = ['./seed.sql', './seeds/preview.generated.sql'];

const args = process.argv.slice(2);
const command = args[0];
const dryRun = args.includes('--dry-run');
const assumeYes = args.includes('--yes');
const seedArg = args.indexOf('--seed');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function seedOverride() {
  if (seedArg === -1) return undefined;
  const raw = args[seedArg + 1];
  if (raw === undefined || raw === '') return undefined; // CI passes an empty input as ""
  const seed = Number(raw);
  if (!Number.isInteger(seed) || seed < 0) fail(`--seed must be a non-negative integer, got "${raw}".`);
  return seed;
}

function generate() {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    fail(`Could not read ${CONFIG_FILE}: ${error.message}`);
  }
  let sql;
  try {
    sql = generatePreviewSeed(config, seedOverride());
  } catch (error) {
    fail(error.message);
  }
  mkdirSync(dirname(GENERATED_FILE), { recursive: true });
  writeFileSync(GENERATED_FILE, sql, 'utf8');
  console.log(`Generated ${GENERATED_FILE} (seed ${seedOverride() ?? config.seed}).`);
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

// Refuses anything that isn't unambiguously the Preview project.
function previewDbUrl() {
  const raw = process.env.PREVIEW_DB_URL || readEnvFile(ENV_FILE).PREVIEW_DB_URL;
  if (!raw) {
    fail(`PREVIEW_DB_URL is not set. Put Preview's session pooler connection string in ${ENV_FILE}\n` +
      '  (Supabase dashboard → project "YULmix - La Bedaine (Preview)" → Connect → Session pooler).');
  }
  if (raw.includes(PRODUCTION_REF)) fail('PREVIEW_DB_URL mentions the PRODUCTION project ref. Refusing.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('PREVIEW_DB_URL is not a valid postgresql:// URL (the password must be percent-encoded).');
  }
  const isPreviewPooler = decodeURIComponent(url.username) === `postgres.${PREVIEW_REF}`;
  const isPreviewDirect = url.hostname === `db.${PREVIEW_REF}.supabase.co`;
  if (!/^postgres(ql)?:$/.test(url.protocol) || !(isPreviewPooler || isPreviewDirect)) {
    fail(`PREVIEW_DB_URL must point at the Preview project (${PREVIEW_REF}): user "postgres.${PREVIEW_REF}" ` +
      `on the pooler, or host "db.${PREVIEW_REF}.supabase.co".`);
  }
  return raw;
}

function redact(dbUrl) {
  const url = new URL(dbUrl);
  if (url.password) url.password = '***';
  return url.toString();
}

function runSupabase(cliArgs, dbUrl) {
  const shown = cliArgs.map((a) => (a === dbUrl ? redact(dbUrl) : a));
  console.log(`\n$ supabase ${shown.join(' ')}`);
  if (dryRun) return;
  const result = spawnSync('supabase', cliArgs, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) fail(`could not run the Supabase CLI: ${result.error.message}`);
  if (result.status !== 0) fail(`supabase ${cliArgs[0]} ${cliArgs[1]} failed (exit ${result.status}).`);
}

async function confirm(what) {
  if (assumeYes || dryRun) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n${what}\nType the Preview project ref (${PREVIEW_REF}) to continue: `);
  rl.close();
  if (answer.trim() !== PREVIEW_REF) fail('Confirmation did not match. Nothing was changed.');
}

const seedArgs = SEED_PATHS.flatMap((path) => ['--sql-paths', path]);

async function main() {
  switch (command) {
    case 'generate':
      generate();
      break;
    case 'local':
      generate();
      runSupabase(['db', 'reset', '--local', ...seedArgs]);
      console.log('\n✔ Local database reset with the generated demo data.');
      break;
    case 'reset': {
      const dbUrl = previewDbUrl();
      console.log(`Target: Preview project ${PREVIEW_REF} (${redact(dbUrl)})${dryRun ? ' [dry run]' : ''}`);
      generate();
      await confirm('This DELETES all data and all users on the Preview database, then re-seeds it.');
      runSupabase(['db', 'reset', '--db-url', dbUrl, ...seedArgs, '--yes'], dbUrl);
      console.log(dryRun
        ? `\nDry run: nothing was changed. Inspect ${GENERATED_FILE}.`
        : '\n✔ Preview database reset. Anyone who signs in from now on is an admin.');
      break;
    }
    default:
      fail('Usage: node scripts/preview-db.mjs <reset|local|generate> [--seed <n>] [--dry-run] [--yes]');
  }
}

await main();
