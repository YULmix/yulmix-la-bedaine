// impersonate (#266, ADR 0025): opens and ends a « Voir comme » session. The request handling and
// its contract are in handler.ts, the calls to Supabase in gateway.ts.
//
// Environment, provided by the Supabase runtime:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// The custom access token hook must be enabled in the project's Auth (locally supabase/config.toml;
// production and Preview in the dashboard, #268). Without it every start fails with
// impersonation_not_marked, and nothing is handed over.

import { createGateway } from './gateway.ts';
import { createHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.serve(createHandler(createGateway({ url, anonKey, serviceRoleKey })));
