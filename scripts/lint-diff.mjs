#!/usr/bin/env node
// Elevates local/no-literal-ui-strings (repo-wide "warn" in eslint.config.js)
// to a hard failure, but ONLY for lines actually added in this diff — not for
// pre-existing warnings elsewhere in a touched file. That's what lets the
// rule gate new code today without a giant pre-existing-backlog cleanup
// blocking every unrelated PR (see eslint.config.js for the full rationale).
//
// Usage:
//   node scripts/lint-diff.mjs [baseRef]           lints baseRef...HEAD (what CI checks)
//   node scripts/lint-diff.mjs --staged [baseRef]  lints the staged snapshot against
//                                                   merge-base(baseRef, HEAD) — used by the
//                                                   pre-commit hook, where HEAD doesn't yet
//                                                   include the commit being made, so diffing
//                                                   baseRef...HEAD would miss it entirely.
//
// Default baseRef: origin/main

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const staged = args.includes('--staged');
const baseRef = args.find((a) => a !== '--staged') || 'origin/main';
const RULE_ID = 'local/no-literal-ui-strings';

const run = (cmd, cmdArgs, options = {}) => execFileSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, ...options });

// In --staged mode, "HEAD" doesn't yet include the commit being made, so we can't use
// baseRef...HEAD (merge-base(baseRef, HEAD)..HEAD) — it would compare against the wrong
// endpoint. Instead diff the staged index against merge-base(baseRef, HEAD) directly: that's
// the same set of added lines the eventual baseRef...HEAD diff will show once this commit
// (and anything already committed-but-unpushed) lands.
const diffFromRef = staged ? run('git', ['merge-base', baseRef, 'HEAD']).trim() : `${baseRef}...HEAD`;
const diffBaseArgs = staged ? ['--cached', diffFromRef] : [diffFromRef];

const changedFiles = run('git', ['diff', '--diff-filter=ACMR', '--name-only', ...diffBaseArgs, '--', '*.jsx'])
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean);

if (changedFiles.length === 0) {
  console.log(`lint-diff: no changed .jsx files${staged ? ' staged' : ''}, nothing to check.`);
  process.exit(0);
}

// Map of file -> Set of line numbers added by this diff (new-file line numbers).
const addedLinesByFile = new Map();
for (const file of changedFiles) {
  const patch = run('git', ['diff', '-U0', ...diffBaseArgs, '--', file]);
  const added = new Set();
  let currentNewLine = null;
  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      currentNewLine = parseInt(hunk[1], 10);
      continue;
    }
    if (currentNewLine === null) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added.add(currentNewLine);
      currentNewLine += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // removed line: doesn't consume a new-file line number
    } else if (!line.startsWith('\\')) {
      currentNewLine += 1;
    }
  }
  addedLinesByFile.set(file, added);
}

// In --staged mode, lint the staged blob content (git show :file), not the working-tree
// file — the working tree may hold further unstaged edits that won't be part of this commit.
let failures = 0;
if (staged) {
  for (const file of changedFiles) {
    const content = run('git', ['show', `:${file}`]);
    let eslintJson;
    try {
      const out = run('npx', ['eslint', '--stdin', '--stdin-filename', file, '--format', 'json'], { input: content });
      eslintJson = JSON.parse(out);
    } catch (err) {
      eslintJson = JSON.parse(err.stdout);
    }
    const addedLines = addedLinesByFile.get(file) || new Set();
    for (const result of eslintJson) {
      for (const msg of result.messages) {
        if (msg.ruleId !== RULE_ID) continue;
        if (!addedLines.has(msg.line)) continue; // pre-existing, not introduced by this diff
        failures += 1;
        console.error(`${file}:${msg.line}:${msg.column} ${msg.message}`);
      }
    }
  }
} else {
  let eslintJson;
  try {
    const out = run('npx', ['eslint', '--format', 'json', ...changedFiles]);
    eslintJson = JSON.parse(out);
  } catch (err) {
    // ESLint exits non-zero when there are any errors; stdout still has the JSON.
    eslintJson = JSON.parse(err.stdout);
  }

  for (const result of eslintJson) {
    const addedLines = addedLinesByFile.get(result.filePath.replace(`${process.cwd()}/`, '')) || new Set();
    for (const msg of result.messages) {
      if (msg.ruleId !== RULE_ID) continue;
      if (!addedLines.has(msg.line)) continue; // pre-existing, not introduced by this diff
      failures += 1;
      console.error(`${result.filePath}:${msg.line}:${msg.column} ${msg.message}`);
    }
  }
}

if (failures > 0) {
  console.error(`\nlint-diff: ${failures} new literal UI string(s) introduced in this diff. Move them into src/locales/fr.json.`);
  process.exit(1);
}

console.log('lint-diff: no new literal UI strings introduced.');
