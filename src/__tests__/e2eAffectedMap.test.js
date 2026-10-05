// e2e/affected-map.json drives `npm run test:e2e:affected` (scripts/e2e-affected.mjs). It only
// helps while it is complete: a spec nothing points at never runs in an affected set, and a source
// file without an entry sends every change to it to the whole suite.
/** @jest-environment node */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const { smoke, all, map } = JSON.parse(fs.readFileSync(path.join(root, 'e2e/affected-map.json'), 'utf-8'));
const specs = fs.readdirSync(path.join(root, 'e2e')).filter((f) => f.endsWith('.spec.js')).map((f) => f.slice(0, -'.spec.js'.length));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const sourceFiles = walk(path.join(root, 'src'))
  .map((f) => path.relative(root, f).split(path.sep).join('/'))
  .filter((f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f) && !f.includes('__tests__'));
const globals = all.map((p) => new RegExp(p));

test('every spec is in the smoke set or mapped from a source file', () => {
  const covered = new Set([...smoke, ...Object.values(map).flat()]);
  expect(specs.filter((s) => !covered.has(s))).toEqual([]);
});

test('the map and the smoke set name real specs and real files', () => {
  expect([...smoke, ...Object.values(map).flat()].filter((s) => !specs.includes(s))).toEqual([]);
  expect(Object.keys(map).filter((f) => !fs.existsSync(path.join(root, f)))).toEqual([]);
});

test('every source file is mapped, or its changes run the whole suite', () => {
  expect(sourceFiles.filter((f) => !map[f] && !globals.some((re) => re.test(f)))).toEqual([]);
});
