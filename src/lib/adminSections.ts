// The admin section registry (#208, ADR 0022): what the navigation knows about each section. The
// sidebar, the phone bottom bar, « Plus », the page header and the phone ViewTabs all render from
// it, so adding a section or a view is one entry here (and its component in the admin shell).
// The URLs are the admin routes module's (src/lib/adminRoutes.ts); the ids are the same.
// Each section and view also says the lowest role that may open it (#217, ADR 0023): the
// navigation shows a role only what it allows, and the shell sends it away from the rest.
import {
  Banknote, BedDouble, CalendarRange, Car, ClipboardList, HandHeart, History, Inbox,
  LayoutDashboard, List, MapPin, MessageSquareText, Users, UsersRound, Utensils
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  ADMIN_SECTIONS, LOGISTICS_VIEW_IDS, USERS_VIEW_IDS, adminRoute,
  type AdminRoute, type AdminSection, type LogisticsView, type UsersView
} from './adminRoutes';
import type { PageWidth } from './pageWidth';
import { hasRole } from './editionRoles';
import type { AccessRole } from './editionRoles';

export type { PageWidth };

/** What a section's marker says, computed by the admin shell from the stores. */
export type SectionMarker = 'unsavedLogistics' | 'unsavedEvent' | 'unresolvedFeedback';

export interface AdminViewEntry<Id extends string = string> {
  id: Id;
  /** Key in fr.json. */
  labelKey: string;
  icon: LucideIcon;
  width: PageWidth;
  /** The view shows its section's marker too (the view the unsaved work is on). */
  showsMarker?: boolean;
  /** The lowest role that may open it (ADR 0023). */
  minRole: AccessRole;
}

export interface AdminSectionEntry {
  id: AdminSection;
  /** Keys in fr.json: the full label (sidebar, page title) and the bottom bar's short one. */
  labelKey: string;
  shortKey: string;
  icon: LucideIcon;
  /**
   * In the phone bottom bar (4 slots), rather than under « Plus ». Which sections get a slot is
   * an organisers' decision (ADR 0022), not a side effect of the order.
   */
  inBar: boolean;
  /** Its views, the first being the default; none for a one-page section. */
  views: readonly AdminViewEntry[];
  /** Key in fr.json naming the views' switcher (phone). */
  viewsLabelKey?: string;
  /** The width of a one-page section. A view declares its own. */
  width: PageWidth;
  marker?: SectionMarker;
  /** The lowest role that may open it (ADR 0023); its views may ask for more. */
  minRole: AccessRole;
}

// Comité reads every Logistique view, places included (ADR 0023).
const LOGISTICS_VIEWS: Record<LogisticsView, Omit<AdminViewEntry<LogisticsView>, 'id'>> = {
  places: { labelKey: 'logisticsViewTitle', icon: BedDouble, width: 'dense', showsMarker: true, minRole: 'committee' },
  food: { labelKey: 'logisticsViewFood', icon: Utensils, width: 'dense', minRole: 'committee' },
  volunteering: { labelKey: 'logisticsViewVolunteering', icon: HandHeart, width: 'dense', minRole: 'committee' },
  transport: { labelKey: 'logisticsViewTransport', icon: Car, width: 'dense', minRole: 'committee' },
  comments: { labelKey: 'logisticsViewComments', icon: MessageSquareText, width: 'dense', minRole: 'committee' }
};

// The change history is Organisateur's, like the exports.
const USERS_VIEWS: Record<UsersView, Omit<AdminViewEntry<UsersView>, 'id'>> = {
  list: { labelKey: 'usersViewList', icon: List, width: 'dense', minRole: 'committee' },
  participants: { labelKey: 'usersViewParticipants', icon: Users, width: 'dense', minRole: 'committee' },
  history: { labelKey: 'usersViewHistory', icon: History, width: 'dense', minRole: 'organiser' }
};

const viewsOf = <Id extends string>(ids: readonly Id[], entries: Record<Id, Omit<AdminViewEntry<Id>, 'id'>>) =>
  ids.map(id => ({ id, ...entries[id] }));

