import {
  ADMIN_SECTIONS, LOGISTICS_VIEW_IDS, NEW_EVENT_ID, USERS_VIEW_IDS,
  adminHref, adminRedirect, adminRoute, isAdminPath, parseAdminLocation
} from './adminRoutes';

const split = (href) => {
  const [pathname, query] = href.split('?');
  return [pathname, query ? `?${query}` : ''];
};
const roundTrip = (route) => parseAdminLocation(...split(adminHref(route)));

const EVENT = '6f1c0a52-8d7e-4b1a-9f38-2a1d5e7c9b40';
const VENUE = 'a3b9e2d1-4c5f-4e6a-8b7c-9d0e1f2a3b4c';
const LOCATION = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

describe('adminHref and parseAdminLocation', () => {
  const routes = [
    ...ADMIN_SECTIONS.map(adminRoute),
    ...LOGISTICS_VIEW_IDS.map(view => ({ section: 'logistics', view })),
    ...USERS_VIEW_IDS.map(view => ({ section: 'users', view })),
    { section: 'events', eventId: EVENT, editorSection: 'details' },
    { section: 'events', eventId: EVENT, editorSection: 'sleeping' },
    { section: 'events', eventId: 'new', editorSection: 'details' },
    { section: 'venues', venueId: VENUE, locationId: null },
    { section: 'venues', venueId: VENUE, locationId: LOCATION }
  ];

  test.each(routes.map(route => [adminHref(route), route]))('%s round-trips', (_href, route) => {
    expect(roundTrip(route)).toEqual(route);
  });

  test('canonical hrefs: a default view has no segment', () => {
    expect(adminHref(adminRoute('overview'))).toBe('/admin/overview');
    expect(adminHref(adminRoute('logistics'))).toBe('/admin/logistics');
    expect(adminHref({ section: 'logistics', view: 'food' })).toBe('/admin/logistics/food');
    expect(adminHref(adminRoute('users'))).toBe('/admin/users');
    expect(adminHref({ section: 'users', view: 'history' })).toBe('/admin/users/history');
    expect(adminHref(adminRoute('feedback'))).toBe('/admin/feedback');
    expect(adminHref({ section: 'events', eventId: EVENT, editorSection: 'details' })).toBe(`/admin/events/${EVENT}`);
    expect(adminHref({ section: 'events', eventId: EVENT, editorSection: 'sleeping' })).toBe(`/admin/events/${EVENT}?section=sleeping`);
    expect(adminHref({ section: 'venues', venueId: VENUE, locationId: LOCATION })).toBe(`/admin/venues/${VENUE}/${LOCATION}`);
  });

  test('the new event\'s editor is /admin/events/new, on its details only (#111)', () => {
    expect(adminHref({ section: 'events', eventId: 'new', editorSection: 'details' })).toBe('/admin/events/new');
    expect(adminHref({ section: 'events', eventId: 'new', editorSection: 'sleeping' })).toBe('/admin/events/new');
    expect(parseAdminLocation('/admin/events/new')).toEqual({ section: 'events', eventId: NEW_EVENT_ID, editorSection: 'details' });
    expect(parseAdminLocation('/admin/events/new', '?section=sleeping').editorSection).toBe('details');
  });

  test('a location without a venue is dropped', () => {
    expect(adminHref({ section: 'venues', venueId: null, locationId: LOCATION })).toBe('/admin/venues');
  });

  test('unknown or missing values fall back to defaults, never throw', () => {
    expect(parseAdminLocation('/admin')).toEqual(adminRoute('overview'));
    expect(parseAdminLocation('/admin/bogus/food')).toEqual(adminRoute('overview'));
    expect(parseAdminLocation('/admin/logistics/nope')).toEqual(adminRoute('logistics'));
    expect(parseAdminLocation('/admin/users/nope')).toEqual(adminRoute('users'));
    expect(parseAdminLocation(`/admin/events/${EVENT}`, '?section=bogus'))
      .toEqual({ section: 'events', eventId: EVENT, editorSection: 'details' });
    expect(parseAdminLocation('/admin/events', '?section=sleeping')).toEqual(adminRoute('events'));
    expect(parseAdminLocation('/admin/venues/%E0%A4%A')).toEqual(adminRoute('venues'));
  });
});

