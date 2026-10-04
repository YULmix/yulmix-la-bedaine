import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogOut, RotateCw, TriangleAlert, X } from 'lucide-react';
import fr from '../locales/fr.json';
import { supabase, clearVoirCommeTab, createAdminSessionReader, functionHeaders, functionUrl } from '../lib/supabase';
import { appError } from '../lib/dbErrors';
import {
  endVoirComme, msLeft, readVoirCommeSession, startVoirComme, targetIdFromPath, timeLeftLabel, writeVoirCommeSession
} from '../lib/voirComme';
import { VoirCommeContext, useVoirComme } from '../hooks/useVoirComme';
import { CANVAS_CLASS } from '../lib/pageWidth';
import { Button, cx } from './ui';

// « Voir comme » (#267, ADR 0025): the shell of a tab opened on /voir-comme/<member id>. It reads
// the admin's session (the ordinary tabs' storage, never written here), asks the `impersonate`
// function for the member's read-only session, puts it in this tab's own client
// (src/lib/supabase.ts: sessionStorage, its own key) and runs the app on it, with the banner in
// the header. The session ends with « Quitter », after its 30 minutes, or when the tab is left;
// then the tab says so and offers to close or to go back to the admin's own account.

// One start per tab: React's StrictMode runs effects twice in development, and a second start on
// the same member would be refused (impersonation_target_pending).
let pendingStart = null;

const startSession = async (targetId) => {
  const reader = createAdminSessionReader();
  const { data: { session: admin } } = await reader.auth.getSession();
  if (!admin) throw appError(fr.voirCommeAdminSignedOut);
  const started = await startVoirComme(admin.access_token, targetId);
  const { error } = await supabase.auth.setSession({ access_token: started.access_token, refresh_token: started.refresh_token });
  if (error) {
    console.error('Voir comme: storing the session failed:', error.message);
    await endVoirComme(started.access_token, started.session_id).catch(() => {});
    throw appError(fr.dbErrorImpersonationFailed);
  }
  const session = {
    sessionId: started.session_id,
    endsAt: started.ends_at,
    targetId: started.target.id,
    targetName: started.target.full_name
  };
  writeVoirCommeSession(session);
  return session;
};

const startOnce = (targetId) => {
  pendingStart ??= startSession(targetId).finally(() => { pendingStart = null; });
  return pendingStart;
};

const closeTab = () => window.close();

// Back to the admin's own app in this tab: the next load is an ordinary tab.
const backToMyAccount = () => {
  clearVoirCommeTab();
  writeVoirCommeSession(null);
  window.location.assign('/');
};

// The session's tokens leave this tab's storage only: never a global sign-out, which would sign
// the member out everywhere (ADR 0025).
const dropLocalSession = () => supabase.auth.signOut({ scope: 'local' }).catch(() => {});

// A page of its own (no header: the app isn't running), for the start, a failure and the end.
const TabPage = ({ icon: Icon, tone = 'neon', title, children, actions, busy = false }) => (
  <div className="flex min-h-dvh flex-col bg-night text-ink">
    <main className={cx(CANVAS_CLASS, 'flex flex-1 items-center justify-center py-10')}>
      <section aria-busy={busy || undefined} className="w-full max-w-lg rounded-card border border-line bg-surface p-6 text-center sm:p-8">
        <span className={cx('mx-auto grid size-14 place-items-center rounded-full bg-raised', tone === 'bad' ? 'text-bad' : 'text-neon')}>
          <Icon aria-hidden="true" className={cx('size-6', busy && 'animate-pulse')} strokeWidth={1.75} />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-ink">{title}</h1>
        {children && <div className="mt-2 space-y-2 text-muted">{children}</div>}
        {actions && <div className="mt-6 flex flex-col-reverse justify-center gap-3 sm:flex-row">{actions}</div>}
      </section>
    </main>
  </div>
);

