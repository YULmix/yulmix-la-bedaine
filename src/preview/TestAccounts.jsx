// Preview-only (#105): sign in as any seeded @test.local account, so a preview deployment can be
// checked as a member or an admin. Only reachable when __PREVIEW_TOOLS__ is true (dev server,
// Vercel Preview builds; see vite.config.js), as a lazy chunk: production builds contain none of
// this file, its strings or the seed password. At runtime it also renders only against the
// Preview Supabase project or a local stack.
import { useEffect, useState } from 'react';
import { FlaskConical, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import pv from '../locales/fr.preview.json';
import AccountPicker from '../components/AccountPicker';
import { accountLevel } from '../lib/registrationOptions';
import { Button, Dialog, Field, Input, Tag } from '../components/ui';
import { listPartySummaries } from '../lib/parties';

// Every seeded account's password (supabase/seed.sql, scripts/preview-seed/).
const TEST_PASSWORD = 'password123';
const TEST_DOMAIN = '@test.local';
const PREVIEW_PROJECT_REF = 'uacfrldoiixfstigosqv';
const QUICK_ACCOUNTS = [
  { email: 'admin@test.local', label: pv.quickAdmin },
  { email: 'organiser@test.local', label: pv.quickOrganiser },
  { email: 'committee@test.local', label: pv.quickCommittee },
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
      const [profilesRes, eventRes, rolesRes] = await Promise.all([
        supabase.from('profiles').select('id, email, full_name, is_admin')
          .ilike('email', `%${TEST_DOMAIN}`).is('deleted_at', null).order('full_name'),
        supabase.from('events').select('id').eq('is_active', true).maybeSingle(),
        supabase.from('edition_roles').select('user_id, role, event_id')
      ]);
      if (profilesRes.error || eventRes.error || rolesRes.error) {
        console.error('Error loading test accounts:', profilesRes.error || eventRes.error || rolesRes.error);
        if (!ignore) setState({ loading: false, error: true, accounts: [] });
        return;
      }
      const eventId = eventRes.data?.id;
      let parties = [];
      let problemParties = new Set();
      if (eventId) {
        parties = await listPartySummaries(supabase, eventId).catch(() => []);
        const { data: problems } = await supabase.from('email_log')
          .select('party_id').in('party_id', parties.map(p => p.id)).in('status', ['failed', 'pending']);
        problemParties = new Set((problems || []).map(row => row.party_id));
      }
      const byUser = new Map(parties.map(p => [p.user_id, p]));
      // Their level on the active edition; none without one.
      const roleOf = new Map((rolesRes.data || []).filter(r => r.event_id === eventId).map(r => [r.user_id, r.role]));
      const accounts = profilesRes.data.map(profile => {
        const party = byUser.get(profile.id);
        return {
          ...profile,
          level: accountLevel(profile, roleOf.get(profile.id)),
          party,
          hasBed: !!party?.hasPlace,
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
    <>
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
    </>
  );
};

export const TestAccountPicker = ({ open, onClose, currentEmail, isAdmin }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const { loading, error: loadError, accounts } = useTestAccounts(ENABLED && open && isAdmin);

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

  const header = (
    <div className="space-y-6">
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

      <h3 className="text-sm font-semibold text-muted">{pv.allAccounts}</h3>
    </div>
  );

  return (
    <Dialog open={open} onClose={onClose} title={pv.pickerTitle} size="md">
      <div className="px-5 py-5 sm:px-6">
        {isAdmin ? (
          <AccountPicker
            header={header}
            accounts={accounts}
            loading={loading}
            error={loadError}
            isCurrent={account => account.email.toLowerCase() === current}
            isDisabled={() => !!busy}
            onChoose={account => choose(account.email)}
            renderTags={account => <AccountTags account={account} />}
          />
        ) : (
          <div className="space-y-3">
            {header}
            <p className="text-sm text-faint">{pv.adminOnlyHint}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
};
