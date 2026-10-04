// impersonate (#266, ADR 0025): opens and ends a « Voir comme » session, a real Supabase session
// of a member, read-only, marked by the impersonated_by claim the custom access token hook adds.
//
// The request handling lives here, behind the Gateway interface, so the Deno tests run it against
// a fake; gateway.ts talks to Supabase over HTTP. The database stays the authority: the
// impersonation_log trigger re-checks the actor and the target, the hook marks the session and
// caps its exp, and the statement trigger refuses every write made with it. This function only
// adds what the database can't do: mint the session.
//
// POST { action: 'start', target_id }  as an admin, with the admin's own (not impersonated) JWT
//   → 200 { access_token, refresh_token, expires_at, session_id, ends_at, target: { id, full_name } }
//   expires_at is the access token's exp (epoch seconds), capped by the hook at the log row's
//   expires_at; ends_at is that row's expires_at: the session can't outlive it (a countdown
//   reads ends_at).
// POST { action: 'end', session_id, access_token? }  as the admin who started it: sets ended_at,
//   then signs out that session only (local scope) when given its access token, which the UI
//   always sends (without it only the hook refuses the session's refresh). Or with the
//   impersonated JWT itself (the read-only tab's « Quitter »): ends that session.
//   → 200 { ended: true, revoked }
// Errors: { error: '<code>' }, codes mapped to French in src/lib/dbErrors.ts.
//
// Nothing here logs a token, an email or member data: only codes and statuses.

export type Claims = Record<string, unknown> & { sub?: string; session_id?: string; impersonated_by?: string; exp?: number };

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  is_admin: boolean | null;
  deleted_at: string | null;
}

export interface LogRow {
  id: number;
  admin_id: string | null;
  target_id: string | null;
  session_id: string | null;
  expires_at: string;
  ended_at: string | null;
}

export interface Session {
  access_token: string;
  refresh_token: string;
}

export type InsertResult = { ok: true; row: LogRow } | { ok: false; code: string };

export interface Gateway {
  /** The user a JWT belongs to, checked by Supabase Auth (signature and live session); null if invalid. */
  getUser(token: string): Promise<{ id: string } | null>;
  /** public.is_admin() as the caller. */
  isAdmin(token: string): Promise<boolean>;
  /** The target's profile read as the caller (admins read every profile); null if none. */
  readProfile(token: string, id: string): Promise<Profile | null>;
  /** The target's Auth account (service role): its email is the one the magic link is for. */
  getAuthUser(id: string): Promise<{ id: string; email: string | null } | null>;
  /** Inserts the impersonation_log row (service role); the trigger's refusal comes back as a code. */
  insertLog(adminId: string, targetId: string): Promise<InsertResult>;
  readLogBySession(sessionId: string): Promise<LogRow | null>;
  /** Sets ended_at on a row not yet ended (service role). */
  endLog(id: number): Promise<void>;
  /** generateLink({ type: 'magiclink' }): sends nothing, returns the hashed token. */
  generateMagicLink(email: string): Promise<{ userId: string; tokenHash: string }>;
  /** verifyOtp({ token_hash, type: 'magiclink' }) with no persisted session: the hook runs here. */
  verifyMagicLink(tokenHash: string): Promise<Session>;
  /** Signs out the session this access token belongs to, and only it (scope local). */
  signOut(accessToken: string): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOT_ADMIN_EMAIL = 'yulmixalabedaine@gmail.com';

// The trigger on impersonation_log raises these; anything else from the insert is a 500.
const INSERT_REFUSALS: Record<string, number> = {
  impersonation_actor_not_admin: 403,
  impersonation_target_self: 422,
  impersonation_target_admin: 422,
  impersonation_target_deleted: 422,
  impersonation_target_not_found: 404,
  impersonation_target_pending: 409
};
export const insertRefusalStatus = (code: string): number | undefined => INSERT_REFUSALS[code];

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } });
const refuse = (code: string, status: number) => json({ error: code }, status);

/** The payload of a JWT, unverified: only read after Supabase Auth has accepted the token. */
export const decodeClaims = (token: string): Claims | null => {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0))));
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
};

const bearer = (request: Request): string | null => {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '');
  return match ? match[1] : null;
};

class Refusal extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export function createHandler(gateway: Gateway, log: (message: string) => void = message => console.error(message)) {
  // Ends a row and signs its session out, swallowing errors: used on the way out of a failure.
  const abandon = async (rowId: number | null, accessToken: string | null) => {
    if (accessToken) await gateway.signOut(accessToken).catch(() => false);
    if (rowId !== null) await gateway.endLog(rowId).catch(error => log(`impersonate: ending log row ${rowId} failed: ${error}`));
  };

