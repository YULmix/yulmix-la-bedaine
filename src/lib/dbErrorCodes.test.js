import fs from 'node:fs';
import path from 'node:path';
import { dbErrorMessage } from './dbErrors';

// ADR 0021: SQL raises stable English codes (`RAISE EXCEPTION USING MESSAGE = '<code>'`) and
// src/lib/dbErrors.ts maps each to French. This test reads the migrations statically (no DB), keeps
// only the CURRENT definition of every function (a later CREATE OR REPLACE supersedes an earlier
// one, a DROP FUNCTION removes it) and fails, naming them, when a code it can still raise has no
// mapping.

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

/** Number of top-level, comma-separated parameters in a function's argument list. */
const countParams = (args) => {
  const text = args.trim();
  if (!text) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) count += 1;
  }
  return count;
};

/** Matches the argument list, which may contain one level of nested parentheses (numeric(10,2)). */
const ARGS = '((?:[^()]|\\([^()]*\\))*)';
const CREATE_RE = new RegExp(
  `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:"?public"?\\.)?"?(\\w+)"?\\s*\\(${ARGS}\\)`, 'gi'
);
const DROP_RE = /drop\s+function\s+(?:if\s+exists\s+)?([^;]+);/gi;
const DROP_ONE_RE = new RegExp(`(?:"?\\w+"?\\.)?"?(\\w+)"?\\s*\\(${ARGS}\\)`, 'g');

/** Current function definitions: signature -> { file, body }. */
export const currentFunctions = (dir = MIGRATIONS_DIR) => {
  const functions = new Map();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '');
    // Statements in file order: creates and drops.
    const events = [];
    for (const m of sql.matchAll(CREATE_RE)) {
      const afterHeader = m.index + m[0].length;
      const tag = /\$([A-Za-z_]*)\$/g;
      tag.lastIndex = afterHeader;
      const open = tag.exec(sql);
      let body = '';
      if (open) {
        const closeAt = sql.indexOf(open[0], open.index + open[0].length);
        body = sql.slice(open.index + open[0].length, closeAt === -1 ? undefined : closeAt);
      }
      events.push({ at: m.index, kind: 'create', key: `${m[1].toLowerCase()}/${countParams(m[2])}`, body });
    }
    for (const m of sql.matchAll(DROP_RE)) {
      for (const one of m[1].matchAll(DROP_ONE_RE)) {
        events.push({ at: m.index, kind: 'drop', key: `${one[1].toLowerCase()}/${countParams(one[2])}` });
      }
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === 'create') functions.set(e.key, { file, body: e.body });
      else functions.delete(e.key);
    }
  }
  return functions;
};

/** Every `MESSAGE = '<code>'` of a function body, whatever the line breaks around it. */
export const codesRaisedBy = (body) => {
  const code = body.replace(/--[^\n]*/g, '');
  return [...code.matchAll(/\bmessage\s*=\s*'([^']*)'/gi)].map((m) => m[1]);
};

describe('database error codes', () => {
  const functions = currentFunctions();
  const codes = new Map(); // code -> first "function (file)" raising it
  for (const [key, { file, body }] of functions) {
    for (const c of codesRaisedBy(body)) if (!codes.has(c)) codes.set(c, `${key.split('/')[0]} (${file})`);
  }

  it('finds the functions and codes (guards against a parser that silently matches nothing)', () => {
    expect(functions.size).toBeGreaterThan(20);
    expect(codes.has('admin_only')).toBe(true);
  });

  it('ignores the codes of superseded function definitions', () => {
    expect(codes.has('place_event_fixed')).toBe(false);
  });

  it('maps every code the current functions raise to a French message', () => {
    const sentinel = '__unmapped__';
    const missing = [...codes]
      .filter(([code]) => dbErrorMessage({ message: code }, sentinel) === sentinel)
      .map(([code, where]) => `${code} (raised in ${where})`);
    expect(missing).toEqual([]);
  });
});