const ENDED_MESSAGES = {
  quit: 'voirCommeEndedQuit',
  expired: 'voirCommeEndedExpired',
  left: 'voirCommeEndedLeft',
  lost: 'voirCommeEndedLost'
};

const EndedPage = ({ reason, targetName, endError }) => (
  <TabPage
    icon={EyeOff}
    title={fr.voirCommeEndedTitle}
    actions={(
      <>
        <Button variant="secondary" onClick={backToMyAccount}>{fr.voirCommeBackToMyAccount}</Button>
        <Button onClick={closeTab}>
          <X aria-hidden="true" className="size-4.5" strokeWidth={2} />
          {fr.voirCommeCloseTab}
        </Button>
      </>
    )}
  >
    <p>{fr[ENDED_MESSAGES[reason] || ENDED_MESSAGES.lost].replace('{name}', targetName || fr.voirCommeSomeone)}</p>
    {endError && <p role="alert" className="text-sm text-bad">{endError}</p>}
  </TabPage>
);

/** The banner, on every page of the tab (in the sticky header): whose session, read-only, time left, « Quitter ». */
export const VoirCommeBanner = () => {
  const voirComme = useVoirComme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  if (!voirComme) return null;
  const name = voirComme.targetName || fr.voirCommeSomeone;
  return (
    <div role="status" aria-label={fr.voirCommeBannerLabel} className="border-b border-warn/50 tint-warn">
      <div className={cx(CANVAS_CLASS, 'flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5')}>
        <Eye aria-hidden="true" className="size-4.5 shrink-0 text-warn" strokeWidth={2} />
        <p className="min-w-0 flex-1 text-sm text-ink">
          <span className="font-semibold [overflow-wrap:anywhere]">{fr.voirCommeBannerViewing.replace('{name}', name)}</span>
          <span className="text-muted"> · {fr.voirCommeReadOnly} · </span>
          <span className="whitespace-nowrap font-data text-muted">{timeLeftLabel(voirComme.endsAt, now)}</span>
        </p>
        <Button size="sm" variant="secondary" loading={voirComme.quitting} onClick={voirComme.quit}>
          <LogOut aria-hidden="true" className="size-4" strokeWidth={2} />
          {fr.voirCommeQuit}
        </Button>
      </div>
    </div>
  );
};

