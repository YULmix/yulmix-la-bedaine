// send-party-email (ADR 0016): sends the transactional emails a party is owed.
//
// Called by the trigger on public.user_parties (through pg_net) with { "party_id": "<uuid>" }.
// It trusts nothing else in the request: it reads the committed party and email_log with the
// service role and sends only what dueTemplates() says is owed. Each email is claimed in
// email_log (unique per party and template) before it is sent, so concurrent or repeated calls
// send it at most once, and a failure is recorded, never retried (Resend free plan: 100/day).
//
// Environment:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  provided by the Supabase runtime
//   RESEND_API_KEY  production only (`supabase secrets set`). Without it nothing is sent: the
//                   email is logged and recorded as dry_run. Local and Preview run like this.
//   EMAIL_FROM, SITE_URL  optional overrides of the defaults below

import {
  buildContext,
  dueTemplates,
  renderEmail,
  type EventInfo,
  type Party,
  type Recipient,
  type Template
} from './emails.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'La Bédaine <bedaine@yulmix.com>';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://www.yulmix.com/';
// Organisers' inbox: the reply-to address and the Interac recipient named in the emails.
const ORGANISERS_EMAIL = 'yulmixalabedaine@gmail.com';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PartyRow = Party & { events: EventInfo | null; profiles: Recipient | null };
type LogRow = { id: string; template: Template };

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers
    }
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? (undefined as T) : await response.json();
}

async function send(to: string, template: Template, email: ReturnType<typeof renderEmail>, idempotencyKey: string) {
  if (!RESEND_API_KEY) {
    console.log(`[dry run] ${template} to ${to}: ${email.subject}\n${email.text}`);
    return { status: 'dry_run' as const, resend_id: null, error: null };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // Resend drops a second request with the same key within 24 hours.
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      reply_to: ORGANISERS_EMAIL,
      subject: email.subject,
      text: email.text,
      html: email.html
    })
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`Resend refused ${template} to ${to}: ${response.status} ${body}`);
    return { status: 'failed' as const, resend_id: null, error: `${response.status} ${body}`.slice(0, 1000) };
  }
  return { status: 'sent' as const, resend_id: JSON.parse(body).id ?? null, error: null };
}

async function handle(partyId: string) {
  const [party] = await rest<PartyRow[]>(
    `user_parties?id=eq.${partyId}&select=id,status,is_waitlisted,payment_status,calculated_amount_owed,` +
      'attendees(name,place:attendee_places(place_id)),events(theme,event_start_date,is_active,venue:venues(address)),profiles(email,full_name)' +
      // Removed attendees (#237) are kept as rows; the service role reads past RLS, so filter them.
      '&attendees.deleted_at=is.null&attendees.order=position.asc'
  );
  if (!party?.events || !party.profiles?.email) return { party_id: partyId, results: [] };

  const logged = await rest<LogRow[]>(`email_log?party_id=eq.${partyId}&select=id,template`);
  const due = dueTemplates(party, party.events, logged.map(row => row.template));
  const context = buildContext(party, party.events, party.profiles, { siteUrl: SITE_URL, interacEmail: ORGANISERS_EMAIL });

  const results = [];
  for (const template of due) {
    // Claim first. ignore-duplicates returns only rows actually inserted, so if another call
    // claimed this template in the meantime we get nothing back and skip it.
    const [claim] = await rest<LogRow[]>('email_log?on_conflict=party_id,template', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify([{ party_id: partyId, template, recipient: party.profiles.email }])
    });
    if (!claim) continue;

    const outcome = await send(party.profiles.email, template, renderEmail(template, context), `${partyId}:${template}`)
      .catch(error => ({ status: 'failed' as const, resend_id: null, error: String(error).slice(0, 1000) }));
    await rest(`email_log?id=eq.${claim.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...outcome, updated_at: new Date().toISOString() })
    });
    results.push({ template, status: outcome.status });
  }
  return { party_id: partyId, results };
}

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const payload = await request.json().catch(() => null);
  const partyId = payload?.party_id;
  if (typeof partyId !== 'string' || !UUID.test(partyId)) {
    return Response.json({ error: 'party_id (uuid) is required' }, { status: 400 });
  }
  try {
    return Response.json(await handle(partyId));
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
});
