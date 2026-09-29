import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ChevronDown, Info, LogOut, MessageSquareWarning, ShieldCheck, Sparkles, UserX } from 'lucide-react';
import { supabase } from '../lib/supabase';
import fr from '../locales/fr.json';
import { initials } from '../lib/eventDisplay';
import { dbErrorMessage } from '../lib/dbErrors';
import { ConfirmDialog, cx } from './ui';
import yulmixLogo from '../assets/YULmix_App.png';

// Preview-only account switcher (#105). __PREVIEW_TOOLS__ is a build-time constant (vite.config.js):
// false in production builds, which then drop these imports and the whole chunk.
const previewTool = (name) => lazy(() => import('../preview/TestAccounts').then(m => ({ default: m[name] })));
const TestAccountMenuItem = __PREVIEW_TOOLS__ ? previewTool('TestAccountMenuItem') : null;
const TestAccountPicker = __PREVIEW_TOOLS__ ? previewTool('TestAccountPicker') : null;
const TestAccountMarker = __PREVIEW_TOOLS__ ? previewTool('TestAccountMarker') : null;

const MENU_ITEM = 'flex w-full min-h-11 items-center gap-3 rounded-control px-3 text-left text-base text-ink hover:bg-raised focus-visible:bg-raised';

// Small popover menu: closes on outside click, Escape, or choosing an item.
const useMenu = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
};

const navLinkClass = ({ isActive }) => cx(
  'inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold transition duration-150',
  isActive ? 'text-neon' : 'text-muted hover:text-ink'
);

