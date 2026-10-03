import fr from '../locales/fr.json';
import { ADMIN_SECTIONS, LOGISTICS_VIEW_IDS, TOOLS_VIEW_IDS, adminRoute } from './adminRoutes';
import { ADMIN_SECTION_ENTRIES, BAR_SECTIONS, MORE_SECTIONS, adminPage } from './adminSections';

const EVENT = '6f1c0a52-8d7e-4b1a-9f38-2a1d5e7c9b40';
const VENUE = 'a3b9e2d1-4c5f-4e6a-8b7c-9d0e1f2a3b4c';

describe('the admin section registry', () => {
  test('has every section of the routes module, in its order', () => {
    expect(ADMIN_SECTION_ENTRIES.map(section => section.id)).toEqual([...ADMIN_SECTIONS]);
  });

  test('its views are the routes module\'s, default first', () => {
    const views = id => ADMIN_SECTION_ENTRIES.find(section => section.id === id).views.map(view => view.id);
    expect(views('logistics')).toEqual([...LOGISTICS_VIEW_IDS]);
    expect(views('tools')).toEqual([...TOOLS_VIEW_IDS]);
  });

  test('every label is in fr.json', () => {
    for (const section of ADMIN_SECTION_ENTRIES) {
      const keys = [section.labelKey, section.shortKey, section.viewsLabelKey, ...section.views.map(view => view.labelKey)].filter(Boolean);
      for (const key of keys) expect(fr[key]).toEqual(expect.any(String));
      if (section.views.length) expect(section.viewsLabelKey).toBeDefined();
    }
  });

  // ADR 0022: the bar's four are an organisers' decision.
  test('the phone bar has Résumé, Inscrits, Logistique and Budget; the rest is under « Plus »', () => {
    expect(BAR_SECTIONS.map(section => section.id)).toEqual(['overview', 'users', 'logistics', 'budget']);
    expect(MORE_SECTIONS.map(section => section.id)).toEqual(ADMIN_SECTIONS.filter(id => !['overview', 'users', 'logistics', 'budget'].includes(id)));
  });
});

describe('adminPage', () => {
  test('a one-page section has no view and its own width', () => {
    expect(adminPage(adminRoute('users'))).toMatchObject({ section: { id: 'users' }, view: null, drillDown: false, width: 'dense' });
    expect(adminPage(adminRoute('budget'))).toMatchObject({ view: null, width: 'narrow' });
  });

  test('a view has its own width', () => {
    expect(adminPage({ section: 'tools', view: 'exports' })).toMatchObject({ view: { id: 'exports' }, width: 'narrow' });
    expect(adminPage({ section: 'tools', view: 'history' })).toMatchObject({ view: { id: 'history' }, width: 'dense' });
    expect(adminPage({ section: 'logistics', view: 'food' })).toMatchObject({ section: { id: 'logistics' }, view: { id: 'food' }, width: 'dense' });
  });

  test('the event editor and a venue are drill-downs of their section', () => {
    expect(adminPage(adminRoute('events'))).toMatchObject({ drillDown: false, width: 'narrow' });
    expect(adminPage({ section: 'events', eventId: EVENT, editorSection: 'details' })).toMatchObject({ section: { id: 'events' }, drillDown: true });
    expect(adminPage(adminRoute('venues'))).toMatchObject({ drillDown: false });
    expect(adminPage({ section: 'venues', venueId: VENUE, locationId: null })).toMatchObject({ section: { id: 'venues' }, drillDown: true });
  });
});
