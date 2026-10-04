import fr from '../locales/fr.json';
import { ADMIN_SECTIONS, LOGISTICS_VIEW_IDS, USERS_VIEW_IDS, adminRoute } from './adminRoutes';
import { ADMIN_SECTION_ENTRIES, BAR_SECTIONS, MORE_SECTIONS, adminPage, mayOpen, roleRedirect, sectionsFor } from './adminSections';

const EVENT = '6f1c0a52-8d7e-4b1a-9f38-2a1d5e7c9b40';
const VENUE = 'a3b9e2d1-4c5f-4e6a-8b7c-9d0e1f2a3b4c';

describe('the admin section registry', () => {
  test('has every section of the routes module, in its order', () => {
    expect(ADMIN_SECTION_ENTRIES.map(section => section.id)).toEqual([...ADMIN_SECTIONS]);
  });

  test('its views are the routes module\'s, default first', () => {
    const views = id => ADMIN_SECTION_ENTRIES.find(section => section.id === id).views.map(view => view.id);
    expect(views('logistics')).toEqual([...LOGISTICS_VIEW_IDS]);
    expect(views('users')).toEqual([...USERS_VIEW_IDS]);
  });

  test('every label is in fr.json', () => {
    for (const section of ADMIN_SECTION_ENTRIES) {
      const keys = [section.labelKey, section.shortKey, section.viewsLabelKey, ...section.views.map(view => view.labelKey)].filter(Boolean);
      for (const key of keys) expect(fr[key]).toEqual(expect.any(String));
      if (section.views.length) expect(section.viewsLabelKey).toBeDefined();
    }
  });

  // ADR 0022: the bar's four are an organisers' decision.
  test('Retours is the last section, under « Plus », its marker the unresolved count', () => {
    const last = ADMIN_SECTION_ENTRIES.at(-1);
    expect(last).toMatchObject({ id: 'feedback', inBar: false, marker: 'unresolvedFeedback' });
  });

  test('the phone bar has Résumé, Inscrits, Logistique and Budget; the rest is under « Plus »', () => {
    expect(BAR_SECTIONS.map(section => section.id)).toEqual(['overview', 'users', 'logistics', 'budget']);
    expect(MORE_SECTIONS.map(section => section.id)).toEqual(ADMIN_SECTIONS.filter(id => !['overview', 'users', 'logistics', 'budget'].includes(id)));
  });
});

describe('adminPage', () => {
  test('a one-page section has no view and its own width', () => {
    expect(adminPage(adminRoute('feedback'))).toMatchObject({ section: { id: 'feedback' }, view: null, drillDown: false, width: 'dense' });
    expect(adminPage(adminRoute('budget'))).toMatchObject({ view: null, width: 'narrow' });
  });

  test('a view has its own width', () => {
    expect(adminPage({ section: 'users', view: 'list' })).toMatchObject({ view: { id: 'list' }, width: 'dense' });
    expect(adminPage({ section: 'users', view: 'history' })).toMatchObject({ view: { id: 'history' }, width: 'dense' });
    expect(adminPage({ section: 'logistics', view: 'food' })).toMatchObject({ section: { id: 'logistics' }, view: { id: 'food' }, width: 'dense' });
  });

  test('the event editor and a venue are drill-downs of their section', () => {
    expect(adminPage(adminRoute('events'))).toMatchObject({ drillDown: false, width: 'narrow' });
    expect(adminPage({ section: 'events', eventId: EVENT, editorSection: 'details' })).toMatchObject({ section: { id: 'events' }, drillDown: true });
    expect(adminPage(adminRoute('venues'))).toMatchObject({ drillDown: false });
    expect(adminPage({ section: 'venues', venueId: VENUE, locationId: null })).toMatchObject({ section: { id: 'venues' }, drillDown: true });
  });
});

describe('what each role may open (#217, ADR 0023)', () => {
  const ids = role => sectionsFor(role).map(section => ({ id: section.id, views: section.views.map(view => view.id) }));

  test('Comité: Résumé, the list and participants of Inscrits and every Logistique view', () => {
    expect(ids('committee')).toEqual([
      { id: 'overview', views: [] },
      { id: 'users', views: ['list', 'participants'] },
      { id: 'logistics', views: [...LOGISTICS_VIEW_IDS] }
    ]);
  });

  test('Organisateur: plus Budget and Inscrits\' Historique', () => {
    expect(ids('organiser')).toEqual([
      { id: 'overview', views: [] },
      { id: 'users', views: [...USERS_VIEW_IDS] },
      { id: 'logistics', views: [...LOGISTICS_VIEW_IDS] },
      { id: 'budget', views: [] }
    ]);
  });

  test('admin: everything, Équipe included; no role: nothing', () => {
    expect(sectionsFor('admin').map(section => section.id)).toEqual([...ADMIN_SECTIONS]);
    expect(sectionsFor('admin').find(section => section.id === 'users').views).toHaveLength(USERS_VIEW_IDS.length);
    expect(sectionsFor(null)).toEqual([]);
  });

  test('the same role gets the same array (a stable dependency)', () => {
    expect(sectionsFor('committee')).toBe(sectionsFor('committee'));
  });

  test('Équipe is under « Plus », before Retours', () => {
    expect(MORE_SECTIONS.map(section => section.id).slice(-2)).toEqual(['team', 'feedback']);
  });

  test('mayOpen checks the section and the view', () => {
    expect(mayOpen({ section: 'users', view: 'list' }, 'committee')).toBe(true);
    expect(mayOpen({ section: 'users', view: 'history' }, 'committee')).toBe(false);
    expect(mayOpen({ section: 'users', view: 'history' }, 'organiser')).toBe(true);
    expect(mayOpen(adminRoute('budget'), 'committee')).toBe(false);
    expect(mayOpen(adminRoute('events'), 'organiser')).toBe(false);
    expect(mayOpen(adminRoute('team'), 'admin')).toBe(true);
    expect(mayOpen(adminRoute('overview'), null)).toBe(false);
  });

  test('roleRedirect sends a forbidden page to the first section the role may open', () => {
    expect(roleRedirect(adminRoute('budget'), 'committee')).toEqual(adminRoute('overview'));
    expect(roleRedirect({ section: 'users', view: 'history' }, 'committee')).toEqual(adminRoute('overview'));
    expect(roleRedirect({ section: 'venues', venueId: VENUE, locationId: null }, 'organiser')).toEqual(adminRoute('overview'));
    expect(roleRedirect(adminRoute('budget'), 'organiser')).toBeNull();
    expect(roleRedirect(adminRoute('feedback'), 'admin')).toBeNull();
    // Nowhere to send someone without a role: the shell shows « accès restreint ».
    expect(roleRedirect(adminRoute('overview'), null)).toBeNull();
  });

  test('adminPage with a role\'s sections lists only its views', () => {
    expect(adminPage({ section: 'users', view: 'list' }, sectionsFor('committee')).section.views.map(view => view.id)).toEqual(['list', 'participants']);
  });
});
