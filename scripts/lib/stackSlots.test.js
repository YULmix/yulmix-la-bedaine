import { readFileSync } from 'node:fs';
import {
  BASE_PORT, BLOCK_SIZE, SLOT_COUNT, pickSlot, portsForSlot, preferredSlot, projectIdFor, renderConfig
} from './stackSlots';

const allFree = () => true;
const config = readFileSync(require('node:path').join(__dirname, '../../supabase/config.toml'), 'utf8');

describe('slot derivation', () => {
  test('a path always hashes to the same slot, inside the range', () => {
    const slot = preferredSlot('/home/a/wt/GH-1');
    expect(preferredSlot('/home/a/wt/GH-1')).toBe(slot);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(SLOT_COUNT);
  });

  test('paths spread over the slots', () => {
    const slots = new Set(Array.from({ length: 60 }, (_, i) => preferredSlot(`/wt/GH-${i}`)));
    expect(slots.size).toBeGreaterThan(40);
  });

  test('port blocks never overlap and stay clear of the default stack and Vite', () => {
    const seen = new Set();
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      for (const port of Object.values(portsForSlot(slot))) {
        expect(seen.has(port)).toBe(false);
        seen.add(port);
        expect(port).toBeGreaterThanOrEqual(BASE_PORT);
        expect(port).toBeLessThan(BASE_PORT + SLOT_COUNT * BLOCK_SIZE);
      }
    }
    for (const port of [5173, 8083, ...Array.from({ length: 10 }, (_, i) => 54320 + i)]) expect(seen.has(port)).toBe(false);
  });

  test('rejects a slot out of range', () => {
    expect(() => portsForSlot(-1)).toThrow();
    expect(() => portsForSlot(SLOT_COUNT)).toThrow();
  });
});

describe('pickSlot', () => {
  const worktreePath = '/wt/GH-7';
  const preferred = preferredSlot(worktreePath);

  test('takes the preferred slot when it is free', async () => {
    expect(await pickSlot({ worktreePath, isPortFree: allFree })).toBe(preferred);
  });

  test('keeps the slot the worktree already reserved', async () => {
    const reserved = new Map([[(preferred + 5) % SLOT_COUNT, worktreePath]]);
    expect(await pickSlot({ worktreePath, reserved, ownSlot: (preferred + 5) % SLOT_COUNT, isPortFree: () => false })).toBe((preferred + 5) % SLOT_COUNT);
  });

  test('another worktree reserving the preferred slot pushes to the next one', async () => {
    const reserved = new Map([[preferred, '/wt/other']]);
    expect(await pickSlot({ worktreePath, reserved, isPortFree: allFree })).toBe((preferred + 1) % SLOT_COUNT);
  });

  test('a busy port in the preferred block (a stranger process) pushes to the next slot', async () => {
    const busy = portsForSlot(preferred).db;
    expect(await pickSlot({ worktreePath, isPortFree: (port) => port !== busy })).toBe((preferred + 1) % SLOT_COUNT);
  });

  test('wraps around, and gives up when every slot is taken', async () => {
    const reserved = new Map(Array.from({ length: SLOT_COUNT }, (_, i) => [i, `/wt/other-${i}`]));
    expect(await pickSlot({ worktreePath, reserved, isPortFree: allFree })).toBeNull();
    reserved.delete(0);
    expect(await pickSlot({ worktreePath, reserved, isPortFree: allFree })).toBe(0);
  });
});

describe('projectIdFor', () => {
  test('is Docker-safe, stable and unique per path', () => {
    const id = projectIdFor('/home/a/yulmix.worktrees/GH-312-worktree supabase');
    expect(id).toMatch(/^yulmix-wt-[a-z0-9-]+-[0-9a-f]{6}$/);
    expect(id.length).toBeLessThanOrEqual(40);
    expect(projectIdFor('/home/a/yulmix.worktrees/GH-312-worktree supabase')).toBe(id);
    expect(projectIdFor('/other/GH-312-worktree supabase')).not.toBe(id);
  });
});

describe('renderConfig', () => {
  const ports = portsForSlot(3);
  const rendered = renderConfig(config, { projectId: 'yulmix-wt-x-abc123', ports });

  test('sets the project id and shifts every port', () => {
    expect(rendered).toMatch(/^project_id = "yulmix-wt-x-abc123"$/m);
    for (const name of ['api', 'db', 'shadow', 'pooler', 'studio', 'inbucket', 'analytics', 'inspector']) {
      expect(rendered).toContain(String(ports[name]));
    }
    for (const port of [54320, 54321, 54322, 54323, 54324, 54327, 54329, 8083]) {
      expect(rendered).not.toMatch(new RegExp(`=\\s*${port}\\b`));
    }
  });

  test('switches studio and analytics off and leaves the rest alone', () => {
    expect(rendered).toMatch(/\[studio\]\nenabled = false/);
    expect(rendered).toMatch(/\[analytics\]\nenabled = false/);
    expect(rendered).toMatch(/\[edge_runtime\]\nenabled = true/);
    expect(rendered.split('\n').length).toBe(config.split('\n').length);
  });

  test('refuses a config it cannot shift', () => {
    expect(() => renderConfig(config.replace(/^shadow_port.*$/m, ''), { projectId: 'x', ports })).toThrow(/db\.shadow_port/);
  });
});
