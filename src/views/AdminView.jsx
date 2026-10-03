import { useEffect } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { Banknote, CalendarRange, ClipboardList, BedDouble, LayoutDashboard, MapPin, Wrench } from 'lucide-react';
import { adminHref, adminRedirect, adminRoute, ADMIN_SECTIONS, isAdminPath, parseAdminLocation } from '../lib/adminRoutes';
import fr from '../locales/fr.json';
import OverviewSection from '../components/admin/sections/OverviewSection';
import UsersSection from '../components/admin/sections/UsersSection';
import LogisticsSection from '../components/admin/sections/LogisticsSection';
import BudgetSection from '../components/admin/sections/BudgetSection';
import EventsSection from '../components/admin/sections/EventsSection';
import VenuesSection from '../components/admin/sections/VenuesSection';
import ToolsSection from '../components/admin/sections/ToolsSection';
import { ConfirmDialog, Notice, cx } from '../components/ui';
import { refreshEvents, useEvents } from '../lib/events';
import { useAdminParties } from '../lib/adminParties';
import { useEventPlaces } from '../lib/eventPlaces';
import { useBudget } from '../lib/budget';
import { useUnsavedLogistics } from '../lib/logistics';
import { useUnsavedEventIds } from '../lib/eventDrafts';

// The admin shell (#195): routes to the current section, the navigation, and the guards for
// unsaved work. Each section loads, shows and changes its own data through the stores in src/lib;
// nothing here reads or writes the database.

// Admin sub-navigation tabs, in the order and with the ids of the admin routes module (ADR 0022);
// the id is the URL's first segment, /admin/<id>.
const TAB_DISPLAY = {
  overview: { labelKey: 'adminTabOverview', shortKey: 'adminTabOverviewShort', icon: LayoutDashboard },
  users: { labelKey: 'adminTabUsers', shortKey: 'adminTabUsersShort', icon: ClipboardList },
  logistics: { labelKey: 'adminTabLogistics', shortKey: 'adminTabLogisticsShort', icon: BedDouble },
  budget: { labelKey: 'adminTabBudget', shortKey: 'adminTabBudgetShort', icon: Banknote },
  events: { labelKey: 'adminTabEvents', shortKey: 'adminTabEventsShort', icon: CalendarRange },
  venues: { labelKey: 'adminTabVenues', shortKey: 'adminTabVenuesShort', icon: MapPin },
  tools: { labelKey: 'adminTabTools', shortKey: 'adminTabToolsShort', icon: Wrench }
};
const ADMIN_TABS = ADMIN_SECTIONS.map(id => ({ id, ...TAB_DISPLAY[id] }));

// The section for a route (src/lib/adminRoutes.ts); each takes only its route params.
const renderSection = (route) => {
  switch (route.section) {
    case 'users': return <UsersSection />;
    case 'logistics': return <LogisticsSection view={route.view} />;
    case 'budget': return <BudgetSection />;
    case 'events': return <EventsSection eventId={route.eventId} editorSection={route.editorSection} />;
    case 'venues': return <VenuesSection venueId={route.venueId} locationId={route.locationId} />;
    case 'tools': return <ToolsSection view={route.view} />;
    default: return <OverviewSection />;
  }
};