const SECTIONS: Record<AdminSection, Omit<AdminSectionEntry, 'id'>> = {
  // Résumé is a dashboard of cards side by side, which a narrow page cramps: dense.
  overview: { labelKey: 'adminTabOverview', shortKey: 'adminTabOverviewShort', icon: LayoutDashboard, inBar: true, views: [], width: 'dense', minRole: 'committee' },
  users: {
    labelKey: 'adminTabUsers', shortKey: 'adminTabUsersShort', icon: ClipboardList, inBar: true,
    views: viewsOf(USERS_VIEW_IDS, USERS_VIEWS), viewsLabelKey: 'usersViewsLabel', width: 'dense', minRole: 'committee'
  },
  logistics: {
    labelKey: 'adminTabLogistics', shortKey: 'adminTabLogisticsShort', icon: BedDouble, inBar: true,
    views: viewsOf(LOGISTICS_VIEW_IDS, LOGISTICS_VIEWS), viewsLabelKey: 'logisticsViewsLabel', width: 'dense',
    marker: 'unsavedLogistics', minRole: 'committee'
  },
  budget: { labelKey: 'adminTabBudget', shortKey: 'adminTabBudgetShort', icon: Banknote, inBar: true, views: [], width: 'narrow', minRole: 'organiser' },
  events: { labelKey: 'adminTabEvents', shortKey: 'adminTabEventsShort', icon: CalendarRange, inBar: false, views: [], width: 'narrow', marker: 'unsavedEvent', minRole: 'admin' },
  venues: { labelKey: 'adminTabVenues', shortKey: 'adminTabVenuesShort', icon: MapPin, inBar: false, views: [], width: 'narrow', minRole: 'admin' },
  // Who has a role on each edition (#217): granting one is an admin's.
  team: { labelKey: 'adminTabTeam', shortKey: 'adminTabTeamShort', icon: UsersRound, inBar: false, views: [], width: 'narrow', minRole: 'admin' },
  // The unresolved count is the marker: it is what an organiser comes to this section for.
  feedback: { labelKey: 'adminTabFeedback', shortKey: 'adminTabFeedbackShort', icon: Inbox, inBar: false, views: [], width: 'dense', marker: 'unresolvedFeedback', minRole: 'admin' }
};

/** Every section, in the routes module's order (the sidebar's and « Plus »'s). */
export const ADMIN_SECTION_ENTRIES: readonly AdminSectionEntry[] = ADMIN_SECTIONS.map(id => ({ id, ...SECTIONS[id] }));

/** The phone bottom bar's sections, then the ones under « Plus ». */
export const BAR_SECTIONS = ADMIN_SECTION_ENTRIES.filter(section => section.inBar);
export const MORE_SECTIONS = ADMIN_SECTION_ENTRIES.filter(section => !section.inBar);

export const sectionEntry = (id: AdminSection): AdminSectionEntry =>
  ADMIN_SECTION_ENTRIES.find(section => section.id === id) as AdminSectionEntry;

export interface AdminPage {
  section: AdminSectionEntry;
  /** The current view, for a section that has views. */
  view: AdminViewEntry | null;
  /**
   * One item's page (an event, a venue) rather than the section's own. Its parent section stays
   * current in the navigation, and it opens with its own header, a back link naming the parent and
   * its title (DrillDownHeader, #210), instead of the section's.
   */
  drillDown: boolean;
  width: PageWidth;
}

const sectionsByRole = new Map<AccessRole, readonly AdminSectionEntry[]>();

/**
 * The sections a role may open, each with only the views it may open, in the registry's order.
 * None without a role. The same array for the same role, so it can be a dependency.
 */
export const sectionsFor = (role: AccessRole | null | undefined): readonly AdminSectionEntry[] => {
  if (!role) return [];
  if (!sectionsByRole.has(role)) {
    sectionsByRole.set(role, ADMIN_SECTION_ENTRIES
      .filter(section => hasRole(role, section.minRole))
      .map(section => ({ ...section, views: section.views.filter(view => hasRole(role, view.minRole)) })));
  }
  return sectionsByRole.get(role)!;
};

/** Whether a role may open a route: its section, and its view if it has one. */
export const mayOpen = (route: AdminRoute, role: AccessRole | null | undefined): boolean => {
  const section = sectionsFor(role).find(entry => entry.id === route.section);
  if (!section) return false;
  return !('view' in route) || section.views.some(view => view.id === route.view);
};

/**
 * Where to send a role that may not open a route (ADR 0023): the first section it may open, at
 * its defaults. Null when it may stay, or when it may open nothing at all.
 */
export const roleRedirect = (route: AdminRoute, role: AccessRole | null | undefined): AdminRoute | null => {
  if (!role || mayOpen(route, role)) return null;
  const first = sectionsFor(role)[0];
  return first ? adminRoute(first.id) : null;
};

/**
 * What the shell shows for a route: its section, its view, and its width. With `sections` (a
 * role's, from sectionsFor), the section entry lists only the views the role may open.
 */
export const adminPage = (route: AdminRoute, sections: readonly AdminSectionEntry[] = ADMIN_SECTION_ENTRIES): AdminPage => {
  const section = sections.find(entry => entry.id === route.section) ?? sectionEntry(route.section);
  const viewId = 'view' in route ? route.view : null;
  const view = section.views.find(entry => entry.id === viewId) ?? null;
  const drillDown = (route.section === 'events' && !!route.eventId) || (route.section === 'venues' && !!route.venueId);
  return { section, view, drillDown, width: drillDown ? 'dense' : view?.width ?? section.width };
};
