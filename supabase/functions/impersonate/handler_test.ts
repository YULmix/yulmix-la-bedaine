// Run with: deno test supabase/functions/impersonate/
// The request handling against a fake Gateway: who may start and end a « Voir comme » session,
// and what is handed over. The real thing (hook, trigger, Auth) is exercised against a local stack;
// see docs/07-development-setup.md.
import assert from 'node:assert/strict';
import { createGateway } from './gateway.ts';
import { createHandler, decodeClaims, type Claims, type Gateway, type LogRow, type Profile } from './handler.ts';

const ADMIN = '00000000-0000-0000-0000-000000000002';
const MEMBER = '00000000-0000-0000-0000-000000000001';
const OTHER_ADMIN = '00000000-0000-0000-0000-000000000005';
const DELETED = '00000000-0000-0000-0000-000000000006';
const SESSION = '11111111-1111-1111-1111-111111111111';
const ENDS_AT = '2026-10-04T20:30:00+00:00';
const CAP = Math.floor(Date.parse(ENDS_AT) / 1000);

const b64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: Claims) => `${b64url({ alg: 'ES256', typ: 'JWT' })}.${b64url(claims)}.signature`;
const adminToken = jwt({ sub: ADMIN, session_id: '22222222-2222-2222-2222-222222222222', role: 'authenticated' });
const memberToken = jwt({ sub: MEMBER, session_id: '33333333-3333-3333-3333-333333333333', role: 'authenticated' });
const impersonatedToken = jwt({ sub: MEMBER, session_id: SESSION, impersonated_by: ADMIN, exp: CAP, role: 'authenticated' });

// A fake Supabase: who the tokens belong to, profiles, the log, and what the hook would do.
function fakeGateway(options: { hookMarks?: boolean; insertCode?: string } = {}) {
  const { hookMarks = true, insertCode } = options;
  const profiles: Record<string, Profile> = {
    [ADMIN]: { id: ADMIN, full_name: 'Admin', email: 'admin@test.local', is_admin: true, deleted_at: null },
    [OTHER_ADMIN]: { id: OTHER_ADMIN, full_name: 'Autre', email: 'other@test.local', is_admin: true, deleted_at: null },
    [MEMBER]: { id: MEMBER, full_name: 'Mo Membre', email: 'member@test.local', is_admin: false, deleted_at: null },
    [DELETED]: { id: DELETED, full_name: null, email: 'gone@test.local', is_admin: false, deleted_at: '2026-10-01T00:00:00Z' }
  };
  const tokens: Record<string, string> = { [adminToken]: ADMIN, [memberToken]: MEMBER, [impersonatedToken]: MEMBER };
  const log: LogRow[] = [];
  const calls: string[] = [];
  const signedOut: string[] = [];
  const gateway: Gateway = {
    getUser: async token => (tokens[token] ? { id: tokens[token] } : null),
    isAdmin: async token => profiles[tokens[token]]?.is_admin === true,
    readProfile: async (token, id) => (profiles[tokens[token]]?.is_admin ? profiles[id] ?? null : null),
    getAuthUser: async id => (profiles[id] ? { id, email: profiles[id].email } : null),
    insertLog: async (adminId, targetId) => {
      calls.push('insertLog');
      if (insertCode) return { ok: false, code: insertCode };
      const row = { id: log.length + 1, admin_id: adminId, target_id: targetId, session_id: null, expires_at: ENDS_AT, ended_at: null };
      log.push(row);
      return { ok: true, row };
    },
    readLogBySession: async sessionId => log.find(row => row.session_id === sessionId) ?? null,
    endLog: async id => {
      calls.push(`endLog ${id}`);
      const row = log.find(r => r.id === id);
      if (row && row.ended_at === null) row.ended_at = new Date().toISOString();
    },
    generateMagicLink: async email => {
      calls.push('generateMagicLink');
      const profile = Object.values(profiles).find(p => p.email === email);
      return { userId: profile!.id, tokenHash: 'hash' };
    },
    verifyMagicLink: async () => {
      calls.push('verifyMagicLink');
      // The hook claims the newest pending row, as the database does.
      const row = log.findLast(r => r.session_id === null && r.ended_at === null)!;
      row.session_id = SESSION;
      const claims: Claims = { sub: row.target_id!, session_id: SESSION, exp: hookMarks ? CAP : CAP + 1800, role: 'authenticated' };
      if (hookMarks) claims.impersonated_by = row.admin_id!;
      const access = jwt(claims);
      tokens[access] = row.target_id!;
      return { access_token: access, refresh_token: 'refresh' };
    },
    signOut: async token => {
      signedOut.push(token);
      return true;
    }
  };
  return { gateway, log, calls, signedOut };
}

const post = (token: string | null, body: unknown) => new Request('http://localhost/impersonate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const run = async (fake: ReturnType<typeof fakeGateway>, request: Request) => {
  const logged: string[] = [];
  const response = await createHandler(fake.gateway, message => logged.push(message))(request);
  return { status: response.status, body: await response.json().catch(() => null), logged, headers: response.headers };
};

