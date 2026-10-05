// Admin routes (#196, ADR 0022): the one place that knows what an admin URL looks like. A URL is
// a path, /admin/<section>/<view>, with English ids; a section's default view has no segment.
// Components parse the location with parseAdminLocation() and build links with adminHref(), and
// never format an admin URL themselves.
//
//   /admin/overview · /admin/budget · /admin/feedback · /admin/team
//   /admin/users[/<view>]                            view: list (default), participants, history
//   /admin/participants                              Comité's « Participants » (#291)
//   /admin/logistics[/<view>]                        view: places (default), food, …
//   /admin/events · /admin/events/<eventId>[?section=sleeping] · /admin/events/new (#111)
//   /admin/venues[/<venueId>[/<locationId>]]
//
// The query-param URLs that came before (/admin?tab=…&view=…&venue=…&location=…, and a bare
// /admin) still work: adminRedirect() maps them, and any URL that isn't canonical (an unknown
// section or view, a trailing slash), to the canonical href, which the admin view navigates to
// with `replace` so Back doesn't return to the old one. So do the dissolved « Outils » URLs
// (#209): /admin/tools[/<view>] and ?tab=tools&view=… go to where each view moved.

export const ADMIN_ROOT = '/admin';

// « Équipe » (team, #217) sits before Retours: Retours stays last, as ADR 0022 decided.
// « Participants » (#291) is Comité's top-level stand-in for Inscrits, after it; the registry
// (src/lib/adminSections.ts) shows each role only one of the two.
export const ADMIN_SECTIONS = ['overview', 'users', 'participants', 'logistics', 'budget', 'events', 'venues', 'team', 'feedback'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];
export const DEFAULT_ADMIN_SECTION: AdminSection = 'overview';

// A section's views, the first being its default.
export const LOGISTICS_VIEW_IDS = ['places', 'food', 'volunteering', 'transport', 'comments'] as const;
export type LogisticsView = (typeof LOGISTICS_VIEW_IDS)[number];
export const USERS_VIEW_IDS = ['list', 'participants', 'history'] as const;
export type UsersView = (typeof USERS_VIEW_IDS)[number];

export const EDITOR_SECTIONS = ['details', 'sleeping'] as const;
export type EditorSection = (typeof EDITOR_SECTIONS)[number];

// The id the event editor has in its URL while the event doesn't exist yet (#111). Never an
// event's id (those are uuids). A new event has only its details: there is no Couchage to open
// before it is saved, so its editor section is always the first.
export const NEW_EVENT_ID = 'new';

export type AdminRoute =
  | { section: 'overview' | 'participants' | 'budget' | 'feedback' | 'team' }
  | { section: 'users'; view: UsersView }
  | { section: 'logistics'; view: LogisticsView }
  | { section: 'events'; eventId: string | null; editorSection: EditorSection }
  | { section: 'venues'; venueId: string | null; locationId: string | null };

// Where the views of the dissolved « Outils » section moved (#209). Any other view, or none, was
// its default, the export, which is now an action of Inscrits.
const TOOLS_VIEW_ROUTES: Record<string, AdminRoute> = {
  history: { section: 'users', view: 'history' },
  feedback: { section: 'feedback' }
};
const TOOLS_DEFAULT_ROUTE: AdminRoute = { section: 'users', view: USERS_VIEW_IDS[0] };
const toolsRoute = (view: string | null | undefined): AdminRoute =>
  (view && Object.hasOwn(TOOLS_VIEW_ROUTES, view) ? TOOLS_VIEW_ROUTES[view] : TOOLS_DEFAULT_ROUTE);
const LEGACY_TOOLS = 'tools';

