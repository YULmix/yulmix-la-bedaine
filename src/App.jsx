import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { isAdminPath } from './lib/adminRoutes';
import { LockKeyhole, UserX } from 'lucide-react';
import Header from './components/Header';
import EventModal from './components/EventModal';
import FeedbackModal from './components/FeedbackModal';
import ResolutionBanner from './components/ResolutionBanner';
import ToastContainer from './components/Toast';
import HomeView from './views/HomeView';
import AdminView from './views/AdminView';
import EventDetailsView from './views/EventDetailsView';
import AboutView from './views/AboutView';
import RegistrationPage from './views/RegistrationPage';
import CarpoolView from './views/CarpoolView';
import { Button, EmptyState, Skeleton } from './components/ui';
import fr from './locales/fr.json';
import { supabase } from './lib/supabase';
import { useEvents } from './lib/events';

const signInWithGoogle = async () => {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch (error) {
    console.error(`${fr.authError}:`, error);
  }
};

// Auth still resolving: the page's shape, not a spinner.
const ShellSkeleton = () => (
  <div className="min-h-dvh bg-night" aria-busy="true">
    <span className="sr-only">{fr.loading}</span>
    <div className="h-16 border-b border-line" />
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <Skeleton className="h-72 rounded-card" />
      <Skeleton className="h-16" />
      <Skeleton className="h-56 rounded-card" />
    </div>
  </div>
);

const PageMain = ({ children, wide = false }) => (
  <main className={`mx-auto w-full flex-1 px-4 pb-16 pt-6 md:px-6 ${wide ? 'max-w-7xl' : 'max-w-6xl'}`}>{children}</main>
);

const SignedOutHome = () => (
  <PageMain>
    <section className="relative isolate flex min-h-[70dvh] flex-col justify-end overflow-hidden rounded-card border border-line p-6 sm:p-10 animate-rise">
      <img src="/bedaine-disco.webp" alt="" aria-hidden="true" className="absolute inset-0 -z-20 size-full object-cover" />
      <img src="/bedaine-mural.webp" alt="" aria-hidden="true" className="absolute inset-x-0 top-0 -z-20 h-1/2 w-full object-cover opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,var(--color-night)_20%,transparent)]" />
      <p className="font-data text-xs uppercase tracking-widest text-muted">{fr.appTitle}</p>
      <h1 className="mt-3 font-display text-display-lg text-ink">{fr.brandName}</h1>
      <p className="mt-4 max-w-xl text-lg text-ink">{fr.pleaseSignInHome}</p>
      <p className="mt-1 max-w-xl text-muted">{fr.signedOutSubtext}</p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button onClick={signInWithGoogle}>
          <LockKeyhole aria-hidden="true" className="size-4.5" strokeWidth={2} />
          {fr.signInWithGoogle}
        </Button>
      </div>
    </section>
  </PageMain>
);

// Guards a route on the app's auth state. Declared at module level on purpose: a component defined
// inside App would be a new type on every App render (Supabase fires an auth event whenever the
// browser tab regains focus), and React would remount the whole page under it, dropping every
// unsaved edit.
const ProtectedRoute = ({ ready, isAuthenticated, isAdmin, adminOnly = false, children }) => {
  if (!ready) return <ShellSkeleton />;

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (adminOnly && !isAdmin) {
    return (
      <PageMain>
        <EmptyState icon={LockKeyhole} title={fr.adminOnlyAccessMessage} action={<Link to="/" className="font-semibold text-neon underline underline-offset-4">{fr.backToHome}</Link>} />
      </PageMain>
    );
  }

  return children;
};