  async function start(token: string, callerId: string, claims: Claims, body: Record<string, unknown>) {
    if (claims.impersonated_by !== undefined) throw new Refusal('impersonation_caller_impersonated', 403);
    if (!(await gateway.isAdmin(token))) throw new Refusal('impersonation_actor_not_admin', 403);

    const targetId = body.target_id;
    if (typeof targetId !== 'string' || !UUID.test(targetId)) throw new Refusal('impersonation_request_invalid', 400);
    if (targetId.toLowerCase() === callerId.toLowerCase()) throw new Refusal('impersonation_target_self', 422);

    // The trigger on impersonation_log checks all of this again; refusing here first means a
    // refused target never gets as far as the service role.
    const profile = await gateway.readProfile(token, targetId);
    if (!profile) throw new Refusal('impersonation_target_not_found', 404);
    if (profile.is_admin === true || profile.email === ROOT_ADMIN_EMAIL) throw new Refusal('impersonation_target_admin', 422);
    if (profile.deleted_at !== null) throw new Refusal('impersonation_target_deleted', 422);
    // The magic link goes to the Auth account's email, never the profile's: generating one for an
    // email Auth doesn't know would create an account.
    const account = await gateway.getAuthUser(targetId);
    if (!account?.email) throw new Refusal('impersonation_target_not_found', 404);

    const inserted = await gateway.insertLog(callerId, targetId);
    if (!inserted.ok) {
      const status = insertRefusalStatus(inserted.code);
      if (status) throw new Refusal(inserted.code, status);
      throw new Error(`insert impersonation_log: ${inserted.code}`);
    }
    const row = inserted.row;

    let session: Session | null = null;
    try {
      const link = await gateway.generateMagicLink(account.email);
      if (link.userId !== targetId) throw new Error('the magic link is for another account');
      session = await gateway.verifyMagicLink(link.tokenHash);

      // The hook fails open for a fresh claim (ADR 0025): an unmarked session would be a writable
      // session of the member. Hand over only a token that is marked, for this admin, on the
      // member, and tied to this very row.
      const minted = decodeClaims(session.access_token);
      const claimed = minted?.session_id ? await gateway.readLogBySession(String(minted.session_id)) : null;
      if (
        !minted ||
        minted.sub !== targetId ||
        minted.impersonated_by !== callerId ||
        typeof minted.exp !== 'number' ||
        claimed?.id !== row.id
      ) {
        throw new Refusal('impersonation_not_marked', 500);
      }
      return json({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: minted.exp,
        session_id: minted.session_id,
        ends_at: claimed.expires_at,
        target: { id: targetId, full_name: profile.full_name }
      });
    } catch (error) {
      await abandon(row.id, session?.access_token ?? null);
      throw error;
    }
  }

  async function end(token: string, callerId: string, claims: Claims, body: Record<string, unknown>) {
    const requested = body.session_id;
    if (requested !== undefined && (typeof requested !== 'string' || !UUID.test(requested))) {
      throw new Refusal('impersonation_request_invalid', 400);
    }

    // The read-only tab ending its own session (« Quitter »).
    if (claims.impersonated_by !== undefined) {
      const sessionId = String(claims.session_id ?? '');
      if (requested !== undefined && requested !== sessionId) throw new Refusal('impersonation_session_not_found', 404);
      const row = UUID.test(sessionId) ? await gateway.readLogBySession(sessionId) : null;
      if (!row || row.target_id !== callerId || row.admin_id !== claims.impersonated_by) {
        throw new Refusal('impersonation_session_not_found', 404);
      }
      if (row.ended_at === null) await gateway.endLog(row.id);
      return json({ ended: true, revoked: await gateway.signOut(token) });
    }

    // The admin's own tab: only the admin who started the session may end it.
    if (typeof requested !== 'string') throw new Refusal('impersonation_request_invalid', 400);
    if (!(await gateway.isAdmin(token))) throw new Refusal('impersonation_actor_not_admin', 403);
    const row = await gateway.readLogBySession(requested);
    if (!row || row.admin_id !== callerId) throw new Refusal('impersonation_session_not_found', 404);

    // The session's own access token, when given, must belong to that session: checked before
    // anything is written, so a refused request ends nothing.
    const sessionToken = typeof body.access_token === 'string' && body.access_token !== '' ? body.access_token : null;
    if (body.access_token !== undefined && body.access_token !== null && sessionToken === null) {
      throw new Refusal('impersonation_request_invalid', 400);
    }
    if (sessionToken !== null) {
      const sessionClaims = decodeClaims(sessionToken);
      if (sessionClaims?.session_id !== requested || sessionClaims?.impersonated_by !== callerId) {
        throw new Refusal('impersonation_request_invalid', 400);
      }
    }

    // Ending the row makes the hook refuse every refresh. With the session's own access token,
    // also sign that session out (scope local: the member's other sessions are untouched); an
    // expired one can't sign anything out. Without it, the Auth session and its refresh token
    // live on, refused by the hook only: the UI always sends it (#267).
    if (row.ended_at === null) await gateway.endLog(row.id);
    const revoked = sessionToken !== null && await gateway.signOut(sessionToken);
    return json({ ended: true, revoked });
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'POST') return refuse('method_not_allowed', 405);

    const token = bearer(request);
    if (!token) return refuse('not_authenticated', 401);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('impersonation_request_invalid', 400);
    const action = (body as Record<string, unknown>).action;
    if (action !== 'start' && action !== 'end') return refuse('impersonation_request_invalid', 400);

    try {
      // Supabase Auth checks the token (signature, live session); its claims are only read after.
      const caller = await gateway.getUser(token);
      const claims = caller ? decodeClaims(token) : null;
      if (!caller || !claims || claims.sub !== caller.id) return refuse('not_authenticated', 401);
      return action === 'start'
        ? await start(token, caller.id, claims, body as Record<string, unknown>)
        : await end(token, caller.id, claims, body as Record<string, unknown>);
    } catch (error) {
      if (error instanceof Refusal) {
        if (error.status >= 500) log(`impersonate ${action}: ${error.code}`);
        return refuse(error.code, error.status);
      }
      log(`impersonate ${action}: ${error instanceof Error ? error.message : 'unknown error'}`);
      return refuse('impersonation_failed', 500);
    }
  };
}