/** The « Voir comme » tab: starts or resumes the session, then runs `children` (the app) on it. */
const VoirCommeTab = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  // { status: 'starting' | 'active' | 'error' | 'ended', session, reason, message, endError }
  const [state, setState] = useState(() => ({ status: 'starting', session: null }));
  const [quitting, setQuitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // What pagehide needs synchronously: the session and its current access token.
  const live = useRef({ session: null, token: null });
  const targetId = useMemo(() => targetIdFromPath(location.pathname), [location.pathname]);

  const end = useCallback((reason, endError = null, session = live.current.session) => {
    live.current = { session: null, token: null };
    writeVoirCommeSession(null);
    setState({ status: 'ended', session, reason, endError });
  }, []);

  // Start (a /voir-comme/<id> URL) or resume (a session this tab already holds).
  useEffect(() => {
    let current = true;
    const resume = async () => {
      const stored = readVoirCommeSession();
      if (stored?.left) {
        // The tab was reloaded or left: its session was ended on the way out.
        await dropLocalSession();
        if (current) end('left', null, stored);
        return;
      }
      if (stored) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!current) return;
        if (!session || msLeft(stored.endsAt) === 0) {
          await dropLocalSession();
          if (current) end(session ? 'expired' : 'lost', null, stored);
          return;
        }
        live.current = { session: stored, token: session.access_token };
        setState({ status: 'active', session: stored });
        if (targetId) navigate('/', { replace: true });
        return;
      }
      if (!targetId) {
        end('lost');
        return;
      }
      try {
        const session = await startOnce(targetId);
        const { data } = await supabase.auth.getSession();
        if (!current) return;
        live.current = { session, token: data.session?.access_token ?? null };
        setState({ status: 'active', session });
        navigate('/', { replace: true });
      } catch (error) {
        if (current) setState({ status: 'error', session: null, message: error.message || fr.dbErrorImpersonationFailed });
      }
    };
    resume();
    return () => { current = false; };
    // Once per attempt: the URL changes to « / » once started, which must not start again.
  }, [attempt]);

  const active = state.status === 'active';
  const endsAt = state.session?.endsAt;

  // The token follows refreshes; a sign-out (the refresh refused once the session is over) ends it.
  useEffect(() => {
    if (!active) return undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) live.current.token = session.access_token;
      if (event === 'SIGNED_OUT' && live.current.session) end(msLeft(live.current.session.endsAt) === 0 ? 'expired' : 'lost');
    });
    return () => subscription.unsubscribe();
  }, [active, end]);

  // The 30 minutes are up: the token can't be used or refreshed any more.
  useEffect(() => {
    if (!active || !endsAt) return undefined;
    const timer = setTimeout(() => {
      const { session } = live.current;
      end('expired', null, session);
      dropLocalSession();
    }, msLeft(endsAt));
    return () => clearTimeout(timer);
  }, [active, endsAt, end]);

  // Closing (or reloading) the tab ends the session: a keepalive request outlives the page. The
  // stored session is marked as left, so a reload says the session is over instead of reusing it.
  // Where the request can't go out, the hook still refuses the session after its 30 minutes.
  useEffect(() => {
    if (!active) return undefined;
    const onPageHide = () => {
      const { session, token } = live.current;
      if (!session || !token) return;
      writeVoirCommeSession({ ...session, left: true });
      try {
        fetch(functionUrl('impersonate'), {
          method: 'POST',
          keepalive: true,
          headers: functionHeaders(token),
          body: JSON.stringify({ action: 'end', session_id: session.sessionId })
        }).catch(() => {});
      } catch {
        // Nothing more can be done from a closing page.
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [active]);

  const quit = useCallback(async () => {
    const { session, token } = live.current;
    if (!session) return;
    setQuitting(true);
    // From here the tab is leaving: neither the sign-out below nor closing it ends it a second time.
    live.current = { session: null, token: null };
    let endError = null;
    try {
      const { data } = await supabase.auth.getSession();
      await endVoirComme(data.session?.access_token ?? token, session.sessionId);
    } catch (error) {
      endError = fr.voirCommeEndFailed.replace('{reason}', error.message || fr.dbErrorImpersonationFailed);
    }
    await dropLocalSession();
    setQuitting(false);
    end('quit', endError, session);
    if (!endError) closeTab();
  }, [end]);

  const context = useMemo(
    () => (active ? { targetName: state.session.targetName, endsAt: state.session.endsAt, quit, quitting } : null),
    [active, state.session, quit, quitting]
  );

  if (state.status === 'starting') {
    return (
      <TabPage icon={Eye} title={fr.voirCommeStarting} busy>
        <p>{fr.voirCommeStartingHint}</p>
      </TabPage>
    );
  }
  if (state.status === 'error') {
    return (
      <TabPage
        icon={TriangleAlert}
        tone="bad"
        title={fr.voirCommeStartFailedTitle}
        actions={(
          <>
            <Button variant="secondary" onClick={closeTab}>{fr.voirCommeCloseTab}</Button>
            <Button onClick={() => { setState({ status: 'starting', session: null }); setAttempt(n => n + 1); }}>
              <RotateCw aria-hidden="true" className="size-4.5" strokeWidth={2} />
              {fr.retry}
            </Button>
          </>
        )}
      >
        <p role="alert">{state.message}</p>
      </TabPage>
    );
  }
  if (state.status === 'ended') {
    return <EndedPage reason={state.reason} targetName={state.session?.targetName} endError={state.endError} />;
  }
  return <VoirCommeContext.Provider value={context}>{children}</VoirCommeContext.Provider>;
};

export default VoirCommeTab;
