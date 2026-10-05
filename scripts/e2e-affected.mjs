// Picks the e2e specs a change can affect, so a developer runs those instead of the whole suite.
//
//   npm run test:e2e:affected                 # specs for the diff against origin/main (prints them)
//   npm run test:e2e:affected -- --run        # ...and runs them (needs the local DB, see docs/07)
//   npm run test:e2e:affected -- --base=HEAD~1 --explain
//
// How it decides (docs/07-development-setup.md, "Running fewer specs"). Specs and the app share the
// strings in src/locales/fr.json (`fr.someKey`), so a spec "covers" a source file when it uses a key
// that the file, or a module that imports it (transitively), uses. Anything that could touch every
// screen (the app shell, styles, migrations, the e2e support code, config) selects the whole suite.
// A small smoke set always runs. Runs use one worker: the specs share one active event (#170). The full suite is still what the supervisor/CI-like checks run.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const base = (flag('base') || '--base=origin/main').split('=')[1];
const explain = !!flag('explain');
const run = !!flag('run');

// Always run: the member/admin RLS boundary and the core member flow.
const SMOKE = ['auth-and-rls', 'member-registration-confirmation'];
// A change here can affect any screen, or the test setup itself: run everything.
const GLOBAL = [
  /^src\/(App|main)\.jsx$/, /^src\/index\.css$/, /^src\/components\/(ui|Header|Toast)\b/, /^src\/lib\/(supabase|toasts|format|database\.types)\b/,
  /^supabase\/(migrations|seed\.sql|config\.toml|functions)/, /^e2e\/support\//, /^playwright\.config\.js$/, /^package(-lock)?\.json$/,
  /^(vite|vercel)\./, /^index\.html$/, /^src\/locales\/(?!fr\.json)/
];

const sh = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf-8', maxBuffer: 64 << 20 }).trim();
const changed = [...new Set([
  ...sh('git', ['diff', '--name-only', `${base}...HEAD`]).split('\n'),
  ...sh('git', ['diff', '--name-only', 'HEAD']).split('\n'),
  ...sh('git', ['ls-files', '--others', '--exclude-standard']).split('\n')
].filter(Boolean))];

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
const srcFiles = walk('src').filter((f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f) && !f.includes('__tests__'));
const specs = readdirSync('e2e').filter((f) => f.endsWith('.spec.js')).map((f) => f.replace('.spec.js', ''));

const keysOf = (text) => new Set([...text.matchAll(/\bfr\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
const specKeys = Object.fromEntries(specs.map((s) => [s, keysOf(readFileSync(`e2e/${s}.spec.js`, 'utf-8'))]));

// Import graph of src (relative imports only).
const resolveImport = (from, spec) => {
  const p = normalize(join(dirname(from), spec));
  for (const c of [p, ...['.js', '.jsx', '.ts', '.tsx'].map((e) => p + e), ...['index.js', 'index.jsx', 'index.ts', 'index.tsx'].map((i) => join(p, i))]) {
    if (srcFiles.includes(c)) return c;
  }
  return null;
};
const importers = new Map(); // file -> files importing it
const fileKeys = new Map();
for (const f of srcFiles) {
  const text = readFileSync(f, 'utf-8');
  fileKeys.set(f, keysOf(text));
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolveImport(f, m[1]);
    if (target) importers.set(target, [...(importers.get(target) || []), f]);
  }
}
// The keys that tell which screens a file shows: its own, plus (for a helper with few of its own,
// or any lib/ module, e.g.) those of the modules that import it directly.
const screenKeys = (f) => {
  const own = fileKeys.get(f);
  if (own.size >= 3 && /\.(jsx|tsx)$/.test(f)) return own;
  return new Set([...own, ...(importers.get(f) || []).flatMap((i) => [...fileKeys.get(i)])]);
};

// Keys used by many specs say little about one screen: ignore them when matching.
const usage = {};
for (const s of specs) for (const k of specKeys[s]) usage[k] = (usage[k] || 0) + 1;
const common = new Set(Object.keys(usage).filter((k) => usage[k] > specs.length * 0.1));

const selected = new Map(SMOKE.map((s) => [s, 'smoke set']));
let all = false;
const add = (s, why) => { if (!selected.has(s)) selected.set(s, why); };
const addByKeys = (keys, why) => {
  for (const s of specs) { const hit = [...keys].find((k) => !common.has(k) && specKeys[s].has(k)); if (hit) add(s, `${why} (fr.${hit})`); }
};

for (const f of changed) {
  if (!existsSync(f) && !/^(src|e2e)\//.test(f)) continue;
  let m;
  if ((m = f.match(/^e2e\/([^/]+)\.spec\.js$/))) { if (specs.includes(m[1])) add(m[1], `edited ${f}`); continue; }
  if (f === 'src/locales/fr.json') {
    const parse = (t) => { try { return JSON.parse(t); } catch { return {}; } };
    const before = parse(sh('git', ['show', `${base}:src/locales/fr.json`]));
    const now = parse(readFileSync(f, 'utf-8'));
    const keys = new Set(Object.keys(now).filter((k) => before[k] !== now[k]).concat(Object.keys(before).filter((k) => !(k in now))));
    addByKeys(keys, 'fr.json key changed');
    continue;
  }
  if (GLOBAL.some((re) => re.test(f))) { all = true; add('*', `${f} can affect every screen`); continue; }
  if (/^src\//.test(f) && srcFiles.includes(f)) {
    const keys = screenKeys(f);
    addByKeys(keys, `${f}`);
    continue;
  }
  if (/^(src|e2e|supabase|scripts)\//.test(f) && !/\.(md|test\.jsx?)$/.test(f) && !/__tests__/.test(f)) {
    if (/^supabase\//.test(f)) { all = true; add('*', `${f} (database/functions)`); }
  }
}

const picked = all ? specs : [...selected.keys()].filter((s) => s !== '*');
if (explain) for (const [s, why] of selected) console.error(`${s.padEnd(36)} ${why}`);
console.error(`${all ? 'ALL' : picked.length} of ${specs.length} specs${all ? ' (a changed file can affect every screen)' : ''}`);
console.log(picked.map((s) => `e2e/${s}.spec.js`).join(' '));

if (run) {
  const files = all ? [] : picked.map((s) => `e2e/${s}.spec.js`);
  execFileSync('npx', ['playwright', 'test', '--no-deps', '--workers=1', ...files], { stdio: 'inherit' });
}