const AdminView = ({ isAdmin }) => {
  const location = useLocation();
  const navigate = useNavigate();
  // Where we are, from the URL. The event editor, /admin/events/:id, is under the same admin
  // shell: the Événements tab stays selected.
  const route = parseAdminLocation(location.pathname, location.search);
  const activeTab = route.section;
  // Old query-param links (/admin?tab=…) and paths that aren't canonical go to the canonical one,
  // replacing it in the history so Back doesn't bounce.
  useEffect(() => {
    const target = adminRedirect(location.pathname, location.search);
    if (target) navigate(target, { replace: true });
  }, [location.pathname, location.search, navigate]);
  // Moving to another route pushes a history entry, so Back walks back through tabs, views and
  // editor sections.
  const selectTab = (tabId) => navigate(adminHref(adminRoute(tabId)));

  // The events come from the store the member pages read too (src/lib/events.ts): a change made
  // here shows there without a reload (#192). Fresh for the admin on arrival.
  const { events, activeEvent } = useEvents();
  useEffect(() => {
    if (isAdmin) refreshEvents();
  }, [isAdmin]);
  // The shell keeps the active event's shared caches subscribed, so moving between sections (and
  // in and out of the event editor) never reloads them: a cache reloads when a screen subscribes
  // while nobody was.
  useAdminParties(activeEvent?.id);
  useEventPlaces(activeEvent?.id);
  useBudget(activeEvent?.id);

  // Closing or reloading the browser tab with unsaved edits asks first. (The event editor's would
  // be restored from sessionStorage on a reload, but not in a new tab; Logistique's live only in
  // its store, src/lib/logistics.ts.)
  const hasUnsavedEvent = useUnsavedEventIds(events).length > 0;
  const unsavedLogistics = useUnsavedLogistics();
  useEffect(() => {
    if (!hasUnsavedEvent && !unsavedLogistics) return;
    const warn = (event) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedEvent, unsavedLogistics]);

  // Leaving the admin pages in the app asks too (#150): the Logistique draft stays in its store, but
  // nothing outside the admin shows or saves it, and a reload loses it. Moving between admin tabs
  // doesn't ask.
  const leaveBlocker = useBlocker(({ nextLocation }) => unsavedLogistics > 0 && !isAdminPath(nextLocation.pathname));

  if (!isAdmin) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6">
        <Notice tone="warn">{fr.adminAccessRestricted}</Notice>
      </main>
    );
  }

  const activeTabIndex = ADMIN_TABS.findIndex(tab => tab.id === activeTab);
  // Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation).
  const handleTabKeyDown = (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    let next = activeTabIndex + (keys[event.key] || 0);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = ADMIN_TABS.length - 1;
    next = (next + ADMIN_TABS.length) % ADMIN_TABS.length;
    selectTab(ADMIN_TABS[next].id);
    requestAnimationFrame(() => document.getElementById(`admin-tab-${ADMIN_TABS[next].id}`)?.focus());
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:px-6 md:pb-16">

      <div className="mb-6 flex flex-col gap-1">
        <p className="font-data text-xs uppercase tracking-widest text-neon">{activeEvent ? activeEvent.theme : fr.adminPageSubtitle}</p>
        <h1 className="font-display text-display-md text-ink">{fr.adminPageTitle}</h1>
      </div>

      {/* One tablist: inline pills from md up, a fixed bottom bar (thumb zone) on phones. */}
      <div
        role="tablist"
        aria-label={fr.adminTabsAriaLabel}
        onKeyDown={handleTabKeyDown}
        data-bottom-bar
        className={cx(
          'fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-line bg-night/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md',
          'md:static md:mb-8 md:flex md:gap-1 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none'
        )}
      >
        {ADMIN_TABS.map(tab => {
          const isActive = tab.id === activeTab;
          const Icon = tab.icon;
          const showDot = (tab.id === 'logistics' && unsavedLogistics > 0) || (tab.id === 'events' && hasUnsavedEvent);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`admin-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`admin-tabpanel-${tab.id}`}
              aria-label={fr[tab.labelKey]}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              className={cx(
                'relative flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-semibold transition duration-150',
                'md:min-h-11 md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-sm',
                isActive ? 'text-neon md:tint-neon md:text-ink' : 'text-faint hover:text-ink md:hover:bg-raised'
              )}
            >
              <Icon aria-hidden="true" className={cx('size-5 md:size-4.5', isActive && 'md:text-neon')} strokeWidth={1.75} />
              <span className="md:hidden">{fr[tab.shortKey]}</span>
              <span className="hidden md:inline">{fr[tab.labelKey]}</span>
              {showDot && <span className="absolute right-[calc(50%-1.25rem)] top-2 size-2 rounded-full bg-warn md:static" aria-label={fr.unsavedTag} />}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`admin-tabpanel-${activeTab}`} aria-labelledby={`admin-tab-${activeTab}`} key={activeTab} className="animate-step">
        {renderSection(route)}
      </div>

      <ConfirmDialog
        open={leaveBlocker.state === 'blocked'}
        title={fr.logisticsLeaveTitle}
        confirmLabel={fr.logisticsLeaveConfirm}
        onConfirm={() => leaveBlocker.proceed()}
        onCancel={() => leaveBlocker.reset()}
      >
        {fr.logisticsLeaveBody.replace('{n}', unsavedLogistics)}
      </ConfirmDialog>
    </main>
  );
};

export default AdminView;
