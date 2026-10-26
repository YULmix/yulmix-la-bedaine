import { render, screen, within } from '@testing-library/react';
import BilanAnswers from './BilanAnswers';
import fr from '../../locales/fr.json';

// The items after the close (#317, restyled by #346), from event_feedback_answers()'s result (#354, ADR 0029).
const closed = {
  closed: true,
  closes_on: '2026-10-20',
  closes_at: '2026-10-21T04:00:00+00:00',
  closed_at: '2026-10-21T05:00:00+00:00',
  released: true,
  signed: [
    { category: 'welcome', text: 'Accueil top', author: { id: 'u1', party: 'p1', name: 'Alice Tremblay', email: 'alice@test.local' } }
  ],
  private: [{ category: 'welcome', text: 'Zèbre' }, { category: 'welcome', text: 'Abricot' }, { category: 'welcome', text: 'Mangue' }]
};
const category = name => screen.getByRole('region', { name });

test('grouped by category: the named answer with its author, the anonymous ones as « Anonyme », in the database\'s order', () => {
  render(<BilanAnswers result={closed} />);
  const welcome = category(fr.bilanCategoryWelcome);
  const items = within(welcome).getAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual([
    'Alice TremblayAccueil top',
    `${fr.adminBilanAnonymous}Zèbre`,
    `${fr.adminBilanAnonymous}Abricot`,
    `${fr.adminBilanAnonymous}Mangue`
  ]);
  // Every category, in order, with its count; an empty one says so.
  expect(screen.getAllByRole('region').map(region => region.getAttribute('aria-labelledby')))
    .toEqual(['welcome', 'party_music', 'safety', 'lodging', 'food', 'communications', 'schedule', 'other'].map(c => `bilan-category-${c}`));
  expect(within(welcome).getByText('4')).toBeInTheDocument();
  expect(within(category(fr.bilanCategoryFood)).getByText(fr.adminBilanCategoryEmpty)).toBeInTheDocument();
  expect(within(category(fr.bilanCategoryFood)).getByText('0')).toBeInTheDocument();
});

test('the anonymous answers carry no id, date or attribute in the DOM', () => {
  const { container } = render(<BilanAnswers result={closed} />);
  const anonymous = screen.getByText('Zèbre').closest('li');
  expect(anonymous.attributes).toHaveLength(1); // class only
  expect(container.innerHTML).not.toMatch(/u1|p1|2026-10-10/);
});

// The database returns `private: []` until the release: none listed.
test('no anonymous answers shown: the named ones only', () => {
  render(<BilanAnswers result={{ ...closed, released: false, private: [] }} />);
  const welcome = category(fr.bilanCategoryWelcome);
  expect(within(welcome).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Alice TremblayAccueil top']);
  expect(within(welcome).queryByText(fr.adminBilanAnonymous)).toBeNull();
});

test('no answer at all: the empty state, no category', () => {
  render(<BilanAnswers result={{ ...closed, signed: [], private: [] }} />);
  expect(screen.getByText(fr.adminBilanEmptyTitle)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: fr.bilanCategoryWelcome })).toBeNull();
});
