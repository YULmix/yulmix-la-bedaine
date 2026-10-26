#!/usr/bin/env node
// One local Supabase stack per worktree (#312), so worktrees and agents never share a database.
//
//   npm run stack:up        generate this worktree's stack (own project id and ports) and start it
//   npm run stack:down      stop it and remove its containers and volumes
//   npm run stack:prune     remove the stacks of worktrees that no longer exist
//   npm run stack:env       print the URLs, keys, DB URL and Vite port of this worktree's stack
//   npm run stack:dev       Vite on the stack's port, pointed at the stack
//   npm run stack:cli -- <supabase args>   the Supabase CLI on this stack, e.g. `-- db reset`
//
// See docs/07-development-setup.md ("Per-worktree local stack"). The main checkout needs none of
// this: with no stack generated it keeps using the default `supabase start` stack.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import {
  REPO_ROOT, STACK_DIR, destroyProject, readRegistry, readState,
  removeRegistryEntry, resolveStack, stackEnv, workdirArgs, writeRegistryEntry
} from './lib/stack.js';
import { pickSlot, portsForSlot, projectIdFor, renderConfig } from './lib/stackSlots.js';

const TRIMMED_OUT = 'studio,logflare,vector';
const LINKED = ['migrations', 'functions', 'seed.sql', 'seeds'];

const fail = (message) => {
  console.error(`\n✖ ${message}`);
  process.exit(1);
};

const isPortFree = (port) =>
  new Promise((resolvePort) => {
    const server = net.createServer();
    server.once('error', () => resolvePort(false));
    // All interfaces: the CLI publishes on 0.0.0.0, and a loopback-only listener must count too.
    server.listen(port, () => server.close(() => resolvePort(true)));
  });

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { cwd: REPO_ROOT, stdio: 'inherit', ...options });

function isRunning(stack) {
  const result = spawnSync('supabase', [...workdirArgs(stack), 'status', '-o', 'env'], { cwd: REPO_ROOT, stdio: 'ignore' });
  return result.status === 0;
}

async function up() {
  const existing = readState();
  const registry = readRegistry();
  const reserved = new Map(registry.map((entry) => [entry.slot, entry.worktree]));
  const alreadyRunning = existing && isRunning({ ...existing, workdir: join(REPO_ROOT, STACK_DIR) });
  const slot = alreadyRunning
    ? existing.slot
    : await pickSlot({ worktreePath: REPO_ROOT, reserved, isPortFree, ownSlot: existing?.slot ?? null });
  if (slot === null) fail('No free slot for a local stack (all 200 are reserved or have busy ports). Run `npm run stack:prune`.');
  const ports = portsForSlot(slot);
  const projectId = projectIdFor(REPO_ROOT);

  // The slot is only ours to keep if its ports are free or already ours (a running stack).
  if (!alreadyRunning) {
    for (const port of Object.values(ports)) {
      if (!(await isPortFree(port))) fail(`Port ${port} (slot ${slot}) is busy.`);
    }
  }

  const workdir = join(REPO_ROOT, STACK_DIR);
  const supabaseDir = join(workdir, 'supabase');
  mkdirSync(supabaseDir, { recursive: true });
  // The seeds directory only exists once db:local:demo has run; the link must not dangle.
  mkdirSync(join(REPO_ROOT, 'supabase', 'seeds'), { recursive: true });
  for (const name of LINKED) {
    const link = join(supabaseDir, name);
    // unlink, not rmSync: a link left by a renamed worktree dangles, and rmSync skips those.
    try { unlinkSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    symlinkSync(join(REPO_ROOT, 'supabase', name), link);
  }
  const template = readFileSync(join(REPO_ROOT, 'supabase', 'config.toml'), 'utf8');
  writeFileSync(join(supabaseDir, 'config.toml'), renderConfig(template, { projectId, ports }));
  const state = { slot, projectId, ports, worktree: REPO_ROOT };
  writeFileSync(join(workdir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  writeRegistryEntry(state);

  const stack = { ...state, workdir };
  if (alreadyRunning) {
    console.log(`Stack ${projectId} is already running.`);
  } else {
    // `start` applies every migration and the seed on a fresh volume (the seeded test users).
    const started = run('supabase', [...workdirArgs(stack), 'start', '-x', TRIMMED_OUT]);
    if (started.status !== 0) fail('supabase start failed (see above).');
  }
  printEnv(stack);
}

function printEnv(stack) {
  const env = stackEnv(stack);
  console.log('');
  for (const [key, value] of Object.entries(env)) console.log(`${key}=${value}`);
  console.log(`\nAPI ${env.VITE_SUPABASE_URL}  DB ${env.SUPABASE_DB_URL}  Vite port ${env.VITE_PORT}`);
}

function down() {
  const state = readState();
  if (!state) fail('No stack generated in this worktree (nothing to stop).');
  const stack = { ...state, workdir: join(REPO_ROOT, STACK_DIR) };
  spawnSync('supabase', [...workdirArgs(stack), 'stop', '--no-backup'], { cwd: REPO_ROOT, stdio: 'inherit' });
  const removed = destroyProject(state.projectId);
  // No stack any more: a main checkout returns to the default stack, a worktree gets the «stack:up» hint.
  rmSync(join(REPO_ROOT, STACK_DIR, 'state.json'), { force: true });
  removeRegistryEntry(state.projectId);
  console.log(`Removed ${removed.containers} container(s), ${removed.volumes} volume(s), ${removed.networks} network(s) of ${state.projectId}.`);
}

function prune() {
  let pruned = 0;
  for (const entry of readRegistry()) {
    if (typeof entry.worktree !== 'string' || existsSync(entry.worktree)) continue;
    let removed;
    try {
      removed = destroyProject(entry.projectId);
    } catch (error) {
      console.error(`Skipped a registry entry: ${error.message}`);
      continue;
    }
    removeRegistryEntry(entry.projectId);
    pruned++;
    console.log(`Pruned ${entry.projectId} (${entry.worktree} is gone): ${removed.containers} container(s), ${removed.volumes} volume(s).`);
  }
  console.log(pruned ? `${pruned} stack(s) pruned.` : 'Nothing to prune: every registered stack still has its worktree.');
}

function cli(args) {
  const stack = resolveStack();
  process.exit(run('supabase', [...workdirArgs(stack), ...args]).status ?? 1);
}

// `npm run db:types`: write the file only when the CLI succeeded (a shell redirect would truncate it).
function types() {
  const stack = resolveStack();
  const result = spawnSync('supabase', [...workdirArgs(stack), 'gen', 'types', 'typescript', '--local'], {
    cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'inherit']
  });
  if (result.status !== 0) fail('supabase gen types failed.');
  writeFileSync(join(REPO_ROOT, 'src', 'lib', 'database.types.ts'), result.stdout);
}

function dev(args) {
  const stack = resolveStack();
  const env = stackEnv(stack);
  const child = spawn('npx', ['vite', '--port', env.VITE_PORT, '--strictPort', ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 0));
}

const [command, ...rest] = process.argv.slice(2);
try {
  switch (command) {
    case 'up': await up(); break;
    case 'down': down(); break;
    case 'prune': prune(); break;
    case 'env': printEnv(resolveStack() ?? fail('The main checkout uses the default stack: `supabase status -o env`.')); break;
    case 'cli': cli(rest); break;
    case 'types': types(); break;
    case 'dev': dev(rest); break;
    default:
      fail('Usage: node scripts/stack.mjs <up|down|prune|env|dev|types|cli> [args]');
  }
} catch (error) {
  fail(error.message);
}
