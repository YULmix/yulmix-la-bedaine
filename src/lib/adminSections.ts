// The admin section registry (#208, ADR 0022): what the navigation knows about each section. The
// sidebar, the phone bottom bar, « Plus », the page header and the phone ViewTabs all render from
// it, so adding a section or a view is one entry here (and its component in the admin shell).
// The URLs are the admin routes module's (src/lib/adminRoutes.ts); the ids are the same.
import {
  Banknote, BedDouble, CalendarRange, Car, ClipboardList, Download, HandHeart, History, Inbox,
  LayoutDashboard, MapPin, MessageSquareText, Utensils, Wrench
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  ADMIN_SECTIONS, LOGISTICS_VIEW_IDS, TOOLS_VIEW_IDS,
  type AdminRoute, type AdminSection, type LogisticsView, type ToolsView
} from './adminRoutes';

/**
 * How wide a page is: `dense` (lists, logs, tables) is full width, its list scrolling in a box
 * fitted to the viewport; `narrow` (forms, summaries) has a max width of about 3xl.
 */
export type PageWidth = 'dense' | 'narrow';

/** What a section's marker says, computed by the admin shell from the stores. */
export type SectionMarker = 'unsavedLogistics' | 'unsavedEvent';

export interface AdminViewEntry<Id extends string = string> {
  id: Id;
  /** Key in fr.json. */
  labelKey: string;
  icon: LucideIcon;
  width: PageWidth;
  /** The view shows its section's marker too (the view the unsaved work is on). */
  showsMarker?: boolean;
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
}

const LOGISTICS_VIEWS: Record<LogisticsView, Omit<AdminViewEntry<LogisticsView>, 'id'>> = {
  places: { labelKey: 'logisticsViewTitle', icon: BedDouble, width: 'dense', showsMarker: true },
  food: { labelKey: 'logisticsViewFood', icon: Utensils, width: 'dense' },
  volunteering: { labelKey: 'logisticsViewVolunteering', icon: HandHeart, width: 'dense' },
  transport: { labelKey: 'logisticsViewTransport', icon: Car, width: 'dense' },
  comments: { labelKey: 'logisticsViewComments', icon: MessageSquareText, width: 'dense' }
};

const TOOLS_VIEWS: Record<ToolsView, Omit<AdminViewEntry<ToolsView>, 'id'>> = {
  exports: { labelKey: 'toolsViewExports', icon: Download, width: 'narrow' },
  history: { labelKey: 'toolsViewHistory', icon: History, width: 'dense' },
  feedback: { labelKey: 'toolsViewFeedback', icon: Inbox, width: 'dense' }
};

const viewsOf = <Id extends string>(ids: readonly Id[], entries: Record<Id, Omit<AdminViewEntry<Id>, 'id'>>) =>
  ids.map(id => ({ id, ...entries[id] }));

const SECTIONS: Record<AdminSection, Omit<AdminSectionEntry, 'id'>> = {
  overview: { labelKey: 'adminTabOverview', shortKey: 'adminTabOverviewShort', icon: LayoutDashboard, inBar: true, views: [], width: 'narrow' },
  users: { labelKey: 'adminTabUsers', shortKey: 'adminTabUsersShort', icon: ClipboardList, inBar: true, views: [], width: 'dense' },
  logistics: {
    labelKey: 'adminTabLogistics', shortKey: 'adminTabLogisticsShort', icon: BedDouble, inBar: true,
    views: viewsOf(LOGISTICS_VIEW_IDS, LOGISTICS_VIEWS), viewsLabelKey: 'logisticsViewsLabel', width: 'dense',
    marker: 'unsavedLogistics'
  },
  budget: { labelKey: 'adminTabBudget', shortKey: 'adminTabBudgetShort', icon: Banknote, inBar: true, views: [], width: 'narrow' },
  events: { labelKey: 'adminTabEvents', shortKey: 'adminTabEventsShort', icon: CalendarRange, inBar: false, views: [], width: 'narrow', marker: 'unsavedEvent' },
  venues: { labelKey: 'adminTabVenues', shortKey: 'adminTabVenuesShort', icon: MapPin, inBar: false, views: [], width: 'narrow' },
  tools: {
    labelKey: 'adminTabTools', shortKey: 'adminTabToolsShort', icon: Wrench, inBar: false,
    views: viewsOf(TOOLS_VIEW_IDS, TOOLS_VIEWS), viewsLabelKey: 'toolsViewsLabel', width: 'narrow'
  }
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
   * One item's page (an event, a venue) rather than the section's own. It brings its own header
   * and back link, and manages its own width until #210 gives drill-downs one pattern.
   */
  drillDown: boolean;
  width: PageWidth;
}

/** What the shell shows for a route: its section, its view, and its width. */
export const adminPage = (route: AdminRoute): AdminPage => {
  const section = sectionEntry(route.section);
  const viewId = 'view' in route ? route.view : null;
  const view = section.views.find(entry => entry.id === viewId) ?? null;
  const drillDown = (route.section === 'events' && !!route.eventId) || (route.section === 'venues' && !!route.venueId);
  return { section, view, drillDown, width: drillDown ? 'dense' : view?.width ?? section.width };
};