const oneOf = <T extends string>(values: readonly T[], value: string | null | undefined, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

const decode = (segment: string | undefined): string | null => {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/** Whether a pathname is in the admin area (the admin view stays mounted across it). */
export const isAdminPath = (pathname: string): boolean => pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`);

/** The route for a section, at its defaults. */
export const adminRoute = (section: AdminSection): AdminRoute => {
  switch (section) {
    case 'logistics': return { section, view: LOGISTICS_VIEW_IDS[0] };
    case 'users': return { section, view: USERS_VIEW_IDS[0] };
    case 'events': return { section, eventId: null, editorSection: EDITOR_SECTIONS[0] };
    case 'venues': return { section, venueId: null, locationId: null };
    default: return { section };
  }
};

// The route a section's segments describe; missing or unknown values fall back to the defaults.
const routeOf = (section: AdminSection, rest: Array<string | null>, search: URLSearchParams): AdminRoute => {
  switch (section) {
    case 'logistics': return { section, view: oneOf(LOGISTICS_VIEW_IDS, rest[0], LOGISTICS_VIEW_IDS[0]) };
    case 'users': return { section, view: oneOf(USERS_VIEW_IDS, rest[0], USERS_VIEW_IDS[0]) };
    case 'events': return {
      section,
      eventId: rest[0] ?? null,
      editorSection: rest[0] && rest[0] !== NEW_EVENT_ID ? oneOf(EDITOR_SECTIONS, search.get('section'), EDITOR_SECTIONS[0]) : EDITOR_SECTIONS[0]
    };
    case 'venues': return { section, venueId: rest[0] ?? null, locationId: rest[0] ? rest[1] ?? null : null };
    default: return { section };
  }
};

/** The admin route a location shows. Never throws: anything unknown falls back to a default. */
export const parseAdminLocation = (pathname: string, search = ''): AdminRoute => {
  const params = new URLSearchParams(search);
  const segments = pathname.slice(ADMIN_ROOT.length).split('/').filter(Boolean).map(decode);
  if (segments[0] === LEGACY_TOOLS) return toolsRoute(segments[1]);
  const section = oneOf(ADMIN_SECTIONS, segments[0], DEFAULT_ADMIN_SECTION);
  return routeOf(section, section === segments[0] ? segments.slice(1) : [], params);
};

const path = (...segments: Array<string | null>): string =>
  [ADMIN_ROOT, ...segments.filter((segment): segment is string => !!segment).map(encodeURIComponent)].join('/');

/** The canonical href of an admin route. */
export const adminHref = (route: AdminRoute): string => {
  switch (route.section) {
    case 'logistics': return path(route.section, route.view === LOGISTICS_VIEW_IDS[0] ? null : route.view);
    case 'users': return path(route.section, route.view === USERS_VIEW_IDS[0] ? null : route.view);
    case 'events': {
      if (!route.eventId) return path(route.section);
      const href = path(route.section, route.eventId);
      return route.editorSection === EDITOR_SECTIONS[0] || route.eventId === NEW_EVENT_ID ? href : `${href}?section=${route.editorSection}`;
    }
    case 'venues': return path(route.section, route.venueId, route.venueId ? route.locationId : null);
    default: return path(route.section);
  }
};

// The route an old query-param URL (/admin?tab=…) meant.
const legacyRoute = (params: URLSearchParams): AdminRoute => {
  if (params.get('tab') === LEGACY_TOOLS) return toolsRoute(params.get('view'));
  const section = oneOf(ADMIN_SECTIONS, params.get('tab'), DEFAULT_ADMIN_SECTION);
  if (section === 'venues') {
    const venueId = params.get('venue') || null;
    return { section, venueId, locationId: venueId ? params.get('location') || null : null };
  }
  return routeOf(section, [params.get('view')], params);
};

/**
 * Where a location should be sent instead, or null when it is already canonical: an old
 * query-param URL (or a bare /admin) goes to the path it meant, and a path with unknown or
 * superfluous parts to the route it falls back to.
 */
export const adminRedirect = (pathname: string, search = ''): string | null => {
  if (!isAdminPath(pathname)) return null;
  const params = new URLSearchParams(search);
  const legacy = pathname.replace(/\/+$/, '') === ADMIN_ROOT;
  const href = adminHref(legacy ? legacyRoute(params) : parseAdminLocation(pathname, search));
  // The Inscrits list keeps its sort in ?tri= (#259): the one param a canonical path may carry.
  const kept = !legacy && params.has('tri') && parseAdminLocation(pathname, search).section === 'users' ? `?tri=${encodeURIComponent(params.get('tri') ?? '')}` : '';
  const here = `${pathname}${search && search !== '?' ? search : ''}`;
  return href === here || (kept && `${href}${kept}` === here) ? null : href;
};
