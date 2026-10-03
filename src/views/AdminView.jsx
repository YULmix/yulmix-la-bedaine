import { useEffect, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { adminHref, adminRedirect, isAdminPath, parseAdminLocation } from '../lib/adminRoutes';
import { ADMIN_SECTION_ENTRIES, adminPage } from '../lib/adminSections';
import fr from '../locales/fr.json';
import OverviewSection from '../components/admin/sections/OverviewSection';
import UsersSection from '../components/admin/sections/UsersSection';
import LogisticsSection from '../components/admin/sections/LogisticsSection';
import BudgetSection from '../components/admin/sections/BudgetSection';
import EventsSection from '../components/admin/sections/EventsSection';
import VenuesSection from '../components/admin/sections/VenuesSection';
import FeedbackSection from '../components/admin/sections/FeedbackSection';
import { AdminBottomBar, AdminHeaderActionsProvider, AdminPageHeader, AdminSidebar } from '../components/admin/AdminNav';
import { ConfirmDialog, Notice, ViewPanel, ViewTabs, cx } from '../components/ui';
import { refreshEvents, useEvents } from '../lib/events';
import { useAdminParties } from '../lib/adminParties';
import { useEventPlaces } from '../lib/eventPlaces';
import { useBudget } from '../lib/budget';
import { useUnsavedLogistics } from '../lib/logistics';
import { useUnsavedEventIds } from '../lib/eventDrafts';
import { useFeedback } from '../lib/feedback';

// The admin shell (#195, #208): routes to the current section, the navigation, and the guards for
// unsaved work. Each section loads, shows and changes its own data through the stores in src/lib;
// nothing here reads or writes the database. What the navigation shows comes from the section
// registry (src/lib/adminSections.ts); the component for each section is here.

// Each section's component; it takes the route's params (src/lib/adminRoutes.ts).
const SECTION_COMPONENTS = {
  overview: OverviewSection,
  users: UsersSection,
  logistics: LogisticsSection,
  budget: BudgetSection,
  events: EventsSection,
  venues: VenuesSection,
  feedback: FeedbackSection
};

const AdminView = ({ isAdmin }) => {
  const location = useLocation();
  const navigate = useNavigate();
  // Where we are, from the URL. The event editor, /admin/events/:id, is under the same admin
  // shell: the Événements tab stays selected.
  const route = parseAdminLocation(location.pathname, location.search);
  const page = adminPage(route);
  // Old query-param links (/admin?tab=…) and paths that aren't canonical go to the canonical one,
  // replacing it in the history so Back doesn't bounce.
  useEffect(() => {
    const target = adminRedirect(location.pathname, location.search);
    if (target) navigate(target, { replace: true });
  }, [location.pathname, location.search, navigate]);
  // The page header's actions slot (AdminHeaderActions), once it is mounted.
  const [actionsSlot, setActionsSlot] = useState(null);

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
  const { unresolvedCount: unresolvedFeedback } = useFeedback();
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

  // Whether each section shows its marker (the registry says which), in the sidebar, the bar and
  // « Plus ».
  // A marker is a dot, or a count (a number: nothing for 0).
  const markerValues = { unsavedLogistics: unsavedLogistics > 0, unsavedEvent: hasUnsavedEvent, unresolvedFeedback: unresolvedFeedback > 0 && unresolvedFeedback };
  const markers = Object.fromEntries(ADMIN_SECTION_ENTRIES.map(entry => [entry.id, !!entry.marker && markerValues[entry.marker]]));
  const Section = SECTION_COMPONENTS[route.section];
  const theme = activeEvent?.theme;
  const { section, view } = page;
  const content = <Section {...route} />;

  return (
    // One centred container for the sidebar and the page, as wide as the header's on admin pages
    // (max-w-screen-2xl, src/components/Header.jsx).
    <div className="mx-auto flex w-full max-w-screen-2xl flex-1">
      <AdminSidebar page={page} markers={markers} theme={theme} />

      <main className="min-w-0 flex-1 px-4 pb-28 pt-4 md:pb-16 md:pl-8 md:pr-6 md:pt-5">
        <div className={cx(page.width === 'narrow' && 'max-w-3xl')}>
          {/* A drill-down (the event editor, a venue) brings its own header and back link (#210). */}
          {!page.drillDown && <AdminPageHeader page={page} slotRef={setActionsSlot} theme={theme} />}
          <AdminHeaderActionsProvider slot={page.drillDown ? null : actionsSlot}>
            {view ? (
              <>
                {/* Phones switch views here; the sidebar lists them from md up. */}
                <div className="mb-5 md:hidden">
                  <ViewTabs
                    views={section.views.map(entry => ({
                      id: entry.id,
                      label: fr[entry.labelKey],
                      icon: entry.icon,
                      badge: entry.showsMarker && markers[section.id] && <span className="size-2 rounded-full bg-warn" aria-label={fr.unsavedTag} />
                    }))}
                    value={view.id}
                    // A history entry per view, so Back walks back through them.
                    onChange={next => navigate(adminHref({ ...route, view: next }))}
                    label={fr[section.viewsLabelKey]}
                    idPrefix="admin-view"
                  />
                </div>
                <ViewPanel idPrefix="admin-view" value={view.id}>{content}</ViewPanel>
              </>
            ) : (
              <section aria-labelledby={page.drillDown ? undefined : 'admin-page-title'} key={section.id} className="animate-step">
                {content}
              </section>
            )}
          </AdminHeaderActionsProvider>
        </div>
      </main>

      <AdminBottomBar page={page} markers={markers} />

      <ConfirmDialog
        open={leaveBlocker.state === 'blocked'}
        title={fr.logisticsLeaveTitle}
        confirmLabel={fr.logisticsLeaveConfirm}
        onConfirm={() => leaveBlocker.proceed()}
        onCancel={() => leaveBlocker.reset()}
      >
        {fr.logisticsLeaveBody.replace('{n}', unsavedLogistics)}
      </ConfirmDialog>
    </div>
  );
};

export default AdminView;
