// Per-worktree local Supabase stack (#312): state, registry, and how the tools find the stack.
// Pure slot/port/config logic is in stackSlots.js. Used by scripts/stack.mjs (the commands),
// playwright.config.js, jest.rls.config.js and scripts/preview-db.mjs.
//
// - Main checkout, no stack generated: `resolveStack` returns null and every tool does what it
//   always did (default `supabase` project, ports 54321.., Vite 5173).
// - A stack generated (`npm run stack:up`): `<root>/.stack/` holds a Supabase workdir (gitignored)
//   and state.json; tools pass `--workdir` and use the slot's ports.
// - A worktree without a stack: an error telling you to run `npm run stack:up`, never a silent
//   fall onto another stack.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const STACK_DIR = '.stack';
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

export function isMainCheckout(root = REPO_ROOT) {
  // A linked worktree's .git is a file ("gitdir: ..."); everything else is "main": a normal
  // checkout (.git directory, which is what CI's actions/checkout gives) and a tree without .git
  // (tarball). So a SEPARATE full clone is also "main" and shares the default stack: git cannot
  // tell it apart. Run `npm run stack:up` in such a clone to give it its own (state.json then wins).
  const git = join(root, '.git');
  return !(existsSync(git) && statSync(git).isFile());
}

export const NO_STACK_MESSAGE =
  'This worktree has no local Supabase stack. Run `npm run stack:up` first (it gives the worktree its own ' +
  'database, API and Vite ports, so it never touches another worktree\'s or the main checkout\'s).';

export function statePath(root = REPO_ROOT) {
  return join(root, STACK_DIR, 'state.json');
}

export function readState(root = REPO_ROOT) {
  try {
    return JSON.parse(readFileSync(statePath(root), 'utf8'));
  } catch {
    return null;
  }
}

// null: the default stack (main checkout without a generated one). Throws in a bare worktree.
export function resolveStack(root = REPO_ROOT) {
  const state = readState(root);
  if (state) return { ...state, workdir: join(root, STACK_DIR) };
  if (isMainCheckout(root)) return null;
  throw new Error(NO_STACK_MESSAGE);
}

// Args to put before a `supabase` subcommand: `--workdir <dir>` for a generated stack.
export function workdirArgs(stack) {
  return stack ? ['--workdir', stack.workdir] : [];
}

export function viteDevPort(stack) {
  return stack ? stack.ports.vite : 5173;
}

// Runs `supabase status -o env` for the stack (or the default one) and returns its KEY="value" pairs.
export function readStatusEnv(stack) {
  let output;
  try {
    output = execFileSync('supabase', [...workdirArgs(stack), 'status', '-o', 'env'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const hint = stack
      ? 'Its stack is not running: `npm run stack:up`.'
      : 'Start it with `supabase start` (or `supabase db reset` for a fresh database with the seeded test users).';
    throw new Error(`Local Supabase is not running. ${hint}\n${error.message}`);
  }
  const env = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^([A-Z_0-9]+)="(.*)"$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

// The env the app and the tools need, for the stack in use.
export function stackEnv(stack, status = readStatusEnv(stack)) {
  return {
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    SUPABASE_DB_URL: status.DB_URL,
    VITE_PORT: String(viteDevPort(stack))
  };
}

// --- registry: every generated stack, outside the worktrees so `prune` can see vanished ones ---

export function registryDir() {
  if (process.env.STACK_REGISTRY_DIR) return process.env.STACK_REGISTRY_DIR;
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'yulmix-la-bedaine-stacks');
}

export function readRegistry() {
  const dir = registryDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function writeRegistryEntry(entry) {
  mkdirSync(registryDir(), { recursive: true });
  writeFileSync(join(registryDir(), `${entry.projectId}.json`), JSON.stringify(entry, null, 2) + '\n');
}

export function removeRegistryEntry(projectId) {
  rmSync(join(registryDir(), `${projectId}.json`), { force: true });
}

// --- Docker: remove everything the CLI created for a project id ---

const docker = (args) => execFileSync('docker', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
const names = (args) => docker(args).split('\n').map((s) => s.trim()).filter(Boolean);

// `supabase stop --no-backup` leaves at least the edge runtime's volume behind, and nothing at all
// works for a worktree whose directory is gone, so sweep by name: the CLI suffixes every container,
// volume and network with `_<project_id>`.
// Ids stack.mjs generates (stackSlots.projectIdFor). Anything else (a hand-edited registry entry)
// must sweep nothing: an empty id would make the name filters match foreign resources.
export const PROJECT_ID_PATTERN = /^yulmix-wt-[a-z0-9-]+$/;

export function destroyProject(projectId) {
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(`Refusing to sweep Docker for an unexpected project id: ${JSON.stringify(projectId)}`);
  }
  const suffix = `_${projectId}`;
  const containers = names(['ps', '-a', '--format', '{{.Names}}', '--filter', `name=${projectId}`]).filter((n) => n.endsWith(suffix));
  if (containers.length) docker(['rm', '-f', '-v', ...containers]);
  const volumes = names(['volume', 'ls', '-q', '--filter', `name=${projectId}`]).filter((n) => n.endsWith(suffix));
  if (volumes.length) docker(['volume', 'rm', '-f', ...volumes]);
  const networks = names(['network', 'ls', '--format', '{{.Name}}', '--filter', `name=${projectId}`]).filter((n) => n.endsWith(suffix));
  if (networks.length) docker(['network', 'rm', ...networks]);
  return { containers: containers.length, volumes: volumes.length, networks: networks.length };
}
