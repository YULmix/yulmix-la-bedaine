// Preview-only (#105): sign in as any seeded @test.local account, so a preview deployment can be
// checked as a member or an admin. Only reachable when __PREVIEW_TOOLS__ is true (dev server,
// Vercel Preview builds; see vite.config.js), as a lazy chunk: production builds contain none of
// this file, its strings or the seed password. At runtime it also renders only against the
// Preview Supabase project or a local stack.
import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Search, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import pv from '../locales/fr.preview.json';
import { initials } from '../lib/eventDisplay';
import { Button, Dialog, Field, Input, Tag, cx } from '../components/ui';

// Every seeded account's password (supabase/seed.sql, scripts/preview-seed/).
const TEST_PASSWORD = 'password123';
const TEST_DOMAIN = '@test.local';
const PREVIEW_PROJECT_REF = 'uacfrldoiixfstigosqv';
const QUICK_ACCOUNTS = [
  { email: 'admin@test.local', label: pv.quickAdmin },
  { email: 'member@test.local', label: pv.quickMember }
];

const isPreviewDatabase = (url = '') =>
  url.startsWith(`https://${PREVIEW_PROJECT_REF}.supabase.co`) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url);

const ENABLED = isPreviewDatabase(import.meta.env.VITE_SUPABASE_URL);

export const isTestAccount = (email) => !!email?.toLowerCase().endsWith(TEST_DOMAIN);

// A full page load after switching: screens keyed on "is signed in" wouldn't refetch when one
// signed-in account replaces another.
const signInAs = async (email) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) return error;
  window.location.assign('/');
  return null;
};

export const TestAccountMenuItem = ({ className, onSelect }) => {
  if (!ENABLED) return null;
  return (
    <button role="menuitem" onClick={onSelect} className={className}>
      <FlaskConical aria-hidden="true" className="size-5 text-info" strokeWidth={1.75} />
      {pv.switchAccount}
    </button>
  );
};

export const TestAccountMarker = ({ email }) => {
  if (!ENABLED || !isTestAccount(email)) return null;
  return (
    <p className="border-b border-info/40 tint-info px-4 py-1.5 text-center font-data text-xs text-info">
      {pv.marker.replace('{email}', email)}
    </p>
  );
};

// What the admin needs to pick the right account: its state on the active event.
const useTestAccounts = (enabled) => {
  const [state, setState] = useState({ loading: enabled, error: false, accounts: [] });

  useEffect(() => {
    if (!enabled) return undefined;
    let ignore = false;
    const load = async () => {
      const [profilesRes, eventRes] = await Promise.all([
        supabase.from('profiles').select('id, email, full_name, is_admin')
          .ilike('email', `%${TEST_DOMAIN}`).is('deleted_at', null).order('full_name'),
        supabase.from('events').select('id').eq('is_active', true).maybeSingle()
      ]);
      if (profilesRes.error || eventRes.error) {
        console.error('Error loading test accounts:', profilesRes.error || eventRes.error);
        if (!ignore) setState({ loading: false, error: true, accounts: [] });
        return;
      }
      const eventId = eventRes.data?.id;
      let parties = [];
      let problemParties = new Set();
      if (eventId) {
        const { data: partyRows } = await supabase.from('user_parties')
          .select('id, user_id, status, is_waitlisted, payment_status, attendees(place:attendee_places(place_id))').eq('event_id', eventId);
        parties = partyRows || [];
        const { data: problems } = await supabase.from('email_log')
          .select('party_id').in('party_id', parties.map(p => p.id)).in('status', ['failed', 'pending']);
        problemParties = new Set((problems || []).map(row => row.party_id));
      }
      const byUser = new Map(parties.map(p => [p.user_id, p]));
      const accounts = profilesRes.data.map(profile => {
        const party = byUser.get(profile.id);
        return {
          ...profile,
          party,
          hasBed: !!party?.attendees?.some(a => a.place),
          emailProblem: !!party && problemParties.has(party.id)
        };
      });
      if (!ignore) setState({ loading: false, error: false, accounts });
    };
    load();
    return () => { ignore = true; };
  }, [enabled]);

  return state;
};