function App() {
  // Admin pages are wider (the sidebar and the page, ADR 0022); the footer lines up with them.
  const adminPage = isAdminPath(useLocation().pathname);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // Soft-deleted account (#36): the database gives it no member access; the app shows why.
  const [isDeleted, setIsDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [user, setUser] = useState(null);
  // The events and the active one, shared with the admin (src/lib/events.ts, #195). Routes that
  // need the active event (/inscription, /event-details) must not decide "no event" before the
  // events query has answered.
  const { activeEvent, otherEvents, loading: eventsLoading } = useEvents();
  const eventsLoaded = !eventsLoading;

  // Fetch admin status for current user (matches DB is_admin() function logic)
  const fetchAdminStatus = async (userId) => {
    try {
      // Use the database's is_admin() function which respects root email fallback
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('is_admin');

      if (!rpcError && typeof rpcData === 'boolean') {
        setIsAdmin(rpcData);
        return;
      }

      // Fallback: fetch profile and apply same logic client‑side
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin, email')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      // If profile doesn't exist yet (race condition after sign‑up), treat as non‑admin
      const isAdmin = data ? (data.is_admin || data.email === 'yulmixalabedaine@gmail.com') : false;
      setIsAdmin(isAdmin);
    } catch (error) {
      console.error('Error fetching admin status:', error);
      setIsAdmin(false);
    }
  };

  // A deleted member can still read their own profile row; everything else is closed to them.
  // If the lookup fails, the database still refuses a deleted account everything; only the
  // explanation is missing, so treat it as active rather than signing the user out.
  const fetchAccountStatus = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('deleted_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      setIsDeleted(!!data?.deleted_at);
    } catch (error) {
      console.error('Error fetching account status:', error);
      setIsDeleted(false);
    }
  };

  const handleEventClick = (event) => {
    setSelectedEvent(event);
    setIsModalOpen(true);
  };

  useEffect(() => {

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user || null);
        setIsAuthenticated(!!session);
        if (session?.user) {
          await Promise.all([fetchAdminStatus(session.user.id), fetchAccountStatus(session.user.id)]);
        } else {
          setIsAdmin(false);
          setIsDeleted(false);
        }
        setLoading(false);
      }
    );

    const getInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        setUser(session?.user || null);
        setIsAuthenticated(!!session);
        if (session?.user) {
          await Promise.all([fetchAdminStatus(session.user.id), fetchAccountStatus(session.user.id)]);
        }
      } catch (error) {
        console.error('Error getting initial session:', error);
        setIsAuthenticated(false);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (loading) return <ShellSkeleton />;

  const guard = { ready: !loading && eventsLoaded, isAuthenticated, isAdmin };

  return (
    <div className="flex min-h-dvh flex-col bg-night text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-80 focus:rounded-control focus:bg-neon focus:px-4 focus:py-2 focus:text-night">{fr.skipToContent}</a>
      <ResolutionBanner isAuthenticated={isAuthenticated} />
      <Header
        isAuthenticated={isAuthenticated}
        setIsAuthenticated={setIsAuthenticated}
        user={user}
        isAdmin={isAdmin}
        isDeleted={isDeleted}
        onOpenFeedback={() => setIsFeedbackOpen(true)}
      />

      {/* overflow-x-clip: step/tab slide-ins translate content sideways; without it mobile browsers widen the layout viewport mid-animation. clip (not hidden) keeps position: sticky working. */}
      <div id="main" className="flex flex-1 flex-col overflow-x-clip">
        {isAuthenticated && isDeleted ? (
          <PageMain>
            <EmptyState
              icon={UserX}
              title={fr.accountDeletedTitle}
              action={<Button variant="secondary" onClick={() => supabase.auth.signOut()}>{fr.signOut}</Button>}
            >
              {fr.accountDeletedMessage}
            </EmptyState>
          </PageMain>
        ) : (
        <Routes>
          <Route path="/" element={
            isAuthenticated ? (
              <PageMain>
                <HomeView
                  activeEvent={activeEvent}
                  isAuthenticated={isAuthenticated}
                  otherEvents={otherEvents}
                  onEventClick={handleEventClick}
                />
              </PageMain>
            ) : <SignedOutHome />
          } />

          <Route path="/inscription" element={
            <ProtectedRoute {...guard}>
              <RegistrationPage activeEvent={activeEvent} isAuthenticated={isAuthenticated} userId={user?.id} />
            </ProtectedRoute>
          } />

          <Route path="/event-details" element={
            <ProtectedRoute {...guard}>
              <PageMain>
                <EventDetailsView activeEvent={activeEvent} />
              </PageMain>
            </ProtectedRoute>
          } />

          {/* The board says itself when it isn't for this member (#180). */}
          <Route path="/carpool" element={
            <ProtectedRoute {...guard}>
              <PageMain>
                <CarpoolView />
              </PageMain>
            </ProtectedRoute>
          } />

          {/* /admin/* so AdminView stays mounted between its tabs and the event editor
              (/admin/events/:id), keeping unsaved drafts. */}
          <Route path="/admin/*" element={
            <ProtectedRoute {...guard} adminOnly>
              <AdminView isAdmin={isAdmin} />
            </ProtectedRoute>
          } />

          <Route path="/a-propos" element={
            <PageMain>
              <AboutView />
            </PageMain>
          } />
        </Routes>
        )}
      </div>

      <footer className="border-t border-line pb-24 md:pb-0">
        <div className={`mx-auto flex ${adminPage ? 'max-w-screen-2xl' : 'max-w-6xl'} flex-col gap-3 px-4 py-6 text-sm text-faint sm:flex-row sm:items-center sm:justify-between md:px-6`}>
          <p>© {new Date().getFullYear()} {fr.org}. {fr.allRightsReserved}</p>
          <div className="flex gap-5">
            <Link to="/a-propos" className="inline-flex min-h-11 items-center hover:text-ink">{fr.about}</Link>
            {isAuthenticated && !isDeleted && (
              <button onClick={() => setIsFeedbackOpen(true)} className="inline-flex min-h-11 items-center hover:text-ink">{fr.reportProblem}</button>
            )}
          </div>
        </div>
      </footer>

      <EventModal
        event={selectedEvent}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />

      {isAuthenticated && !isDeleted && (
        <FeedbackModal userId={user?.id} open={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
      )}

      {/* The app-wide toasts (src/lib/toasts.ts), for every page. */}
      <ToastContainer />
    </div>
  );
}

export default App;