Deno.test('start: an admin gets a marked session of the member', async () => {
  const fake = fakeGateway();
  const { status, body } = await run(fake, post(adminToken, { action: 'start', target_id: MEMBER }));
  assert.equal(status, 200);
  assert.equal(body.refresh_token, 'refresh');
  assert.equal(body.session_id, SESSION);
  assert.equal(body.expires_at, CAP);
  assert.equal(body.ends_at, ENDS_AT);
  assert.deepEqual(body.target, { id: MEMBER, full_name: 'Mo Membre' });
  assert.equal(decodeClaims(body.access_token)?.impersonated_by, ADMIN);
  assert.deepEqual(fake.log.map(r => [r.admin_id, r.target_id, r.session_id, r.ended_at]), [[ADMIN, MEMBER, SESSION, null]]);
  assert.deepEqual(fake.signedOut, []);
});

Deno.test('start: a non-admin is refused with 403, nothing inserted nor minted', async () => {
  const fake = fakeGateway();
  const { status, body } = await run(fake, post(memberToken, { action: 'start', target_id: OTHER_ADMIN }));
  assert.equal(status, 403);
  assert.equal(body.error, 'impersonation_actor_not_admin');
  assert.deepEqual(fake.calls, []);
});

Deno.test('start: an impersonated token is refused with 403, even an admin\'s', async () => {
  const fake = fakeGateway();
  const { status, body } = await run(fake, post(impersonatedToken, { action: 'start', target_id: DELETED }));
  assert.equal(status, 403);
  assert.equal(body.error, 'impersonation_caller_impersonated');
  assert.deepEqual(fake.calls, []);
});

Deno.test('start: self, an admin, a deleted or an unknown account is refused before any insert', async () => {
  const cases: [string, number, string][] = [
    [ADMIN, 422, 'impersonation_target_self'],
    [OTHER_ADMIN, 422, 'impersonation_target_admin'],
    [DELETED, 422, 'impersonation_target_deleted'],
    ['99999999-9999-9999-9999-999999999999', 404, 'impersonation_target_not_found']
  ];
  for (const [target, expectedStatus, code] of cases) {
    const fake = fakeGateway();
    const { status, body } = await run(fake, post(adminToken, { action: 'start', target_id: target }));
    assert.deepEqual([status, body.error], [expectedStatus, code], target);
    assert.deepEqual(fake.calls, [], target);
  }
});

Deno.test('start: the trigger\'s refusals map to their status, unknown errors to 500', async () => {
  for (const [code, expectedStatus, expectedCode] of [
    ['impersonation_target_pending', 409, 'impersonation_target_pending'],
    ['impersonation_target_admin', 422, 'impersonation_target_admin'],
    ['impersonation_actor_not_admin', 403, 'impersonation_actor_not_admin'],
    ['permission denied for table impersonation_log', 500, 'impersonation_failed']
  ] as const) {
    const fake = fakeGateway({ insertCode: code });
    const { status, body } = await run(fake, post(adminToken, { action: 'start', target_id: MEMBER }));
    assert.deepEqual([status, body.error], [expectedStatus, expectedCode], code);
    assert.ok(!fake.calls.includes('generateMagicLink'), code);
  }
});

Deno.test('start: a session the hook did not mark is signed out, its row ended, nothing handed over', async () => {
  const fake = fakeGateway({ hookMarks: false });
  const { status, body, logged } = await run(fake, post(adminToken, { action: 'start', target_id: MEMBER }));
  assert.equal(status, 500);
  assert.deepEqual(body, { error: 'impersonation_not_marked' });
  assert.equal(fake.signedOut.length, 1);
  assert.notEqual(fake.log[0].ended_at, null);
  assert.deepEqual(logged, ['impersonate start: impersonation_not_marked']);
});

Deno.test('start: a failure after the insert ends the row', async () => {
  const fake = fakeGateway();
  fake.gateway.verifyMagicLink = () => Promise.reject(new Error('verify: 403 otp_expired'));
  const { status, body, logged } = await run(fake, post(adminToken, { action: 'start', target_id: MEMBER }));
  assert.deepEqual([status, body.error], [500, 'impersonation_failed']);
  assert.notEqual(fake.log[0].ended_at, null);
  assert.deepEqual(logged, ['impersonate start: verify: 403 otp_expired']);
});