const AccountTags = ({ account }) => {
  const { party } = account;
  return (
    <div className="flex flex-wrap gap-1.5">
      {account.is_admin && <Tag tone="neon">{pv.tagAdmin}</Tag>}
      {!party && <Tag>{pv.tagNotRegistered}</Tag>}
      {party?.status === 'cancelled' && <Tag>{pv.tagCancelled}</Tag>}
      {party && party.status !== 'cancelled' && (party.is_waitlisted
        ? <Tag tone="warn">{pv.tagWaitlisted}</Tag>
        : <Tag tone="info">{pv.tagRegistered}</Tag>)}
      {party && party.status !== 'cancelled' && !party.is_waitlisted && (party.payment_status === 'paid'
        ? <Tag tone="ok">{pv.tagPaid}</Tag>
        : <Tag tone="warn">{pv.tagUnpaid}</Tag>)}
      {account.hasBed && <Tag tone="ok">{pv.tagBed}</Tag>}
      {account.emailProblem && <Tag tone="bad">{pv.tagEmailProblem}</Tag>}
    </div>
  );
};

export const TestAccountPicker = ({ open, onClose, currentEmail, isAdmin }) => {
  const [email, setEmail] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const { loading, error: loadError, accounts } = useTestAccounts(ENABLED && open && isAdmin);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter(a => [a.full_name, a.email].some(v => v?.toLowerCase().includes(needle)));
  }, [accounts, query]);

  if (!ENABLED) return null;

  const choose = async (target) => {
    const address = target.trim().toLowerCase();
    if (!isTestAccount(address)) {
      setError(pv.emailInvalid.replace('{domain}', TEST_DOMAIN));
      return;
    }
    setBusy(address);
    setError(null);
    const signInError = await signInAs(address);
    if (signInError) {
      setBusy(null);
      setError(pv.signInError.replace('{message}', signInError.message));
    }
  };

  const current = currentEmail?.toLowerCase();

  return (
    <Dialog open={open} onClose={onClose} title={pv.pickerTitle} size="md">
      <div className="space-y-6 px-5 py-5 sm:px-6">
        <p className="text-sm text-muted">{pv.pickerIntro.replace('{domain}', TEST_DOMAIN)}</p>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted">{pv.quickAccounts}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {QUICK_ACCOUNTS.map(account => (
              <Button
                key={account.email}
                variant="secondary"
                className="justify-start"
                loading={busy === account.email}
                disabled={account.email === current}
                onClick={() => choose(account.email)}
              >
                <UserRound aria-hidden="true" className="size-4.5 text-faint" strokeWidth={1.75} />
                <span className="min-w-0 text-left">
                  <span className="block">{account.label}</span>
                  <span className="block truncate font-data text-xs font-normal text-faint">{account.email}</span>
                </span>
              </Button>
            ))}
          </div>
        </section>

        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => { event.preventDefault(); choose(email); }}
        >
          <Field label={pv.emailLabel} htmlFor="test-account-email" className="flex-1">
            <Input
              id="test-account-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={pv.emailPlaceholder}
            />
          </Field>
          <Button type="submit" loading={busy === email.trim().toLowerCase()} disabled={!email.trim()}>{pv.signIn}</Button>
        </form>

        {error && <p role="alert" className="text-sm font-semibold text-bad">{error}</p>}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted">{pv.allAccounts}</h3>
          {!isAdmin ? (
            <p className="text-sm text-faint">{pv.adminOnlyHint}</p>
          ) : (
            <>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-faint" />
                <Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={pv.search} aria-label={pv.search} className="pl-10" />
              </div>
              {loading && <p className="text-sm text-faint">{pv.loading}</p>}
              {loadError && <p className="text-sm text-bad">{pv.loadError}</p>}
              {!loading && !loadError && visible.length === 0 && <p className="text-sm text-faint">{pv.noMatch}</p>}
              {visible.length > 0 && (
                <ul className="divide-y divide-line rounded-card border border-line">
                  {visible.map(account => {
                    const isCurrent = account.email.toLowerCase() === current;
                    return (
                      <li key={account.id}>
                        <button
                          type="button"
                          disabled={isCurrent || !!busy}
                          onClick={() => choose(account.email)}
                          className={cx(
                            'flex w-full min-h-11 items-start gap-3 px-4 py-3 text-left transition duration-150',
                            isCurrent ? 'cursor-default bg-raised' : 'hover:bg-raised disabled:opacity-60'
                          )}
                        >
                          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-raised font-data text-sm text-muted">
                            {initials(account.full_name || account.email)}
                          </span>
                          <span className="min-w-0 flex-1 space-y-1.5">
                            <span className="block truncate font-semibold text-ink">
                              {account.full_name || fr.notSpecified}
                              {isCurrent && <span className="ml-2 text-sm font-normal text-faint">{pv.current}</span>}
                            </span>
                            <span className="block truncate font-data text-xs text-faint">{account.email}</span>
                            <AccountTags account={account} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
};
