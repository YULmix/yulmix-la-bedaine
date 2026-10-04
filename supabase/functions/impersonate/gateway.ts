// The impersonate function's Gateway (handler.ts) over Supabase's HTTP APIs: PostgREST and Auth.
// Plain fetch, as send-party-email, so the function has no dependency to resolve.
//
// Error messages carry a path, a status and an error code, never a body that could hold an email
// or a token.

import type { Gateway, LogRow, Profile, Session } from './handler.ts';

export interface GatewayConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  fetch?: typeof fetch;
}

const LOG_COLUMNS = 'id,admin_id,target_id,session_id,expires_at,ended_at';

export function createGateway({ url, anonKey, serviceRoleKey, fetch: fetchImpl = fetch }: GatewayConfig): Gateway {
  const call = async (path: string, init: RequestInit & { key: string; token: string }) => {
    const { key, token, headers, ...rest } = init;
    return await fetchImpl(`${url}${path}`, {
      ...rest,
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }
    });
  };
  const asUser = (token: string) => ({ key: anonKey, token });
  const asService = { key: serviceRoleKey, token: serviceRoleKey };

  // A failed call, described without its body (which may echo an email back).
  const failure = async (what: string, response: Response) => {
    const body = await response.json().catch(() => null);
    const code = body?.error_code ?? body?.code ?? '';
    return new Error(`${what}: ${response.status}${code ? ` ${code}` : ''}`);
  };
  const rows = async <T>(what: string, response: Response): Promise<T[]> => {
    if (!response.ok) throw await failure(what, response);
    return await response.json();
  };

  return {
    async getUser(token) {
      const response = await call('/auth/v1/user', { method: 'GET', ...asUser(token) });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw await failure('GET /auth/v1/user', response);
      const user = await response.json();
      return typeof user?.id === 'string' ? { id: user.id } : null;
    },

    async isAdmin(token) {
      const response = await call('/rest/v1/rpc/is_admin', { method: 'POST', body: '{}', ...asUser(token) });
      if (!response.ok) throw await failure('rpc is_admin', response);
      return (await response.json()) === true;
    },

    async readProfile(token, id) {
      const [profile] = await rows<Profile>('GET profiles', await call(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=id,full_name,email,is_admin,deleted_at`,
        { method: 'GET', ...asUser(token) }
      ));
      return profile ?? null;
    },

    async getAuthUser(id) {
      const response = await call(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'GET', ...asService });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw await failure('GET /auth/v1/admin/users', response);
      const user = await response.json();
      return { id: user.id, email: user.email ?? null };
    },

    async insertLog(adminId, targetId) {
      const response = await call(`/rest/v1/impersonation_log?select=${LOG_COLUMNS}`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ admin_id: adminId, target_id: targetId }),
        ...asService
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        // The trigger's codes are the message; the partial unique index is the race's backstop.
        const code = error?.code === '23505' && error?.message !== 'impersonation_target_pending'
          ? 'impersonation_target_pending'
          : String(error?.message ?? `insert ${response.status}`);
        return { ok: false, code };
      }
      const [row] = await response.json();
      return { ok: true, row };
    },

    async readLogBySession(sessionId) {
      const [row] = await rows<LogRow>('GET impersonation_log', await call(
        `/rest/v1/impersonation_log?session_id=eq.${encodeURIComponent(sessionId)}&select=${LOG_COLUMNS}`,
        { method: 'GET', ...asService }
      ));
      return row ?? null;
    },

    async endLog(id) {
      // The service role may only write ended_at; the trigger refuses ending a row twice, hence
      // the filter.
      const response = await call(`/rest/v1/impersonation_log?id=eq.${id}&ended_at=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ ended_at: new Date().toISOString() }),
        ...asService
      });
      if (!response.ok) throw await failure('PATCH impersonation_log', response);
      await response.body?.cancel();
    },

    async generateMagicLink(email) {
      const response = await call('/auth/v1/admin/generate_link', {
        method: 'POST',
        body: JSON.stringify({ type: 'magiclink', email }),
        ...asService
      });
      if (!response.ok) throw await failure('generate_link', response);
      const link = await response.json();
      const userId = link?.id ?? link?.user?.id;
      const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
      if (typeof userId !== 'string' || typeof tokenHash !== 'string') throw new Error('generate_link: unexpected response');
      return { userId, tokenHash };
    },

    async verifyMagicLink(tokenHash) {
      const response = await fetchImpl(`${url}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash })
      });
      if (!response.ok) throw await failure('verify', response);
      const session = await response.json();
      if (typeof session?.access_token !== 'string' || typeof session?.refresh_token !== 'string') {
        throw new Error('verify: no session');
      }
      return { access_token: session.access_token, refresh_token: session.refresh_token } satisfies Session;
    },

    async signOut(accessToken) {
      const response = await call('/auth/v1/logout?scope=local', { method: 'POST', ...asUser(accessToken) });
      await response.body?.cancel();
      return response.ok;
    }
  };
}
