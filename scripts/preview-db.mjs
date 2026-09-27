#!/usr/bin/env node
// Resets and seeds the PREVIEW Supabase project (ADR 0015) so a branch's preview deployment
// can be tested against known data. Never production.
//
// Usage:
//   npm run db:preview:reset             wipe Preview, re-apply supabase/migrations/, seed the
//                                        fake users + demo data, then grant the admin allowlist
//   npm run db:preview:admins            only (re)apply the admin allowlist, no reset
//   ... -- --dry-run                     print what would run (password redacted), touch nothing
//   ... -- --yes                         skip the "type the project ref" confirmation
//
// Needs two local-only, gitignored files (see docs/07-development-setup.md):
//   .env.preview.local            PREVIEW_DB_URL=<Preview's session pooler connection string>
//   supabase/preview-admins.local one email per line (optionally "email, Full Name"), # comments
//
// What a reset does (Supabase CLI `db reset --db-url`): drops everything in `public`, truncates
// every `auth` table (all users, including real Google sign-ins, are gone), re-applies every
// migration, then runs supabase/seed.sql and supabase/seeds/preview.sql.
//
// Admins: since the reset deletes every user, each allowlisted email gets a pre-created,
// email-confirmed auth user with profiles.is_admin = true. Signing in with Google under that same
// (verified) email later links to that user via Supabase's automatic identity linking, so the
// admin flag is already there on first sign-in. Allowlisted users who already exist are just
// promoted.
//
// Connection: only ever an explicit --db-url, never `--linked` (the CLI's linked project in this
// repo is production). `--project-ref` isn't used either: it needs IPv6 to reach the direct host,
// and its IPv4 fallback is the pooler URL cached in supabase/.temp/, which is production's, so
// the CLI rejects it for Preview. The session pooler URL works over IPv4 and names its target.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const PREVIEW_REF = 'uacfrldoiixfstigosqv';
const PRODUCTION_REF = 'ceacurlofmasyvhsoska';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_FILE = join(ROOT, '.env.preview.local');
const ADMINS_FILE = join(ROOT, 'supabase', 'preview-admins.local');
// Relative to supabase/, as `db reset --sql-paths` expects. Order matters: seed.sql creates the
// test users that preview.sql's registrations belong to.
const SEED_PATHS = ['./seed.sql', './seeds/preview.sql'];

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const assumeYes = args.includes('--yes');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
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

// "email" or "email, Full Name" per line; blank lines and # comments ignored.
function readAdmins() {
  if (!existsSync(ADMINS_FILE)) {
    console.warn(`! ${ADMINS_FILE} not found: only the seeded admin@test.local will be an admin.`);
    return [];
  }
  const admins = [];
  readFileSync(ADMINS_FILE, 'utf8').split(/\r?\n/).forEach((line, index) => {
    const content = line.replace(/#.*/, '').trim();
    if (!content) return;
    const [email, ...nameParts] = content.split(',').map((part) => part.trim());
    if (!/^[^\s@',]+@[^\s@',]+\.[^\s@',]+$/.test(email)) {
      fail(`${ADMINS_FILE}:${index + 1}: "${email}" is not an email address.`);
    }
    admins.push({ email: email.toLowerCase(), fullName: nameParts.join(', ') });
  });
  return admins;
}

const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

// Idempotent: creates the auth user if missing (handle_new_user() then creates the profile), and
// promotes it. Run as the postgres role, so prevent_self_privilege_escalation (keyed on auth.uid())
// doesn't apply. Empty-string token columns match seed.sql: GoTrue can't scan NULLs there.
// One DO block on purpose: `supabase db query` runs a single prepared statement.
function adminsSql(admins) {
  const rows = admins.map(({ email, fullName }) => `(${sqlLiteral(email)}, ${sqlLiteral(fullName)})`);
  return `-- Generated by scripts/preview-db.mjs from supabase/preview-admins.local. Preview only.
DO $$
DECLARE
  admin record;
  v_user_id uuid;
BEGIN
  FOR admin IN SELECT * FROM (VALUES
    ${rows.join(',\n    ')}
  ) AS allowlist(email, full_name) LOOP
    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = admin.email;
    IF v_user_id IS NULL THEN
      v_user_id := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
        admin.email, '', now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', admin.full_name),
        now(), now(), '', '', '', ''
      );
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
      VALUES (
        gen_random_uuid(), v_user_id, v_user_id::text,
        jsonb_build_object('sub', v_user_id::text, 'email', admin.email, 'email_verified', true),
        'email', now(), now()
      );
    END IF;
    UPDATE public.profiles SET is_admin = true WHERE id = v_user_id;
  END LOOP;
END $$;
`;
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

function grantAdmins(dbUrl, admins) {
  if (admins.length === 0) return;
  const sql = adminsSql(admins);
  if (dryRun) {
    console.log('\n--- admin allowlist SQL ---\n' + sql);
  }
  const dir = mkdtempSync(join(tmpdir(), 'preview-admins-'));
  const file = join(dir, 'preview-admins.sql');
  try {
    writeFileSync(file, sql, 'utf8');
    runSupabase(['db', 'query', '--db-url', dbUrl, '--file', file], dbUrl);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (!['reset', 'admins'].includes(command)) {
    fail('Usage: node scripts/preview-db.mjs <reset|admins> [--dry-run] [--yes]');
  }
  const dbUrl = previewDbUrl();
  const admins = readAdmins();
  console.log(`Target: Preview project ${PREVIEW_REF} (${redact(dbUrl)})${dryRun ? ' [dry run]' : ''}`);
  console.log(`Admin allowlist: ${admins.length ? admins.map((a) => a.email).join(', ') : '(none)'}`);

  if (command === 'reset') {
    await confirm('This DELETES all data and all users on the Preview database, then re-seeds it.');
    const seedArgs = SEED_PATHS.flatMap((path) => ['--sql-paths', path]);
    runSupabase(['db', 'reset', '--db-url', dbUrl, ...seedArgs, '--yes'], dbUrl);
  } else {
    await confirm('This creates/promotes the allowlisted users as admins on the Preview database.');
  }
  grantAdmins(dbUrl, admins);
  console.log(dryRun ? '\nDry run: nothing was changed.' : '\n✔ Preview database is ready.');
}

await main();
