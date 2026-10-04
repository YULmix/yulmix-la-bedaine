import fr from '../locales/fr.json';

// The real module reads Vite's import.meta.env; the URL and headers are what the function gets.
jest.mock('./supabase', () => ({
  supabase: {},
  VOIR_COMME_PATH: '/voir-comme',
  functionUrl: (name) => `http://127.0.0.1:54321/functions/v1/${name}`,
  functionHeaders: (token) => ({ apikey: 'anon', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
}));
import {
  canViewAs, endVoirComme, logState, msLeft, startVoirComme, targetIdFromPath, timeLeftLabel, voirCommeUrl
} from './voirComme';

const ID = '00000000-0000-0000-0000-000000000001';

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

describe('the « Voir comme » route', () => {
  test('carries the target id only, and reads it back', () => {
    expect(voirCommeUrl(ID)).toBe(`/voir-comme/${ID}`);
    expect(targetIdFromPath(`/voir-comme/${ID}`)).toBe(ID);
    expect(targetIdFromPath(`/voir-comme/${ID}/`)).toBe(ID);
  });

  test('anything else is no target', () => {
    expect(targetIdFromPath('/')).toBeNull();
    expect(targetIdFromPath('/voir-comme/not-a-uuid')).toBeNull();
    expect(targetIdFromPath(`/voir-comme/${ID}/extra`)).toBeNull();
    expect(targetIdFromPath(`/admin/voir-comme/${ID}`)).toBeNull();
  });
});

describe('canViewAs', () => {
  const member = { id: ID, is_admin: false, email: 'member@test.local', deleted_at: null };

  test('a live non-admin account other than oneself', () => {
    expect(canViewAs(member, 'someone-else')).toBe(true);
  });

  test('never an admin, the root admin, a deleted account or oneself', () => {
    expect(canViewAs({ ...member, is_admin: true })).toBe(false);
    expect(canViewAs({ ...member, email: 'yulmixalabedaine@gmail.com' })).toBe(false);
    expect(canViewAs({ ...member, deleted_at: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(canViewAs(member, ID)).toBe(false);
    expect(canViewAs(null)).toBe(false);
  });
});

describe('startVoirComme', () => {
  const started = {
    access_token: 'a', refresh_token: 'r', expires_at: 1, session_id: ID, ends_at: '2026-10-04T20:30:00+00:00', target: { id: ID, full_name: 'Test Member' }
  };

  test('posts start with the admin token and returns the session', async () => {
    const fetchImpl = jest.fn(async () => response(200, started));
    await expect(startVoirComme('admin-token', ID, fetchImpl)).resolves.toEqual(started);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/functions\/v1\/impersonate$/);
    expect(init.headers.Authorization).toBe('Bearer admin-token');
    expect(JSON.parse(init.body)).toEqual({ action: 'start', target_id: ID });
  });

  test('a refusal comes back in French, by its code', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const pending = jest.fn(async () => response(409, { error: 'impersonation_target_pending' }));
    await expect(startVoirComme('t', ID, pending)).rejects.toThrow(fr.dbErrorImpersonationTargetPending);
    const admin = jest.fn(async () => response(422, { error: 'impersonation_target_admin' }));
    await expect(startVoirComme('t', ID, admin)).rejects.toThrow(fr.dbErrorImpersonationTargetAdmin);
    const unknown = jest.fn(async () => response(401, { msg: 'Invalid JWT' }));
    await expect(startVoirComme('t', ID, unknown)).rejects.toThrow(fr.dbErrorImpersonationFailed);
    const offline = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(startVoirComme('t', ID, offline)).rejects.toThrow(fr.voirCommeNetworkError);
  });

  test('a response without a session is a failure', async () => {
    const fetchImpl = jest.fn(async () => response(200, { ended: true }));
    await expect(startVoirComme('t', ID, fetchImpl)).rejects.toThrow(fr.dbErrorImpersonationFailed);
  });
});

test('endVoirComme posts end with the session id, keepalive when asked', async () => {
  const fetchImpl = jest.fn(async () => response(200, { ended: true, revoked: true }));
  await endVoirComme('session-token', ID, { keepalive: true, fetchImpl });
  const [, init] = fetchImpl.mock.calls[0];
  expect(init.headers.Authorization).toBe('Bearer session-token');
  expect(init.keepalive).toBe(true);
  expect(JSON.parse(init.body)).toEqual({ action: 'end', session_id: ID });
});

describe('the time left', () => {
  const endsAt = '2026-10-04T20:30:00Z';
  const at = (iso) => Date.parse(iso);

  test('in whole minutes, rounded up', () => {
    expect(timeLeftLabel(endsAt, at('2026-10-04T20:00:00Z'))).toBe(fr.voirCommeMinutesLeft.replace('{minutes}', '30'));
    expect(timeLeftLabel(endsAt, at('2026-10-04T20:28:30Z'))).toBe(fr.voirCommeMinutesLeft.replace('{minutes}', '2'));
  });

  test('the last minute, and after the end', () => {
    expect(timeLeftLabel(endsAt, at('2026-10-04T20:29:30Z'))).toBe(fr.voirCommeLessThanAMinute);
    expect(msLeft(endsAt, at('2026-10-04T20:31:00Z'))).toBe(0);
  });
});

describe('logState', () => {
  const now = Date.parse('2026-10-04T20:10:00Z');
  const row = { session_id: ID, ended_at: null, expires_at: '2026-10-04T20:30:00Z' };

  test('open until its end, quit before it, expired after it', () => {
    expect(logState(row, now)).toBe('active');
    expect(logState({ ...row, ended_at: '2026-10-04T20:05:00Z' }, now)).toBe('ended');
    expect(logState(row, Date.parse('2026-10-04T20:31:00Z'))).toBe('expired');
  });

  test('a start that never got a session', () => {
    expect(logState({ ...row, session_id: null, ended_at: '2026-10-04T20:00:01Z' }, now)).toBe('unopened');
  });
});
