// Picks the e2e specs a change can affect, so a developer iterating runs those, not the whole suite.
//
//   npm run test:e2e:affected                 # prints the specs for the diff against origin/main
//   npm run test:e2e:affected -- --run        # ...and runs them (one worker; needs the local DB)
//   npm run test:e2e:affected -- --base=HEAD~1 --explain
//
// The map lives in e2e/affected-map.json (one versioned file; src/__tests__/e2eAffectedMap.test.js
// fails when a spec or a source file is missing from it). Rules, in order:
//   - a changed e2e/*.spec.js runs itself;
//   - a path matching one of "all" (shared code, migrations, config, e2e/support...) runs the WHOLE suite;
//   - a changed src/locales/fr.json value runs the specs that use that key;
//   - another src/ file: its "map" entry, and the WHOLE suite when it has none (a new file: add it);
//   - the "smoke" specs always run.
// Before a PR is pushed the developer still runs the whole suite once (docs/08-contributing.md).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const base = (flag('base') || '--base=origin/main').split('=')[1];
const explain = !!flag('explain');
const run = !!flag('run');

const { smoke, all: allPatterns, map } = JSON.parse(readFileSync('e2e/affected-map.json', 'utf-8'));
const specs = readdirSync('e2e').filter((f) => f.endsWith('.spec.js')).map((f) => f.replace('.spec.js', ''));

const sh = (a) => execFileSync('git', a, { encoding: 'utf-8', maxBuffer: 64 << 20 }).trim();
const changed = [...new Set([
  ...sh(['diff', '--name-only', `${base}...HEAD`]).split('\n'),
  ...sh(['diff', '--name-only', 'HEAD']).split('\n'),
  ...sh(['ls-files', '--others', '--exclude-standard']).split('\n')
].filter(Boolean))];

const selected = new Map(smoke.map((s) => [s, 'smoke set']));
const add = (s, why) => { if (!selected.has(s)) selected.set(s, why); };
let allWhy = null;
const globals = allPatterns.map((p) => new RegExp(p));

for (const f of changed) {
  let m;
  if ((m = f.match(/^e2e\/([^/]+)\.spec\.js$/))) { if (specs.includes(m[1])) add(m[1], `edited ${f}`); continue; }
  if (globals.some((re) => re.test(f))) { allWhy ||= `${f} can affect every screen`; continue; }
  if (f === 'src/locales/fr.json') {
    const parse = (t) => { try { return JSON.parse(t); } catch { return {}; } };
    const before = parse(sh(['show', `${base}:src/locales/fr.json`]));
    const now = parse(readFileSync(f, 'utf-8'));
    const keys = new Set([...Object.keys(now), ...Object.keys(before)].filter((k) => before[k] !== now[k]));
    for (const s of specs) {
      const text = readFileSync(`e2e/${s}.spec.js`, 'utf-8');
      const hit = [...keys].find((k) => text.includes(`fr.${k}`));
      if (hit) add(s, `fr.json key ${hit} changed`);
    }
    continue;
  }
  if (/^src\/.*\.(jsx?|tsx?)$/.test(f) && !/\.test\.|__tests__/.test(f)) {
    if (map[f]) map[f].forEach((s) => add(s, f));
    else if (changed.includes(f) && !isDeleted(f)) allWhy ||= `${f} is not in e2e/affected-map.json (add it)`;
  }
}
function isDeleted(f) { try { readFileSync(f); return false; } catch { return true; } }

const picked = allWhy ? specs : [...selected.keys()];
if (explain) for (const [s, why] of selected) console.error(`${s.padEnd(36)} ${why}`);
console.error(allWhy ? `ALL ${specs.length} specs: ${allWhy}` : `${picked.length} of ${specs.length} specs`);
console.log(picked.map((s) => `e2e/${s}.spec.js`).join(' '));

if (run) {
  const files = allWhy ? [] : picked.map((s) => `e2e/${s}.spec.js`);
  // One worker: the specs share one active event (#170).
  execFileSync('npx', ['playwright', 'test', '--no-deps', '--workers=1', ...files], { stdio: 'inherit' });
}