Deno.test('requests: no token 401, invalid token 401, bad bodies 400, other methods 405, preflight 204', async () => {
  const fake = fakeGateway();
  assert.equal((await run(fake, post(null, { action: 'start', target_id: MEMBER }))).status, 401);
  assert.equal((await run(fake, post(jwt({ sub: ADMIN }), { action: 'start', target_id: MEMBER }))).status, 401);
  for (const body of ['not json', [], { action: 'extend' }, { action: 'start', target_id: 'nope' }, { action: 'end' }, { action: 'end', session_id: 'nope' }]) {
    const { status, body: out } = await run(fake, post(adminToken, body));
    assert.deepEqual([status, out.error], [400, 'impersonation_request_invalid'], JSON.stringify(body));
  }
  assert.equal((await run(fake, new Request('http://localhost/impersonate'))).status, 405);
  const preflight = await createHandler(fake.gateway)(new Request('http://localhost/impersonate', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.ok(preflight.headers.get('Access-Control-Allow-Headers')?.includes('authorization'));
  assert.deepEqual(fake.calls, []);
});

Deno.test('end: the admin who started it ends it and signs that session out only', async () => {
  const fake = fakeGateway();
  const started = (await run(fake, post(adminToken, { action: 'start', target_id: MEMBER }))).body;
  const { status, body } = await run(fake, post(adminToken, { action: 'end', session_id: SESSION, access_token: started.access_token }));
  assert.deepEqual([status, body], [200, { ended: true, revoked: true }]);
  assert.notEqual(fake.log[0].ended_at, null);
  assert.deepEqual(fake.signedOut, [started.access_token]);
  // Again: already ended, nothing to write.
  const again = await run(fake, post(adminToken, { action: 'end', session_id: SESSION }));
  assert.deepEqual([again.status, again.body], [200, { ended: true, revoked: false }]);
  assert.equal(fake.calls.filter(c => c.startsWith('endLog')).length, 1);
});

Deno.test('end: another admin, a member or an unknown session is refused; a foreign token is not signed out', async () => {
  const fake = fakeGateway();
  await run(fake, post(adminToken, { action: 'start', target_id: MEMBER }));
  const otherAdmin = jwt({ sub: OTHER_ADMIN, session_id: '44444444-4444-4444-4444-444444444444' });
  (fake.gateway as unknown as { getUser: Gateway['getUser'] }).getUser = async token =>
    token === otherAdmin ? { id: OTHER_ADMIN } : token === adminToken ? { id: ADMIN } : token === memberToken ? { id: MEMBER } : null;
  fake.gateway.isAdmin = async token => token === otherAdmin || token === adminToken;
  assert.deepEqual((await run(fake, post(otherAdmin, { action: 'end', session_id: SESSION }))).body, { error: 'impersonation_session_not_found' });
  assert.deepEqual((await run(fake, post(memberToken, { action: 'end', session_id: SESSION }))).body, { error: 'impersonation_actor_not_admin' });
  assert.equal((await run(fake, post(adminToken, { action: 'end', session_id: '55555555-5555-5555-5555-555555555555' }))).status, 404);
  // A token that isn't that session's: refused, nothing signed out.
  const res = await run(fake, post(adminToken, { action: 'end', session_id: SESSION, access_token: memberToken }));
  assert.deepEqual([res.status, res.body.error], [400, 'impersonation_request_invalid']);
  assert.deepEqual(fake.signedOut, []);
});

Deno.test('end: the impersonated tab ends its own session (« Quitter »), and only its own', async () => {
  const fake = fakeGateway();
  const started = (await run(fake, post(adminToken, { action: 'start', target_id: MEMBER }))).body;
  const wrong = await run(fake, post(started.access_token, { action: 'end', session_id: '55555555-5555-5555-5555-555555555555' }));
  assert.equal(wrong.status, 404);
  const { status, body } = await run(fake, post(started.access_token, { action: 'end' }));
  assert.deepEqual([status, body], [200, { ended: true, revoked: true }]);
  assert.notEqual(fake.log[0].ended_at, null);
  assert.deepEqual(fake.signedOut, [started.access_token]);
});

Deno.test('gateway: maps the trigger\'s codes and the unique index, and keeps bodies out of errors', async () => {
  const responses: Response[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const gateway = createGateway({
    url: 'http://supabase', anonKey: 'anon', serviceRoleKey: 'service',
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return responses.shift()!;
    }) as typeof fetch
  });
  responses.push(Response.json({ code: 'P0001', message: 'impersonation_target_admin' }, { status: 400 }));
  assert.deepEqual(await gateway.insertLog(ADMIN, MEMBER), { ok: false, code: 'impersonation_target_admin' });
  responses.push(Response.json({ code: '23505', message: 'duplicate key value violates unique constraint' }, { status: 409 }));
  assert.deepEqual(await gateway.insertLog(ADMIN, MEMBER), { ok: false, code: 'impersonation_target_pending' });
  assert.equal((requests[0].init.headers as Record<string, string>).Authorization, 'Bearer service');

  responses.push(Response.json({ code: 422, error_code: 'validation_failed', msg: 'member@test.local is invalid' }, { status: 422 }));
  await assert.rejects(gateway.generateMagicLink('member@test.local'), (error: Error) => {
    assert.equal(error.message, 'generate_link: 422 validation_failed');
    return true;
  });

  responses.push(Response.json({ id: MEMBER, email: 'member@test.local', hashed_token: 'h', action_link: 'x' }));
  assert.deepEqual(await gateway.generateMagicLink('member@test.local'), { userId: MEMBER, tokenHash: 'h' });

  responses.push(new Response(null, { status: 204 }));
  assert.equal(await gateway.signOut('the-session-token'), true);
  const logout = requests.at(-1)!;
  assert.equal(logout.url, 'http://supabase/auth/v1/logout?scope=local');
  assert.equal((logout.init.headers as Record<string, string>).Authorization, 'Bearer the-session-token');
});
