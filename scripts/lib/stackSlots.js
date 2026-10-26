// Pure helpers for per-worktree local Supabase stacks (#312): which ports a worktree owns, and the
// config.toml its stack runs with. No I/O here (scripts/lib/stack.js does that), so it is unit
// tested (stackSlots.test.js).
//
// Every slot owns a block of ten consecutive ports, below Linux's ephemeral range (32768+) so a
// random outgoing connection never holds one. The main checkout keeps the committed
// supabase/config.toml ports (54320-54329, 8083) and Vite's 5173, outside every block.
import { createHash } from 'node:crypto';

export const BASE_PORT = 24000;
export const BLOCK_SIZE = 10;
export const SLOT_COUNT = 200; // 24000-25999

// Offset of each port inside a slot's block. 9 is spare.
export const PORT_OFFSETS = {
  api: 0,
  db: 1,
  shadow: 2,
  pooler: 3,
  studio: 4,
  inbucket: 5,
  analytics: 6,
  inspector: 7,
  vite: 8
};

export function portsForSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) {
    throw new Error(`slot must be an integer in 0..${SLOT_COUNT - 1}, got ${slot}`);
  }
  const base = BASE_PORT + slot * BLOCK_SIZE;
  return Object.fromEntries(Object.entries(PORT_OFFSETS).map(([name, offset]) => [name, base + offset]));
}

// The slot a worktree path hashes to: stable for a given path, spread over all slots.
export function preferredSlot(worktreePath) {
  const digest = createHash('sha256').update(worktreePath).digest();
  return digest.readUInt32BE(0) % SLOT_COUNT;
}

// First usable slot starting at the preferred one and walking up (wrapping). `reserved` is a
// Map slot -> worktree path of the stacks already registered; a slot reserved by this very
// worktree is usable. `isPortFree(port)` (sync or async) says whether nothing listens on it; it
// is only asked about slots nobody has reserved. Returns null when every slot is taken.
export async function pickSlot({ worktreePath, reserved = new Map(), isPortFree, ownSlot = null }) {
  if (ownSlot !== null && reserved.get(ownSlot) === worktreePath) return ownSlot;
  const start = preferredSlot(worktreePath);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = (start + i) % SLOT_COUNT;
    const owner = reserved.get(slot);
    if (owner !== undefined && owner !== worktreePath) continue;
    if (owner === worktreePath) return slot;
    let free = true;
    for (const port of Object.values(portsForSlot(slot))) {
      if (!(await isPortFree(port))) {
        free = false;
        break;
      }
    }
    if (free) return slot;
  }
  return null;
}

// A Docker-safe, readable, unique project id: the CLI names every container and volume after it.
export function projectIdFor(worktreePath) {
  const name = worktreePath.split('/').filter(Boolean).pop() || 'worktree';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const hash = createHash('sha256').update(worktreePath).digest('hex').slice(0, 6);
  return `yulmix-wt-${slug || 'worktree'}-${hash}`;
}

// [section, key] of every port in supabase/config.toml, by PORT_OFFSETS name.
const PORT_KEYS = {
  api: ['api', 'port'],
  db: ['db', 'port'],
  shadow: ['db', 'shadow_port'],
  pooler: ['db.pooler', 'port'],
  studio: ['studio', 'port'],
  inbucket: ['local_smtp', 'port'],
  analytics: ['analytics', 'port'],
  inspector: ['edge_runtime', 'inspector_port']
};
// Trimmed worktree stacks run without these (their containers are also left out of `start`).
const DISABLED_SECTIONS = ['studio', 'analytics'];

// The tracked config.toml with this stack's project id and ports, studio and analytics off.
// Throws if the tracked file no longer has a key we shift, so a config change can't silently
// leave a worktree stack on the default ports.
export function renderConfig(toml, { projectId, ports }) {
  const wanted = new Map(Object.entries(PORT_KEYS).map(([name, [section, key]]) => [`${section}\0${key}`, ports[name]]));
  const seen = new Set();
  const disabled = new Set();
  let section = '';
  let projectIdSet = false;
  const lines = toml.split('\n').map((line) => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1];
      return line;
    }
    if (section === '' && /^project_id\s*=/.test(line)) {
      projectIdSet = true;
      return `project_id = "${projectId}"`;
    }
    const assignment = line.match(/^(\s*)([a-z_]+)(\s*=\s*)(\S+)(.*)$/);
    if (!assignment) return line;
    const [, indent, key, eq, , rest] = assignment;
    const id = `${section}\0${key}`;
    if (wanted.has(id) && /^\d+$/.test(assignment[4])) {
      seen.add(id);
      return `${indent}${key}${eq}${wanted.get(id)}${rest}`;
    }
    if (DISABLED_SECTIONS.includes(section) && key === 'enabled' && !disabled.has(section)) {
      disabled.add(section);
      return `${indent}${key}${eq}false${rest}`;
    }
    return line;
  });
  const missing = [...wanted.keys()].filter((id) => !seen.has(id)).map((id) => id.replace('\0', '.'));
  if (!projectIdSet) missing.push('project_id');
  for (const s of DISABLED_SECTIONS) if (!disabled.has(s)) missing.push(`${s}.enabled`);
  if (missing.length) {
    throw new Error(`supabase/config.toml has no ${missing.join(', ')}: update PORT_KEYS in scripts/lib/stackSlots.js`);
  }
  return lines.join('\n');
}