describe('adminRedirect', () => {
  it('leaves the Inscrits sort param alone', () => {
    expect(adminRedirect('/admin/users', '?tri=-modification')).toBeNull();
    expect(adminRedirect('/admin/venues', '?tri=nom')).toBe('/admin/venues');
  });

  test.each([
    ['/admin/tools', '/admin/users'],
    ['/admin/tools/exports', '/admin/users'],
    ['/admin/tools/history', '/admin/users/history'],
    ['/admin/tools/feedback', '/admin/feedback'],
    ['/admin/tools/nope', '/admin/users'],
    ['/admin/tools/', '/admin/users']
  ])('the Outils path %s → %s', (pathname, href) => {
    expect(adminRedirect(pathname)).toBe(href);
  });

  test('the new homes are canonical', () => {
    expect(adminRedirect('/admin/users')).toBeNull();
    expect(adminRedirect('/admin/users/history')).toBeNull();
    expect(adminRedirect('/admin/feedback')).toBeNull();
  });

  test.each([
    ['', '/admin/overview'],
    ['?tab=overview', '/admin/overview'],
    ['?tab=users', '/admin/users'],
    ['?tab=budget', '/admin/budget'],
    ['?tab=events', '/admin/events'],
    ['?tab=bogus', '/admin/overview'],
    ['?tab=logistics', '/admin/logistics'],
    ['?tab=logistics&view=food', '/admin/logistics/food'],
    ['?tab=logistics&view=nope', '/admin/logistics'],
    ['?tab=users&view=history', '/admin/users/history'],
    ['?tab=feedback', '/admin/feedback'],
    // The dissolved Outils section (#209).
    ['?tab=tools', '/admin/users'],
    ['?tab=tools&view=exports', '/admin/users'],
    ['?tab=tools&view=history', '/admin/users/history'],
    ['?tab=tools&view=feedback', '/admin/feedback'],
    ['?tab=tools&view=nope', '/admin/users'],
    ['?tab=venues', '/admin/venues'],
    [`?tab=venues&venue=${VENUE}`, `/admin/venues/${VENUE}`],
    [`?tab=venues&venue=${VENUE}&location=${LOCATION}`, `/admin/venues/${VENUE}/${LOCATION}`],
    [`?tab=venues&location=${LOCATION}`, '/admin/venues']
  ])('/admin%s → %s', (search, href) => {
    expect(adminRedirect('/admin', search)).toBe(href);
  });

  test('a trailing slash on the old root is still the old root', () => {
    expect(adminRedirect('/admin/', '?tab=users')).toBe('/admin/users');
  });

  test('a path that isn\'t canonical goes to the route it falls back to', () => {
    expect(adminRedirect('/admin/bogus')).toBe('/admin/overview');
    expect(adminRedirect('/admin/logistics/places')).toBe('/admin/logistics');
    expect(adminRedirect('/admin/logistics/nope')).toBe('/admin/logistics');
    expect(adminRedirect('/admin/users/')).toBe('/admin/users');
    expect(adminRedirect(`/admin/events/${EVENT}`, '?section=details')).toBe(`/admin/events/${EVENT}`);
    expect(adminRedirect('/admin/users', '?tab=logistics')).toBe('/admin/users');
    expect(adminRedirect('/admin/events/new', '?section=sleeping')).toBe('/admin/events/new');
  });

  test('a canonical location stays where it is', () => {
    expect(adminRedirect('/admin/overview')).toBeNull();
    expect(adminRedirect('/admin/logistics/food')).toBeNull();
    expect(adminRedirect(`/admin/events/${EVENT}`, '?section=sleeping')).toBeNull();
    expect(adminRedirect(`/admin/venues/${VENUE}/${LOCATION}`)).toBeNull();
    expect(adminRedirect('/admin/users', '?')).toBeNull();
    expect(adminRedirect('/admin/events/new')).toBeNull();
  });

  test('outside the admin area there is nothing to redirect', () => {
    expect(adminRedirect('/', '?tab=users')).toBeNull();
    expect(adminRedirect('/administration')).toBeNull();
  });
});

test('isAdminPath', () => {
  expect(isAdminPath('/admin')).toBe(true);
  expect(isAdminPath('/admin/logistics/food')).toBe(true);
  expect(isAdminPath('/administration')).toBe(false);
  expect(isAdminPath('/')).toBe(false);
});