const Header = ({ isAuthenticated, setIsAuthenticated, user, isAdmin, isDeleted = false, onOpenFeedback }) => {
  const menu = useMenu();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);

  const userDisplayName = user
    ? (user.user_metadata?.full_name || user.email || fr.profile)
    : fr.profile;

  const handleSignIn = async (provider) => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin }
      });
      if (error) console.error(`${fr.authError}:`, error);
    } catch (error) {
      console.error(`${fr.authError}:`, error);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error(`${fr.authError}:`, error);
      } else {
        setIsAuthenticated(false);
        menu.setOpen(false);
        navigate('/');
      }
    } catch (error) {
      console.error(`${fr.authError}:`, error);
    }
  };

  // The database decides (close-date lock, root admin) and raises a code; dbErrorMessage maps it
  // to French. Anything else gets the generic message.
  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.rpc('delete_my_account');
    setDeleting(false);
    if (error) {
      setDeleteError(dbErrorMessage(error, fr.deleteAccountError));
      return;
    }
    setConfirmingDelete(false);
    await handleSignOut();
  };

  const closeDeleteDialog = () => {
    setConfirmingDelete(false);
    setDeleteError(null);
  };

  const go = (path) => {
    menu.setOpen(false);
    navigate(path);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-night/85 backdrop-blur-md">
      {TestAccountMarker && isAuthenticated && (
        <Suspense fallback={null}><TestAccountMarker email={user?.email} /></Suspense>
      )}
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:px-6">
        <Link to="/" className="mr-auto flex shrink-0 items-center gap-3 rounded-control py-2" aria-label={fr.homeLinkLabel}>
          <img src={yulmixLogo} alt="" aria-hidden="true" className="h-7 w-auto" />
          <span className="hidden whitespace-nowrap font-display text-base text-ink min-[440px]:inline sm:text-lg">{fr.brandName}</span>
        </Link>

        {isAuthenticated && !isDeleted && (
          <nav aria-label={fr.mainNavLabel} className="flex items-center">
            <NavLink to="/event-details" className={navLinkClass}>
              <Info aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
              <span className="sr-only sm:not-sr-only">{fr.navInfo}</span>
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" className={navLinkClass}>
                <ShieldCheck aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
                <span className="sr-only sm:not-sr-only">{fr.navAdmin}</span>
              </NavLink>
            )}
          </nav>
        )}

        <div ref={menu.ref} className="relative min-w-0">
          <button
            onClick={() => menu.setOpen(!menu.open)}
            aria-expanded={menu.open}
            aria-haspopup="menu"
            className={cx(
              'inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-1.5 text-sm font-semibold transition duration-150',
              isAuthenticated ? 'border-line pr-3 hover:border-edge' : 'border-neon bg-neon px-4 text-night hover:brightness-110'
            )}
          >
            {isAuthenticated ? (
              <>
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-raised font-data text-xs text-neon">
                  {initials(userDisplayName)}
                </span>
                <span className="min-w-0 max-w-32 truncate sm:max-w-48">{userDisplayName}</span>
                <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-faint" />
              </>
            ) : fr.signIn}
          </button>

          {menu.open && (
            <div role="menu" className="absolute right-0 mt-2 w-64 rounded-card border border-line bg-surface p-2 shadow-pop animate-sheet">
              {!isAuthenticated ? (
                <>
                  <button role="menuitem" onClick={() => handleSignIn('google')} className={MENU_ITEM}>{fr.signInWithGoogle}</button>
                  {TestAccountMenuItem && (
                    <Suspense fallback={null}>
                      <TestAccountMenuItem className={MENU_ITEM} onSelect={() => { menu.setOpen(false); setSwitchingAccount(true); }} />
                    </Suspense>
                  )}
                </>
              ) : (
                <>
                  {!isDeleted && isAdmin && (
                    <button role="menuitem" onClick={() => go('/admin')} className={MENU_ITEM}>
                      <ShieldCheck aria-hidden="true" className="size-5 text-faint" strokeWidth={1.75} />
                      {fr.adminNavLink}
                    </button>
                  )}
                  <button role="menuitem" onClick={() => go('/a-propos')} className={MENU_ITEM}>
                    <Sparkles aria-hidden="true" className="size-5 text-faint" strokeWidth={1.75} />
                    {fr.about}
                  </button>
                  {!isDeleted && (
                    <button role="menuitem" onClick={() => { menu.setOpen(false); onOpenFeedback(); }} className={MENU_ITEM}>
                      <MessageSquareWarning aria-hidden="true" className="size-5 text-faint" strokeWidth={1.75} />
                      {fr.reportProblem}
                    </button>
                  )}
                  {TestAccountMenuItem && (
                    <Suspense fallback={null}>
                      <TestAccountMenuItem className={MENU_ITEM} onSelect={() => { menu.setOpen(false); setSwitchingAccount(true); }} />
                    </Suspense>
                  )}
                  <div className="my-1 h-px bg-line" />
                  {!isDeleted && (
                    <button role="menuitem" onClick={() => { menu.setOpen(false); setConfirmingDelete(true); }} className={cx(MENU_ITEM, 'text-muted')}>
                      <UserX aria-hidden="true" className="size-5 text-faint" strokeWidth={1.75} />
                      {fr.deleteAccount}
                    </button>
                  )}
                  <button role="menuitem" onClick={handleSignOut} className={cx(MENU_ITEM, 'text-bad')}>
                    <LogOut aria-hidden="true" className="size-5" strokeWidth={1.75} />
                    {fr.signOut}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {TestAccountPicker && switchingAccount && (
        <Suspense fallback={null}>
          <TestAccountPicker
            open
            onClose={() => setSwitchingAccount(false)}
            currentEmail={isAuthenticated ? user?.email : null}
            isAdmin={isAuthenticated && isAdmin}
          />
        </Suspense>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={fr.deleteAccountConfirmTitle}
        confirmLabel={fr.deleteAccount}
        onConfirm={handleDeleteAccount}
        onCancel={closeDeleteDialog}
        loading={deleting}
      >
        {fr.deleteAccountConfirm}
        {deleteError && <span role="alert" className="mt-3 block font-semibold text-bad">{deleteError}</span>}
      </ConfirmDialog>
    </header>
  );
};

export default Header;
